/**
 * MAGIC SQUARES — the classic number puzzle (public domain)
 *
 * - Fill an n×n grid with the numbers 1 to n², each once, so every row,
 *   every column and both long diagonals add up to the same MAGIC SUM:
 *   15 on 3×3, 34 on 4×4, 65 on 5×5.
 * - Some numbers are given. Each puzzle has exactly one answer.
 * - Three squares in a row: 3×3, 4×4, then 5×5. A hint fills in one
 *   correct number and costs 30 seconds. Lowest total time wins.
 */
import { Rng } from '../shared/rng';

export const magicSum = (n: number) => (n * (n * n + 1)) / 2;

/** Every line as a list of cells: rows, columns, then the two diagonals. */
export function lines(n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    out.push(Array.from({ length: n }, (_, k) => i * n + k));
    out.push(Array.from({ length: n }, (_, k) => k * n + i));
  }
  out.push(Array.from({ length: n }, (_, k) => k * n + k));
  out.push(Array.from({ length: n }, (_, k) => k * n + (n - 1 - k)));
  return out;
}

export type Grid = (number | null)[];

/** True when the grid holds 1..n² once each and every line hits the magic sum. */
export function isMagic(n: number, g: Grid): boolean {
  if (g.length !== n * n || g.some((v) => v === null)) return false;
  if (new Set(g).size !== n * n || g.some((v) => v! < 1 || v! > n * n)) return false;
  const m = magicSum(n);
  return lines(n).every((l) => l.reduce((t, c) => t + g[c]!, 0) === m);
}

/**
 * Backtracking search over the empty cells. Lines are checked as they fill:
 * a line with one gap left forces its last number. Calls `found` for each
 * solution; stop by returning true. Gives up (returns 'budget') after `budget` steps.
 */
function search(n: number, start: Grid, found: (g: Grid) => boolean, rng: Rng | null, budget: number): 'done' | 'stopped' | 'budget' {
  const g = [...start];
  const N2 = n * n;
  const m = magicSum(n);
  const L = lines(n);
  const linesOf: number[][] = Array.from({ length: N2 }, () => []);
  L.forEach((l, i) => l.forEach((c) => linesOf[c].push(i)));
  const used = new Array(N2 + 1).fill(false);
  for (const v of g) if (v !== null) used[v] = true;
  let steps = 0;

  // fill rows top to bottom: each row closes quickly, and its last cell is forced
  const order = Array.from({ length: N2 }, (_, c) => c).filter((c) => g[c] === null);

  const lineOk = (li: number) => {
    let sum = 0;
    let gaps = 0;
    for (const c of L[li]) {
      if (g[c] === null) gaps++;
      else sum += g[c]!;
    }
    if (gaps === 0) return sum === m;
    // the gaps need at least 1+2+…, at most N2+(N2-1)+…
    const low = (gaps * (gaps + 1)) / 2;
    const high = gaps * N2 - (gaps * (gaps - 1)) / 2;
    return m - sum >= low && m - sum <= high;
  };

  const forced = (c: number): number | null => {
    for (const li of linesOf[c]) {
      let sum = 0;
      let gaps = 0;
      for (const d of L[li]) {
        if (g[d] === null) gaps++;
        else sum += g[d]!;
      }
      if (gaps === 1) return m - sum;
    }
    return null;
  };

  const go = (k: number): 'done' | 'stopped' | 'budget' => {
    if (k === order.length) return found(g) ? 'stopped' : 'done';
    if (++steps > budget) return 'budget';
    const c = order[k];
    const f = forced(c);
    let values: number[];
    if (f !== null) values = f >= 1 && f <= N2 && !used[f] ? [f] : [];
    else {
      values = [];
      for (let v = 1; v <= N2; v++) if (!used[v]) values.push(v);
      if (rng) for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
    }
    for (const v of values) {
      g[c] = v;
      used[v] = true;
      if (linesOf[c].every(lineOk)) {
        const r = go(k + 1);
        if (r !== 'done') {
          if (r === 'budget') {
            g[c] = null;
            used[v] = false;
          }
          return r;
        }
      }
      g[c] = null;
      used[v] = false;
    }
    return 'done';
  };
  return go(0);
}

/** Up to `limit` solutions consistent with the grid; null if the search ran out of budget. */
export function solutions(n: number, start: Grid, limit = 2, budget = 400_000): Grid[] | null {
  const out: Grid[] = [];
  const r = search(n, start, (g) => {
    out.push([...g]);
    return out.length >= limit;
  }, null, budget);
  return r === 'budget' ? null : out;
}

const shuffled = (k: number, rng: Rng) => {
  const a = Array.from({ length: k }, (_, i) => i);
  for (let i = k - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * 5×5 straight from Euler's recipe: two orthogonal Latin squares where every
 * row, column and diagonal holds each symbol once, relabelled at random.
 * Searching for a 5×5 takes seconds; this is instant and just as varied.
 */
function euler5(rng: Rng): Grid {
  const ok = (p: number, q: number) => [p, q, p + q, p - q].every((v) => ((v % 5) + 5) % 5 !== 0);
  const pairs: [number, number][] = [];
  for (let p = 1; p < 5; p++) for (let q = 1; q < 5; q++) if (ok(p, q)) pairs.push([p, q]);
  for (;;) {
    const [a, b] = pairs[Math.floor(rng() * pairs.length)];
    const [c, d] = pairs[Math.floor(rng() * pairs.length)];
    if ((((a * d - b * c) % 5) + 5) % 5 === 0) continue; // not orthogonal
    const sigma = shuffled(5, rng);
    const tau = shuffled(5, rng);
    const [s1, s2] = [Math.floor(rng() * 5), Math.floor(rng() * 5)];
    const g: Grid = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) g.push(5 * sigma[(a * i + b * j + s1) % 5] + tau[(c * i + d * j + s2) % 5] + 1);
    return g;
  }
}

/** A random full magic square. */
export function randomMagic(n: number, rng: Rng): Grid {
  if (n === 5) return euler5(rng);
  for (;;) {
    let out: Grid | null = null;
    // a random first row keeps the search varied; a fresh try if it stalls
    search(n, Array(n * n).fill(null), (g) => {
      out = [...g];
      return true;
    }, rng, 50_000);
    if (out) return out;
  }
}

/** How many numbers each puzzle starts with. */
export const GIVENS: Record<number, number> = { 3: 2, 4: 7, 5: 14 };

export interface Puzzle { n: number; givens: Grid; solution: Grid }

/**
 * Take a random magic square and blank cells one by one, keeping a cell only
 * when blanking it would allow a second answer (or the check runs too long).
 */
export function makePuzzle(n: number, rng: Rng, target = GIVENS[n]): Puzzle {
  for (;;) {
    const solution = randomMagic(n, rng);
    const givens: Grid = [...solution];
    const cells = Array.from({ length: n * n }, (_, c) => c);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    let left = n * n;
    for (const c of cells) {
      if (left <= target) break;
      const v = givens[c];
      givens[c] = null;
      const sols = solutions(n, givens, 2, 150_000);
      if (sols && sols.length === 1) left--;
      else givens[c] = v;
    }
    // close enough to the target: a couple of extra givens is fine
    if (left <= target + 2) return { n, givens, solution };
  }
}

// ------------------------------------------------------------- the match ----

export const BOARDS = [3, 4, 5];
export const HINT_MS = 30_000;

export interface Ghost { name: string; times: number[] }
export interface BoardResult { n: number; timeMs: number; hints: number }
export type Phase = 'play' | 'solved' | 'gameOver';

export interface GameState {
  index: number;
  phase: Phase;
  puzzles: Puzzle[];
  grid: Grid;
  hints: number;
  results: BoardResult[];
  ghosts: Ghost[];
}

export const current = (s: GameState) => s.puzzles[s.index];

export function newGame(rng: Rng, ghostNames: string[], boards = BOARDS): GameState {
  const puzzles = boards.map((n) => makePuzzle(n, rng));
  const base: Record<number, number> = { 3: 50_000, 4: 200_000, 5: 420_000 };
  const skills = [0.8, 1, 1.25];
  const ghosts = ghostNames.map((name, i) => ({
    name, times: boards.map((n) => Math.round(base[n] * skills[i % 3] * (0.8 + rng() * 0.5))),
  }));
  return { index: 0, phase: 'play', puzzles, grid: [...puzzles[0].givens], hints: 0, results: [], ghosts };
}

export const isGiven = (s: GameState, c: number) => current(s).givens[c] !== null;

/** Put a number in a cell (or clear it with null). A number already used elsewhere moves here. */
export function write(s: GameState, c: number, v: number | null, timeMs: number): GameState {
  if (s.phase !== 'play' || isGiven(s, c)) return s;
  const n = current(s).n;
  if (v !== null && (v < 1 || v > n * n)) return s;
  const grid = s.grid.map((x, i) => (i === c ? v : x === v && v !== null ? null : x));
  return finish({ ...s, grid }, timeMs);
}

function finish(s: GameState, timeMs: number): GameState {
  const n = current(s).n;
  if (!isMagic(n, s.grid)) return s;
  const result = { n, timeMs: timeMs + s.hints * HINT_MS, hints: s.hints };
  return { ...s, phase: 'solved', results: [...s.results, result] };
}

/** Fill one empty or wrong cell with the right number. Returns the cell, or -1. */
export function hintCell(s: GameState, rng: Rng): number {
  const sol = current(s).solution;
  const wrong = s.grid.map((v, c) => (v !== null && v !== sol[c] ? c : -1)).filter((c) => c >= 0);
  const empty = s.grid.map((v, c) => (v === null ? c : -1)).filter((c) => c >= 0);
  const pool = wrong.length ? wrong : empty;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : -1;
}

export function useHint(s: GameState, c: number, timeMs: number): GameState {
  if (s.phase !== 'play' || c < 0) return s;
  const v = current(s).solution[c];
  const t = { ...s, hints: s.hints + 1 };
  return write(t, c, v, timeMs);
}

export function nextBoard(s: GameState): GameState {
  if (s.phase !== 'solved') throw new Error('not solved');
  if (s.index + 1 >= s.puzzles.length) return { ...s, phase: 'gameOver' };
  const index = s.index + 1;
  return { ...s, index, phase: 'play', grid: [...s.puzzles[index].givens], hints: 0 };
}

/** Line totals for display: sum so far and whether the line is full. */
export function lineTotals(n: number, g: Grid) {
  return lines(n).map((l) => ({ sum: l.reduce((t, c) => t + (g[c] ?? 0), 0), full: l.every((c) => g[c] !== null) }));
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
