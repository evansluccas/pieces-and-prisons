/**
 * PIECE TOGETHER — rules (our own speed-assembly exile puzzle)
 *
 * - An outline is drawn on a grid, and a tray holds a set of pieces made of
 *   squares. Fit EVERY piece into the outline: no gaps, no overlaps, nothing
 *   sticking out. Pieces may be turned and flipped.
 * - Easy: 6 small pieces. Normal: 8 pieces. Hard: 8 pieces, mostly big ones.
 * - Every outline was built from its own pieces, so it always has an answer
 *   (sometimes more than one — any complete fill counts).
 * - An exile match is 3 puzzles; lowest total time wins, the slowest is exiled.
 */
import { Rng } from '../shared/rng';

export type Cell = [number, number]; // [x, y]
export type Difficulty = 'easy' | 'normal' | 'hard';

const T3: Cell[][] = [
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [0, 1]],
];
const T4: Cell[][] = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
];
const T5: Cell[][] = [
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],         // I
  [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],         // L
  [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1]],         // Y
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]],         // N
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],         // P
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],         // T
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],         // U
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],         // V
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],         // W
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],         // X
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],         // F
  [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],         // Z
];

/** The piece shapes, by size (3, 4 and 5 squares). */
export const SHAPES = { T3, T4, T5 };

const PROFILE: Record<Difficulty, { count: number; pool: Cell[][] }> = {
  easy: { count: 6, pool: [...T3, ...T4, ...T4] },
  normal: { count: 8, pool: [...T3, ...T4, ...T4, ...T5] },
  hard: { count: 8, pool: [...T4, ...T5, ...T5] },
};

export const key = ([x, y]: Cell) => `${x},${y}`;

export function norm(cells: Cell[]): Cell[] {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
export const rotate = (cells: Cell[]): Cell[] => norm(cells.map(([x, y]) => [-y, x] as Cell));
export const flip = (cells: Cell[]): Cell[] => norm(cells.map(([x, y]) => [-x, y] as Cell));

/** All distinct orientations (turns and flips). */
export function orientations(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur = norm(cells);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      if (!out.some((o) => JSON.stringify(o) === JSON.stringify(cur))) out.push(cur);
      cur = rotate(cur);
    }
    cur = flip(cur);
  }
  return out;
}

/** `solution` is how the outline was built — kept for checking, never shown. */
export interface Puzzle { outline: Cell[]; pieces: Cell[][]; difficulty: Difficulty; solution: Placement[] }

const pick = <T>(a: T[], rng: Rng): T => a[Math.floor(rng() * a.length)];
const NB: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Build an outline by actually laying the pieces down, each touching what is
 * already there, so the puzzle always has an answer. Prefer compact shapes.
 */
export function makePuzzle(rng: Rng, difficulty: Difficulty): Puzzle {
  const prof = PROFILE[difficulty];
  for (;;) {
    const pieces = Array.from({ length: prof.count }, () => pick(prof.pool, rng));
    const taken = new Set<string>();
    const laid: Cell[][] = [];
    let ok = true;
    for (const p of pieces) {
      let best: Cell[] | null = null;
      let bestScore = -Infinity;
      for (let tries = 0; tries < 60; tries++) {
        const o = pick(orientations(p), rng);
        const base: Cell = taken.size ? (pick([...taken], rng).split(',').map(Number) as Cell) : [0, 0];
        const anchor = pick(o, rng);
        const d = pick(NB, rng);
        const cells = o.map(([x, y]) => [x - anchor[0] + base[0] + (taken.size ? d[0] : 0), y - anchor[1] + base[1] + (taken.size ? d[1] : 0)] as Cell);
        if (cells.some((c) => taken.has(key(c)))) continue;
        if (taken.size && !cells.some(([x, y]) => NB.some(([dx, dy]) => taken.has(`${x + dx},${y + dy}`)))) continue;
        // compactness: how many neighbours touch the existing shape
        const touch = cells.reduce((t, [x, y]) => t + NB.filter(([dx, dy]) => taken.has(`${x + dx},${y + dy}`)).length, 0);
        const score = touch + rng() * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = cells;
        }
      }
      if (!best) { ok = false; break; }
      best.forEach((c) => taken.add(key(c)));
      laid.push(best);
    }
    if (!ok) continue;
    const all = [...taken].map((k) => k.split(',').map(Number) as Cell);
    const mx = Math.min(...all.map((c) => c[0]));
    const my = Math.min(...all.map((c) => c[1]));
    const outline = norm(all);
    const w = Math.max(...outline.map((c) => c[0])) + 1;
    const h = Math.max(...outline.map((c) => c[1])) + 1;
    if (w > 12 || h > 9) continue; // must fit the board
    if (hasHole(outline)) continue;
    // show each piece in a random orientation, so the tray doesn't give the answer away
    const solution: Placement[] = laid.map((cells, piece) => {
      const shape = norm(cells);
      const ox = Math.min(...cells.map((c) => c[0])) - mx;
      const oy = Math.min(...cells.map((c) => c[1])) - my;
      return { piece, cells: shape, at: [ox, oy] as Cell };
    });
    return { outline, pieces: pieces.map((p) => pick(orientations(p), rng)), difficulty, solution };
  }
}

/** True if some empty square is completely enclosed by the outline. */
function hasHole(cells: Cell[]): boolean {
  const set = new Set(cells.map(key));
  const w = Math.max(...cells.map((c) => c[0])) + 3;
  const h = Math.max(...cells.map((c) => c[1])) + 3;
  const seen = new Set<string>(['-1,-1']);
  const stack: Cell[] = [[-1, -1]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of NB) {
      const n: Cell = [x + dx, y + dy];
      if (n[0] < -1 || n[1] < -1 || n[0] > w || n[1] > h || seen.has(key(n)) || set.has(key(n))) continue;
      seen.add(key(n));
      stack.push(n);
    }
  }
  return (w + 2) * (h + 2) - seen.size - set.size > 0;
}

// ------------------------------------------------------------ placing ----

/** A piece on the board: its current shape and the board square of its (0,0). */
export interface Placement { piece: number; cells: Cell[]; at: Cell }

export const placedCells = (p: Placement): Cell[] => p.cells.map(([x, y]) => [x + p.at[0], y + p.at[1]] as Cell);

/** Can this shape go here: inside the outline and not on top of other pieces? */
export function canPlace(outline: Cell[], placed: Placement[], cells: Cell[], at: Cell, ignore = -1): boolean {
  const inside = new Set(outline.map(key));
  const used = new Set(placed.filter((p) => p.piece !== ignore).flatMap(placedCells).map(key));
  return cells.every(([x, y]) => {
    const k = `${x + at[0]},${y + at[1]}`;
    return inside.has(k) && !used.has(k);
  });
}

export const isComplete = (pz: Puzzle, placed: Placement[]) =>
  placed.length === pz.pieces.length && placed.reduce((t, p) => t + p.cells.length, 0) === pz.outline.length;

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
  const perPiece = { easy: 6_000, normal: 8_500, hard: 11_000 }[p.difficulty];
  return Math.round((12_000 + p.pieces.length * perPiece) * skill * (0.8 + rng() * 0.5));
}

export function newGame(rng: Rng, difficulty: Difficulty, ghostNames: string[], config = DEFAULT_CONFIG): GameState {
  const puzzles = Array.from({ length: config.puzzles }, () => makePuzzle(rng, difficulty));
  const skills = [0.8, 1, 1.25];
  const ghosts = ghostNames.map((name, i) => ({ name, times: puzzles.map((p) => ghostTime(p, skills[i % 3], rng)) }));
  return { config, difficulty, index: 0, phase: 'solve', puzzle: puzzles[0], queue: puzzles.slice(1), results: [], ghosts };
}

/** Hand in a board; only a complete, legal fill counts. */
export function finish(s: GameState, placed: Placement[], timeMs: number): GameState {
  if (s.phase !== 'solve' || !isComplete(s.puzzle, placed)) return s;
  for (let i = 0; i < placed.length; i++) if (!canPlace(s.puzzle.outline, placed, placed[i].cells, placed[i].at, placed[i].piece)) return s;
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

export const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
