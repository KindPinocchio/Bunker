import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalStringify } from "../../src/sim/canonical.ts";
import { Pcg32 } from "../../src/sim/pcg32.ts";
import { validateWorld } from "../../src/sim/world.ts";
import { applyDeveloperCommand, stepWorld } from "../../src/sim/engine.ts";
import { advancePhysics, applyDoorPositions, controllerView, electricalLoadKw, equalizeHydraulics, expireEngineeringEpisodes, groupFlow, pollSensors, pumpMetrics, refreshPower, refreshRelay, resolveMotors, sensorTruth, settleEnergy, stairTransfer, updateController, updateEquipmentEpisodes, waterDepthCm } from "../../src/sim/engineering.ts";
import { fixture, fixtureContent, isolate, openConnection, water, connectReferenceStair } from "./fixture.mjs";

const close = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≠ ${b}`);
const totalWater = (world) => Object.values(world.rooms).reduce((sum, r) => sum + r.waterM3, 0);
function start(world, content, group, count = 1) {
  for (const p of Object.values(world.pumps).filter((p) => p.group === group)) {
    p.wearPercent = 0; p.fault = "bearing"; p.command = Number(p.id.at(-1)) <= count; p.status = p.command ? "running" : "stopped";
  }
  refreshPower(world, content);
}

test("native fixture creates all accepted entities and passes cross-reference/ownership validation", () => {
  const { world, content } = fixture();
  validateWorld(world, content);
  assert.equal(Object.keys(world.rooms).length, 17); assert.equal(Object.keys(world.items).length, 91);
  assert.equal(Object.keys(world.doors).length, 17); assert.equal(Object.keys(world.pumps).length, 6);
});

test("PCG32 matches its reference vector and restores an exact continuation", () => {
  const random = new Pcg32(42n, 54n);
  assert.deepEqual(Array.from({ length: 6 }, () => random.nextUint32()), [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);
  const restored = Pcg32.restore(random.snapshot());
  assert.deepEqual(Array.from({ length: 100 }, () => random.nextUint32()), Array.from({ length: 100 }, () => restored.nextUint32()));
});

test("horizontal mixing conserves water and weights depth by floor area", () => {
  const { world, content } = fixture(); isolate(world); openConnection(world, content, "u_corridor", "u_bed1");
  world.rooms.u_corridor.waterM3 = 0.4; world.rooms.u_bed1.waterM3 = 1.6;
  equalizeHydraulics(world, content);
  close(totalWater(world), 2); close(waterDepthCm(world, content, "u_corridor"), 200 / 56); close(waterDepthCm(world, content, "u_bed1"), 200 / 56);
});

test("one reference stair drains 0.8 m³ downwards in five seconds; closure blocks it", () => {
  const { world, content } = fixture(); const stair = connectReferenceStair(world, content);
  world.rooms.u_bed1.waterM3 = 0.8;
  for (let i = 0; i < 5; i++) { equalizeHydraulics(world, content); close(totalWater(world), 0.8); }
  close(world.rooms.u_bed1.waterM3, 0); close(world.rooms.l_store3.waterM3, 0.8);
  world.rooms.u_bed1.waterM3 = 0.8; world.rooms.l_store3.waterM3 = 0;
  world.doors[stair.id].position = "closed"; equalizeHydraulics(world, content); close(world.rooms.u_bed1.waterM3, 0.8);
});

test("lower backpressure reverses the stair flow without equilibrium overshoot", () => {
  const { world, content } = fixture(); connectReferenceStair(world, content); world.rooms.l_store3.waterM3 = 64;
  equalizeHydraulics(world, content); close(world.rooms.u_bed1.waterM3, 0.16); close(totalWater(world), 64);
  let hash = 20261112;
  const random = () => { hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0; return hash / 2 ** 32; };
  for (let i = 0; i < 10000; i++) {
    const au = 1 + random() * 199, al = 1 + random() * 199, vu = random() * 2000, vl = random() * 2000;
    const q = stairTransfer(vu, vl, au, al, 3, 0, 0.16);
    const level = vu + vl <= al * 3 ? (vu + vl) / al : (vu + vl + au * 3) / (au + al);
    const target = au * Math.max(0, level - 3);
    close((vu - q) + (vl + q), vu + vl);
    assert.ok(vu - q >= -1e-9 && vl + q >= -1e-9 && (vu - target) * (vu - q - target) >= -1e-9);
  }
});

test("open stairs mix heat by room volume, while a closed door blocks heat", () => {
  const { world, content } = fixture(); const stair = connectReferenceStair(world, content);
  world.rooms.u_bed1.temperatureC = 0; world.rooms.l_store3.temperatureC = 40;
  advancePhysics(world, content); close(world.rooms.u_bed1.temperatureC, 19.8); close(world.rooms.l_store3.temperatureC, 19.8);
  world.doors[stair.id].position = "closed"; world.doors[stair.id].mode = "closed";
  world.rooms.u_bed1.temperatureC = 0; world.rooms.l_store3.temperatureC = 40;
  advancePhysics(world, content); close(world.rooms.u_bed1.temperatureC, 0); close(world.rooms.l_store3.temperatureC, 39.6);
});

test("drainage loses dry shares and never redistributes an unused share", () => {
  const { world, content } = fixture(); isolate(world); start(world, content, "drain");
  world.rooms.u_bed2.waterM3 = 1;
  advancePhysics(world, content); close(world.rooms.u_bed2.waterM3, 1 - 0.16 / 17);
  for (const room of Object.values(world.rooms)) room.drainValveOpen = room.id === "u_bed2";
  world.rooms.u_bed2.waterM3 = 1; world.pumps.drain_1.wearPercent = 0;
  advancePhysics(world, content); close(world.rooms.u_bed2.waterM3, 0.84);
});

test("damaged or missing pipe gives fivefold heat and an immediate open-connection leak", () => {
  const { world, content } = fixture(); isolate(world); world.rooms.u_bed2.heatingRequest = true; start(world, content, "geo", 3);
  const pipe = world.pipes.pipe_u_bed2; world.items[pipe.itemId].damagePercent = 100;
  advancePhysics(world, content); close(world.rooms.u_bed2.temperatureC, 24.75); close(world.rooms.u_bed2.waterM3, 0.16);
  const item = world.items[pipe.itemId]; item.location = { kind: "floor", roomId: "u_bed2", x: 4, y: 8 }; pipe.itemId = null;
  world.rooms.u_bed2.heatingValveOpen = false; world.rooms.u_bed2.waterM3 = 0; world.rooms.u_bed2.temperatureC = 20;
  advancePhysics(world, content); close(world.rooms.u_bed2.waterM3, 0); close(world.rooms.u_bed2.temperatureC, 19.8);
});

test("fault effects begin after 50% and a dead pump consumes no power or flow", () => {
  const { world, content } = fixture(); start(world, content, "geo"); const p = world.pumps.geo_1;
  p.wearPercent = 50; p.fault = "seal"; close(pumpMetrics(p, world, content).flowFactor, 0.8);
  p.wearPercent = 99; close(pumpMetrics(p, world, content).flowFactor, 0.604 * 0.608);
  p.fault = "winding"; close(pumpMetrics(p, world, content).powerKw, 1.5 * 1.392);
  p.wearPercent = 100; assert.deepEqual(pumpMetrics(p, world, content), { flowFactor: 0, powerKw: 0 });
});

test("a stopped, connected impeller affects neighbors until service isolation", () => {
  const { world, content } = fixture(); start(world, content, "geo");
  const other = world.pumps.geo_2; other.wearPercent = 100; other.fault = "impeller"; other.status = "stopped";
  advancePhysics(world, content); close(world.pumps.geo_1.wearPercent, 100 / 1800 * 1.4);
  world.pumps.geo_1.wearPercent = 0; other.inService = false;
  advancePhysics(world, content); close(world.pumps.geo_1.wearPercent, 100 / 1800);
});

test("nominal wear and multiplicative dry/fungal wear retain 1800/120-second references", () => {
  for (const [dry, expected] of [[false, 1800], [true, 120]]) {
    const { world, content } = fixture(); isolate(world); start(world, content, "geo");
    if (dry) { for (const room of Object.values(world.rooms)) room.heatingValveOpen = false; world.pumps.geo_1.infectionPercent = 100; }
    for (let tick = 1; tick <= expected; tick++) {
      world.rooms.l_geo.temperatureC = 20; advancePhysics(world, content);
      if (tick < expected) assert.ok(world.pumps.geo_1.wearPercent < 100);
    }
    close(world.pumps.geo_1.wearPercent, 100); assert.equal(world.pumps.geo_1.status, "stopped");
  }
});

test("start error persists for five ticks, successful retry clears it, service isolation clears it", () => {
  const { world, content } = fixture(); const p = world.pumps.geo_1; p.command = true; p.wearPercent = 99; p.fault = "winding";
  for (const relay of content.relays) refreshRelay(world, relay);
  for (let seed = 1; seed < 1000; seed++) {
    const r = new Pcg32(BigInt(seed), 54n); const state = r.snapshot();
    if (r.nextFloat() < 0.392 && r.nextFloat() >= 0.392) { world.rng.equipment = state; break; }
  }
  resolveMotors(world, content); assert.equal(p.status, "start-error"); assert.equal(p.retryAtTick, 5);
  const state = structuredClone(world.rng.equipment);
  for (let tick = 1; tick < 5; tick++) { world.tick = tick; resolveMotors(world, content); assert.equal(p.status, "start-error"); assert.deepEqual(world.rng.equipment, state); }
  world.tick = 5; resolveMotors(world, content); assert.equal(p.status, "running"); assert.equal(p.retryAtTick, null);
  p.status = "start-error"; p.retryAtTick = 99; p.inService = false; resolveMotors(world, content); assert.equal(p.status, "out-of-service"); assert.equal(p.retryAtTick, null);
});

test("false sensor signal drives automation while the physical thermometer remains true", () => {
  const { world, content } = fixture(); world.sensors.u_bed2_temp.episode = { untilTick: 50, value: 0 };
  world.items[world.sensors.u_bed2_temp.itemId].infectionPercent = 100;
  updateController(world, content);
  assert.equal(world.rooms.u_bed2.temperatureC, 20); assert.equal(world.rooms.u_bed2.heatingRequest, true);
  assert.equal(controllerView(world, content).rooms.find((r) => r.id === "u_bed2").temperature, 0);
  assert.equal("wearPercent" in controllerView(world, content).pumps[0], false);
});

test("permanent sensor/relay failure overrides a reversible episode", () => {
  const { world, content } = fixture(); const sensor = world.sensors.u_bed2_water;
  world.items[sensor.itemId].infectionPercent = 100;
  sensor.episode = { untilTick: 99, value: 20 }; world.items[sensor.itemId].damagePercent = 100;
  pollSensors(world, content); assert.equal(sensor.signal, null);
  const relay = world.relays.heat_u_bed2; relay.episode = { untilTick: 99, value: null }; world.items[relay.itemId].infectionPercent = 100; world.items[relay.itemId].damagePercent = 100;
  refreshRelay(world, content.relays.find((r) => r.id === relay.id)); assert.equal(relay.contactClosed, false);
});

test("flood latch holds at 9 cm, releases at zero, and a shared door considers both sides", () => {
  const { world, content } = fixture(); const d = content.doors.find((d) => d.rooms.includes("u_bed2"));
  water(world, content, "u_bed2", 10); updateController(world, content); assert.equal(world.doors[d.id].position, "closed");
  water(world, content, "u_bed2", 9); updateController(world, content); assert.equal(world.rooms.u_bed2.floodIsolation, true);
  water(world, content, "u_bed1", 10); water(world, content, "u_bed2", 0); updateController(world, content);
  assert.equal(world.rooms.u_bed2.floodIsolation, false); assert.equal(world.doors[d.id].position, "closed");
  water(world, content, "u_bed1", 0); updateController(world, content); assert.equal(world.doors[d.id].position, "open");
});

test("temperature isolation uses the exact 40 °C boundary; manual mode wins", () => {
  const { world, content } = fixture(); const d = content.doors.find((d) => d.rooms.includes("u_bed2"));
  world.rooms.u_bed2.temperatureC = 40; updateController(world, content); assert.equal(world.doors[d.id].position, "closed");
  world.rooms.u_bed2.temperatureC = 39.999; updateController(world, content); assert.equal(world.doors[d.id].position, "open");
  world.doors[d.id].mode = "open"; water(world, content, "u_bed2", 20); updateController(world, content); assert.equal(world.doors[d.id].position, "open");
});

test("controller adds pumps every five seconds with no improvement and stages down on trends", () => {
  const { world, content } = fixture(); world.rooms.u_bed2.temperatureC = 5;
  for (let t = 0; t <= 10; t++) { world.tick = t; updateController(world, content); assert.equal(world.controller.heatStage, Math.min(3, 1 + Math.floor(t / 5))); }
  for (let t = 11; t <= 20; t++) { world.tick = t; world.rooms.u_bed2.temperatureC += 0.1; updateController(world, content); }
  assert.equal(world.controller.heatStage, 2);
  world.rooms.u_bed2.temperatureC = 40; updateController(world, content); assert.equal(world.controller.heatStage, 0);
});

test("a failed water sensor demands all three drain pumps sequentially", () => {
  const { world, content } = fixture(); world.items[world.sensors.u_bed2_water.itemId].damagePercent = 100;
  for (let t = 0; t <= 10; t++) { world.tick = t; updateController(world, content); assert.equal(world.controller.drainStage, Math.min(3, 1 + Math.floor(t / 5))); }
});

test("external loss selects battery, changes light load only, then total outage opens doors", () => {
  const { world, content } = fixture(); refreshPower(world, content); close(electricalLoadKw(world, content), 1.12);
  const d = content.doors[0]; world.doors[d.id].mode = "closed";
  world.power.externalAvailable = false; refreshPower(world, content);
  assert.equal(world.power.source, "battery"); close(electricalLoadKw(world, content), 0.6525 + 0.01);
  world.battery.energyKj = 0; refreshPower(world, content);
  assert.equal(world.power.source, "none"); assert.equal(world.controller.powered, false); assert.equal(world.doors[d.id].position, "open"); assert.equal(world.doors[d.id].mode, "closed");
  world.power.externalAvailable = true; refreshPower(world, content); assert.equal(world.doors[d.id].position, "closed");
});

test("charging is independent of breaker and battery output; loss of capacity clips absolute energy", () => {
  const { world, content } = fixture(); world.battery.energyKj = 100; world.battery.outputEnabled = false; world.power.externalBreakerClosed = false;
  refreshPower(world, content); assert.equal(world.power.source, "none"); settleEnergy(world, content, 0); close(world.battery.energyKj, 101.5);
  world.battery.damagePercent = 99; refreshPower(world, content); close(world.battery.capacityKj, 9); close(world.battery.energyKj, 9); close(sensorTruth(world, content, "battery_charge"), 100);
});

test("overload requires ten uninterrupted seconds, resets when load recovers, and has no random blackout", () => {
  const { world, content } = fixture();
  for (let i = 0; i < 9; i++) settleEnergy(world, content, 11);
  assert.equal(world.power.externalBreakerClosed, true); settleEnergy(world, content, 10); assert.equal(world.power.overloadTicks, 0);
  for (let i = 0; i < 10; i++) settleEnergy(world, content, 11);
  assert.equal(world.power.externalBreakerClosed, false); refreshPower(world, content); assert.equal(world.power.source, "battery");
});

test("dead controller stops every pump despite bridged contacts, keeps lighting and local doors", () => {
  const { world, content } = fixture(); start(world, content, "geo", 3); start(world, content, "drain", 3);
  for (const r of Object.values(world.relays)) { r.episode = { untilTick: 100, value: null }; world.items[r.itemId].infectionPercent = 100; }
  world.controller.damagePercent = 100; refreshPower(world, content);
  assert.equal(world.power.source, "external"); assert.equal(controllerView(world, content), null);
  assert.ok(Object.values(world.pumps).every((p) => p.status === "stopped")); close(groupFlow(world, content).geothermal, 0);
  assert.equal(world.relays.geo_pump_1_contactor.contactClosed, true);
  assert.equal(world.relays.light_01.contactClosed, true);
  const d = Object.values(world.doors)[0]; d.mode = "closed"; applyDoorPositions(world); assert.equal(d.position, "closed");
  assert.throws(() => applyDeveloperCommand(world, { type: "cbu-diagnostics" }, content));
});

test("self-test lasts five seconds, stays cached, and resets on total power loss", () => {
  const { world, content } = fixture(); let current = applyDeveloperCommand(world, { type: "cbu-diagnostics" }, content);
  for (let i = 0; i < 4; i++) current = stepWorld(current, content);
  assert.equal(current.controller.lastSelfTest, null); current = stepWorld(current, content);
  const cached = current.controller.lastSelfTest.damagePercent;
  current.controller.damagePercent = 50; refreshPower(current, content); close(controllerView(current, content).selfTest.damagePercent, cached);
  current.power.externalAvailable = false; current.battery.outputEnabled = false; refreshPower(current, content); assert.equal(current.controller.lastSelfTest, null);
});

test("new controller commands affect the next physical step, not the current energy/heat ledger", () => {
  const { world, content } = fixture(); isolate(world); world.rooms.u_bed2.temperatureC = 5;
  world.power.externalAvailable = false; const initialEnergy = world.battery.energyKj;
  const first = stepWorld(world, content);
  close(first.rooms.u_bed2.temperatureC, 4.95); assert.equal(first.pumps.geo_1.status, "running");
  close(first.battery.energyKj, initialEnergy - first.power.lastStepLoadKw);
  assert.ok(first.power.loadKw > first.power.lastStepLoadKw);
  const next = stepWorld(first, content); assert.ok(next.rooms.u_bed2.temperatureC > 4.95 * 0.99);
});

test("equipment episodes are fixed, use only their RNG stream, and cannot start in the cold", () => {
  const { world, content } = fixture(); const sensor = world.sensors.u_bed2_temp;
  world.items[sensor.itemId].infectionPercent = 100; world.rooms.u_bed2.temperatureC = 5;
  const originalRng = structuredClone(world.rng); updateEquipmentEpisodes(world, content); assert.deepEqual(world.rng, originalRng);
  world.rooms.u_bed2.temperatureC = 20;
  for (let t = 1; t <= 1000 && sensor.episode === null; t++) { world.tick = t; updateEquipmentEpisodes(world, content); }
  assert.ok(sensor.episode); const episode = structuredClone(sensor.episode);
  world.rooms.u_bed2.temperatureC = 45; pollSensors(world, content); assert.equal(sensor.signal, episode.value);
  world.rooms.u_bed2.temperatureC = 0; updateEquipmentEpisodes(world, content); assert.deepEqual(sensor.episode, episode);
  world.tick = episode.untilTick; expireEngineeringEpisodes(world); assert.equal(sensor.episode, null);
  for (const stream of ["world", "loot", "fungus", "rats"]) assert.deepEqual(world.rng[stream], originalRng[stream]);
});

test("save-like JSON round trip preserves a dynamic controller, pending timer and all RNG state", () => {
  const { world, content } = fixture(); let control = applyDeveloperCommand(world, { type: "inspect-sensor", sensorId: "u_corridor_temp" }, content);
  control.rooms.u_bed2.temperatureC = 0;
  for (let i = 0; i < 2; i++) control = stepWorld(control, content);
  let restored = JSON.parse(JSON.stringify(control));
  for (let i = 0; i < 100; i++) { control = stepWorld(control, content); restored = stepWorld(restored, content); }
  assert.equal(canonicalStringify(restored), canonicalStringify(control)); validateWorld(restored, content);
});

test("seeded full graph runs deterministically for 600 seconds with finite, bounded physical state", () => {
  const { world, content } = fixture("long-run"); let first = world, second = fixture("long-run").world;
  for (let tick = 0; tick < 600; tick++) {
    first = stepWorld(first, content); second = stepWorld(second, content);
    for (const room of Object.values(first.rooms)) assert.ok(Number.isFinite(room.temperatureC) && Number.isFinite(room.waterM3) && room.waterM3 >= 0);
    assert.ok(first.battery.energyKj >= 0 && first.battery.energyKj <= first.battery.capacityKj);
  }
  assert.equal(canonicalStringify(first), canonicalStringify(second)); validateWorld(first, content);
  assert.equal(fixtureContent().rooms.length, 17);
});

test("pump fungal effects use only active/inactive temperature, not a second F(T) multiplier", () => {
  const { world, content } = fixture(); start(world, content, "geo"); const pump = world.pumps.geo_1;
  pump.infectionPercent = 100;
  for (const [temperature, expected] of [[5, 1], [20, 0.6], [30, 0.6], [40, 0.6], [50, 1]]) {
    world.rooms.l_geo.temperatureC = temperature; close(pumpMetrics(pump, world, content).flowFactor, expected);
  }
});

test("a cold fungal bridge persists until expiry or removal of its living source; damage remains", () => {
  const { world, content } = fixture(); const r = world.relays.heat_u_bed2;
  const item = world.items[r.itemId]; item.infectionPercent = 50; item.damagePercent = 75;
  r.episode = { untilTick: 10, value: null }; world.rooms.u_bed2.temperatureC = 0;
  refreshRelay(world, content.relays.find((d) => d.id === r.id)); assert.equal(r.contactClosed, true);
  world.tick = 5; expireEngineeringEpisodes(world); assert.ok(r.episode);
  item.infectionPercent = 0; expireEngineeringEpisodes(world);
  assert.equal(r.episode, null); assert.equal(item.damagePercent, 75);
  refreshRelay(world, content.relays.find((d) => d.id === r.id)); assert.equal(r.contactClosed, false);
});

test("energy accounting combines charge and discharge before clipping, without creating headroom loss", () => {
  const { world, content } = fixture(); world.power.externalBreakerClosed = false; refreshPower(world, content);
  const capacity = world.battery.capacityKj; assert.equal(world.power.source, "battery");
  settleEnergy(world, content, 0.65); close(world.battery.energyKj, capacity);
  world.battery.energyKj = 100; settleEnergy(world, content, 2); close(world.battery.energyKj, 99.5);
  world.power.externalAvailable = false; settleEnergy(world, content, 2); close(world.battery.energyKj, 97.5);
});

test("manual breaker reset completes after five seconds and restores stored modes", () => {
  const { world, content } = fixture(); world.power.externalBreakerClosed = false; world.battery.outputEnabled = false;
  const door = Object.values(world.doors)[0]; door.mode = "closed"; refreshPower(world, content); assert.equal(door.position, "open");
  let next = applyDeveloperCommand(world, { type: "breaker-reset" }, content);
  for (let i = 0; i < 4; i++) next = stepWorld(next, content);
  assert.equal(next.power.externalBreakerClosed, false); next = stepWorld(next, content);
  assert.equal(next.power.externalBreakerClosed, true); assert.equal(next.power.source, "external"); assert.equal(next.doors[door.id].position, "closed");
});

test("developer experiment commands change recorded conditions without inventing repair gameplay", () => {
  const { world, content } = fixture();
  let next = applyDeveloperCommand(world, { type: "room-condition", roomId: "u_bed2", temperatureC: 10, waterCm: 12 }, content);
  close(waterDepthCm(next, content, "u_bed2"), 12); assert.equal(world.rooms.u_bed2.temperatureC, 20);
  next = applyDeveloperCommand(next, { type: "room-valve", roomId: "u_bed2", circuit: "heating", open: false }, content);
  assert.equal(next.rooms.u_bed2.heatingValveOpen, false);
  next = applyDeveloperCommand(next, { type: "component-condition", componentId: "u_bed2_temp", damagePercent: 100, infectionPercent: 0 }, content);
  pollSensors(next, content); assert.equal(next.sensors.u_bed2_temp.signal, null);
  next = applyDeveloperCommand(next, { type: "pump-condition", pumpId: "geo_1", wearPercent: 100, infectionPercent: 0 }, content);
  assert.equal(next.pumps.geo_1.status, "stopped"); close(pumpMetrics(next.pumps.geo_1, next, content).powerKw, 0);
});
