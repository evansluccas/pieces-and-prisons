/**
 * FENCE LOOP — rules (a classic loop-drawing puzzle, our own presentation)
 *
 * - A grid of dots with numbers in some of the squares. Draw fences between
 *   neighbouring dots so they form ONE closed loop: no crossings, no branches,
 *   no loose ends.
 * - A number says how many of that square's four sides are fenced.
 *   Squares without a number can have any count.
 * - Every puzzle has exactly one answer. The lock opens the moment your loop
 *   matches it.
 * - An exile match is 3 puzzles in a row; lowest total time wins, the slowest
 *   is exiled.
 */
import { Rng } from '../shared/rng';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const SIZE: Record<Difficulty, number> = { easy: 5, normal: 6, hard: 7 };

// ------------------------------------------------------------ geometry ----

/**
 * Edges are numbered: first the horizontal ones (row r = 0..R of dots,
 * col c = 0..C-1), then the vertical ones (row r = 0..R-1, col c = 0..C).
 */
export interface Geometry {
  R: number;
  C: number;
  edges: number;
  cellEdges: number[][];   // cell -> its 4 edges (top, bottom, left, right)
  vertexEdges: number[][]; // dot -> its 2..4 edges
  edgeVerts: [number, number][];
}

const geoCache = new Map<string, Geometry>();

export function geometry(R: number, C: number): Geometry {
  const k = `${R}x${C}`;
  if (geoCache.has(k)) return geoCache.get(k)!;
  const H = (R + 1) * C;
  const h = (r: number, c: number) => r * C + c;
  const v = (r: number, c: number) => H + r * (C + 1) + c;
  const dot = (r: number, c: number) => r * (C + 1) + c;
  const edges = H + R * (C + 1);
  const cellEdges: number[][] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cellEdges.push([h(r, c), h(r + 1, c), v(r, c), v(r, c + 1)]);
  const edgeVerts: [number, number][] = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) edgeVerts.push([dot(r, c), dot(r, c + 1)]);
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) edgeVerts.push([dot(r, c), dot(r + 1, c)]);
  const vertexEdges: number[][] = Array.from({ length: (R + 1) * (C + 1) }, () => []);
  edgeVerts.forEach(([a, b], e) => {
    vertexEdges[a].push(e);
    vertexEdges[b].push(e);
  });
  const g = { R, C, edges, cellEdges, vertexEdges, edgeVerts };
  geoCache.set(k, g);
  return g;
}

// ---------------------------------------------------------- generating ----

/** The loop around a region of cells: an edge is on when exactly one side is in the region. */
export function regionLoop(R: number, C: number, inside: boolean[]): boolean[] {
  const g = geometry(R, C);
  const on = Array<boolean>(g.edges).fill(false);
  const at = (r: number, c: number) => r >= 0 && r < R && c >= 0 && c < C && inside[r * C + c];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) on[r * C + c] = at(r - 1, c) !== at(r, c);
  const H = (R + 1) * C;
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) on[H + r * (C + 1) + c] = at(r, c - 1) !== at(r, c);
  return on;
}

/** True if the fenced edges form exactly one closed loop. */
export function isSingleLoop(R: number, C: number, on: boolean[]): boolean {
  const g = geometry(R, C);
  const used = on.map((x, e) => (x ? e : -1)).filter((e) => e >= 0);
  if (used.length < 4) return false;
  for (const es of g.vertexEdges) {
    const d = es.filter((e) => on[e]).length;
    if (d !== 0 && d !== 2) return false;
  }
  // walk the loop from one edge and see that it covers every fenced edge
  const seen = new Set<number>([used[0]]);
  const stack = [g.edgeVerts[used[0]][0], g.edgeVerts[used[0]][1]];
  const visited = new Set<number>();
  while (stack.length) {
    const d = stack.pop()!;
    if (visited.has(d)) continue;
    visited.add(d);
    for (const e of g.vertexEdges[d]) {
      if (!on[e] || seen.has(e)) continue;
      seen.add(e);
      stack.push(...g.edgeVerts[e]);
    }
  }
  return seen.size === used.length;
}

/** Grow a random blob of cells whose outline is a single loop. */
function randomLoop(R: number, C: number, rng: Rng): boolean[] {
  for (;;) {
    const inside = Array<boolean>(R * C).fill(false);
    inside[Math.floor(rng() * R * C)] = true;
    const target = Math.floor(R * C * (0.4 + rng() * 0.2));
    let count = 1;
    for (let tries = 0; tries < R * C * 40 && count < target; tries++) {
      const cand: number[] = [];
      for (let i = 0; i < R * C; i++) {
        if (inside[i]) continue;
        const r = Math.floor(i / C);
        const c = i % C;
        if ((r > 0 && inside[i - C]) || (r < R - 1 && inside[i + C]) || (c > 0 && inside[i - 1]) || (c < C - 1 && inside[i + 1])) cand.push(i);
      }
      const i = cand[Math.floor(rng() * cand.length)];
      inside[i] = true;
      if (isSingleLoop(R, C, regionLoop(R, C, inside))) count++;
      else inside[i] = false;
    }
    const loop = regionLoop(R, C, inside);
    if (count >= target * 0.8 && isSingleLoop(R, C, loop)) return loop;
  }
}

export const clueOf = (g: Geometry, loop: boolean[], cell: number) => g.cellEdges[cell].filter((e) => loop[e]).length;

// -------------------------------------------------------------- solving ----

const UNK = 0;
const ON = 1;
const OFF = 2;

/**
 * Count solutions (stopping at `limit`). Constraint propagation on dots and
 * numbers, plus a check that a loop only closes when it is the whole answer.
 */
export function countSolutions(R: number, C: number, clues: (number | null)[], limit = 2): number {
  const g = geometry(R, C);
  let found = 0;

  const verts = (e: number) => g.edgeVerts[e];
  const cellsOfEdge: number[][] = Array.from({ length: g.edges }, () => []);
  g.cellEdges.forEach((es, cell) => es.forEach((e) => cellsOfEdge[e].push(cell)));

  /** Does turning `e` on close a loop? (its two dots already joined by fences) */
  function closesLoop(st: Uint8Array, e: number): boolean {
    const [a, b] = verts(e);
    let cur = a;
    let prevEdge = e;
    for (let steps = 0; steps < g.edges; steps++) {
      const next = g.vertexEdges[cur].find((x) => x !== prevEdge && st[x] === ON);
      if (next === undefined) return false;
      const [p, q] = verts(next);
      cur = p === cur ? q : p;
      prevEdge = next;
      if (cur === b) return true;
    }
    return false;
  }

  function valid(st: Uint8Array): boolean {
    for (let cell = 0; cell < clues.length; cell++) {
      const k = clues[cell];
      if (k === null) continue;
      const on = g.cellEdges[cell].filter((e) => st[e] === ON).length;
      if (on !== k) return false;
    }
    for (const es of g.vertexEdges) {
      const d = es.filter((e) => st[e] === ON).length;
      if (d !== 0 && d !== 2) return false;
    }
    return true;
  }

  function propagate(st: Uint8Array, queue: number[]): boolean {
    while (queue.length) {
      const e = queue.pop()!;
      // dots at both ends
      for (const d of verts(e)) {
        const es = g.vertexEdges[d];
        let on = 0;
        let unk = 0;
        for (const x of es) {
          if (st[x] === ON) on++;
          else if (st[x] === UNK) unk++;
        }
        if (on > 2 || (on === 1 && unk === 0)) return false;
        if (on === 2 && unk) {
          for (const x of es) if (st[x] === UNK) { st[x] = OFF; queue.push(x); }
        } else if (on === 1 && unk === 1) {
          for (const x of es) if (st[x] === UNK) { if (!setOn(st, x, queue)) return false; }
        } else if (on === 0 && unk === 1) {
          for (const x of es) if (st[x] === UNK) { st[x] = OFF; queue.push(x); }
        }
      }
      // numbered squares on both sides
      for (const cell of cellsOfEdge[e]) {
        const k = clues[cell];
        if (k === null) continue;
        const es = g.cellEdges[cell];
        let on = 0;
        let unk = 0;
        for (const x of es) {
          if (st[x] === ON) on++;
          else if (st[x] === UNK) unk++;
        }
        if (on > k || on + unk < k) return false;
        if (unk && on === k) {
          for (const x of es) if (st[x] === UNK) { st[x] = OFF; queue.push(x); }
        } else if (unk && on + unk === k) {
          for (const x of es) if (st[x] === UNK) { if (!setOn(st, x, queue)) return false; }
        }
      }
    }
    return true;
  }

  /** Turn an edge on; if it closes a loop, everything else must be off and all numbers satisfied. */
  function setOn(st: Uint8Array, e: number, queue: number[]): boolean {
    if (closesLoop(st, e)) {
      st[e] = ON;
      for (let x = 0; x < g.edges; x++) if (st[x] === UNK) st[x] = OFF;
      // the closed loop must be the only fenced edges
      const onEdges = [...st].filter((x) => x === ON).length;
      let len = 1;
      let cur = verts(e)[1];
      let prev = e;
      while (cur !== verts(e)[0] && len <= g.edges) {
        const next = g.vertexEdges[cur].find((x) => x !== prev && st[x] === ON);
        if (next === undefined) return false; // the fences branch somewhere: not one clean loop
        const [p, q] = verts(next);
        cur = p === cur ? q : p;
        prev = next;
        len++;
      }
      if (len !== onEdges || !valid(st)) return false;
      queue.length = 0;
      return true;
    }
    st[e] = ON;
    queue.push(e);
    return true;
  }

  function choose(st: Uint8Array): number {
    // extend a loose end first: the most constrained choice
    for (const es of g.vertexEdges) {
      let on = 0;
      for (const x of es) if (st[x] === ON) on++;
      if (on === 1) for (const x of es) if (st[x] === UNK) return x;
    }
    for (let e = 0; e < g.edges; e++) if (st[e] === UNK) return e;
    return -1;
  }

  function search(st: Uint8Array) {
    if (found >= limit) return;
    const e = choose(st);
    if (e < 0) {
      // complete assignment: must be one loop meeting every number
      const on = [...st].map((x) => x === ON);
      if (valid(st) && isSingleLoop(R, C, on)) found++;
      return;
    }
    for (const val of [ON, OFF]) {
      const next = st.slice();
      const q: number[] = [];
      let ok = true;
      if (val === ON) ok = setOn(next, e, q);
      else {
        next[e] = OFF;
        q.push(e);
      }
      if (ok && propagate(next, q)) search(next);
      if (found >= limit) return;
    }
  }

  const st = new Uint8Array(g.edges);
  // start by checking every numbered square
  const q: number[] = [];
  for (let e = 0; e < g.edges; e++) q.push(e);
  if (propagate(st, q)) search(st);
  return found;
}

export interface Puzzle { R: number; C: number; clues: (number | null)[]; answer: boolean[]; difficulty: Difficulty }

/** A random loop, all its numbers, then remove numbers while the answer stays unique. */
export function makePuzzle(rng: Rng, difficulty: Difficulty): Puzzle {
  const n = SIZE[difficulty];
  const g = geometry(n, n);
  for (;;) {
    const answer = randomLoop(n, n, rng);
    const clues: (number | null)[] = g.cellEdges.map((_, cell) => clueOf(g, answer, cell));
    if (countSolutions(n, n, clues) !== 1) continue;
    const order = [...clues.keys()].sort(() => rng() - 0.5);
    // easy puzzles keep a few extra numbers
    const keepExtra = { easy: 0.35, normal: 0.12, hard: 0 }[difficulty];
    for (const cell of order) {
      if (rng() < keepExtra) continue;
      const k = clues[cell];
      clues[cell] = null;
      if (countSolutions(n, n, clues) !== 1) clues[cell] = k;
    }
    return { R: n, C: n, clues, answer, difficulty };
  }
}

/** The player's fences match the answer. */
export const solved = (p: Puzzle, fences: boolean[]) => fences.every((x, e) => x === p.answer[e]);

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
  const cells = p.R * p.C;
  const perCell = { easy: 2_600, normal: 3_200, hard: 4_000 }[p.difficulty];
  return Math.round((15_000 + cells * perCell) * skill * (0.8 + rng() * 0.5));
}

export function newGame(rng: Rng, difficulty: Difficulty, ghostNames: string[], config = DEFAULT_CONFIG): GameState {
  const puzzles = Array.from({ length: config.puzzles }, () => makePuzzle(rng, difficulty));
  const skills = [0.8, 1, 1.25];
  const ghosts = ghostNames.map((name, i) => ({ name, times: puzzles.map((p) => ghostTime(p, skills[i % 3], rng)) }));
  return { config, difficulty, index: 0, phase: 'solve', puzzle: puzzles[0], queue: puzzles.slice(1), results: [], ghosts };
}

export function finish(s: GameState, fences: boolean[], timeMs: number): GameState {
  if (s.phase !== 'solve' || !solved(s.puzzle, fences)) return s;
  return { ...s, phase: 'solved', results: [...s.results, { puzzle: s.puzzle, timeMs }] };
}

export function nextPuzzle(s: GameState): GameState {
  if (s.phase !== 'solved') throw new Error('not solved');
  if (!s.queue.length) return { ...s, phase: 'gameOver' };
  return { ...s, index: s.index + 1, phase: 'solve', puzzle: s.queue[0], queue: s.queue.slice(1) };
}

export const totalMs = (s: GameState) => s.results.reduce((t, r) => t + r.timeMs, 0);

export function standings(s: GameState) {
  const rows = [
    { name: 'You', ms: totalMs(s) },
    ...s.ghosts.map((g) => ({ name: g.name, ms: g.times.slice(0, s.results.length).reduce((a, b) => a + b, 0) })),
  ];
  return rows.sort((a, b) => a.ms - b.ms || (a.name === 'You' ? -1 : 1));
}

export const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
