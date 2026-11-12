import type { Content } from "../content/load.ts";
import type { WorldState } from "./state.ts";
import { Pcg32 } from "./pcg32.ts";

type Pump = WorldState["pumps"][string];
type Relay = WorldState["relays"][string];
interface Zone { ids: string[]; area: number; volume: number; water: number; elevation: number }
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const sorted = <T extends { id: string }>(table: Record<string, T>) => Object.values(table).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const online = (world: WorldState) => world.power.source !== "none" && world.controller.damagePercent < 100;
const active = (temperature: number, content: Content) => temperature > content.balance.fungus.temperature_response.min_c && temperature < content.balance.fungus.temperature_response.max_c;

function installedItem(world: WorldState, component: { id: string; itemId: string | null }) {
  const item = component.itemId ? world.items[component.itemId] : undefined;
  return item?.location.kind === "installed" && item.location.socketId === component.id ? item : undefined;
}

export function waterDepthCm(world: WorldState, content: Content, roomId: string): number {
  return 100 * world.rooms[roomId]!.waterM3 / content.rooms.find((r) => r.id === roomId)!.area;
}

export function zones(world: WorldState, content: Content, includeStairs: boolean): Zone[] {
  const adjacency = new Map(content.rooms.map((room) => [room.id, [] as string[]]));
  for (const door of content.doors) {
    if (world.doors[door.id]!.position !== "open" || (!includeStairs && door.kind === "stair")) continue;
    adjacency.get(door.rooms[0])!.push(door.rooms[1]); adjacency.get(door.rooms[1])!.push(door.rooms[0]);
  }
  const seen = new Set<string>(), result: Zone[] = [];
  for (const definition of content.rooms) {
    if (seen.has(definition.id)) continue;
    const ids: string[] = [], queue = [definition.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id); ids.push(id); queue.push(...adjacency.get(id)!);
    }
    ids.sort();
    const definitions = ids.map((id) => content.rooms.find((r) => r.id === id)!);
    result.push({ ids, area: definitions.reduce((a, r) => a + r.area, 0), volume: definitions.reduce((a, r) => a + r.volume, 0), water: ids.reduce((a, id) => a + world.rooms[id]!.waterM3, 0), elevation: content.layout.floor_elevations[definition.floor] });
  }
  return result;
}

/** A.5: a signed, capacity-limited transfer; lower backpressure can reverse the flow. */
export function stairTransfer(upperWater: number, lowerWater: number, upperArea: number, lowerArea: number, upperElevation: number, lowerElevation: number, capacity: number): number {
  if (![upperWater, lowerWater, upperArea, lowerArea, upperElevation, lowerElevation, capacity].every(Number.isFinite) || upperArea <= 0 || lowerArea <= 0 || upperWater < 0 || lowerWater < 0 || capacity < 0 || upperElevation <= lowerElevation) throw new Error("Некорректные параметры лестничного переноса");
  const total = upperWater + lowerWater;
  const level = total <= lowerArea * (upperElevation - lowerElevation)
    ? lowerElevation + total / lowerArea
    : (total + lowerArea * lowerElevation + upperArea * upperElevation) / (lowerArea + upperArea);
  const equilibriumUpper = upperArea * Math.max(0, level - upperElevation);
  return clamp(upperWater - equilibriumUpper, -capacity, capacity);
}

export function equalizeHydraulics(world: WorldState, content: Content): void {
  const horizontal = zones(world, content, false);
  const byRoom = new Map(horizontal.flatMap((zone) => zone.ids.map((id) => [id, zone] as const)));
  for (const door of content.doors.filter((d) => d.kind === "stair").sort((a, b) => a.id < b.id ? -1 : 1)) {
    if (world.doors[door.id]!.position !== "open") continue;
    const a = byRoom.get(door.rooms[0])!, b = byRoom.get(door.rooms[1])!;
    const upper = a.elevation > b.elevation ? a : b, lower = upper === a ? b : a;
    const transfer = stairTransfer(upper.water, lower.water, upper.area, lower.area, upper.elevation, lower.elevation, content.balance.engineering.stair_flow_m3_s);
    upper.water -= transfer; lower.water += transfer;
  }
  for (const zone of horizontal) for (const id of zone.ids) {
    world.rooms[id]!.waterM3 = Math.max(0, zone.water) * content.rooms.find((r) => r.id === id)!.area / zone.area;
  }
}

function faultSeverity(pump: Pump, content: Content): number {
  const start = content.balance.pump.fault_start_wear;
  return clamp((pump.wearPercent - start) / (100 - start));
}
function pumpEligible(pump: Pump, world: WorldState): boolean {
  return online(world) && pump.inService && pump.wearPercent < 100 && pump.status === "running";
}

export function pumpMetrics(pump: Pump, world: WorldState, content: Content): { flowFactor: number; powerKw: number } {
  if (!pumpEligible(pump, world)) return { flowFactor: 0, powerKw: 0 };
  const config = content.balance.pump;
  const fungus = active(world.rooms[pump.roomId]!.temperatureC, content) ? pump.infectionPercent / 100 : 0;
  let flow = (1 - config.wear_flow_loss_at_full * pump.wearPercent / 100) * (1 - config.fungus_flow_loss_at_full * fungus);
  const effect = config.fault_max * faultSeverity(pump, content);
  if (pump.fault === "seal" || pump.fault === "impeller") flow *= 1 - effect;
  const nominal = pump.group === "geo" ? config.geothermal_nominal_kw : config.drain_nominal_kw;
  return { flowFactor: flow, powerKw: nominal * (pump.fault === "winding" ? 1 + effect : 1) };
}

export function groupFlow(world: WorldState, content: Content): { geothermal: number; drainM3s: number } {
  let geo = 0, drain = 0;
  for (const pump of sorted(world.pumps)) {
    const flow = pumpMetrics(pump, world, content).flowFactor;
    if (pump.group === "geo") geo += flow; else drain += flow;
  }
  return { geothermal: geo / 3, drainM3s: drain * content.balance.engineering.drain_nominal_m3_s_each };
}

export function refreshRelay(world: WorldState, definition: Content["relays"][number]): void {
  const relay = world.relays[definition.id]!;
  const item = installedItem(world, relay);
  const isExternal = definition.kind === "external_feed";
  if (isExternal) relay.command = world.power.externalAvailable;
  else if (definition.kind === "lighting") relay.command = world.power.source !== "none";
  else if (definition.kind === "heat_branch") relay.command = online(world) && world.rooms[definition.target!]!.heatingRequest;
  else relay.command = online(world) && world.pumps[definition.target!]!.command;
  const coilPowered = isExternal ? world.power.externalAvailable : world.power.source !== "none";
  const bridge = Boolean(item && item.infectionPercent > 0 && relay.episode !== null && relay.episode.untilTick > world.tick);
  relay.contactClosed = Boolean(item && item.damagePercent < 100 && (bridge || (relay.command && coilPowered)));
}

export function applyDoorPositions(world: WorldState): void {
  for (const door of sorted(world.doors)) door.position = world.power.source === "none" ? "open" : door.mode === "auto" ? door.automaticCommand : door.mode;
}

export function resolveMotors(world: WorldState, content: Content, powerRestored = false): void {
  const random = Pcg32.restore(world.rng.equipment);
  for (const pump of sorted(world.pumps)) {
    const contactor = content.relays.find((r) => r.kind === "motor_contactor" && r.target === pump.id)!;
    const desired = online(world) && pump.inService && pump.wearPercent < 100 && world.relays[contactor.id]!.contactClosed;
    if (!pump.inService) { pump.status = "out-of-service"; pump.retryAtTick = null; continue; }
    if (pump.wearPercent >= 100) { pump.status = "stopped"; pump.retryAtTick = null; continue; }
    if (!desired) { if (pump.status === "running" || pump.status === "out-of-service") pump.status = "stopped"; continue; }
    if (pump.status === "running") continue;
    if (pump.status === "start-error" && !powerRestored && pump.retryAtTick !== null && pump.retryAtTick > world.tick) continue;
    const probability = pump.fault === "winding" ? content.balance.pump.fault_max * faultSeverity(pump, content) : 0;
    if (probability > 0 && random.nextFloat() < probability) {
      pump.status = "start-error"; pump.retryAtTick = world.tick + content.balance.pump.restart_retry_s;
    } else { pump.status = "running"; pump.retryAtTick = null; }
  }
  world.rng.equipment = random.snapshot();
}

/** Phase 1 and hard-priority enforcement after energy accounting; no physics is repeated. */
export function refreshPower(world: WorldState, content: Content): void {
  const previousSource = world.power.source;
  world.battery.capacityKj = content.balance.power.battery_nominal_kj * (1 - world.battery.damagePercent / 100);
  world.battery.energyKj = clamp(world.battery.energyKj, 0, world.battery.capacityKj);
  const external = content.relays.find((r) => r.kind === "external_feed")!;
  refreshRelay(world, external);
  const grid = world.power.externalAvailable && world.power.externalBreakerClosed && world.relays[external.id]!.contactClosed;
  world.power.source = grid ? "external" : world.battery.outputEnabled && world.battery.energyKj > 0 ? "battery" : "none";
  world.controller.powered = online(world);
  if (world.power.source === "none") world.controller.lastSelfTest = null;
  if (!world.controller.powered) {
    const controller = world.controller;
    controller.heatStage = 0; controller.drainStage = 0;
    controller.heatTrend = []; controller.waterTrend = []; controller.heatImprovementChecks = 0;
    controller.heatLastCheckTick = world.tick; controller.drainLastCheckTick = world.tick;
    for (const pump of sorted(world.pumps)) pump.command = false;
  }
  for (const relay of content.relays) refreshRelay(world, relay);
  applyDoorPositions(world);
  resolveMotors(world, content, previousSource === "none" && world.power.source !== "none");
  world.power.loadKw = electricalLoadKw(world, content);
}

export function electricalLoadKw(world: WorldState, content: Content): number {
  if (world.power.source === "none") return 0;
  const power = content.balance.power;
  let load = world.controller.damagePercent < 100 ? power.cbu_kw : 0;
  load += Object.values(world.sensors).filter((s) => installedItem(world, s)).length * power.sensor_kw_each;
  load += Object.values(world.relays).filter((r) => installedItem(world, r)).length * power.relay_kw_each;
  for (const relay of content.relays.filter((r) => r.kind === "lighting")) if (world.relays[relay.id]!.contactClosed) load += relay.targets!.length * power.light_kw_per_room * (world.power.source === "battery" ? power.battery_light_power_factor : 1);
  load += Object.values(world.doors).filter((d) => d.position === "closed").length * power.closed_door_kw_each;
  for (const pump of sorted(world.pumps)) load += pumpMetrics(pump, world, content).powerKw;
  return load;
}

/** One accounting call per physical second, independent of new controller commands. */
export function settleEnergy(world: WorldState, content: Content, loadKw: number): void {
  const config = content.balance.power;
  if (!Number.isFinite(loadKw) || loadKw < 0) throw new Error("Неверная электрическая нагрузка");
  world.power.lastStepLoadKw = loadKw;
  const charge = world.power.externalAvailable ? config.battery_charge_kw : 0;
  const discharge = world.power.source === "battery" ? loadKw : 0;
  world.battery.energyKj = clamp(world.battery.energyKj + charge - discharge, 0, world.battery.capacityKj);
  if (world.power.source === "external") {
    world.power.overloadTicks = loadKw > config.line_capacity_kw ? world.power.overloadTicks + 1 : 0;
    if (world.power.overloadTicks >= config.overload_grace_s) world.power.externalBreakerClosed = false;
  } else if (world.power.externalBreakerClosed) world.power.overloadTicks = 0;
}

export function expireEngineeringEpisodes(world: WorldState): void {
  for (const component of [...Object.values(world.sensors), ...Object.values(world.relays)]) {
    const item = installedItem(world, component);
    if (component.episode && (component.episode.untilTick <= world.tick || !item || item.infectionPercent === 0)) component.episode = null;
  }
}

/** Phase 2: old motor/door state, one physical update, then committed wear and energy. */
export function advancePhysics(world: WorldState, content: Content): void {
  const flow = groupFlow(world, content);
  const loadKw = electricalLoadKw(world, content);
  const before = structuredClone(world);
  for (const definition of content.rooms) {
    const room = world.rooms[definition.id]!;
    const pipe = Object.values(world.pipes).find((p) => p.roomId === definition.id);
    const heatRelay = content.relays.find((r) => r.kind === "heat_branch" && r.target === definition.id);
    let heat = 0;
    if (pipe && room.heatingValveOpen && heatRelay && world.relays[heatRelay.id]!.contactClosed) {
      const item = installedItem(world, pipe);
      const damage = item ? item.damagePercent / 100 : 1;
      heat = content.balance.engineering.pipe_temperature_gain_reference_c_s * flow.geothermal * (content.balance.engineering.reference_volume_m3 / definition.volume) * (1 + 4 * damage);
      room.waterM3 += content.balance.engineering.pipe_max_leak_m3_s * flow.geothermal * damage;
    }
    room.temperatureC = Math.min(content.balance.engineering.max_temperature_c, (room.temperatureC + heat) * (1 - content.balance.engineering.cooling_fraction_s));
  }
  const openValves = Object.values(world.rooms).filter((r) => r.drainValveOpen).length;
  if (openValves > 0 && flow.drainM3s > 0) for (const zone of zones(world, content, false)) {
    const requested = zone.ids.filter((id) => world.rooms[id]!.drainValveOpen).length * flow.drainM3s / openValves;
    const remainingFraction = zone.water > 0 ? Math.max(0, zone.water - requested) / zone.water : 0;
    // Debit current water proportionally, without prematurely mixing newly leaked water.
    for (const id of zone.ids) world.rooms[id]!.waterM3 *= remainingFraction;
  }
  for (const zone of zones(before, content, true)) {
    const temperature = zone.ids.reduce((sum, id) => sum + world.rooms[id]!.temperatureC * content.rooms.find((r) => r.id === id)!.volume, 0) / zone.volume;
    for (const id of zone.ids) world.rooms[id]!.temperatureC = temperature;
  }
  const anyDrainOpen = Object.values(before.rooms).some((r) => r.drainValveOpen);
  const anyHeatOpen = content.pipes.some((p) => before.rooms[p.room]!.heatingValveOpen);
  for (const pump of sorted(world.pumps)) {
    const old = before.pumps[pump.id]!;
    if (!pumpEligible(old, before)) continue;
    const fungus = active(before.rooms[old.roomId]!.temperatureC, content) ? old.infectionPercent / 100 : 0;
    let extra = 0;
    for (const other of sorted(before.pumps)) if (other.id !== old.id && other.group === old.group && other.inService) {
      if (other.fault === "impeller" || (other.fault === "bearing" && pumpEligible(other, before))) extra += content.balance.pump.fault_max * faultSeverity(other, content);
    }
    const dry = old.group === "geo" ? !anyHeatOpen : !anyDrainOpen;
    const wear = (100 / content.balance.pump.nominal_life_s) * (dry ? content.balance.pump.dry_multiplier : 1) * (1 + content.balance.pump.fungus_wear_extra * fungus) * (1 + Math.min(content.balance.pump.neighbor_wear_cap, extra));
    pump.wearPercent = Math.min(100, old.wearPercent + wear);
    if (100 - pump.wearPercent <= content.balance.simulation.numeric_epsilon) { pump.wearPercent = 100; pump.status = "stopped"; pump.retryAtTick = null; }
  }
  settleEnergy(world, content, loadKw);
  refreshPower(world, content);
}

export function sensorTruth(world: WorldState, content: Content, sensorId: string): number {
  const sensor = world.sensors[sensorId]!;
  return sensor.kind === "temperature" ? world.rooms[sensor.roomId]!.temperatureC : sensor.kind === "water" ? waterDepthCm(world, content, sensor.roomId) : world.battery.capacityKj > 0 ? world.battery.energyKj / world.battery.capacityKj * 100 : 0;
}

export function pollSensors(world: WorldState, content: Content): void {
  for (const sensor of sorted(world.sensors)) {
    const item = installedItem(world, sensor);
    sensor.signal = world.power.source === "none" || !item || item.damagePercent >= 100 ? null : item.infectionPercent > 0 && sensor.episode && sensor.episode.untilTick > world.tick ? sensor.episode.value : sensorTruth(world, content, sensor.id);
  }
}

function stageGroup(world: WorldState, content: Content, group: "heat" | "drain", requested: boolean, metric: number, faulted = false): void {
  const c = world.controller, b = content.balance.pump;
  const heat = group === "heat";
  const stageKey = heat ? "heatStage" : "drainStage";
  const trendKey = heat ? "heatTrend" : "waterTrend";
  const checkKey = heat ? "heatLastCheckTick" : "drainLastCheckTick";
  const changeKey = heat ? "heatLastStageTick" : "drainLastStageTick";
  if (!requested) { c[stageKey] = 0; c[trendKey] = []; if (heat) c.heatImprovementChecks = 0; return; }
  c[trendKey].push({ tick: world.tick, value: metric });
  c[trendKey] = c[trendKey].filter((sample) => sample.tick >= world.tick - b.staging_up_s);
  if (c[stageKey] === 0) { c[stageKey] = 1; c[checkKey] = world.tick; c[changeKey] = world.tick; return; }
  if (world.tick - c[checkKey] < b.staging_up_s) return;
  const previous = c[trendKey].find((sample) => sample.tick === world.tick - b.staging_up_s);
  c[checkKey] = world.tick;
  if (!previous) return;
  const improved = !faulted && previous.value - metric >= (heat ? b.heat_trend_improvement_c : b.water_trend_improvement_cm) - content.balance.simulation.numeric_epsilon;
  if (heat) c.heatImprovementChecks = improved ? c.heatImprovementChecks + 1 : 0;
  if (!improved && c[stageKey] < 3) { c[stageKey]++; c[changeKey] = world.tick; }
  else if (improved && c[stageKey] > 1 && world.tick - c[changeKey] >= (heat ? b.heat_staging_down_s : b.drain_staging_down_s) && (!heat || c.heatImprovementChecks >= 2)) {
    c[stageKey]--; c[changeKey] = world.tick; if (heat) c.heatImprovementChecks = 0;
  }
}

/** Phase 3 reads signals only, including fixed false values and faults. */
export function updateController(world: WorldState, content: Content): void {
  pollSensors(world, content);
  if (online(world)) {
    const b = content.balance.engineering;
    for (const room of Object.values(world.rooms)) {
      const temperature = world.sensors[`${room.id}_temp`]!.signal;
      const water = world.sensors[`${room.id}_water`]!.signal;
      if (temperature === null || temperature >= b.heating_off_c) room.heatingRequest = false;
      else if (temperature <= b.heating_on_c) room.heatingRequest = room.id !== "u_control";
      if (water === null || water >= b.flood_close_cm) room.floodIsolation = true;
      else if (water === b.flood_release_cm) room.floodIsolation = false;
      if (temperature !== null) room.temperatureIsolation = temperature >= b.heating_off_c;
    }
    const requests = Object.values(world.rooms).filter((r) => r.heatingRequest);
    const heatMetric = Math.max(0, ...requests.map((r) => b.heating_off_c - world.sensors[`${r.id}_temp`]!.signal!));
    const waterSensors = Object.values(world.sensors).filter((s) => s.kind === "water");
    const drainFault = waterSensors.some((s) => s.signal === null);
    const waterMetric = Math.max(0, ...waterSensors.map((s) => s.signal ?? 0));
    stageGroup(world, content, "heat", requests.length > 0, heatMetric);
    stageGroup(world, content, "drain", drainFault || waterMetric > 0, waterMetric, drainFault);
    for (const group of ["geo", "drain"] as const) {
      const available = sorted(world.pumps).filter((p) => p.group === group && p.inService);
      const count = group === "geo" ? world.controller.heatStage : world.controller.drainStage;
      for (const pump of sorted(world.pumps).filter((p) => p.group === group)) pump.command = available.indexOf(pump) >= 0 && available.indexOf(pump) < count;
    }
    for (const door of content.doors) world.doors[door.id]!.automaticCommand = door.rooms.some((id) => world.rooms[id]!.floodIsolation || world.rooms[id]!.temperatureIsolation) ? "closed" : "open";
  } else for (const pump of sorted(world.pumps)) pump.command = false;
  for (const relay of content.relays) refreshRelay(world, relay);
  applyDoorPositions(world);
  resolveMotors(world, content);
  world.power.loadKw = electricalLoadKw(world, content);
}

/** Engineering-only part of phase 5; colony growth/damage remains a later module. */
export function updateEquipmentEpisodes(world: WorldState, content: Content): void {
  const config = content.balance.fault_signals;
  const random = Pcg32.restore(world.rng.equipment);
  const components: (WorldState["sensors"][string] | Relay)[] = [...sorted(world.sensors), ...sorted(world.relays)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const component of components) {
    const item = installedItem(world, component);
    if (!item || item.damagePercent >= 100 || component.episode || item.infectionPercent <= 0 || !active(world.rooms[component.roomId]!.temperatureC, content)) continue;
    if (random.nextFloat() >= config.bridge_probability_coefficient * item.infectionPercent / 100) continue;
    const [low, high] = config.episode_duration_s;
    const duration = low + random.bounded(high - low + 1);
    let value: number | null = null;
    if ("kind" in component) {
      const choices = component.kind === "temperature" ? config.false_temperature_choices_c : component.kind === "water" ? config.false_water_choices_cm : config.false_charge_choices_percent;
      value = choices[random.bounded(choices.length)]!;
      if (component.kind === "temperature") value += sensorTruth(world, content, component.id);
    }
    component.episode = { untilTick: world.tick + duration, value };
  }
  world.rng.equipment = random.snapshot();
}

/** Information permitted on the controller panel, without infection/wear/true readings. */
export function controllerView(world: WorldState, content: Content) {
  if (!world.controller.powered || world.controller.damagePercent >= 100) return null;
  const charge = world.sensors["battery_charge"]!.signal;
  const load = electricalLoadKw(world, content);
  return {
    source: world.power.source,
    rooms: content.rooms.map((r) => ({ id: r.id, temperature: world.sensors[`${r.id}_temp`]!.signal, waterCm: world.sensors[`${r.id}_water`]!.signal })),
    pumps: sorted(world.pumps).map((p) => ({ id: p.id, status: p.status })),
    doors: sorted(world.doors).map((d) => ({ id: d.id, position: d.position })),
    lights: content.relays.filter((r) => r.kind === "lighting").map((r) => ({ id: r.id, on: world.power.source !== "none" && world.relays[r.id]!.contactClosed })),
    chargePercent: charge,
    autonomySeconds: load === 0 ? "no-load" as const : charge === null ? null : charge / 100 * world.battery.capacityKj / load,
    selfTest: world.controller.lastSelfTest ? { ...world.controller.lastSelfTest } : null,
  };
}
