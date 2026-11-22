/**
 * HEX SUM — rules (our own memory-and-sums duel)
 *
 * - 19 hexagon tiles, each with a number 1–9. Both players study the board,
 *   then every tile is turned face down.
 * - 8 rounds. Each round shows a TARGET. Players take turns picking THREE
 *   tiles in a straight line (side by side, in any of the three directions).
 *   The tiles flip up:
 *     they add up to the target → you win the round, and that line is claimed
 *     for the rest of the match;
 *     they don't → they flip back down and it's the other player's turn.
 *   Every flip is seen by both players. A round with 6 misses is void.
 * - The round's first player alternates. Most rounds won after 8 wins the
 *   duel (equal = draw).
 */
import { Rng } from '../shared/rng';

export type Side = 0 | 1;
export type Hex = [number, number]; // axial (q, r)

/** The 19 tiles: every (q, r) with |q|, |r|, |q + r| ≤ 2, row by row. */
export const HEXES: Hex[] = (() => {
  const out: Hex[] = [];
  for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) if (Math.abs(q + r) <= 2) out.push([q, r]);
  return out;
})();

const at = (q: number, r: number) => HEXES.findIndex(([a, b]) => a === q && b === r);

/** Every straight line of three neighbouring tiles. */
export const LINES: number[][] = (() => {
  const out: number[][] = [];
  for (const [dq, dr] of [[1, 0], [0, 1], [1, -1]]) {
    HEXES.forEach(([q, r], i) => {
      const b = at(q + dq, r + dr);
      const c = at(q + 2 * dq, r + 2 * dr);
      if (b >= 0 && c >= 0) out.push([i, b, c]);
    });
  }
  return out;
})();

export const lineOf = (tiles: number[]) => {
  const key = [...tiles].sort((a, b) => a - b).join();
  return LINES.findIndex((l) => [...l].sort((a, b) => a - b).join() === key);
};

export interface Config { rounds: number; maxMisses: number }
export const DEFAULT_CONFIG: Config = { rounds: 8, maxMisses: 6 };

export interface Attempt { round: number; target: number; side: Side; line: number; sum: number; ok: boolean }

export type Phase = 'memorize' | 'play' | 'gameOver';

export interface GameState {
  config: Config;
  values: number[];
  phase: Phase;
  round: number;
  target: number;
  turn: Side;
  starter: Side;
  misses: number;
  scores: [number, number];
  claimed: number[];         // lines already scored
  attempts: Attempt[];
}

const pick = <T>(a: T[], rng: Rng): T => a[Math.floor(rng() * a.length)];

export const lineSum = (values: number[], line: number) => LINES[line].reduce((t, i) => t + values[i], 0);

/** A target that at least one unclaimed line reaches. */
function newTarget(values: number[], claimed: number[], rng: Rng): number {
  const open = LINES.map((_, i) => i).filter((i) => !claimed.includes(i));
  return lineSum(values, pick(open, rng));
}

export function newGame(rng: Rng, config = DEFAULT_CONFIG, first: Side = 0): GameState {
  const values = HEXES.map(() => 1 + Math.floor(rng() * 9));
  return {
    config, values, phase: 'memorize', round: 1, target: newTarget(values, [], rng), turn: first, starter: first,
    misses: 0, scores: [0, 0], claimed: [], attempts: [],
  };
}

export function startPlay(s: GameState): GameState {
  if (s.phase !== 'memorize') throw new Error('not memorising');
  return { ...s, phase: 'play' };
}

/** Lines a player may still try. */
export const openLines = (s: GameState) => LINES.map((_, i) => i).filter((i) => !s.claimed.includes(i));

export function tryLine(s: GameState, side: Side, line: number, rng: Rng): GameState {
  if (s.phase !== 'play' || s.turn !== side) throw new Error('not your turn');
  if (line < 0 || s.claimed.includes(line)) throw new Error('pick three free tiles in a straight line');
  const sum = lineSum(s.values, line);
  const ok = sum === s.target;
  const attempts = [...s.attempts, { round: s.round, target: s.target, side, line, sum, ok }];
  const other = (1 - side) as Side;
  if (!ok && s.misses + 1 < s.config.maxMisses) return { ...s, attempts, misses: s.misses + 1, turn: other };
  // round over: won, or void after too many misses
  const scores: [number, number] = [...s.scores];
  if (ok) scores[side]++;
  const claimed = ok ? [...s.claimed, line] : s.claimed;
  if (s.round >= s.config.rounds || openLines({ ...s, claimed }).length === 0) {
    return { ...s, attempts, scores, claimed, misses: 0, phase: 'gameOver' };
  }
  const starter = (1 - s.starter) as Side;
  return {
    ...s, attempts, scores, claimed, misses: 0, round: s.round + 1, starter, turn: starter,
    target: newTarget(s.values, claimed, rng),
  };
}

export const winner = (s: GameState): Side | 'draw' | null =>
  s.phase !== 'gameOver' ? null : s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? 0 : 1;
