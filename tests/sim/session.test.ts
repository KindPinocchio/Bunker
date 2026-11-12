import { describe, expect, test } from "vitest";
import { loadContent } from "../../src/content/load";
import { Session, replay } from "../../src/game/session";
import { canonicalStringify } from "../../src/sim/canonical";
import { TICK_PHASES } from "../../src/sim/state";

const content = loadContent();
const doorId = content.doors.find((d) => d.rooms.includes("u_bed2"))!.id;
const sensorId = "u_corridor_temp";

test("same seed gives identical world; another seed changes initial equipment", () => {
  expect(new Session(content, "a").snapshot()).toEqual(new Session(content, "a").snapshot());
  expect(new Session(content, "a").view().pumps).not.toEqual(new Session(content, "b").view().pumps);
});

test("pause preserves time, RNG, actions and journal, and blocks mutations", () => {
  const session = new Session(content, "pause");
  const initial = session.snapshot();
  session.advance(120_000);
  expect(session.snapshot()).toEqual(initial);
  expect(() => session.dispatch({ type: "door-mode", doorId, mode: "closed" })).toThrow(/паузе/);
  expect(session.snapshot()).toEqual(initial);
  session.resume(); session.advance(250); session.pause();
  const partial = session.snapshot(); session.advance(10_000);
  expect(session.snapshot()).toEqual(partial);
  expect(() => session.advance(Number.NaN)).toThrow();
});

test("frame schedules do not change whole ticks, command results or RNG", () => {
  const fast = new Session(content, "frames"), slow = new Session(content, "frames");
  fast.resume(); slow.resume();
  fast.dispatch({ type: "door-mode", doorId, mode: "closed" });
  slow.dispatch({ type: "door-mode", doorId, mode: "closed" });
  fast.advance(10_500);
  for (const ms of [500, 1600, 300, 7000, 1100]) slow.advance(ms);
  expect(fast.snapshot()).toEqual(slow.snapshot());
  expect(fast.tick).toBe(10);
  expect(fast.view().lastTickPhases).toEqual(TICK_PHASES);
  expect(fast.view().graphs.navigation.find((e) => e.id === doorId)?.open).toBe(false);
});

test("snapshot resumes a pending atomic action and fractional second without reroll", () => {
  const control = new Session(content, "inspection"); control.resume();
  control.dispatch({ type: "inspect-sensor", sensorId });
  control.advance(2250);
  const snapshot = JSON.parse(JSON.stringify(control.snapshot()));
  const restored = Session.restore(content, snapshot);
  expect(restored.view().player.action?.endsAtTick).toBe(5);
  expect(restored.snapshot().clock.remainderMs).toBe(250);
  expect(() => restored.dispatch({ type: "door-mode", doorId, mode: "closed" })).toThrow(/атомарного/);
  control.advance(2750); restored.advance(2750);
  expect(restored.snapshot()).toEqual(control.snapshot());
  expect(restored.view().player.action).toBeNull();
  expect(restored.view().observations[sensorId]).toEqual({ tick: 5, infectionPercent: 0 });
});

test("same logical commands replay exactly, including at the final tick", () => {
  const session = new Session(content, "replay"); session.resume();
  session.dispatch({ type: "door-mode", doorId, mode: "closed" });
  session.advance(2000); session.dispatch({ type: "inspect-sensor", sensorId });
  session.advance(7000); session.dispatch({ type: "door-mode", doorId, mode: "auto" });
  const snapshot = session.snapshot();
  expect(canonicalStringify(replay(content, session.seed, snapshot.commands, session.tick).view())).toBe(canonicalStringify(session.view()));
  const copy = session.view(); copy.rng.world.state = "0000000000000000"; copy.rooms.u_corridor!.temperatureC = 999;
  expect(session.view()).not.toEqual(copy);
});

describe("untrusted snapshot is validated before replacement", () => {
  test.each(["schema", "balance", "content", "rng", "ownership", "graph", "reference", "action", "journal"])("rejects invalid %s and preserves the original session", (fault) => {
    const session = new Session(content, "validation");
    const original = session.snapshot();
    const invalid = structuredClone(original) as unknown as Record<string, any>;
    if (fault === "schema") invalid.schemaVersion = 999;
    if (fault === "balance") invalid.world.balanceVersion = "1.0";
    if (fault === "content") invalid.world.contentFingerprint = "0000000000000000";
    if (fault === "rng") invalid.world.rng.rats.increment = "0000000000000002";
    if (fault === "ownership") invalid.world.player.backpack[0] = invalid.world.player.clothing.boots;
    if (fault === "graph") invalid.world.graphs.navigation[0].open = false;
    if (fault === "reference") delete invalid.world.sensors[sensorId];
    if (fault === "action") invalid.world.player.action = { kind: "inspect-sensor", targetId: "missing", startedAtTick: 0, endsAtTick: 5, reservations: [] };
    if (fault === "journal") invalid.commands = [{ scope: "developer", sequence: 9, tick: 0, command: { type: "door-mode", doorId, mode: "open" } }];
    expect(() => Session.restore(content, invalid)).toThrow(/Снимок не загружен/);
    expect(session.snapshot()).toEqual(original);
  });
});
