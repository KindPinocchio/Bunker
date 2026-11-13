// Node-only fixtures read the accepted source files directly. This does not replace
// the application's Zod validation, which is verified by the Vitest content suite.
import { readFileSync } from "node:fs";
import { canonicalStringify, fingerprint } from "../../src/sim/canonical.ts";
import { createWorld } from "../../src/sim/world.ts";
import { BEDROOM_CONTENT } from "../../src/content/bedroom.ts";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
export function fixtureContent() {
  const raw = {
    balance: read("../../data/bunker_balance_v1_1.json"), layout: read("../../docs/spec/bunker_floor_plan_v1.json"),
    engineering: read("../../docs/spec/bunker_engineering_manifest_v1.json"), catalog: read("../../docs/spec/bunker_loot_catalog_v1.json"), dressing: read("../../docs/spec/bunker_room_dressing_v1.json"),
  };
  const sort = (array) => [...array].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    balance: raw.balance, layout: raw.layout, rooms: sort(raw.layout.rooms),
    relays: sort(raw.engineering.relays), sensors: sort([...raw.engineering.room_sensor_cabinets.flatMap((c) => c.sensors.map((s) => ({ ...s, room: c.room }))), raw.engineering.battery_charge_sensor]),
    pipes: sort(raw.engineering.heating_pipes), items: raw.catalog.items, dressing: raw.dressing.rooms,
    doors: sort([
      ...raw.layout.doors.map((d) => ({ ...d, id: `door:${[...d.rooms].sort().join(":")}`, kind: "horizontal", label: d.rooms.join(" / "), initialMode: "auto", initialPosition: "open" })),
      ...raw.layout.stairs.map((d) => ({ ...d, id: `stair:${d.id}`, kind: "stair", label: d.label, initialMode: "auto", initialPosition: "open" })),
    ]),
    fingerprint: fingerprint(canonicalStringify({data:raw,bedroom:BEDROOM_CONTENT})), sourceVersions: { balance: "1.1", layout: "1.0", engineering: "1.0", catalog: "1.0", dressing: "1.0", bedroom:BEDROOM_CONTENT.version },
  };
}
export function fixture(seed = "engineering-20261112") {
  const content = fixtureContent();
  return { content, world: createWorld(content, seed) };
}
export function isolate(world) {
  for (const d of Object.values(world.doors)) { d.mode = "closed"; d.position = "closed"; d.automaticCommand = "closed"; }
}
export function openConnection(world, content, a, b) {
  const d = content.doors.find((door) => door.rooms.includes(a) && door.rooms.includes(b));
  world.doors[d.id].mode = "open"; world.doors[d.id].position = "open";
  return d;
}
export function water(world, content, roomId, cm) { world.rooms[roomId].waterM3 = cm / 100 * content.rooms.find((r) => r.id === roomId).area; }
export function connectReferenceStair(world, content) {
  isolate(world);
  const door = content.doors.find((d) => d.id === "stair:main");
  door.rooms = ["u_bed1", "l_store3"]; // Isolated mathematical fixture, not a change to accepted geometry.
  world.doors[door.id].mode = "open"; world.doors[door.id].position = "open";
  return door;
}
