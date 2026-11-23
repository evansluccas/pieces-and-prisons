/**
 * MIRROR PIECES as an online puzzle race (see shared/race.ts).
 *
 * - 3 puzzles at normal difficulty, the same for everyone. A perfect
 *   reflection scores 1 point; lowest total time wins.
 * - Players see the picture and the tray (as in solo), place the pieces on
 *   their own screen and send the finished build; the server checks it is
 *   the exact mirror image (pieces turned, never flipped) and stops the
 *   clock. A wrong build is simply refused — no penalty, as in solo.
 * - The answer (the reflected layout) is only sent once the round is over.
 * - Time limit 3 minutes: a normal ghost needs about a minute.
 */
import { RacePuzzle, Stage, race } from '../shared/race';
import { flip, norm, placedCells } from '../piece-together/logic';
import { Cell, Placement, Puzzle, canPlace, ghostTime, isMirrored, makePuzzle, turns } from './logic';

/** Normal ghosts take 60 s × skill × 0.8–1.3 (48–98 s); three minutes leaves room. */
export const LIMIT_MS = 180_000;
const SKILLS = [0.8, 1, 1.25]; // as solo's ghost rivals

/** What a player sees: the picture and the tray; the reflection only after the round. */
export interface View {
  cols: number;
  rows: number;
  left: Placement[];
  tray: Cell[][];
  target?: Placement[];
}

const BAD = 'That build didn’t make sense — try placing the pieces again.';
const same = (a: Cell[], b: Cell[]) => JSON.stringify(a) === JSON.stringify(b);
const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

function readCell(c: unknown): Cell {
  if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0], -50, 50) || !isInt(c[1], -50, 50)) throw new Error(BAD);
  return [c[0], c[1]];
}

/**
 * Read a submitted build from the network: one placement per tray piece,
 * each a turn (never a flip) of that piece, on the right half, no overlaps.
 * Returns the placements in the puzzle's own form.
 */
export function readBuild(p: Puzzle, action: unknown): Placement[] {
  if (!action || typeof action !== 'object') throw new Error(BAD);
  const a = action as { type?: unknown; placements?: unknown };
  if (a.type !== 'submit') throw new Error('Unknown move.');
  if (!Array.isArray(a.placements) || a.placements.length > p.tray.length) throw new Error(BAD);
  if (a.placements.length < p.tray.length) throw new Error('Place every piece before you submit.');
  const out: Placement[] = [];
  for (const raw of a.placements as unknown[]) {
    if (!raw || typeof raw !== 'object') throw new Error(BAD);
    const { piece, cells, at } = raw as Record<string, unknown>;
    if (!isInt(piece, 0, p.tray.length - 1)) throw new Error(BAD);
    if (out.some((q) => q.piece === piece)) throw new Error('Each piece can only be placed once.');
    if (!Array.isArray(cells) || cells.length !== p.tray[piece].length) throw new Error('That piece has the wrong shape.');
    // the squares it covers, and the shape they make
    const squares = placedCells({ piece, cells: cells.map(readCell), at: readCell(at) });
    const shape = norm(squares);
    if (!turns(p.tray[piece]).some((t) => same(t, shape))) {
      const flipped = turns(flip(p.tray[piece])).some((t) => same(t, shape));
      throw new Error(flipped ? 'Pieces can be turned but never flipped.' : 'That piece has the wrong shape.');
    }
    const corner: Cell = [Math.min(...squares.map((c) => c[0])), Math.min(...squares.map((c) => c[1]))];
    if (!canPlace(p, out, shape, corner)) throw new Error('Pieces go on the right half, without overlapping.');
    out.push({ piece, cells: shape, at: corner });
  }
  return out;
}

export const puzzle: RacePuzzle<Puzzle, null> = {
  rounds: 3,
  make: (rng) => makePuzzle(rng, 'normal'),
  limitMs: () => LIMIT_MS,
  init: () => null,
  act(p, mine, action) {
    const build = readBuild(p, action);
    if (!isMirrored(p, build)) throw new Error('Not the exact mirror image yet — check where each piece sits and how it’s turned.');
    return { mine, finish: { points: 1 } };
  },
  view(p, stage: Stage): View {
    const v: View = { cols: p.cols, rows: p.rows, left: p.left, tray: p.tray };
    if (stage === 'result' || stage === 'over') v.target = p.target;
    return v;
  },
  bot: (p, rng, seat) => ({ ms: ghostTime(p, SKILLS[seat % SKILLS.length], rng), points: 1 }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
