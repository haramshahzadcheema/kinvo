// Deterministic PRNG for the demo seed — mulberry32, seeded from a string
// hash of the `--seed` value (default "kinvo-demo"). Every random choice in
// seed.ts routes through one shared instance so the same seed string always
// produces the same organizations/users/drivers/ships/assignments and the
// same *relative* timestamp offsets. Absolute dates still shift with
// wall-clock "now" at run time (deliberately — "Today's operations"/
// "Incoming vessels" need to stay genuinely current), but which offsets get
// picked, in what order, is fully reproducible.

function hashStringToSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number, decimals?: number): number;
  bool(probability?: number): boolean;
  pick<T>(items: readonly T[]): T;
  pickWeighted<T>(items: readonly (readonly [T, number])[]): T;
  sample<T>(items: readonly T[], count: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  uuid7ish(): string;
}

export function createRng(seed: string): Rng {
  let state = hashStringToSeed(seed);

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function float(min: number, max: number, decimals = 2): number {
    const value = next() * (max - min) + min;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  function bool(probability = 0.5): boolean {
    return next() < probability;
  }

  // Non-null assertions below are safe, not a type-check bypass: each index
  // is proven in range by the surrounding logic (an explicit length check,
  // or a loop bound derived from `.length`) — `noUncheckedIndexedAccess`
  // can't see that, since it types every index access as possibly-`undefined`
  // regardless of how the index was computed.
  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() called on an empty array');
    return items[int(0, items.length - 1)]!;
  }

  function pickWeighted<T>(items: readonly (readonly [T, number])[]): T {
    if (items.length === 0) throw new Error('pickWeighted() called on an empty array');
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1]![0];
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }

  function sample<T>(items: readonly T[], count: number): T[] {
    return shuffle(items).slice(0, Math.min(count, items.length));
  }

  // Not a real UUIDv7 — just a sortable, deterministic-enough local id for
  // things that need a stable external reference (e.g. fake CALL-E call
  // ids) without pulling in a real generator.
  function uuid7ish(): string {
    return `${Date.now().toString(16)}-${int(0, 0xffffffff).toString(16).padStart(8, '0')}`;
  }

  return { next, int, float, bool, pick, pickWeighted, sample, shuffle, uuid7ish };
}
