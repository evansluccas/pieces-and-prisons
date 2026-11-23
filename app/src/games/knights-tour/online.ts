/**
 * KNIGHT'S TOUR as an online puzzle race.
 *
 * Everyone tours the same three boards (6×6, 7×7, 8×8). There is no secret
 * answer — any full tour counts — so each player moves on their own screen
 * (undo is free) and sends the finished path; the server checks it and
 * stops that player's clock. Hints go through the server so their 30 s count,
 * and only the player who asked sees the hint.
 */
import { RacePuzzle, race } from '../shared/race';
import { BOARDS, HINT_MS, Hint, complete, ghostTime, hint, readPath, stuck } from './logic';

export interface Puzzle { n: number }

export interface Mine {
  hints: number;
  hint: { path: number[]; h: Hint } | null; // the latest hint and the path it was asked for
  tour: number[] | null;                    // the accepted tour
}

/** What a player sees (the puzzle part of the race view). */
export interface View { n: number; hints: number; hint: Mine['hint']; tour: number[] | null }

/**
 * Time per board: about twice what an average solo rival takes (110 s, 170 s,
 * 260 s), so the slowest bots still finish and a stuck player has room to
 * back up and use a hint or two.
 */
export const LIMIT_MS: Record<number, number> = { 6: 4 * 60_000, 7: 6 * 60_000, 8: 8 * 60_000 };

const plural = (k: number) => `${k} hint${k === 1 ? '' : 's'}`;

export const puzzle: RacePuzzle<Puzzle, Mine> = {
  rounds: BOARDS.length,
  make: (_rng, round) => ({ n: BOARDS[round] }),
  limitMs: (p) => LIMIT_MS[p.n],
  init: () => ({ hints: 0, hint: null, tour: null }),

  act(p, mine, action) {
    const a = (action && typeof action === 'object' ? action : {}) as { type?: unknown; path?: unknown };
    if (a.type === 'submit') {
      const path = readPath(p.n, a.path);
      if (!complete(p.n, path)) {
        const left = p.n * p.n - path.length;
        throw new Error(`Not a full tour yet — ${left} square${left === 1 ? '' : 's'} still unvisited.`);
      }
      return { mine: { ...mine, tour: path }, finish: { points: 1, detail: mine.hints ? plural(mine.hints) : '' } };
    }
    if (a.type === 'hint') {
      const path = readPath(p.n, a.path);
      if (!path.length) throw new Error('Pick a starting square first.');
      if (complete(p.n, path)) throw new Error('That tour is already complete.');
      if (stuck(p.n, path)) throw new Error('You’re stuck — undo a few moves first (no charge).');
      // asking twice for the same path doesn't charge twice
      if (mine.hint && mine.hint.path.join() === path.join()) return { mine };
      return { mine: { ...mine, hints: mine.hints + 1, hint: { path, h: hint(p.n, path) } }, penaltyMs: HINT_MS };
    }
    throw new Error('Unknown move.');
  },

  view: (p, _stage, mine): View => ({ n: p.n, hints: mine?.hints ?? 0, hint: mine?.hint ?? null, tour: mine?.tour ?? null }),

  bot: (p, rng, seat) => ({ ms: ghostTime(p.n, seat, rng), points: 1 }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
