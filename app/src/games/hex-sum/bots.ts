import type { Rng } from '../shared/rng';
import { GameState, LINES, openLines } from './logic';

export type Level = 'easy' | 'normal' | 'hard';
/** How many tiles the bot remembers, and how often a memory is slightly wrong. Tuned so first-try hits land
 *  around 20% / 35% / 55% — roughly what a person manages after studying the board. */
export const RECALL: Record<Level, number> = { easy: 0.24, normal: 0.46, hard: 0.68 };
export const SLIP: Record<Level, number> = { easy: 0.25, normal: 0.15, hard: 0.08 };

/** What the bot remembered from the study phase: a number, or null if it forgot. */
export type Memory = (number | null)[];

export function memorize(values: number[], level: Level, rng: Rng): Memory {
  return values.map((v) => {
    if (rng() >= RECALL[level]) return null;
    // a misremembered tile is off by one
    if (rng() < SLIP[level]) return Math.min(9, Math.max(1, v + (rng() < 0.5 ? -1 : 1)));
    return v;
  });
}

/** Memory plus every tile anybody has flipped since. */
export function knowledge(s: GameState, memory: Memory): Memory {
  const k = [...memory];
  for (const a of s.attempts) for (const i of LINES[a.line]) k[i] = s.values[i];
  return k;
}

/** Chance that unknown tiles (each 1–9) add up to `need`. */
function chance(unknown: number, need: number): number {
  if (unknown === 0) return need === 0 ? 1 : 0;
  let ways = Array(need + 1).fill(0);
  ways[0] = 1;
  for (let k = 0; k < unknown; k++) {
    const next = Array(need + 1).fill(0);
    for (let s = 0; s <= need; s++) if (ways[s]) for (let v = 1; v <= 9 && s + v <= need; v++) next[s + v] += ways[s];
    ways = next;
  }
  return ways[need] / 9 ** unknown;
}

/** Pick the open line most likely to hit the target, from what the bot knows. */
export function botLine(s: GameState, memory: Memory, rng: Rng): number {
  const k = knowledge(s, memory);
  const missedThisRound = new Set(s.attempts.filter((a) => a.round === s.round).map((a) => a.line));
  let best = -1;
  let bestP = -1;
  for (const line of openLines(s)) {
    if (missedThisRound.has(line)) continue;
    const tiles = LINES[line];
    const known = tiles.filter((i) => k[i] !== null).reduce((t, i) => t + k[i]!, 0);
    const unknown = tiles.filter((i) => k[i] === null).length;
    const need = s.target - known;
    const p = need < unknown ? 0 : chance(unknown, need) + rng() * 0.01;
    if (p > bestP) {
      bestP = p;
      best = line;
    }
  }
  return best >= 0 ? best : openLines(s)[Math.floor(rng() * openLines(s).length)];
}

