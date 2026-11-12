import { fingerprint } from "./canonical.ts";

export const RNG_STREAMS = ["world", "loot", "fungus", "rats", "equipment"] as const;
export type RngStream = typeof RNG_STREAMS[number];
export interface PcgState { state: string; increment: string }
export type RngStates = Record<RngStream, PcgState>;
const MULTIPLIER = 6364136223846793005n;
const MASK = (1n << 64n) - 1n;
const HEX = /^[0-9a-f]{16}$/;

export class Pcg32 {
  private state = 0n;
  private increment: bigint;

  constructor(initialState: bigint, sequence: bigint) {
    this.increment = ((sequence << 1n) | 1n) & MASK;
    this.nextUint32();
    this.state = (this.state + initialState) & MASK;
    this.nextUint32();
  }

  nextUint32(): number {
    const previous = this.state;
    this.state = (previous * MULTIPLIER + this.increment) & MASK;
    const shifted = Number((((previous >> 18n) ^ previous) >> 27n) & 0xffffffffn) >>> 0;
    const rotation = Number(previous >> 59n);
    return ((shifted >>> rotation) | (shifted << ((-rotation) & 31))) >>> 0;
  }

  nextFloat(): number { return this.nextUint32() / 0x100000000; }

  bounded(bound: number): number {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000) {
      throw new RangeError("Граница PCG32 должна быть целой: 1…2³²");
    }
    const threshold = (0x100000000 - bound) % bound;
    let value: number;
    do { value = this.nextUint32(); } while (value < threshold);
    return value % bound;
  }

  snapshot(): PcgState {
    return { state: this.state.toString(16).padStart(16, "0"), increment: this.increment.toString(16).padStart(16, "0") };
  }

  static restore(value: PcgState): Pcg32 {
    if (!HEX.test(value.state) || !HEX.test(value.increment) || !(BigInt(`0x${value.increment}`) & 1n)) {
      throw new Error("Некорректное состояние PCG32");
    }
    const result = new Pcg32(0n, 0n);
    result.state = BigInt(`0x${value.state}`);
    result.increment = BigInt(`0x${value.increment}`);
    return result;
  }
}

export function createRngStreams(seed: string): RngStates {
  return Object.fromEntries(RNG_STREAMS.map((stream) => [stream, new Pcg32(
    BigInt(`0x${fingerprint(`bunker:state:${seed}:${stream}`)}`),
    BigInt(`0x${fingerprint(`bunker:sequence:${stream}`)}`),
  ).snapshot()])) as RngStates;
}
