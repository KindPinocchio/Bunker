import { expect, test } from "vitest";
import { createRngStreams, Pcg32, RNG_STREAMS } from "../../src/sim/pcg32";

test("PCG32 matches the published initstate=42, initseq=54 reference vector", () => {
  const random = new Pcg32(42n, 54n);
  expect(Array.from({ length: 6 }, () => random.nextUint32())).toEqual([
    0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e,
  ]);
});

test("serialized stream resumes exactly and seeded streams are independent", () => {
  const states = createRngStreams("Сибирь / 01");
  expect(createRngStreams("Сибирь / 01")).toEqual(states);
  expect(createRngStreams("Сибирь / 02")).not.toEqual(states);
  const control = structuredClone(states);
  const generator = Pcg32.restore(states.world);
  Array.from({ length: 57 }, () => generator.nextUint32());
  states.world = generator.snapshot();
  for (const name of RNG_STREAMS.filter((name) => name !== "world")) expect(states[name]).toEqual(control[name]);
  const resumed = Pcg32.restore(states.world);
  expect(Array.from({ length: 100 }, () => resumed.nextUint32())).toEqual(Array.from({ length: 100 }, () => generator.nextUint32()));
});

test("bounded draws stay inside bounds, including one and 2³²", () => {
  const random = new Pcg32(11n, 12n);
  for (const bound of [1, 3, 17, 0x80000001, 0x100000000]) {
    const values = Array.from({ length: 100 }, () => random.bounded(bound));
    expect(values.every((v) => Number.isInteger(v) && v >= 0 && v < bound)).toBe(true);
  }
  expect(() => random.bounded(0)).toThrow();
  expect(() => Pcg32.restore({ state: "0000000000000000", increment: "0000000000000002" })).toThrow();
});
