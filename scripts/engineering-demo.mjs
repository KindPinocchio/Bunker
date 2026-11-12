// Dependency-free developer harness. Uses known accepted source fixtures, not the
// browser's Zod loader. Simulation functions and state are the real shared engine.
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fixture } from "../tests/local/fixture.mjs";
import { applyDeveloperCommand, stepWorld } from "../src/sim/engine.ts";
import { canonicalStringify, fingerprint } from "../src/sim/canonical.ts";
import { SCHEMA_VERSION } from "../src/sim/constants.ts";
import { waterDepthCm } from "../src/sim/engineering.ts";
import { validateWorld } from "../src/sim/world.ts";

const { values } = parseArgs({ options: {
  scenario: { type: "string", default: "flood" }, ticks: { type: "string", default: "30" },
  seed: { type: "string", default: "sibir-001" }, output: { type: "string" },
} });
const ticks = Number(values.ticks);
if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 3600) throw new Error("--ticks: целое число 1…3600");
if (!["flood", "cold", "blackout"].includes(values.scenario)) throw new Error("--scenario: flood, cold или blackout");
const { content, world: initial } = fixture(values.seed);
let world = initial;
const commands = [];
const dispatch = (command) => {
  world = applyDeveloperCommand(world, command, content);
  commands.push({ tick: world.tick, sequence: commands.length + 1, scope: "developer", command });
};
const bedDoor = content.doors.find((d) => d.rooms.includes("u_bed2"));
function schedule(tick) {
  if (tick === 0 && values.scenario === "flood") dispatch({ type: "room-condition", roomId: "u_bed2", temperatureC: 20, waterCm: 12 });
  if (tick === 10 && values.scenario === "flood") {
    for (const room of content.rooms.filter((r) => r.id !== "u_bed2")) dispatch({ type: "room-valve", roomId: room.id, circuit: "drain", open: false });
  }
  if (tick === 0 && values.scenario === "cold") {
    dispatch({ type: "door-mode", doorId: bedDoor.id, mode: "closed" });
    dispatch({ type: "room-condition", roomId: "u_bed2", temperatureC: 0, waterCm: 0 });
  }
  if (tick === 0 && values.scenario === "blackout") {
    dispatch({ type: "door-mode", doorId: bedDoor.id, mode: "closed" });
    dispatch({ type: "external-line", available: false });
  }
  if (tick === 10 && values.scenario === "blackout") dispatch({ type: "battery-output", enabled: false });
  if (tick === 15 && values.scenario === "blackout") dispatch({ type: "external-line", available: true });
}
const describe = () => `тик ${String(world.tick).padStart(3)} | ${world.power.source.padEnd(8)} | T=${world.rooms.u_bed2.temperatureC.toFixed(2)} °C | h=${waterDepthCm(world, content, "u_bed2").toFixed(2)} см | насосы ${Object.values(world.pumps).filter((p) => p.status === "running").map((p) => p.id).join(",") || "—"} | дверь ${world.doors[bedDoor.id].position}`;
console.log(`Bunker 0.2 · ${values.scenario} · seed ${world.seed} · баланс 1.1 · схема ${SCHEMA_VERSION}`);
for (let tick = 0; tick < ticks; tick++) {
  schedule(tick);
  if (tick % 5 === 0) console.log(describe());
  world = stepWorld(world, content);
}
console.log(describe());
validateWorld(world, content);
let repeated = fixture(values.seed).world;
let index = 0;
for (let tick = 0; tick <= ticks; tick++) {
  while (commands[index]?.tick === tick) repeated = applyDeveloperCommand(repeated, commands[index++].command, content);
  if (tick < ticks) repeated = stepWorld(repeated, content);
}
if (canonicalStringify(world) !== canonicalStringify(repeated)) throw new Error("Повтор журнала не совпал");
console.log(`Повтор совпал · ${commands.length} команд · состояние ${fingerprint(canonicalStringify(world))}`);
if (values.output) {
  const snapshot = { format: "bunker.snapshot", schemaVersion: SCHEMA_VERSION, world, clock: { paused: true, remainderMs: 0 }, commands };
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Снимок записан: ${values.output}`);
}
