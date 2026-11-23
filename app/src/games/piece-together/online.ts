/**
 * PIECE TOGETHER as an online puzzle race (see shared/race.ts).
 *
 * Everyone gets the same 3 normal puzzles. You arrange the pieces on your own
 * screen and hand in the finished board; the server checks it is a complete,
 * legal fill (any fill counts, not just the way the outline was cut) and
 * stops your clock. The way the outline was built stays on the server until
 * the round is over.
 */
import { race, RacePuzzle, Stage } from '../shared/race';
import type { Rng } from '../shared/rng';
import { Cell, Placement, Puzzle, ghostTime, isFilled, makePuzzle, norm, orientations } from './logic';

/**
 * 4 minutes a puzzle. The solo game has no clock; its ghosts take about
 * 80 s on a normal puzzle (12 s + 8 pieces × 8.5 s), so this is roughly 3×
 * that — and still more than the slowest ghost ever needs (about 130 s).
 */
export const LIMIT_MS = 240_000;

/** Your private progress: the fill the server accepted, once you're done. */
export interface Mine { placed: Placement[] | null }

/** What a player is sent. `solution` is only filled in once the round is over. */
export interface View {
  outline: Cell[];
  pieces: Cell[][];
  placed: Placement[] | null;   // your accepted fill
  solution: Placement[] | null; // how the outline was built (after the round)
}

const SKILLS = [0.8, 1, 1.25]; // the solo ghosts' skills
const MAX_COORD = 40;          // far more room than any board needs

const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const isCell = (c: unknown): c is Cell => Array.isArray(c) && c.length === 2 && isInt(c[0], -MAX_COORD, MAX_COORD) && isInt(c[1], -MAX_COORD, MAX_COORD);

/**
 * Read a submitted board off the network and check it is a complete, legal
 * fill of this puzzle. Returns the fill (each piece's shape tidied up), or
 * throws a friendly Error.
 */
export function checkFill(p: Pick<Puzzle, 'outline' | 'pieces'>, action: unknown): Placement[] {
  const a = action as { type?: unknown; placements?: unknown } | null;
  if (!a || typeof a !== 'object' || a.type !== 'submit') throw new Error('Unknown move.');
  const list = a.placements;
  if (!Array.isArray(list)) throw new Error('Send your board as a list of placed pieces.');
  if (list.length !== p.pieces.length) throw new Error('Every piece has to be on the board.');
  const seen = new Set<number>();
  const fill: Placement[] = list.map((raw: unknown) => {
    const x = raw as { piece?: unknown; cells?: unknown; at?: unknown } | null;
    if (!x || typeof x !== 'object') throw new Error('That board doesn’t make sense.');
    if (!isInt(x.piece, 0, p.pieces.length - 1)) throw new Error('That piece isn’t in the tray.');
    if (seen.has(x.piece)) throw new Error('Each piece can only be used once.');
    seen.add(x.piece);
    const shape = p.pieces[x.piece];
    if (!Array.isArray(x.cells) || x.cells.length !== shape.length || !x.cells.every(isCell) || !isCell(x.at)) {
      throw new Error('That board doesn’t make sense.');
    }
    const at = x.at;
    const cells = (x.cells as Cell[]).map(([cx, cy]) => [cx + at[0], cy + at[1]] as Cell);
    // the same piece, maybe turned or flipped
    const tidy = norm(cells);
    if (!orientations(shape).some((o) => JSON.stringify(o) === JSON.stringify(tidy))) throw new Error('A piece changed shape.');
    return { piece: x.piece, cells: tidy, at: [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1]))] as Cell };
  });
  if (!isFilled(p, fill)) throw new Error('Not quite — every piece must sit inside the outline with no gaps or overlaps.');
  return fill;
}

export const puzzle: RacePuzzle<Puzzle, Mine> = {
  rounds: 3,
  make: (rng: Rng) => makePuzzle(rng, 'normal'),
  limitMs: () => LIMIT_MS,
  init: () => ({ placed: null }),
  act(p, _mine, action) {
    const placed = checkFill(p, action);
    return { mine: { placed }, finish: { points: 1 } };
  },
  view(p, stage: Stage, mine): View {
    const settled = stage === 'result' || stage === 'over';
    return { outline: p.outline, pieces: p.pieces, placed: mine?.placed ?? null, solution: settled ? p.solution : null };
  },
  // like the solo game's ghosts
  bot: (p, rng, seat) => ({ ms: ghostTime(p, SKILLS[seat % SKILLS.length], rng), points: 1 }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
