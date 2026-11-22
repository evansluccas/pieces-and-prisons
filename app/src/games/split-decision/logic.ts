/**
 * SPLIT DECISION — rules (our own two-choice brain race)
 *
 * - 10 questions from four mini-games. Every question has exactly two
 *   answers; everyone picks one in secret, against a 30-second clock.
 *     COUNT THE CUBES   — a stack of cubes: how many are there? (Hidden cubes
 *                         count: every cube rests on the floor or on another.)
 *     COUNT THE BLOCKS  — a grid of numbers: how many rectangles add up to
 *                         the target? (Any size, from one cell to the whole grid.)
 *     LAY THE GRASS     — can the turf pieces cover the field exactly?
 *                         (Pieces may be turned, not flipped, and can't overlap.)
 *     CARD MEMORY       — study a 4×4 grid of cards; then: where was this card?
 * - A right answer scores 1 point. Most points wins; ties go to the faster
 *   total time on right answers. Last place goes to prison.
 */
import { Card, cardText, fullDeck } from '../deadeye-holdem/cards';
import { Rng } from '../shared/rng';

export type Kind = 'cubes' | 'blocks' | 'grass' | 'memory';
export const KIND_NAME: Record<Kind, string> = {
  cubes: 'Count the cubes', blocks: 'Count the blocks', grass: 'Lay the grass', memory: 'Card memory',
};

export interface CubesQ { kind: 'cubes'; heights: number[][] }               // heights[y][x]
export interface BlocksQ { kind: 'blocks'; grid: number[][]; target: number }
export type Cell = [number, number];                                           // [x, y]
export interface GrassQ { kind: 'grass'; field: Cell[]; pieces: Cell[][] }
export interface MemoryQ { kind: 'memory'; cards: Card[]; ask: number; spots: [number, number] } // ask = index of the card
export type Data = CubesQ | BlocksQ | GrassQ | MemoryQ;

export interface Question { data: Data; prompt: string; options: [string, string]; answer: 0 | 1 }

const pick = <T>(a: T[], rng: Rng): T => a[Math.floor(rng() * a.length)];
const shuffle = <T>(a: T[], rng: Rng): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/** Put the right answer and a decoy in a random order. */
function twoWay(right: string, wrong: string, rng: Rng): { options: [string, string]; answer: 0 | 1 } {
  return rng() < 0.5 ? { options: [right, wrong], answer: 0 } : { options: [wrong, right], answer: 1 };
}

// --------------------------------------------------------------- cubes ----

export const cubeCount = (h: number[][]) => h.flat().reduce((a, b) => a + b, 0);

export function makeCubes(rng: Rng): Question {
  const n = 4;
  const heights = Array.from({ length: n }, () => Array<number>(n).fill(0));
  // a staircase: no column is taller than the ones behind it, so every top
  // is visible and the hidden cubes underneath can be worked out
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const behind = Math.min(y > 0 ? heights[y - 1][x] : 4, x > 0 ? heights[y][x - 1] : 4);
    heights[y][x] = x === 0 && y === 0 ? 3 + Math.floor(rng() * 2) : Math.max(0, behind - (rng() < 0.45 ? 1 : 0) - (rng() < 0.12 ? 1 : 0));
  }
  const total = cubeCount(heights);
  const off = pick([-3, -2, -1, 1, 2, 3], rng);
  return { data: { kind: 'cubes', heights }, prompt: 'How many cubes are in the stack?', ...twoWay(`${total}`, `${total + off}`, rng) };
}

// -------------------------------------------------------------- blocks ----

export function countRects(grid: number[][], target: number): number {
  const R = grid.length;
  const C = grid[0].length;
  let n = 0;
  for (let r0 = 0; r0 < R; r0++) for (let r1 = r0; r1 < R; r1++)
    for (let c0 = 0; c0 < C; c0++) for (let c1 = c0; c1 < C; c1++) {
      let sum = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) sum += grid[r][c];
      if (sum === target) n++;
    }
  return n;
}

export function makeBlocks(rng: Rng): Question {
  for (;;) {
    const grid = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => 1 + Math.floor(rng() * 9)));
    const target = 8 + Math.floor(rng() * 10);
    const n = countRects(grid, target);
    if (n < 2 || n > 6) continue;
    const off = pick(n > 2 ? [-2, -1, 1, 2] : [1, 2], rng);
    return {
      data: { kind: 'blocks', grid, target },
      prompt: `How many rectangles add up to exactly ${target}?`,
      ...twoWay(`${n}`, `${n + off}`, rng),
    };
  }
}

// --------------------------------------------------------------- grass ----

export const SHAPES: Cell[][] = [
  [[0, 0], [1, 0], [2, 0]],                 // I3
  [[0, 0], [1, 0], [0, 1]],                 // L3
  [[0, 0], [1, 0], [2, 0], [3, 0]],         // I4
  [[0, 0], [1, 0], [0, 1], [1, 1]],         // O
  [[0, 0], [1, 0], [2, 0], [2, 1]],         // L4
  [[0, 0], [1, 0], [2, 0], [1, 1]],         // T
  [[0, 0], [1, 0], [1, 1], [2, 1]],         // S
];

const norm = (cells: Cell[]): Cell[] => {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};
const rot = (cells: Cell[]): Cell[] => norm(cells.map(([x, y]) => [-y, x] as Cell));

/** The distinct turns of a piece (no flips). */
export function rotations(piece: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur = norm(piece);
  for (let i = 0; i < 4; i++) {
    if (!out.some((o) => JSON.stringify(o) === JSON.stringify(cur))) out.push(cur);
    cur = rot(cur);
  }
  return out;
}

/** Can these pieces cover exactly these cells? */
export function canTile(field: Cell[], pieces: Cell[][]): boolean {
  if (pieces.reduce((t, p) => t + p.length, 0) !== field.length) return false;
  const free = new Set(field.map(([x, y]) => `${x},${y}`));
  const used = pieces.map(() => false);
  const solve = (): boolean => {
    if (!free.size) return true;
    // first free cell in reading order must be covered by some piece
    const [fx, fy] = [...free].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
    for (let i = 0; i < pieces.length; i++) {
      if (used[i]) continue;
      for (const r of rotations(pieces[i])) {
        // anchor the piece's first cell on the free cell
        const [ax, ay] = r[0];
        const cells = r.map(([x, y]) => `${x - ax + fx},${y - ay + fy}`);
        if (!cells.every((k) => free.has(k))) continue;
        cells.forEach((k) => free.delete(k));
        used[i] = true;
        if (solve()) return true;
        used[i] = false;
        cells.forEach((k) => free.add(k));
      }
    }
    return false;
  };
  return solve();
}

export function makeGrass(rng: Rng): Question {
  for (;;) {
    const pieces = Array.from({ length: 3 }, () => pick(SHAPES, rng));
    // place them touching each other in a 6×5 yard
    const taken = new Set<string>();
    let ok = true;
    for (const p of pieces) {
      const options: Cell[][] = [];
      for (const r of rotations(p))
        for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
          const cells = r.map(([a, b]) => [a + x, b + y] as Cell);
          if (cells.some(([a, b]) => a >= 6 || b >= 5 || taken.has(`${a},${b}`))) continue;
          const touches = !taken.size || cells.some(([a, b]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => taken.has(`${a + dx},${b + dy}`)));
          if (touches) options.push(cells);
        }
      if (!options.length) { ok = false; break; }
      pick(options, rng).forEach(([a, b]) => taken.add(`${a},${b}`));
    }
    if (!ok) continue;
    let field = [...taken].map((k) => k.split(',').map(Number) as Cell);
    const yes = rng() < 0.5;
    if (!yes) {
      // move one cell somewhere else along the edge; keep it only if it really can't be tiled
      const from = pick(field, rng);
      const rest = field.filter((c) => c !== from);
      const edges = [...new Set(rest.flatMap(([a, b]) => [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]].map(([x, y]) => `${x},${y}`)))]
        .filter((k) => !taken.has(k))
        .map((k) => k.split(',').map(Number) as Cell)
        .filter(([x, y]) => x >= 0 && y >= 0 && x < 6 && y < 5);
      if (!edges.length) continue;
      field = [...rest, pick(edges, rng)];
      if (!connected(field) || canTile(field, pieces)) continue;
    }
    if (yes !== canTile(field, pieces)) continue;
    return {
      data: { kind: 'grass', field: norm(field), pieces },
      prompt: 'Can these three pieces cover the field exactly?',
      ...twoWay(yes ? 'Yes' : 'No', yes ? 'No' : 'Yes', rng),
    };
  }
}

function connected(cells: Cell[]): boolean {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const seen = new Set<string>([`${cells[0][0]},${cells[0][1]}`]);
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === cells.length;
}

// -------------------------------------------------------------- memory ----

export function makeMemory(rng: Rng): Question {
  const cards = shuffle(fullDeck(), rng).slice(0, 16);
  const ask = Math.floor(rng() * 16);
  let other = Math.floor(rng() * 16);
  while (other === ask) other = Math.floor(rng() * 16);
  const spots: [number, number] = rng() < 0.5 ? [ask, other] : [other, ask];
  return {
    data: { kind: 'memory', cards, ask, spots },
    prompt: `Where was the ${cardText(cards[ask])}?`,
    options: ['Square A', 'Square B'],
    answer: spots[0] === ask ? 0 : 1,
  };
}

// ------------------------------------------------------------- the match ----

export interface Config { perKind: Record<Kind, number>; answerMs: number; memorizeMs: number }
export const DEFAULT_CONFIG: Config = { perKind: { cubes: 3, blocks: 3, grass: 2, memory: 2 }, answerMs: 30_000, memorizeMs: 8_000 };

export interface PlayerState { id: string; name: string; isBot: boolean; points: number; timeMs: number }
export interface Pick { choice: 0 | 1 | null; ms: number }
export interface QuestionResult { question: Question; picks: Record<string, Pick> }

export type Phase = 'memorize' | 'answer' | 'reveal' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  index: number;
  phase: Phase;
  questions: Question[];
  picks: Record<string, Pick>;
  results: QuestionResult[];
}

const MAKERS: Record<Kind, (rng: Rng) => Question> = { cubes: makeCubes, blocks: makeBlocks, grass: makeGrass, memory: makeMemory };

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  const questions = (Object.keys(config.perKind) as Kind[]).flatMap((k) => Array.from({ length: config.perKind[k] }, () => MAKERS[k](rng)));
  const first = questions[0];
  return {
    config,
    players: players.map((p) => ({ ...p, points: 0, timeMs: 0 })),
    index: 0,
    phase: first.data.kind === 'memory' ? 'memorize' : 'answer',
    questions,
    picks: {},
    results: [],
  };
}

export const question = (s: GameState) => s.questions[s.index];

export function startAnswering(s: GameState): GameState {
  if (s.phase !== 'memorize') throw new Error('not memorising');
  return { ...s, phase: 'answer' };
}

export function choose(s: GameState, id: string, choice: 0 | 1 | null, ms: number): GameState {
  if (s.phase !== 'answer') throw new Error('not answering');
  if (id in s.picks) throw new Error('already answered');
  const picks = { ...s.picks, [id]: { choice, ms: Math.min(ms, s.config.answerMs) } };
  if (s.players.some((p) => !(p.id in picks))) return { ...s, picks };
  const q = question(s);
  const players = s.players.map((p) => {
    const right = picks[p.id].choice === q.answer;
    return right ? { ...p, points: p.points + 1, timeMs: p.timeMs + picks[p.id].ms } : p;
  });
  return { ...s, players, picks, phase: 'reveal', results: [...s.results, { question: q, picks }] };
}

/** Everyone who hasn't answered when the clock runs out gets no answer. */
export function timeUp(s: GameState): GameState {
  let st = s;
  for (const p of s.players) if (!(p.id in st.picks) && st.phase === 'answer') st = choose(st, p.id, null, s.config.answerMs);
  return st;
}

export function next(s: GameState): GameState {
  if (s.phase !== 'reveal') throw new Error('not revealed');
  if (s.index + 1 >= s.questions.length) return { ...s, phase: 'gameOver' };
  const index = s.index + 1;
  return { ...s, index, picks: {}, phase: s.questions[index].data.kind === 'memory' ? 'memorize' : 'answer' };
}

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, seat }))
    .sort((a, b) => b.points - a.points || a.timeMs - b.timeMs || a.seat - b.seat);
}
