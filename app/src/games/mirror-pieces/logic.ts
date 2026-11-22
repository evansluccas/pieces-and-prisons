/**
 * MIRROR PIECES — rules (our own mirror-image exile puzzle)
 *
 * - A gold mirror line splits the board. On the left, a picture made of
 *   coloured pieces. The right side is empty.
 * - Build the exact MIRROR IMAGE on the right: every piece the same colour,
 *   reflected across the line into the matching spot.
 * - The tray holds one piece of each colour. Pieces can be TURNED but never
 *   FLIPPED — work out which turn of each piece is its own reflection.
 * - Easy: 4 small pieces. Normal: 5 pieces. Hard: 6 pieces, mostly big ones.
 * - An exile match is 3 puzzles; lowest total time wins, the slowest is exiled.
 */
import { Rng } from '../shared/rng';
import { Cell, Placement, SHAPES, flip, key, norm, placedCells, rotate } from '../piece-together/logic';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type { Cell, Placement };

const PROFILE: Record<Difficulty, { count: number; cols: number; rows: number; pool: Cell[][] }> = {
  easy: { count: 4, cols: 5, rows: 6, pool: [...SHAPES.T3, ...SHAPES.T4, ...SHAPES.T4] },
  normal: { count: 5, cols: 6, rows: 7, pool: [...SHAPES.T4, ...SHAPES.T4, ...SHAPES.T5] },
  hard: { count: 6, cols: 6, rows: 8, pool: [...SHAPES.T4, ...SHAPES.T5, ...SHAPES.T5] },
};

/** The four turns of a piece (no flips). */
export function turns(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur = norm(cells);
  for (let i = 0; i < 4; i++) {
    if (!out.some((o) => JSON.stringify(o) === JSON.stringify(cur))) out.push(cur);
    cur = rotate(cur);
  }
  return out;
}

export interface Puzzle {
  difficulty: Difficulty;
  cols: number;          // width of ONE half
  rows: number;
  left: Placement[];     // the picture (board columns 0..cols-1)
  target: Placement[];   // its mirror image (columns cols..2·cols-1) — the answer
  tray: Cell[][];        // piece i, in a random TURN of its mirrored shape
}

const pick = <T>(a: T[], rng: Rng): T => a[Math.floor(rng() * a.length)];
const NB: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Reflect a board square across the mirror line between the two halves. */
export const mirrorCell = ([x, y]: Cell, cols: number): Cell => [2 * cols - 1 - x, y];

export function makePuzzle(rng: Rng, difficulty: Difficulty): Puzzle {
  const { count, cols, rows, pool } = PROFILE[difficulty];
  for (;;) {
    const taken = new Set<string>();
    const left: Placement[] = [];
    let ok = true;
    for (let piece = 0; piece < count; piece++) {
      const options: Placement[] = [];
      const shape = pick(pool, rng);
      for (const cells of [...turns(shape), ...turns(flip(shape))])
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const at: Cell = [x, y];
          const sq = cells.map(([a, b]) => [a + x, b + y] as Cell);
          if (sq.some(([a, b]) => a >= cols || b >= rows || taken.has(`${a},${b}`))) continue;
          const touches = !taken.size || sq.some(([a, b]) => NB.some(([dx, dy]) => taken.has(`${a + dx},${b + dy}`)));
          if (touches) options.push({ piece, cells, at });
        }
      if (!options.length) { ok = false; break; }
      const p = pick(options, rng);
      placedCells(p).forEach((c) => taken.add(key(c)));
      left.push(p);
    }
    if (!ok) continue;
    const target = left.map((p) => {
      const sq = placedCells(p).map((c) => mirrorCell(c, cols));
      const cells = norm(sq);
      const at: Cell = [Math.min(...sq.map((c) => c[0])), Math.min(...sq.map((c) => c[1]))];
      return { piece: p.piece, cells, at };
    });
    // the tray piece is the MIRRORED shape in a random turn: it can be turned into place, never flipped
    // ...and never already in the answer's turn, unless the piece looks the same every way round
    const tray = target.map((t) => {
      const others = turns(t.cells).filter((o) => JSON.stringify(o) !== JSON.stringify(t.cells));
      return others.length ? pick(others, rng) : t.cells;
    });
    return { difficulty, cols, rows, left, target, tray };
  }
}

/** Squares a piece may go on: the right half of the board. */
export function canPlace(pz: Puzzle, placed: Placement[], cells: Cell[], at: Cell, ignore = -1): boolean {
  const used = new Set(placed.filter((p) => p.piece !== ignore).flatMap(placedCells).map(key));
  return cells.every(([x, y]) => {
    const bx = x + at[0];
    const by = y + at[1];
    return bx >= pz.cols && bx < 2 * pz.cols && by >= 0 && by < pz.rows && !used.has(`${bx},${by}`);
  });
}

/** Every piece sits exactly on its reflection. */
export function isMirrored(pz: Puzzle, placed: Placement[]): boolean {
  if (placed.length !== pz.target.length) return false;
  return pz.target.every((t) => {
    const p = placed.find((q) => q.piece === t.piece);
    if (!p) return false;
    const a = new Set(placedCells(p).map(key));
    return placedCells(t).every((c) => a.has(key(c))) && a.size === t.cells.length;
  });
}

// ------------------------------------------------------------- the match ----

export interface Config { puzzles: number }
export const DEFAULT_CONFIG: Config = { puzzles: 3 };
export interface Ghost { name: string; times: number[] }
export interface PuzzleResult { puzzle: Puzzle; timeMs: number }
export type Phase = 'solve' | 'solved' | 'gameOver';

export interface GameState {
  config: Config;
  difficulty: Difficulty;
  index: number;
  phase: Phase;
  puzzle: Puzzle;
  queue: Puzzle[];
  results: PuzzleResult[];
  ghosts: Ghost[];
}

export function ghostTime(p: Puzzle, skill: number, rng: Rng): number {
  const perPiece = { easy: 8_000, normal: 10_000, hard: 13_000 }[p.difficulty];
  return Math.round((10_000 + p.tray.length * perPiece) * skill * (0.8 + rng() * 0.5));
}

export function newGame(rng: Rng, difficulty: Difficulty, ghostNames: string[], config = DEFAULT_CONFIG): GameState {
  const puzzles = Array.from({ length: config.puzzles }, () => makePuzzle(rng, difficulty));
  const skills = [0.8, 1, 1.25];
  const ghosts = ghostNames.map((name, i) => ({ name, times: puzzles.map((p) => ghostTime(p, skills[i % 3], rng)) }));
  return { config, difficulty, index: 0, phase: 'solve', puzzle: puzzles[0], queue: puzzles.slice(1), results: [], ghosts };
}

export function finish(s: GameState, placed: Placement[], timeMs: number): GameState {
  if (s.phase !== 'solve' || !isMirrored(s.puzzle, placed)) return s;
  return { ...s, phase: 'solved', results: [...s.results, { puzzle: s.puzzle, timeMs }] };
}

export function nextPuzzle(s: GameState): GameState {
  if (s.phase !== 'solved') throw new Error('not solved');
  if (!s.queue.length) return { ...s, phase: 'gameOver' };
  return { ...s, index: s.index + 1, phase: 'solve', puzzle: s.queue[0], queue: s.queue.slice(1) };
}

export const totalMs = (s: GameState) => s.results.reduce((t, r) => t + r.timeMs, 0);

export function standings(s: GameState) {
  const n = s.results.length;
  const rows = [
    { name: 'You', ms: totalMs(s) },
    ...s.ghosts.map((g) => ({ name: g.name, ms: g.times.slice(0, n).reduce((a, b) => a + b, 0) })),
  ];
  return rows.sort((a, b) => a.ms - b.ms || (a.name === 'You' ? -1 : 1));
}

export { clock } from '../piece-together/logic';
