import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { createFungusTemperatureFactor } from "../../src/sim/fungus-temperature.ts";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const balance = readJson("../../data/bunker_balance_v1_1.json");
const response = balance.fungus.temperature_response;
const factor = createFungusTemperatureFactor(response);
const epsilon = balance.simulation.numeric_epsilon;

test("balance 1.1 changes only the version and the temperature definition", () => {
  const original = readJson("../../docs/spec/bunker_balance_v1.json");
  const revised = structuredClone(balance);
  assert.equal(revised.version, "1.1");
  assert.deepEqual(response, { kind: "triangular", min_c: 5, optimum_c: 30, max_c: 50 });
  revised.version = original.version;
  delete revised.fungus.temperature_response;
  assert.deepEqual(revised, original);
});

test("all imported source files still match the original checksum manifest", () => {
  const root = new URL("../../docs/spec/", import.meta.url);
  const manifest = readFileSync(new URL("MANIFEST.sha256", root), "utf8");
  const entries = manifest.trim().split(/\r?\n/);
  assert.equal(entries.length, 13);
  for (const line of entries) {
    const [, expected, name] = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    const actual = createHash("sha256").update(readFileSync(new URL(name, root))).digest("hex");
    assert.equal(actual, expected, name);
  }
});

test("curve matches the adopted anchor values", () => {
  for (const [temperature, expected] of [
    [-20, 0], [5, 0], [10, 0.2], [15, 0.4], [20, 0.6], [25, 0.8],
    [30, 1], [35, 0.75], [40, 0.5], [45, 0.25], [50, 0], [80, 0],
  ]) {
    assert.ok(Math.abs(factor(temperature) - expected) <= epsilon, `${temperature} °C`);
  }
});

test("activity boundaries are exact and the curve is continuous at its peak", () => {
  const delta = 1e-6;
  assert.equal(factor(5 - delta), 0);
  assert.equal(factor(5), 0);
  assert.ok(factor(5 + delta) > 0);
  assert.ok(factor(50 - delta) > 0);
  assert.equal(factor(50), 0);
  assert.equal(factor(50 + delta), 0);
  assert.equal(factor(30), 1);
  assert.ok(Math.abs(factor(30 - delta) - 1) < 1e-7);
  assert.ok(Math.abs(factor(30 + delta) - 1) < 1e-7);
});

for (const [temperature, expectedTicks] of [[20, 500], [30, 300], [40, 600]]) {
  test(`existing colony grows from 1% to 100% at ${temperature} °C in ${expectedTicks} ticks`, () => {
    let infection = 1;
    const rate = balance.fungus.growth_max_pp_s * factor(temperature);
    for (let tick = 1; tick <= expectedTicks; tick++) {
      infection = Math.min(100, infection + rate * balance.simulation.tick_s);
      if (tick < expectedTicks) {
        assert.ok(infection < 100 - epsilon, `Reached the cap early at tick ${tick}`);
      }
    }
    assert.ok(Math.abs(infection - 100) <= epsilon);
  });
}

test("invalid curve data is rejected before a factor is created", () => {
  for (const invalid of [
    { ...response, kind: "unknown" },
    { ...response, min_c: 30 },
    { ...response, optimum_c: 50 },
    { ...response, max_c: 0 },
    { ...response, min_c: Number.NaN },
    { ...response, max_c: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => createFungusTemperatureFactor(invalid), RangeError);
  }
});

test("invalid temperatures cannot silently propagate into world calculations", () => {
  for (const temperature of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => factor(temperature), RangeError);
  }
});
