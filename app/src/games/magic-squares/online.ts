/**
 * MAGIC SQUARES as an online puzzle race (see ../shared/race.ts).
 *
 * Everyone fills the same three squares: 3×3, 4×4, then 5×5. The server keeps
 * the answer and sends only the size and the givens. A player sends their
 * grid when it is full; the server checks it and stops their clock. A hint
 * goes through the server too: it reveals one correct number to the asker
 * only, and adds 30 seconds.
 */
import { RacePuzzle, race } from '../shared/race';
import { BOARDS, Grid, HINT_MS, Puzzle, ghostMs, isMagic, makePuzzle, place } from './logic';

/** Time limits: a few times what a steady solver needs, and above every bot's slowest time. */
export const LIMIT_MS: Record<number, number> = { 3: 3 * 60_000, 4: 7 * 60_000, 5: 12 * 60_000 };

/** A player's private progress: the numbers their hints revealed. */
export interface Mine { revealed: Grid; hints: number }

/** What one player sees. `solution` stays null until the round is over. */
export interface View {
  n: number;
  givens: Grid;
  revealed: Grid;
  hints: number;
  limitMs: number;
  solution: Grid | null;
}

/** Read a grid sent by a player: n² cells, each empty or a whole number 1..n². */
function readGrid(n: number, raw: unknown, full: boolean): Grid {
  const size = n * n;
  if (!Array.isArray(raw) || raw.length !== size) throw new Error(`Send all ${size} squares.`);
  return raw.map((v) => {
    if (v === null && !full) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > size) {
      throw new Error(full ? `Fill every square with a number from 1 to ${size}.` : `Numbers go from 1 to ${size}.`);
    }
    return v;
  });
}

/** The cells a player can't change: the givens and their own hints. */
const fixed = (p: Puzzle, mine: Mine): Grid => p.givens.map((v, c) => v ?? mine.revealed[c]);

export const puzzle: RacePuzzle<Puzzle, Mine> = {
  rounds: BOARDS.length,
  make: (rng, round) => makePuzzle(BOARDS[round], rng),
  limitMs: (p) => LIMIT_MS[p.n],
  init: (p) => ({ revealed: Array(p.n * p.n).fill(null), hints: 0 }),

  act(p, mine, action) {
    const a = (action ?? {}) as { type?: unknown; grid?: unknown };
    const n = p.n;
    const detail = (hints: number) => (hints ? `${hints} hint${hints > 1 ? 's' : ''}` : '');

    if (a.type === 'submit') {
      const g = readGrid(n, a.grid, true);
      if (p.givens.some((v, c) => v !== null && g[c] !== v)) throw new Error('The given numbers can’t change.');
      if (new Set(g).size !== n * n) throw new Error('Use each number once.');
      if (!isMagic(n, g)) throw new Error('Not magic yet — check the red totals.');
      return { mine, finish: { points: 1, detail: detail(mine.hints) } };
    }

    if (a.type === 'hint') {
      // the player's grid, with the fixed numbers put back in place
      let g = readGrid(n, a.grid, false);
      fixed(p, mine).forEach((v, c) => { if (v !== null) g = place(g, c, v); });
      const open = (c: number) => p.givens[c] === null && mine.revealed[c] === null;
      // like solo: fix a wrong number first, else fill an empty square
      const cells = [...g.keys()].filter(open);
      const wrong = cells.filter((c) => g[c] !== null && g[c] !== p.solution[c]);
      const empty = cells.filter((c) => g[c] === null);
      const pool = wrong.length ? wrong : empty;
      if (!pool.length) throw new Error('Nothing left to hint — send your square.');
      const c = pool[Math.floor(Math.random() * pool.length)];
      const revealed = mine.revealed.map((v, i) => (i === c ? p.solution[c] : v));
      const next = { revealed, hints: mine.hints + 1 };
      g = place(g, c, p.solution[c]);
      // the hint may have completed the square
      const finish = isMagic(n, g) ? { points: 1, detail: detail(next.hints) } : undefined;
      return { mine: next, penaltyMs: HINT_MS, finish };
    }

    throw new Error('Fill the square, or ask for a hint.');
  },

  view(p, stage, mine): View {
    const over = stage === 'result' || stage === 'over';
    return {
      n: p.n,
      givens: p.givens,
      revealed: mine?.revealed ?? Array(p.n * p.n).fill(null),
      hints: mine?.hints ?? 0,
      limitMs: LIMIT_MS[p.n],
      solution: over ? p.solution : null,
    };
  },

  // the solo game's ghost rivals: a typical time, a skill by seat, some luck
  bot: (p, rng, seatIndex) => ({ ms: ghostMs(p.n, seatIndex, rng), points: 1 }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
