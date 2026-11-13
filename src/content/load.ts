import { z } from "zod";
import balanceSource from "../../data/bunker_balance_v1_1.json";
import layoutSource from "../../docs/spec/bunker_floor_plan_v1.json";
import engineeringSource from "../../docs/spec/bunker_engineering_manifest_v1.json";
import catalogSource from "../../docs/spec/bunker_loot_catalog_v1.json";
import dressingSource from "../../docs/spec/bunker_room_dressing_v1.json";
import { canonicalStringify, compareIds, fingerprint } from "../sim/canonical";
import { RNG_STREAMS } from "../sim/pcg32";
import { BEDROOM_CONTENT } from "./bedroom";

const id = z.string().min(1).regex(/^[a-zA-Z0-9_:.-]+$/);
const number = z.number().finite();
const positive = number.positive();
const percent = number.min(0).max(100);
const range = z.tuple([percent, percent]).refine(([a, b]) => a <= b, "Начало диапазона больше конца");
const point = z.object({ room: id, x: number, y: number });
const pair = z.tuple([id, id]);
const balanceSchema = z.looseObject({
  version: z.literal("1.1"),
  player: z.looseObject({ walk_m_s: positive, interaction_m: positive, sight_m: positive, flashlight_range_m: positive, flashlight_cone_deg: positive.max(360), flashlight_near_m: positive }),
  simulation: z.object({ tick_s: z.literal(1), rng: z.literal("PCG32"), streams: z.tuple(RNG_STREAMS.map((s) => z.literal(s)) as [z.ZodLiteral<"world">, z.ZodLiteral<"loot">, z.ZodLiteral<"fungus">, z.ZodLiteral<"rats">, z.ZodLiteral<"equipment">]), numeric_epsilon: positive }),
  initial: z.looseObject({ temperature_c: number, water_cm: number.nonnegative(), battery_charge_fraction: number.min(0).max(1), doors: z.literal("open"), door_mode: z.literal("auto"), valves: z.literal("open"), pumps: z.literal("in_service"), pump_wear_range: range, installed_damage_range: range, loose_part_damage_range: range, relay_count: z.literal(35) }),
  fungus: z.looseObject({ growth_max_pp_s: positive, temperature_response: z.object({ kind: z.literal("triangular"), min_c: number, optimum_c: number, max_c: number }).refine((r) => r.min_c < r.optimum_c && r.optimum_c < r.max_c, "Неверные границы F(T)") }),
  pump: z.object({ nominal_life_s: positive, dry_multiplier: positive, fungus_wear_extra: number.nonnegative(), wear_flow_loss_at_full: number.min(0).max(1), fungus_flow_loss_at_full: number.min(0).max(1), fault_start_wear: percent, fault_max: number.min(0).max(1), neighbor_wear_cap: number.min(0).max(1), restart_retry_s: positive.int(), staging_up_s: positive.int(), drain_staging_down_s: positive.int(), heat_staging_down_s: positive.int(), water_trend_improvement_cm: positive, heat_trend_improvement_c: positive, geothermal_nominal_kw: positive, drain_nominal_kw: positive, fungus_effect_active_only: z.literal(true) }),
  power: z.object({ line_capacity_kw: positive, overload_grace_s: positive.int(), breaker_reset_action_s: positive.int(), battery_nominal_kj: positive, battery_charge_kw: positive, cbu_kw: number.nonnegative(), sensor_kw_each: number.nonnegative(), relay_kw_each: number.nonnegative(), light_kw_per_room: number.nonnegative(), closed_door_kw_each: number.nonnegative(), battery_light_brightness: number.min(0).max(1), battery_light_power_factor: number.min(0).max(1) }),
  engineering: z.object({ reference_area_m2: positive, reference_volume_m3: positive, cooling_fraction_s: number.min(0).max(1), max_temperature_c: number, floor_delta_m: positive, stair_flow_m3_s: positive, drain_nominal_m3_s_each: positive, pipe_max_leak_m3_s: positive, pipe_temperature_gain_reference_c_s: positive, heating_on_c: number, heating_off_c: number, flood_close_cm: number.nonnegative(), flood_release_cm: z.literal(0), pipe_count_per_heated_room: z.literal(1) }),
  fault_signals: z.object({ bridge_probability_coefficient: number.min(0).max(1), episode_duration_s: z.tuple([positive.int(), positive.int()]), false_temperature_choices_c: z.array(number).min(1), false_water_choices_cm: z.array(number.nonnegative()).min(1), false_charge_choices_percent: z.array(percent).min(1) }),
  actions_s: z.record(z.string(), number.nonnegative().int()),
  clothing: z.looseObject({ movement_damage_per_m: number.nonnegative(), heavy_carry_extra_per_m: number.nonnegative(), movement_shares: z.record(z.string(),number.nonnegative()), warmth_caps: z.record(z.string(),number.nonnegative()), durability: z.looseObject({ ordinary: positive, insulated: positive }) }),
  loot: z.looseObject({ loose_item_count: z.literal(72), category_counts: z.record(z.string(), number.nonnegative().int()), containers_per_room: z.record(id, number.nonnegative().int()), base_prices_by_catalog_number: z.record(z.string(), number.nonnegative()), rarity_probabilities: z.array(number.min(0).max(1)).length(3) }),
});
const roomSchema = z.object({ id, floor: z.enum(["upper", "lower"]), name: z.string(), x: number, y: number, width: positive, depth: positive, area: positive, volume: positive });
const doorSchema = z.object({ rooms: pair, x: number, y: number, initial_state: z.null() });
const layoutSchema = z.object({ status: z.string(), units: z.literal("m"), height: positive, floor_elevations: z.object({ upper: number, lower: number }), rooms: z.array(roomSchema).length(17), doors: z.array(doorSchema).length(15), stairs: z.array(doorSchema.extend({ id, label: z.string(), flow_capacity_m3_s: positive })).length(2), accessible_exit: point, blocked_main_entrance: point, corridor_controls: z.array(point) });
const relaySchema = z.object({ id, kind: z.enum(["heat_branch", "motor_contactor", "external_feed", "lighting"]), room: id, target: id.optional(), targets: z.array(id).optional() });
const engineeringSchema = z.object({
  version: z.literal("1.0"), status: z.string(), relays: z.array(relaySchema).length(35),
  room_sensor_cabinets: z.array(z.object({ room: id, sensors: z.array(z.object({ id, kind: z.enum(["temperature", "water"]) })).length(2), relay_ids: z.array(id) })).length(17),
  battery_charge_sensor: z.object({ id, kind: z.literal("charge"), room: id }),
  heating_pipes: z.array(z.object({ id, room: id })).length(16),
  motor_cabinets: z.array(z.object({ room: id, relay_ids: z.array(id).length(3) })).length(2),
  external_board: z.object({ room: id, relay_id: id, breaker_reset_s: positive }), note: z.string(),
});
const itemSchema = z.looseObject({ number: positive.int(), id, name: z.string(), category: z.string(), purpose: z.string(), locations: z.string(), carry: z.enum(["backpack", "hands"]), equipment_slot: z.enum(["boots", "trousers", "jacket", "head", "gloves"]).nullable(), base_value_points: number.nonnegative() });
const sourceSchema = z.object({
  balance: balanceSchema,
  layout: layoutSchema,
  engineering: engineeringSchema,
  catalog: z.object({ status: z.string(), item_type_count: z.literal(30), items: z.array(itemSchema).length(30) }),
  dressing: z.object({ status: z.string(), visual_reference: z.string(), poster_style: z.string(), rooms: z.array(z.object({ room_id: id, name: z.string(), furniture: z.string(), clutter: z.string(), poster_slogan: z.string(), poster_composition: z.string() })).length(17) }),
});

export const RAW_CONTENT = { balance: balanceSource, layout: layoutSource, engineering: engineeringSource, catalog: catalogSource, dressing: dressingSource };
export type RoomDefinition = z.infer<typeof roomSchema>;
export type ItemDefinition = z.infer<typeof itemSchema> & { group: string };
export interface DoorDefinition { id: string; rooms: [string, string]; x: number; y: number; kind: "horizontal" | "stair"; label: string; initialMode: "auto"; initialPosition: "open" }
export type Content = ReturnType<typeof loadContent>;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function unique(values: string[], label: string): void {
  requireCondition(new Set(values).size === values.length, `Повтор ID: ${label}`);
}
function sameIds(actual: string[], expected: string[], label: string): void {
  requireCondition(canonicalStringify([...actual].sort()) === canonicalStringify([...expected].sort()), `Несогласованный состав: ${label}`);
}
function contains(room: RoomDefinition, x: number, y: number): boolean {
  return x >= room.x && x <= room.x + room.width && y >= room.y && y <= room.y + room.depth;
}
function boundary(room: RoomDefinition, x: number, y: number): boolean {
  return contains(room, x, y) && (x === room.x || x === room.x + room.width || y === room.y || y === room.y + room.depth);
}
const groups: Record<string, string> = {
  "Инженерный компонент": "engineering", "Расходник": "aerosol", "Исследовательская находка": "injectors", "Экипировка": "clothing", "Документ": "documents", "Личные бумаги": "documents", "Ценность": "valuables", "Хлам": "junk", "Хлам и личная вещь": "junk",
};

export function loadContent(input: unknown = RAW_CONTENT) {
  try {
    // Reject non-JSON/non-finite values even in preserved fields not used by this kernel yet.
    z.json().parse(input);
    const data = sourceSchema.parse(input);
    const { balance, layout, engineering, catalog, dressing } = data;
    const rooms = [...layout.rooms].sort(compareIds);
    const roomIds = rooms.map((r) => r.id);
    unique(roomIds, "комнаты");
    const byRoom = Object.fromEntries(rooms.map((r) => [r.id, r]));
    const getRoom = (roomId: string) => { const r = byRoom[roomId]; requireCondition(r, `Неизвестная комната ${roomId}`); return r; };
    requireCondition(rooms.reduce((sum, r) => sum + r.area, 0) === 376 && rooms.reduce((sum, r) => sum + r.volume, 0) === 1128, "Неверная общая площадь/объём");
    for (const room of rooms) {
      requireCondition(room.width * room.depth === room.area && room.area * layout.height === room.volume, `Неверная геометрия ${room.id}`);
      for (const other of rooms) if (room.id < other.id && room.floor === other.floor) {
        requireCondition(!(Math.min(room.x + room.width, other.x + other.width) > Math.max(room.x, other.x) && Math.min(room.y + room.depth, other.y + other.depth) > Math.max(room.y, other.y)), `Пересечение комнат ${room.id}/${other.id}`);
      }
    }
    const doors: DoorDefinition[] = [
      ...layout.doors.map((d) => ({ ...d, id: `door:${[...d.rooms].sort().join(":")}`, kind: "horizontal" as const, label: `${getRoom(d.rooms[0]).name} / ${getRoom(d.rooms[1]).name}`, initialMode: balance.initial.door_mode, initialPosition: balance.initial.doors })),
      ...layout.stairs.map((s) => ({ ...s, id: `stair:${s.id}`, kind: "stair" as const, label: `Лестница ${s.label}`, initialMode: balance.initial.door_mode, initialPosition: balance.initial.doors })),
    ].sort(compareIds);
    unique(doors.map((d) => d.id), "двери");
    const adjacent: Record<string, Set<string>> = Object.fromEntries(roomIds.map((rid) => [rid, new Set<string>()]));
    for (const d of doors) {
      const [a, b] = d.rooms.map(getRoom) as [RoomDefinition, RoomDefinition];
      requireCondition(a.id !== b.id, `Дверь в саму себя ${d.id}`);
      requireCondition(d.kind === "horizontal" ? a.floor === b.floor && boundary(a, d.x, d.y) && boundary(b, d.x, d.y) : a.floor !== b.floor && contains(a, d.x, d.y) && contains(b, d.x, d.y), `Неверный проход ${d.id}`);
      adjacent[a.id]!.add(b.id); adjacent[b.id]!.add(a.id);
    }
    for (const [first, second] of [["u_bed1", "u_bed2"], ["u_store1", "u_store2"], ["l_rat1", "l_rat2"], ["l_store3", "l_store4"]]) {
      requireCondition(adjacent[second!]?.size === 1 && adjacent[second!]!.has(first!), `Нарушена последовательная пара ${second}`);
    }
    const visited = new Set<string>(); const queue = [layout.accessible_exit.room];
    while (queue.length) { const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current); queue.push(...adjacent[current]!); }
    requireCondition(visited.size === 17, "Есть недоступные комнаты");
    for (const p of [layout.accessible_exit, layout.blocked_main_entrance, ...layout.corridor_controls]) requireCondition(contains(getRoom(p.room), p.x, p.y), `Точка вне комнаты ${p.room}`);
    const relays = [...engineering.relays].sort(compareIds);
    unique(relays.map((r) => r.id), "реле");
    for (const relay of relays) { getRoom(relay.room); requireCondition(relay.kind === "lighting" ? relay.targets?.length : relay.target, `Нет цели реле ${relay.id}`); }
    const lighting = relays.filter((r) => r.kind === "lighting");
    requireCondition(lighting.length === 12, "Нужно 12 групп света");
    sameIds(lighting.flatMap((r) => r.targets!), roomIds, "освещение");
    sameIds(relays.filter((r) => r.kind === "heat_branch").map((r) => r.target!), roomIds.filter((rid) => rid !== "u_control"), "ветви отопления");
    sameIds(relays.filter((r) => r.kind === "motor_contactor").map((r) => r.target!), ["geo_1", "geo_2", "geo_3", "drain_1", "drain_2", "drain_3"], "насосные контакторы");
    requireCondition(relays.filter((r) => r.kind === "external_feed").length === 1, "Нужен один ввод питания");
    const relayById = Object.fromEntries(relays.map((r) => [r.id, r]));
    const cabinets = [...engineering.room_sensor_cabinets, ...engineering.motor_cabinets];
    for (const cabinet of cabinets) for (const rid of cabinet.relay_ids) requireCondition(relayById[rid]?.room === cabinet.room, `Реле ${rid} не в своём шкафу`);
    sameIds([...cabinets.flatMap((c) => c.relay_ids), engineering.external_board.relay_id], relays.map((r) => r.id), "размещение реле");
    requireCondition(relayById[engineering.external_board.relay_id]?.room === engineering.external_board.room, "Неверная комната вводного реле");
    sameIds(engineering.room_sensor_cabinets.map((c) => c.room), roomIds, "шкафы датчиков");
    for (const c of engineering.room_sensor_cabinets) sameIds(c.sensors.map((s) => s.kind), ["temperature", "water"], `датчики ${c.room}`);
    const sensors = [...engineering.room_sensor_cabinets.flatMap((c) => c.sensors.map((s) => ({ ...s, room: c.room }))), engineering.battery_charge_sensor].sort(compareIds);
    unique(sensors.map((s) => s.id), "датчики");
    requireCondition(sensors.length === 35 && engineering.battery_charge_sensor.room === "l_battery", "Неверный набор датчиков");
    const pipes = [...engineering.heating_pipes].sort(compareIds);
    unique(pipes.map((p) => p.id), "трубы");
    sameIds(pipes.map((p) => p.room), roomIds.filter((rid) => rid !== "u_control"), "трубы");
    unique(catalog.items.map((i) => i.id), "каталог");
    sameIds(catalog.items.map((i) => String(i.number)), Array.from({ length: 30 }, (_, i) => String(i + 1)), "номера каталога");
    const items: ItemDefinition[] = catalog.items.map((item) => {
      requireCondition(balance.loot.base_prices_by_catalog_number[String(item.number)] === item.base_value_points, `Цена не совпадает: ${item.id}`);
      requireCondition(groups[item.category], `Неизвестная категория ${item.category}`);
      return { ...item, group: groups[item.category]! };
    }).sort(compareIds);
    requireCondition(Object.values(balance.loot.category_counts).reduce((a, b) => a + b, 0) === 72, "Неверное число находок");
    requireCondition(Object.values(balance.loot.containers_per_room).reduce((a, b) => a + b, 0) === 41, "Неверное число мест обыска");
    requireCondition(Math.abs(balance.loot.rarity_probabilities.reduce((a, b) => a + b, 0) - 1) <= balance.simulation.numeric_epsilon, "Вероятности редкости не дают 1");
    sameIds(Object.keys(balance.loot.containers_per_room), roomIds, "места обыска");
    sameIds(dressing.rooms.map((r) => r.room_id), roomIds, "обстановка");
    return { balance, rooms, doors, relays, sensors, pipes, items, dressing: dressing.rooms, layout, fingerprint: fingerprint(canonicalStringify({ data, bedroom: BEDROOM_CONTENT })), sourceVersions: { balance: balance.version, layout: "1.0", engineering: engineering.version, catalog: "1.0", dressing: "1.0", bedroom: BEDROOM_CONTENT.version } };
  } catch (error) {
    throw new Error(`Ошибка данных комплекса: ${error instanceof Error ? error.message : String(error)}`);
  }
}
