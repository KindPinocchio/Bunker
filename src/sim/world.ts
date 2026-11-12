import type { Content } from "../content/load";
import { initializeBedroom, validateBedroom } from "./bedroom.ts";
import { canonicalStringify } from "./canonical.ts";
import { createRngStreams, Pcg32 } from "./pcg32.ts";
import { SCHEMA_VERSION, CLOTHING_SLOTS } from "./constants.ts";
import type { ItemState, WorldState } from "./state.ts";

export function buildGraphs(world: Pick<WorldState, "doors" | "relays">, content: Content): WorldState["graphs"] {
  const links = content.doors.map((door) => ({ id: door.id, from: door.rooms[0], to: door.rooms[1], open: world.doors[door.id]!.position === "open" }));
  return {
    navigation: structuredClone(links), rats: structuredClone(links),
    hydraulic: links.filter((edge) => edge.id.startsWith("door:")),
    stairs: links.filter((edge) => edge.id.startsWith("stair:")), thermal: structuredClone(links),
    power: content.relays.flatMap((relay) => (relay.targets ?? [relay.target!]).map((target) => ({ id: `${relay.id}:${target}`, from: relay.id, to: target, open: world.relays[relay.id]!.contactClosed }))),
    infection: [], // Surface geometry will be authored with the biological systems.
  };
}

export function createWorld(content: Content, seedInput: string, profile: WorldState["profile"] = "engineering"): WorldState {
  const seed = seedInput.trim();
  if (!seed || seed.length > 200) throw new Error("Seed должен содержать от 1 до 200 символов");
  const rng = createRngStreams(seed);
  const random = Pcg32.restore(rng.world);
  const initial = content.balance.initial;
  const draw = ([low, high]: [number, number]) => low + (high - low) * random.nextFloat();
  const items: Record<string, ItemState> = {};
  const installed = (id: string, typeId: string) => {
    const itemId = `item:${id}`;
    items[itemId] = { id: itemId, typeId, location: { kind: "installed", socketId: id }, infectionPercent: 0, damagePercent: draw(initial.installed_damage_range), protectionUntilTick: 0, durability: null };
    return itemId;
  };
  const relays = Object.fromEntries(content.relays.map((relay) => {
    const command = relay.kind === "lighting" || relay.kind === "external_feed";
    return [relay.id, { id: relay.id, roomId: relay.room, itemId: installed(relay.id, "relay"), command, contactClosed: command, episode: null }];
  }));
  const sensors = Object.fromEntries(content.sensors.map((sensor) => [sensor.id, {
    id: sensor.id, roomId: sensor.room, itemId: installed(sensor.id, sensor.kind === "temperature" ? "temperature_sensor" : sensor.kind === "water" ? "flood_sensor" : "battery_charge_sensor"), kind: sensor.kind,
    signal: sensor.kind === "temperature" ? initial.temperature_c : sensor.kind === "water" ? initial.water_cm : initial.battery_charge_fraction * 100, episode: null,
  }]));
  const pipes = Object.fromEntries(content.pipes.map((pipe) => [pipe.id, { id: pipe.id, roomId: pipe.room, itemId: installed(pipe.id, "heating_pipe") }]));
  const clothing = {} as WorldState["player"]["clothing"];
  for (const slot of CLOTHING_SLOTS) {
    const id = `starter:${slot}`;
    const typeId = slot === "head" ? "headwear" : slot;
    items[id] = { id, typeId, location: { kind: "worn", slot }, infectionPercent: 0, damagePercent: 0, protectionUntilTick: 0, durability: content.balance.clothing.durability.ordinary };
    clothing[slot] = id;
  }
  const faults = ["bearing", "seal", "impeller", "winding"] as const;
  const pumps: WorldState["pumps"] = Object.fromEntries(content.relays.filter((r) => r.kind === "motor_contactor").map((relay) => {
    const id = relay.target!;
    return [id, { id, roomId: relay.room, group: id.startsWith("geo") ? "geo" : "drain", wearPercent: draw(initial.pump_wear_range), infectionPercent: 0, fault: faults[random.bounded(4)]!, inService: true, command: false, status: "stopped", retryAtTick: null }];
  }));
  const batteryDamage = draw(initial.installed_damage_range);
  const capacity = content.balance.power.battery_nominal_kj * (1 - batteryDamage / 100);
  const controllerDamage = draw(initial.installed_damage_range);
  rng.world = random.snapshot();
  const exit = content.layout.accessible_exit;
  const world: WorldState = {
    profile, bedroom: null, schemaVersion: SCHEMA_VERSION, balanceVersion: content.balance.version, contentFingerprint: content.fingerprint, seed, tick: 0, status: "active", nextEntitySequence: 1, rng,
    rooms: Object.fromEntries(content.rooms.map((room) => [room.id, { id: room.id, temperatureC: initial.temperature_c, waterM3: initial.water_cm / 100 * room.area, heatingValveOpen: room.id !== "u_control", drainValveOpen: true, heatingRequest: false, floodIsolation: false, temperatureIsolation: false }])),
    doors: Object.fromEntries(content.doors.map((door) => [door.id, { id: door.id, mode: door.initialMode, position: door.initialPosition, automaticCommand: "open" }])),
    items, sensors, relays, pipes, pumps,
    battery: { damagePercent: batteryDamage, infectionPercent: 0, capacityKj: capacity, energyKj: capacity * initial.battery_charge_fraction, outputEnabled: true },
    controller: { damagePercent: controllerDamage, infectionPercent: 0, powered: true, lastSelfTest: null, heatTrend: [], waterTrend: [], heatStage: 0, drainStage: 0, heatLastCheckTick: 0, drainLastCheckTick: 0, heatLastStageTick: 0, drainLastStageTick: 0, heatImprovementChecks: 0 },
    power: { source: "external", externalAvailable: true, externalBreakerClosed: true, overloadTicks: 0, loadKw: 0, lastStepLoadKw: 0 },
    player: { roomId: exit.room, x: exit.x + 0.75, y: exit.y, backpack: Array.from({ length: 10 }, () => null), hands: null, clothing, hazards: { cold: 0, heat: 0, poison: 0, oxygen: 0 }, action: null },
    observations: {}, graphs: { navigation: [], rats: [], hydraulic: [], stairs: [], thermal: [], power: [], infection: [] }, lastTickPhases: [],
  };
  if (profile === "bedroom") initializeBedroom(world, content);
  world.graphs = buildGraphs(world, content);
  return world;
}

/** Cross-reference/ownership checks after schema parsing, before replacing a session. */
export function validateWorld(world: WorldState, content: Content): void {
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const equalIds = (actual: string[], expected: string[], label: string) => assert(canonicalStringify(actual.sort()) === canonicalStringify(expected.sort()), `Неверный состав: ${label}`);
  assert(world.contentFingerprint === content.fingerprint, "Снимок создан с другим комплектом данных");
  assert(world.balanceVersion === content.balance.version, "Неизвестная версия баланса");
  equalIds(Object.keys(world.rooms), content.rooms.map((r) => r.id), "комнаты");
  equalIds(Object.keys(world.doors), content.doors.map((d) => d.id), "двери");
  equalIds(Object.keys(world.sensors), content.sensors.map((s) => s.id), "датчики");
  equalIds(Object.keys(world.relays), content.relays.map((r) => r.id), "реле");
  equalIds(Object.keys(world.pipes), content.pipes.map((p) => p.id), "трубы");
  equalIds(Object.keys(world.pumps), content.relays.filter((r) => r.kind === "motor_contactor").map((r) => r.target!), "насосы");
  for (const table of [world.rooms, world.doors, world.items, world.sensors, world.relays, world.pipes, world.pumps]) for (const [id, entity] of Object.entries(table)) assert(id === entity.id, `ID не совпадает с ключом: ${id}`);
  const catalog = Object.fromEntries(content.items.map((item) => [item.id, item]));
  const references = new Map<string, string[]>();
  const reference = (id: string | null, owner: string) => {
    if (id === null) return;
    assert(world.items[id], `Нет предмета ${id}`);
    references.set(id, [...(references.get(id) ?? []), owner]);
  };
  for (const definition of [...content.relays, ...content.sensors, ...content.pipes]) {
    const component = world.relays[definition.id] ?? world.sensors[definition.id] ?? world.pipes[definition.id];
    assert(component?.roomId === definition.room, `Деталь ${definition.id} не в своей комнате`);
    reference(component!.itemId, `installed:${definition.id}`);
    if (component!.itemId) {
      const sensor = content.sensors.find((s) => s.id === definition.id);
      const expectedType = sensor ? sensor.kind === "temperature" ? "temperature_sensor" : sensor.kind === "water" ? "flood_sensor" : "battery_charge_sensor" : content.pipes.some((p) => p.id === definition.id) ? "heating_pipe" : "relay";
      assert(world.items[component!.itemId!]!.typeId === expectedType, `Несовместимый компонент ${definition.id}`);
    }
  }
  world.player.backpack.forEach((itemId, slot) => reference(itemId, `backpack:${slot}`));
  reference(world.player.hands, "hands");
  for (const [slot, itemId] of Object.entries(world.player.clothing)) reference(itemId, `worn:${slot}`);
  for (const item of Object.values(world.items)) if (item.location.kind === "container") {
    assert(world.bedroom?.containers[item.location.containerId], `Неизвестный контейнер ${item.id}`);
    reference(item.id, `container:${item.location.containerId}`);
  }
  for (const item of Object.values(world.items)) {
    assert(catalog[item.typeId], `Неизвестный тип ${item.typeId}`);
    const owners = references.get(item.id) ?? [];
    const location = item.location;
    const owner = location.kind === "installed" ? `installed:${location.socketId}` : location.kind === "backpack" ? `backpack:${location.slot}` : location.kind === "worn" ? `worn:${location.slot}` : location.kind === "container" ? `container:${location.containerId}` : location.kind;
    if (["floor", "destroyed"].includes(location.kind)) assert(owners.length === 0, `Лишнее владение ${item.id}`);
    else assert(owners.length === 1 && owners[0] === owner, `Нарушено владение ${item.id}`);
    if (location.kind === "floor") assert(world.rooms[location.roomId], `Пол неизвестной комнаты ${item.id}`);
    if (location.kind === "worn") assert(catalog[item.typeId]!.equipment_slot === location.slot && (item.durability ?? 0) > 0, `Неверная экипировка ${item.id}`);
  }
  validateBedroom(world, content);
  assert(world.rooms[world.player.roomId], "Игрок в неизвестной комнате");
  const room = content.rooms.find((r) => r.id === world.player.roomId)!;
  assert(world.player.x >= room.x && world.player.x <= room.x + room.width && world.player.y >= room.y && world.player.y <= room.y + room.depth, "Игрок вне комнаты");
  assert(world.battery.energyKj <= world.battery.capacityKj, "Заряд выше ёмкости батареи");
  const expectedCapacity = content.balance.power.battery_nominal_kj * (1 - world.battery.damagePercent / 100);
  assert(Math.abs(world.battery.capacityKj - expectedCapacity) <= content.balance.simulation.numeric_epsilon, "Ёмкость не соответствует повреждению батареи");
  for (const definition of content.sensors) assert(world.sensors[definition.id]?.kind === definition.kind, `Неверный тип датчика ${definition.id}`);
  for (const relay of content.relays.filter((r) => r.kind === "motor_contactor")) {
    const pump = world.pumps[relay.target!]!;
    assert(pump.roomId === relay.room && pump.group === (pump.id.startsWith("geo") ? "geo" : "drain"), `Неверное размещение/группа насоса ${pump.id}`);
  }
  const c = world.controller;
  for (const samples of [c.heatTrend, c.waterTrend]) for (const [index, sample] of samples.entries()) assert(sample.tick <= world.tick && sample.tick >= world.tick - content.balance.pump.staging_up_s && (index === 0 || samples[index - 1]!.tick < sample.tick), "Некорректная история тренда ЦБУ");
  assert([c.heatLastCheckTick, c.drainLastCheckTick, c.heatLastStageTick, c.drainLastStageTick].every((tick) => tick <= world.tick), "Будущий таймер ЦБУ");
  assert(!c.lastSelfTest || c.lastSelfTest.tick <= world.tick, "Будущая самодиагностика ЦБУ");
  for (const state of Object.values(world.rng)) Pcg32.restore(state);
  if (world.player.action) {
    const action = world.player.action;
    assert(action.kind !== "inspect-sensor" || world.sensors[action.targetId], "Неизвестная цель действия");
    assert(action.kind !== "cbu-diagnostics" || action.targetId === "controller", "Неверная цель самодиагностики");
    assert(action.kind !== "breaker-reset" || action.targetId === "external-board", "Неверная цель сброса автомата");
    assert(action.startedAtTick <= world.tick && action.endsAtTick > world.tick, "Неверный остаток времени действия");
    const duration = action.kind === "inspect-sensor" ? content.balance.actions_s.detail_inspect : action.kind === "cbu-diagnostics" ? content.balance.actions_s.cbu_diagnostics : content.balance.power.breaker_reset_action_s;
    assert(action.endsAtTick - action.startedAtTick === duration, "Неверная длительность действия");
    assert(action.reservations.length === 0, "Это действие не резервирует слоты");
  }
  for (const [id, observation] of Object.entries(world.observations)) assert(world.sensors[id] && observation.tick <= world.tick, "Неизвестное или будущее наблюдение");
  assert(canonicalStringify(world.graphs) === canonicalStringify(buildGraphs(world, content)), "Сохранённые графы не соответствуют дверям/реле");
}
