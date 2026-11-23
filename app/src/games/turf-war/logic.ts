/**
 * TURF WAR — rules (our own land-grab with turf pieces)
 *
 * - A 16×16 field. Each player starts with one square of turf.
 * - A queue of turf pieces is shared by everyone. On your turn you may take
 *   any of the FIRST THREE pieces; the ones you skip go to the back of the
 *   queue. Turn and flip it, then lay it so that it:
 *     · touches your own turf along an edge,
 *     · doesn't overlap anything,
 *     · doesn't touch anyone else's turf along an edge (corners are fine).
 * - Bonus spots on the field are yours when you cover them:
 *     PATCH (+)  a single square of turf you can lay instead of a piece later
 *     ROCK  (▲)  drop a rock on any empty square — nobody can build there
 * - If you can't lay any of the three pieces (or a patch), you pass.
 * - After 9 rounds your score is the side of the BIGGEST SOLID SQUARE of your
 *   own turf. Ties go to the most turf overall.
 */
import { Rng } from '../shared/rng';
import { SHAPES, orientations, Cell } from '../piece-together/logic';

export type { Cell };
export const N = 16;
export const ROUNDS = 9;
export const ROCK = -1;
export type Bonus = 'patch' | 'rock';

export interface PlayerState { id: string; name: string; isBot: boolean; patches: number }
export interface Move { player: number; kind: 'piece' | 'patch' | 'pass' | 'rock'; cells: number[]; gained: Bonus[] }

export type Phase = 'place' | 'rock' | 'gameOver';

export interface GameState {
  players: PlayerState[];
  owner: (number | null)[];   // player index, ROCK, or null
  bonus: (Bonus | null)[];
  queue: Cell[][];
  turn: number;
  round: number;
  rounds: number;
  phase: Phase;
  history: Move[];
}

const D2: Cell[] = [[0, 0], [1, 0]];
const SIX: Cell[][] = [
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],         // 2×3 block
  [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [3, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [1, 2], [2, 2]],
];
/** The pool the queue is drawn from: mostly 4s and 5s, a few small and big ones. */
const POOL: Cell[][] = [D2, ...SHAPES.T3, ...SHAPES.T3, ...SHAPES.T4, ...SHAPES.T4, ...SHAPES.T5, ...SIX];

export const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1);
export const xy = (c: number): Cell => [c % N, Math.floor(c / N)];
const NB: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const neighbours = (c: number) => NB.map(([dx, dy]) => at(xy(c)[0] + dx, xy(c)[1] + dy)).filter((d) => d >= 0);

const STARTS: Record<number, Cell[]> = {
  2: [[3, 3], [12, 12]],
  3: [[3, 3], [12, 3], [7, 12]],
  4: [[3, 3], [12, 12], [12, 3], [3, 12]],
};

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, rounds = ROUNDS): GameState {
  if (players.length < 2 || players.length > 4) throw new Error('2 to 4 players');
  const owner: (number | null)[] = Array(N * N).fill(null);
  STARTS[players.length].forEach(([x, y], i) => (owner[at(x, y)] = i));
  // bonus spots: a fair share for each start, away from the starts
  const bonus: (Bonus | null)[] = Array(N * N).fill(null);
  const want: Bonus[] = [...Array(players.length * 2).fill('patch'), ...Array(players.length + 1).fill('rock')];
  for (const b of want) {
    for (;;) {
      const c = Math.floor(rng() * N * N);
      const [x, y] = xy(c);
      const nearStart = STARTS[players.length].some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) < 3);
      if (owner[c] === null && !bonus[c] && !nearStart && x > 0 && y > 0 && x < N - 1 && y < N - 1) {
        bonus[c] = b;
        break;
      }
    }
  }
  const queue = Array.from({ length: players.length * rounds + 6 }, () => POOL[Math.floor(rng() * POOL.length)]);
  return {
    players: players.map((p) => ({ ...p, patches: 0 })),
    owner, bonus, queue, turn: 0, round: 1, rounds, phase: 'place', history: [],
  };
}

export const offered = (s: GameState) => s.queue.slice(0, 3);

/** Can `player` lay turf on exactly these cells? */
export function canLay(s: GameState, player: number, cells: number[]): boolean {
  if (!cells.length || cells.some((c) => c < 0 || s.owner[c] !== null)) return false;
  const set = new Set(cells);
  let touches = false;
  for (const c of cells) {
    for (const d of neighbours(c)) {
      if (set.has(d)) continue;
      const o = s.owner[d];
      if (o === player) touches = true;
      else if (o !== null && o !== ROCK) return false;
    }
  }
  return touches;
}

/** Board cells of a shape whose first square lands on (ox, oy); null if it falls off the field. */
export function cellsAt(shape: Cell[], ox: number, oy: number): number[] | null {
  const out = shape.map(([x, y]) => at(ox + x, oy + y));
  return out.some((c) => c < 0) ? null : out;
}

export interface Placement { pick: number; cells: number[] }

/** Every legal way to lay one of the offered pieces. */
export function placements(s: GameState, player: number): Placement[] {
  const out: Placement[] = [];
  const seen = new Set<string>();
  offered(s).forEach((shape, pick) => {
    for (const o of orientations(shape)) {
      for (let oy = 0; oy < N; oy++) for (let ox = 0; ox < N; ox++) {
        const cells = cellsAt(o, ox, oy);
        if (!cells || !canLay(s, player, cells)) continue;
        const k = `${pick}:${[...cells].sort((a, b) => a - b).join(',')}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ pick, cells });
      }
    }
  });
  return out;
}

export const patchSpots = (s: GameState, player: number) =>
  s.players[player].patches > 0 ? s.owner.map((_, c) => c).filter((c) => canLay(s, player, [c])) : [];

export const mustPass = (s: GameState, player: number) => placements(s, player).length === 0 && patchSpots(s, player).length === 0;

function lay(s: GameState, player: number, cells: number[], kind: Move['kind'], queue: Cell[][]): GameState {
  const owner = [...s.owner];
  const bonus = [...s.bonus];
  const gained: Bonus[] = [];
  for (const c of cells) {
    owner[c] = player;
    if (bonus[c]) {
      gained.push(bonus[c]!);
      bonus[c] = null;
    }
  }
  const players = s.players.map((p, i) => (i === player ? { ...p, patches: p.patches + gained.filter((b) => b === 'patch').length - (kind === 'patch' ? 1 : 0) } : p));
  const next: GameState = { ...s, owner, bonus, players, queue, history: [...s.history, { player, kind, cells, gained }] };
  // a rock is dropped straight away (if there is anywhere to drop it)
  if (gained.includes('rock') && owner.some((o, c) => o === null && !bonus[c])) return { ...next, phase: 'rock' };
  return advance(next);
}

function advance(s: GameState): GameState {
  const turn = (s.turn + 1) % s.players.length;
  const round = turn === 0 ? s.round + 1 : s.round;
  if (round > s.rounds) return { ...s, turn, round: s.round, phase: 'gameOver' };
  return { ...s, turn, round, phase: 'place' };
}

export function takePiece(s: GameState, player: number, pick: number, cells: number[]): GameState {
  if (s.phase !== 'place' || s.turn !== player) throw new Error('not your turn');
  if (pick < 0 || pick > 2 || pick >= s.queue.length) throw new Error('pick one of the first three pieces');
  const shape = s.queue[pick];
  const fits = orientations(shape).some((o) => {
    const ox = Math.min(...cells.map((c) => xy(c)[0]));
    const oy = Math.min(...cells.map((c) => xy(c)[1]));
    const mine = cellsAt(o, ox, oy);
    return mine && [...mine].sort((a, b) => a - b).join() === [...cells].sort((a, b) => a - b).join();
  });
  if (!fits) throw new Error('those squares are not that piece');
  if (!canLay(s, player, cells)) throw new Error('it must touch your turf, not overlap, and not touch anyone else');
  // skipped pieces go to the back of the queue
  const queue = [...s.queue.slice(pick + 1), ...s.queue.slice(0, pick)];
  return lay(s, player, cells, 'piece', queue);
}

export function usePatch(s: GameState, player: number, cell: number): GameState {
  if (s.phase !== 'place' || s.turn !== player) throw new Error('not your turn');
  if (s.players[player].patches < 1) throw new Error('no patches');
  if (!canLay(s, player, [cell])) throw new Error('a patch must touch your turf and nobody else’s');
  return lay(s, player, [cell], 'patch', [...s.queue.slice(1), s.queue[0]]);
}

export function pass(s: GameState, player: number): GameState {
  if (s.phase !== 'place' || s.turn !== player) throw new Error('not your turn');
  if (!mustPass(s, player)) throw new Error('you can still lay something');
  return advance({ ...s, queue: [...s.queue.slice(1), s.queue[0]], history: [...s.history, { player, kind: 'pass', cells: [], gained: [] }] });
}

export const canRock = (s: GameState, c: number) => s.owner[c] === null && !s.bonus[c];

export function dropRock(s: GameState, player: number, cell: number): GameState {
  if (s.phase !== 'rock' || s.turn !== player) throw new Error('no rock to drop');
  if (!canRock(s, cell)) throw new Error('drop it on an empty square');
  const owner = [...s.owner];
  owner[cell] = ROCK;
  return advance({ ...s, owner, history: [...s.history, { player, kind: 'rock', cells: [cell], gained: [] }] });
}

// ----------------------------------------------------------------- scoring ----

/** Biggest solid square whose cells all pass `ok`: its side and top-left corner. */
export function biggestSquare(ok: (c: number) => boolean): { size: number; x: number; y: number } {
  const dp = new Array(N * N).fill(0);
  let best = { size: 0, x: 0, y: 0 };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = y * N + x;
      if (!ok(c)) continue;
      dp[c] = x && y ? 1 + Math.min(dp[c - 1], dp[c - N], dp[c - N - 1]) : 1;
      if (dp[c] > best.size) best = { size: dp[c], x: x - dp[c] + 1, y: y - dp[c] + 1 };
    }
  }
  return best;
}

export const squareOf = (s: GameState, player: number) => biggestSquare((c) => s.owner[c] === player);
export const turfOf = (s: GameState, player: number) => s.owner.filter((o) => o === player).length;

export function standings(s: GameState) {
  return s.players
    .map((p, i) => ({ ...p, seat: i, square: squareOf(s, i).size, turf: turfOf(s, i) }))
    .sort((a, b) => b.square - a.square || b.turf - a.turf || a.seat - b.seat);
}
