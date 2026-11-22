/**
 * NUMBER FORGE — rules (our own equation race)
 *
 * - Ten tiles sit in a pyramid (rows of 1, 2, 3 and 4), lettered A–J. Each
 *   tile has a number (1–9) and an operator (+ − × ÷).
 * - Each round a TARGET is revealed. Everyone races to FORGE it: pick three
 *   different tiles in any order. The equation is
 *       1st number  (2nd operator) 2nd number  (3rd operator) 3rd number
 *   worked out left to right (the first tile's operator is ignored, and
 *   division must come out whole).
 * - A correct forge scores +1 and claims those three tiles for the round —
 *   the same three tiles can't score again in another order. A wrong forge,
 *   or one already claimed, costs −1.
 * - CLOSE THE FORGE: if you think every answer has been found, call it.
 *   Right → +3 and the round ends. Wrong → −1 and the race goes on.
 * - A round lasts at most 60 seconds. 6 rounds; most points wins
 *   (ties: more correct forges). Lowest score goes to prison.
 */
import { Rng } from '../shared/rng';

export type Op = '+' | '−' | '×' | '÷';
export const OPS: Op[] = ['+', '−', '×', '÷'];
export interface Tile { n: number; op: Op }

export const LETTERS = 'ABCDEFGHIJ';
export const ROWS = [[0], [1, 2], [3, 4, 5], [6, 7, 8, 9]];

export interface Config { rounds: number; roundMs: number; closeBonus: number; minAnswers: number; maxAnswers: number }
export const DEFAULT_CONFIG: Config = { rounds: 6, roundMs: 60_000, closeBonus: 3, minAnswers: 2, maxAnswers: 6 };

export interface PlayerState { id: string; name: string; isBot: boolean; points: number; correct: number }

export interface Claim {
  player: string;
  kind: 'forge' | 'close';
  order?: number[];
  value?: number | null;
  ok: boolean;
  repeat?: boolean;
  at: number; // ms since the round started
}

export interface RoundRecord {
  round: number;
  tiles: Tile[];
  target: number;
  answers: number[][];
  claims: Claim[];
  end: 'closed' | 'time';
}

export type Phase = 'play' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  tiles: Tile[];
  target: number;
  answers: number[][]; // every winning set of tiles (sorted indices) — hidden from players
  found: number[][];   // sets claimed so far (sorted)
  claims: Claim[];
  history: RoundRecord[];
}

/** Value of three tiles in this order, or null if a division isn't whole. */
export function evaluate(tiles: Tile[], order: number[]): number | null {
  let v = tiles[order[0]].n;
  for (const i of order.slice(1)) {
    const { n, op } = tiles[i];
    if (op === '+') v += n;
    else if (op === '−') v -= n;
    else if (op === '×') v *= n;
    else {
      if (v % n !== 0) return null;
      v /= n;
    }
  }
  return v;
}

const key = (set: number[]) => [...set].sort((a, b) => a - b).join(',');

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** Every set of three tiles that can make `target` in some order. */
export function solve(tiles: Tile[], target: number): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < tiles.length; a++)
    for (let b = a + 1; b < tiles.length; b++)
      for (let c = b + 1; c < tiles.length; c++) {
        const set = [a, b, c];
        if (PERMS.some((p) => evaluate(tiles, p.map((i) => set[i])) === target)) out.push(set);
      }
  return out;
}

/** A pyramid and a target with a fair number of answers. */
export function makeRound(rng: Rng, config: Config): { tiles: Tile[]; target: number; answers: number[][] } {
  for (;;) {
    const tiles: Tile[] = Array.from({ length: 10 }, () => ({ n: 1 + Math.floor(rng() * 9), op: OPS[Math.floor(rng() * 4)] }));
    const candidates = Array.from({ length: 40 }, (_, i) => i + 1).filter((t) => {
      const n = solve(tiles, t).length;
      return n >= config.minAnswers && n <= config.maxAnswers;
    });
    if (!candidates.length) continue;
    const target = candidates[Math.floor(rng() * candidates.length)];
    return { tiles, target, answers: solve(tiles, target) };
  }
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('2 to 6 players');
  const r = makeRound(rng, config);
  return {
    config,
    players: players.map((p) => ({ ...p, points: 0, correct: 0 })),
    round: 1, phase: 'play', ...r, found: [], claims: [], history: [],
  };
}

const addPoints = (s: GameState, id: string, d: number, correct = 0) =>
  s.players.map((p) => (p.id === id ? { ...p, points: p.points + d, correct: p.correct + correct } : p));

export function forge(s: GameState, id: string, order: number[], at: number): GameState {
  if (s.phase !== 'play') throw new Error('the round is over');
  if (order.length !== 3 || new Set(order).size !== 3 || order.some((i) => i < 0 || i >= s.tiles.length)) {
    throw new Error('pick three different tiles');
  }
  const value = evaluate(s.tiles, order);
  const repeat = s.found.some((f) => key(f) === key(order));
  const ok = value === s.target && !repeat;
  const claim: Claim = { player: id, kind: 'forge', order, value, ok, repeat: value === s.target && repeat, at };
  return {
    ...s,
    players: addPoints(s, id, ok ? 1 : -1, ok ? 1 : 0),
    found: ok ? [...s.found, [...order].sort((a, b) => a - b)] : s.found,
    claims: [...s.claims, claim],
  };
}

export const allFound = (s: GameState) => s.found.length === s.answers.length;

export function close(s: GameState, id: string, at: number): GameState {
  if (s.phase !== 'play') throw new Error('the round is over');
  const ok = allFound(s);
  const next = {
    ...s,
    players: addPoints(s, id, ok ? s.config.closeBonus : -1),
    claims: [...s.claims, { player: id, kind: 'close' as const, ok, at }],
  };
  return ok ? endRound(next, 'closed') : next;
}

export function timeUp(s: GameState): GameState {
  return s.phase === 'play' ? endRound(s, 'time') : s;
}

function endRound(s: GameState, end: RoundRecord['end']): GameState {
  const record: RoundRecord = { round: s.round, tiles: s.tiles, target: s.target, answers: s.answers, claims: s.claims, end };
  return { ...s, phase: 'result', history: [...s.history, record] };
}

export function nextRound(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'result') throw new Error('round not over');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  return { ...s, round: s.round + 1, phase: 'play', ...makeRound(rng, s.config), found: [], claims: [] };
}

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, seat }))
    .sort((a, b) => b.points - a.points || b.correct - a.correct || a.seat - b.seat);
}

export const letters = (order: number[]) => order.map((i) => LETTERS[i]).join('');

/** "7 × 3 − 2" for a tile order (the first tile's operator is left out). */
export function equationText(tiles: Tile[], order: number[]): string {
  return order.map((i, k) => (k === 0 ? `${tiles[i].n}` : `${tiles[i].op} ${tiles[i].n}`)).join(' ');
}

/** The winning order for a set (for showing answers after the round). */
export function winningOrder(tiles: Tile[], set: number[], target: number): number[] {
  for (const p of PERMS) {
    const o = p.map((i) => set[i]);
    if (evaluate(tiles, o) === target) return o;
  }
  return set;
}
