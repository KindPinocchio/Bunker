import { z } from "zod";
import { SCHEMA_VERSION, CLOTHING_SLOTS, TICK_PHASES } from "./constants.ts";

export { SCHEMA_VERSION, TICK_PHASES } from "./constants.ts";
export const slotSchema = z.enum(CLOTHING_SLOTS);
const text = z.string().min(1);
const value = z.number().finite();
const tick = value.int().nonnegative();
const percent = value.min(0).max(100);
const record = <T extends z.ZodType>(schema: T) => z.record(text, schema);
export const doorModeSchema = z.enum(["open", "closed", "auto"]);
const position = z.enum(["open", "closed"]);
const point = { roomId: text, x: value, y: value };
export const itemLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("floor"), ...point }),
  z.strictObject({ kind: z.literal("container"), containerId: text }),
  z.strictObject({ kind: z.literal("installed"), socketId: text }),
  z.strictObject({ kind: z.literal("backpack"), slot: tick.max(9) }),
  z.strictObject({ kind: z.literal("hands") }),
  z.strictObject({ kind: z.literal("worn"), slot: slotSchema }),
  z.strictObject({ kind: z.literal("destroyed") }),
]);
export const itemSchema = z.strictObject({
  id: text, typeId: text, location: itemLocationSchema, infectionPercent: percent,
  damagePercent: percent, protectionUntilTick: tick, durability: value.nonnegative().nullable(),
});
export const actionSchema = z.strictObject({
  kind: z.enum(["inspect-sensor", "cbu-diagnostics", "breaker-reset"]), targetId: text, startedAtTick: tick, endsAtTick: tick,
  reservations: z.array(z.strictObject({ itemId: text, location: itemLocationSchema })),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("flashlight"), enabled: z.boolean() }),
  z.strictObject({ type: z.literal("walk-to"), x: value, y: value }),
  z.strictObject({ type: z.literal("move-input"), dx: value.int().min(-1).max(1), dy: value.int().min(-1).max(1) }),
  z.strictObject({ type: z.literal("search-container"), containerId: text }),
  z.strictObject({ type: z.literal("transfer-item"), itemId: text, to: z.enum(["backpack","hands","floor","container"]), containerId: text.optional() }),
  z.strictObject({ type: z.literal("wear-item"), itemId: text }),
  z.strictObject({ type: z.literal("remove-clothing"), slot: slotSchema, to: z.enum(["backpack","floor"]) }),
  z.strictObject({ type: z.literal("door-mode"), doorId: text, mode: doorModeSchema }),
  z.strictObject({ type: z.literal("inspect-sensor"), sensorId: text }),
  z.strictObject({ type: z.literal("room-valve"), roomId: text, circuit: z.enum(["heating", "drain"]), open: z.boolean() }),
  z.strictObject({ type: z.literal("room-condition"), roomId: text, temperatureC: value.max(100), waterCm: value.nonnegative() }),
  z.strictObject({ type: z.literal("pump-service"), pumpId: text, inService: z.boolean() }),
  z.strictObject({ type: z.literal("external-line"), available: z.boolean() }),
  z.strictObject({ type: z.literal("battery-output"), enabled: z.boolean() }),
  z.strictObject({ type: z.literal("cbu-diagnostics") }),
  z.strictObject({ type: z.literal("breaker-reset") }),
  z.strictObject({ type: z.literal("component-condition"), componentId: text, damagePercent: percent, infectionPercent: percent }),
  z.strictObject({ type: z.literal("pump-condition"), pumpId: text, wearPercent: percent, infectionPercent: percent }),
]);
export const loggedCommandSchema = z.strictObject({
  tick, frame: tick, sequence: tick.positive(), scope: z.enum(["developer","player"]), command: commandSchema,
});
const pcg = z.strictObject({ state: z.string().regex(/^[0-9a-f]{16}$/), increment: z.string().regex(/^[0-9a-f]{16}$/).refine((s) => Boolean(BigInt(`0x${s}`) & 1n), "Чётный increment PCG32") });
const edge = z.strictObject({ id: text, from: text, to: text, open: z.boolean() });
export const graphSchema = z.strictObject({ navigation: z.array(edge), rats: z.array(edge), hydraulic: z.array(edge), stairs: z.array(edge), thermal: z.array(edge), power: z.array(edge), infection: z.array(edge) });
const episode = z.strictObject({ untilTick: tick, value: value.nullable() }).nullable();
export const worldSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), balanceVersion: z.literal("1.1"), contentFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  seed: text.max(200), tick, status: z.literal("active"), nextEntitySequence: tick.positive(),
  profile: z.enum(["engineering","bedroom"]),
  bedroom: z.strictObject({
    flashlight: z.boolean(),
    frame: tick, path: z.array(z.strictObject({x:value,y:value})), dx:value, dy:value, facingX:value, facingY:value,
    turnTarget:z.strictObject({x:value,y:value}).nullable(),
    action:z.strictObject({kind:z.enum(["search","wear","remove"]),targetId:text,endFrame:tick,startFrame:tick,slot:slotSchema.nullable(),backpackSlot:tick.max(9).nullable(),toFloor:z.boolean()}).nullable(),
    containers:record(z.strictObject({id:text,searched:z.boolean(),capacity:tick.positive()})),
    traits:record(z.strictObject({warmth:value.nonnegative(),chemical:value.nonnegative(),maxDurability:value.nonnegative().nullable(),materialId:text.nullable()})),
  }).nullable(),
  rng: z.strictObject({ world: pcg, loot: pcg, fungus: pcg, rats: pcg, equipment: pcg }),
  rooms: record(z.strictObject({ id: text, temperatureC: value, waterM3: value.nonnegative(), heatingValveOpen: z.boolean(), drainValveOpen: z.boolean(), heatingRequest: z.boolean(), floodIsolation: z.boolean(), temperatureIsolation: z.boolean() })),
  doors: record(z.strictObject({ id: text, mode: doorModeSchema, position, automaticCommand: position })),
  items: record(itemSchema),
  sensors: record(z.strictObject({ id: text, roomId: text, itemId: text.nullable(), kind: z.enum(["temperature", "water", "charge"]), signal: value.nullable(), episode })),
  relays: record(z.strictObject({ id: text, roomId: text, itemId: text.nullable(), command: z.boolean(), contactClosed: z.boolean(), episode })),
  pipes: record(z.strictObject({ id: text, roomId: text, itemId: text.nullable() })),
  pumps: record(z.strictObject({ id: text, roomId: text, group: z.enum(["geo", "drain"]), wearPercent: percent, infectionPercent: percent, fault: z.enum(["bearing", "seal", "impeller", "winding"]), inService: z.boolean(), command: z.boolean(), status: z.enum(["stopped", "running", "out-of-service", "start-error"]), retryAtTick: tick.nullable() })),
  battery: z.strictObject({ damagePercent: percent, infectionPercent: percent, capacityKj: value.nonnegative(), energyKj: value.nonnegative(), outputEnabled: z.boolean() }),
  controller: z.strictObject({ damagePercent: percent, infectionPercent: percent, powered: z.boolean(), lastSelfTest: z.strictObject({ tick, damagePercent: percent }).nullable(), heatTrend: z.array(z.strictObject({ tick, value })), waterTrend: z.array(z.strictObject({ tick, value })), heatStage: tick.max(3), drainStage: tick.max(3), heatLastCheckTick: tick, drainLastCheckTick: tick, heatLastStageTick: tick, drainLastStageTick: tick, heatImprovementChecks: tick }),
  power: z.strictObject({ source: z.enum(["external", "battery", "none"]), externalAvailable: z.boolean(), externalBreakerClosed: z.boolean(), overloadTicks: tick, loadKw: value.nonnegative(), lastStepLoadKw: value.nonnegative() }),
  player: z.strictObject({ ...point, backpack: z.array(text.nullable()).length(10), hands: text.nullable(), clothing: z.strictObject({ boots: text.nullable(), trousers: text.nullable(), jacket: text.nullable(), head: text.nullable(), gloves: text.nullable() }), hazards: z.strictObject({ cold: percent, heat: percent, poison: percent, oxygen: percent }), action: actionSchema.nullable() }),
  observations: record(z.strictObject({ tick, infectionPercent: percent })),
  graphs: graphSchema,
  lastTickPhases: z.array(z.enum(TICK_PHASES)),
});
export const clockSchema = z.strictObject({ paused: z.boolean(), remainderMs: value.min(0).lt(1000) });
export const snapshotSchema = z.strictObject({
  format: z.literal("bunker.snapshot"), schemaVersion: z.literal(SCHEMA_VERSION),
  world: worldSchema, clock: clockSchema, commands: z.array(loggedCommandSchema),
});
export type WorldState = z.infer<typeof worldSchema>;
export type ItemState = z.infer<typeof itemSchema>;
export type ItemLocation = z.infer<typeof itemLocationSchema>;
export type Command = z.infer<typeof commandSchema>;
export type LoggedCommand = z.infer<typeof loggedCommandSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ClockState = z.infer<typeof clockSchema>;
