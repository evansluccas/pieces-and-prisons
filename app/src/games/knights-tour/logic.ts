/**
 * KNIGHT'S TOUR — the classic puzzle (public domain)
 *
 * - Pick a starting square, then move the knight like in chess (an L: two
 *   squares one way, one square to the side) so it lands on EVERY square of
 *   the board exactly once.
 * - Three boards in a row: 6×6, 7×7, 8×8. On 7×7 a tour only exists from the
 *   squares coloured like the corners, so you must start on one of those.
 * - Undo is free. A hint shows a next move that can still finish the tour
 *   (or tells you the path can't be finished) — and costs 30 seconds.
 * - Lowest total time wins; the slowest is out.
 */
import { Rng } from '../shared/rng';

const JUMPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export const xy = (n: number, c: number) => [c % n, Math.floor(c / n)] as const;

export function moves(n: number, c: number): number[] {
  const [x, y] = xy(n, c);
  return JUMPS.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n).map(([a, b]) => b * n + a);
}

/** Squares the knight can go to next. */
export function nextSquares(n: number, path: number[]): number[] {
  if (!path.length) return [];
  const seen = new Set(path);
  return moves(n, path[path.length - 1]).filter((c) => !seen.has(c));
}

/** On odd boards a tour must start on a corner-coloured square. */
export function canStart(n: number, c: number): boolean {
  if (n % 2 === 0) return c >= 0 && c < n * n;
  const [x, y] = xy(n, c);
  return (x + y) % 2 === 0;
}

export const complete = (n: number, path: number[]) => path.length === n * n;
export const stuck = (n: number, path: number[]) => path.length > 0 && !complete(n, path) && nextSquares(n, path).length === 0;

/**
 * Finish the tour from this path, or say it can't be done. Tries the squares
 * with the fewest onward moves first (Warnsdorff's rule, ties: farther from
 * the centre), never strands an unvisited square, and backtracks.
 * Returns undefined if it gave up after `budget` steps.
 */
export function solve(n: number, path: number[], budget = 200_000): number[] | null | undefined {
  if (!path.length) return null;
  const seen = new Set(path);
  const out = [...path];
  // a knight always changes colour: the rest of the tour must alternate colours too
  const colour = (c: number) => (xy(n, c)[0] + xy(n, c)[1]) % 2;
  const left = Array.from({ length: n * n }, (_, c) => c).filter((c) => !seen.has(c));
  const head = colour(out[out.length - 1]);
  const other = left.filter((c) => colour(c) !== head).length;
  if (other !== Math.ceil(left.length / 2) || left.length - other !== Math.floor(left.length / 2)) return null;

  let steps = 0;
  const mid = (n - 1) / 2;
  const far = (c: number) => Math.hypot(xy(n, c)[0] - mid, xy(n, c)[1] - mid);
  const onward = (c: number) => moves(n, c).filter((d) => !seen.has(d)).length;
  /** After moving to `c`, could every other unvisited square still be reached? */
  const strands = (c: number) => {
    if (out.length === n * n) return false;
    for (let u = 0; u < n * n; u++) {
      if (seen.has(u)) continue;
      const ways = moves(n, u).filter((d) => !seen.has(d) || d === c).length;
      if (ways === 0) return true;
    }
    return false;
  };
  const go = (): boolean | undefined => {
    if (out.length === n * n) return true;
    if (++steps > budget) return undefined;
    const here = out[out.length - 1];
    const options = moves(n, here).filter((c) => !seen.has(c)).sort((a, b) => onward(a) - onward(b) || far(b) - far(a));
    for (const c of options) {
      seen.add(c);
      out.push(c);
      if (!strands(c)) {
        const r = go();
        if (r !== false) return r;
      }
      out.pop();
      seen.delete(c);
    }
    return false;
  };
  const r = go();
  return r === undefined ? undefined : r ? out : null;
}

export type Hint = { kind: 'move'; to: number } | { kind: 'deadEnd' } | { kind: 'unknown' };

/** Kept short so a hint never freezes the screen; "unknown" usually means a dead end. */
export function hint(n: number, path: number[]): Hint {
  const r = solve(n, path, 50_000);
  if (r === undefined) return { kind: 'unknown' };
  if (r === null || r.length <= path.length) return { kind: 'deadEnd' };
  return { kind: 'move', to: r[path.length] };
}

/**
 * Check a path sent over the network: a list of squares on the board, none
 * twice, a legal start, and knight jumps all the way. Returns a clean copy;
 * throws a friendly message otherwise.
 */
export function readPath(n: number, raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new Error('Send the path as a list of squares.');
  if (raw.length > n * n) throw new Error('That path is longer than the board.');
  const seen = new Set<number>();
  const out: number[] = [];
  for (const c of raw) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= n * n) throw new Error('That path has a square off the board.');
    if (seen.has(c)) throw new Error(`The path visits ${square(n, c)} twice.`);
    if (!out.length && !canStart(n, c)) throw new Error(`On ${n}×${n} the tour must start on a square coloured like the corners.`);
    if (out.length && !moves(n, out[out.length - 1]).includes(c)) {
      throw new Error(`${square(n, out[out.length - 1])} to ${square(n, c)} isn’t a knight move.`);
    }
    seen.add(c);
    out.push(c);
  }
  return out;
}

export const square = (n: number, c: number) => `${'abcdefgh'[xy(n, c)[0]]}${n - xy(n, c)[1]}`;

// ------------------------------------------------------------- the match ----

export const BOARDS = [6, 7, 8];
export const HINT_MS = 30_000;

export interface Ghost { name: string; times: number[] }
export interface BoardResult { n: number; timeMs: number; hints: number }
export type Phase = 'play' | 'solved' | 'gameOver';

export interface GameState {
  index: number;
  phase: Phase;
  path: number[];
  hints: number;
  results: BoardResult[];
  ghosts: Ghost[];
  boards: number[];
}

export const size = (s: GameState) => s.boards[s.index];

const GHOST_BASE: Record<number, number> = { 5: 60_000, 6: 110_000, 7: 170_000, 8: 260_000 };
const GHOST_SKILLS = [0.8, 1, 1.25];

/** How long rival number `i` takes on an n×n board (solo ghosts and online bots). */
export const ghostTime = (n: number, i: number, rng: Rng) =>
  Math.round(GHOST_BASE[n] * GHOST_SKILLS[i % 3] * (0.8 + rng() * 0.5));

export function newGame(rng: Rng, ghostNames: string[], boards = BOARDS): GameState {
  const ghosts = ghostNames.map((name, i) => ({ name, times: boards.map((n) => ghostTime(n, i, rng)) }));
  return { index: 0, phase: 'play', path: [], hints: 0, results: [], ghosts, boards };
}

export function step(s: GameState, c: number, timeMs: number): GameState {
  if (s.phase !== 'play') return s;
  const n = size(s);
  if (!s.path.length) {
    if (!canStart(n, c)) throw new Error('on an odd board, start on a square coloured like the corners');
  } else if (!nextSquares(n, s.path).includes(c)) throw new Error('a knight can’t go there');
  const path = [...s.path, c];
  if (!complete(n, path)) return { ...s, path };
  const result = { n, timeMs: timeMs + s.hints * HINT_MS, hints: s.hints };
  return { ...s, path, phase: 'solved', results: [...s.results, result] };
}

export const undo = (s: GameState): GameState => (s.phase === 'play' ? { ...s, path: s.path.slice(0, -1) } : s);
export const restart = (s: GameState): GameState => (s.phase === 'play' ? { ...s, path: [] } : s);
export const useHint = (s: GameState): GameState => ({ ...s, hints: s.hints + 1 });

export function nextBoard(s: GameState): GameState {
  if (s.phase !== 'solved') throw new Error('not solved');
  if (s.index + 1 >= s.boards.length) return { ...s, phase: 'gameOver' };
  return { ...s, index: s.index + 1, phase: 'play', path: [], hints: 0 };
}

export const totalMs = (s: GameState) => s.results.reduce((t, r) => t + r.timeMs, 0);

export function standings(s: GameState) {
  const k = s.results.length;
  const rows = [
    { name: 'You', ms: totalMs(s) },
    ...s.ghosts.map((g) => ({ name: g.name, ms: g.times.slice(0, k).reduce((a, b) => a + b, 0) })),
  ];
  return rows.sort((a, b) => a.ms - b.ms || (a.name === 'You' ? -1 : 1));
}

export const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
