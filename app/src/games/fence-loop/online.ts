/**
 * FENCE LOOP as an online puzzle race: everyone gets the same 3 normal
 * puzzles. Players see only the grid size and the numbers; the screen sends
 * its fences when the loop looks complete, and the server checks them
 * against the answer and stops the clock.
 */
import { RacePuzzle, Stage, race } from '../shared/race';
import { Puzzle, geometry, ghostTime, makePuzzle } from './logic';

/** Ghost speeds, like the solo rivals: quick, steady, slow. */
const SKILLS = [0.8, 1, 1.25];

/** Nothing private to keep: a wrong loop is refused with no penalty. */
export type Mine = null;

/** What a player sees. `answer` (fenced edge numbers) only once the round is over. */
export interface View {
  R: number;
  C: number;
  clues: (number | null)[];
  answer: number[] | null;
}

/** A submitted loop: the numbers of the fenced edges. Throws if it's malformed. */
export function readEdges(p: Puzzle, action: unknown): boolean[] {
  const a = action as { type?: unknown; edges?: unknown } | null;
  if (!a || typeof a !== 'object' || a.type !== 'submit') throw new Error('Unknown move.');
  const edges = a.edges;
  const total = geometry(p.R, p.C).edges;
  if (!Array.isArray(edges) || edges.length > total) throw new Error('Send the fences of your loop.');
  const on = Array<boolean>(total).fill(false);
  for (const e of edges) {
    if (!Number.isInteger(e) || e < 0 || e >= total) throw new Error('That fence isn’t on the board.');
    if (on[e]) throw new Error('A fence was sent twice.');
    on[e] = true;
  }
  return on;
}

export const puzzle: RacePuzzle<Puzzle, Mine> = {
  rounds: 3,
  make: (rng) => makePuzzle(rng, 'normal'),
  // a typical 6 × 6 ghost takes about 2:15 (the slowest up to ~3:30);
  // 3× that is ~7 minutes, so take the 6-minute ceiling
  limitMs: () => 6 * 60_000,
  init: () => null,
  act(p, mine, action) {
    const on = readEdges(p, action);
    if (!on.every((x, e) => x === p.answer[e])) {
      throw new Error('That loop doesn’t fit every number yet — keep fencing.');
    }
    return { mine, finish: { points: 1 } };
  },
  view(p, stage: Stage): View {
    const over = stage === 'result' || stage === 'over';
    return {
      R: p.R,
      C: p.C,
      clues: [...p.clues],
      answer: over ? p.answer.flatMap((x, e) => (x ? [e] : [])) : null,
    };
  },
  bot: (p, rng, seat) => ({ ms: ghostTime(p, SKILLS[seat % SKILLS.length], rng), points: 1 }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
