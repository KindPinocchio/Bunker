import { describe, expect, test } from "vitest";
import { loadContent, RAW_CONTENT } from "../../src/content/load";
import { createWorld, validateWorld } from "../../src/sim/world";

describe("accepted source contracts", () => {
  test("normalizes the exact room graph and all equipment references", () => {
    const content = loadContent();
    expect(content.balance.version).toBe("1.1");
    expect(content.rooms).toHaveLength(17);
    expect(content.doors.filter((d) => d.kind === "horizontal")).toHaveLength(15);
    expect(content.doors.filter((d) => d.kind === "stair")).toHaveLength(2);
    expect(content.rooms.reduce((sum, r) => sum + r.area, 0)).toBe(376);
    expect(content.relays).toHaveLength(35);
    expect(content.sensors).toHaveLength(35);
    expect(content.pipes).toHaveLength(16);
    expect(content.items).toHaveLength(30);
    expect(content.doors.every((d) => d.initialMode === "auto" && d.initialPosition === "open")).toBe(true);
    const world = createWorld(content, "fixture");
    expect(Object.keys(world.items)).toHaveLength(91); // 86 installed components + 5 starting garments; loose loot comes later.
    expect(() => validateWorld(world, content)).not.toThrow();
  });

  test.each(["geometry", "reference", "price", "pair", "duplicate", "invalid-number"])("rejects damaged %s before world creation", (fault) => {
    const raw = structuredClone(RAW_CONTENT);
    if (fault === "geometry") raw.layout.rooms[0]!.area += 1;
    if (fault === "reference") raw.engineering.relays[0]!.room = "missing";
    if (fault === "price") raw.catalog.items[0]!.base_value_points += 1;
    if (fault === "pair") raw.layout.doors[1]!.rooms[0] = "u_corridor";
    if (fault === "duplicate") raw.catalog.items[1]!.id = raw.catalog.items[0]!.id;
    if (fault === "invalid-number") raw.balance.pump.nominal_life_s = Number.NaN;
    expect(() => loadContent(raw)).toThrow(/Ошибка данных/);
  });

  test("fingerprint changes when a preserved coefficient changes", () => {
    const raw = structuredClone(RAW_CONTENT);
    raw.balance.pump.nominal_life_s += 1;
    expect(loadContent(raw).fingerprint).not.toBe(loadContent().fingerprint);
  });
});
