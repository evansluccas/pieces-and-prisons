export type Rng = () => number;

/**
 * Small seeded PRNG (mulberry32) so games and tests are reproducible.
 * Its whole state is one number, readable as `rngState(rng)`: passing that
 * back to seededRng carries on exactly where it left off (the server saves
 * running tables this way).
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(next, STATE, { get: () => a });
  return next;
}

const STATE = Symbol('rng state');

/** The state of a seeded generator, or null for any other function. */
export const rngState = (f: unknown): number | null =>
  typeof f === 'function' && STATE in f ? (f as unknown as Record<symbol, number>)[STATE] : null;

export const rollDie = (rng: Rng) => 1 + Math.floor(rng() * 6);
