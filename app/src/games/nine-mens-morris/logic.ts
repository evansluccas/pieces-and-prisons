/**
 * NINE MEN'S MORRIS — the classic mill game (public domain)
 *
 * - 24 points joined by lines. Each player has 9 men.
 * - PLACE: take turns putting a man on any empty point until all 18 are down.
 * - MOVE: then take turns sliding one of your men along a line to the next
 *   empty point.
 * - FLY: a player down to 3 men may jump a man to ANY empty point.
 * - MILL: three of your men in a straight line. Making one (by placing or
 *   moving) lets you remove one enemy man — not one standing in a mill,
 *   unless every enemy man is in a mill.
 * - You win when your opponent has fewer than 3 men (after placing) or no
 *   legal move. 50 moves in a row without a mill is a draw.
 */

export const POINTS: [number, number][] = [
  [0, 0], [3, 0], [6, 0],
  [1, 1], [3, 1], [5, 1],
  [2, 2], [3, 2], [4, 2],
  [0, 3], [1, 3], [2, 3], [4, 3], [5, 3], [6, 3],
  [2, 4], [3, 4], [4, 4],
  [1, 5], [3, 5], [5, 5],
  [0, 6], [3, 6], [6, 6],
];

export const ADJ: number[][] = [
  [1, 9], [0, 2, 4], [1, 14],
  [4, 10], [1, 3, 5, 7], [4, 13],
  [7, 11], [4, 6, 8], [7, 12],
  [0, 10, 21], [3, 9, 11, 18], [6, 10, 15], [8, 13, 17], [5, 12, 14, 20], [2, 13, 23],
  [11, 16], [15, 17, 19], [12, 16],
  [10, 19], [16, 18, 20, 22], [13, 19],
  [9, 22], [19, 21, 23], [14, 22],
];

export const MILLS: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
  [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

export type Side = 0 | 1;
export interface Config { men: number; drawAfter: number }
export const DEFAULT_CONFIG: Config = { men: 9, drawAfter: 50 };

/** One whole turn: put down or move a man, then (if it made a mill) remove one. */
export interface Turn { from: number | null; to: number; remove: number | null }

export interface GameState {
  config: Config;
  board: (Side | null)[];
  inHand: [number, number];
  turn: Side;
  quiet: number;            // moves since the last mill
  history: { side: Side; turn: Turn }[];
  winner: Side | 'draw' | null;
}

export function newGame(config = DEFAULT_CONFIG, first: Side = 0): GameState {
  return { config, board: Array(24).fill(null), inHand: [config.men, config.men], turn: first, quiet: 0, history: [], winner: null };
}

export const count = (s: GameState, side: Side) => s.board.filter((b) => b === side).length;
export const placing = (s: GameState, side: Side) => s.inHand[side] > 0;
export const flying = (s: GameState, side: Side) => !placing(s, side) && count(s, side) === 3;

export const inMill = (board: (Side | null)[], p: number) =>
  board[p] !== null && MILLS.some((m) => m.includes(p) && m.every((q) => board[q] === board[p]));

/** Enemy men this side may take: not in a mill, unless all of them are. */
export function removable(board: (Side | null)[], side: Side): number[] {
  const theirs = board.map((b, i) => (b === 1 - side ? i : -1)).filter((i) => i >= 0);
  const free = theirs.filter((p) => !inMill(board, p));
  return free.length ? free : theirs;
}

/** Destinations for each of this side's moves (from = null while placing). */
export function steps(s: GameState, side: Side): { from: number | null; to: number }[] {
  const empty = s.board.map((b, i) => (b === null ? i : -1)).filter((i) => i >= 0);
  if (placing(s, side)) return empty.map((to) => ({ from: null, to }));
  const out: { from: number | null; to: number }[] = [];
  const fly = flying(s, side);
  s.board.forEach((b, from) => {
    if (b !== side) return;
    for (const to of fly ? empty : ADJ[from].filter((q) => s.board[q] === null)) out.push({ from, to });
  });
  return out;
}

/** Does putting `side` on `to` (leaving `from`) make a mill? */
export function makesMill(board: (Side | null)[], side: Side, from: number | null, to: number): boolean {
  const b = [...board];
  if (from !== null) b[from] = null;
  b[to] = side;
  return MILLS.some((m) => m.includes(to) && m.every((q) => b[q] === side));
}

/** Every legal whole turn for the side to move. */
export function legalTurns(s: GameState): Turn[] {
  if (s.winner !== null) return [];
  const side = s.turn;
  const out: Turn[] = [];
  for (const st of steps(s, side)) {
    if (!makesMill(s.board, side, st.from, st.to)) {
      out.push({ ...st, remove: null });
      continue;
    }
    const b = [...s.board];
    if (st.from !== null) b[st.from] = null;
    b[st.to] = side;
    for (const r of removable(b, side)) out.push({ ...st, remove: r });
  }
  return out;
}

export function play(s: GameState, t: Turn): GameState {
  if (s.winner !== null) throw new Error('game over');
  const side = s.turn;
  const ok = legalTurns(s).some((x) => x.from === t.from && x.to === t.to && x.remove === t.remove);
  if (!ok) throw new Error('illegal move');
  const board = [...s.board];
  if (t.from !== null) board[t.from] = null;
  board[t.to] = side;
  if (t.remove !== null) board[t.remove] = null;
  const inHand: [number, number] = [...s.inHand];
  if (t.from === null) inHand[side]--;
  const other = (1 - side) as Side;
  const next: GameState = {
    ...s, board, inHand, turn: other,
    quiet: t.remove !== null ? 0 : s.quiet + 1,
    history: [...s.history, { side, turn: t }],
  };
  // the opponent loses with fewer than 3 men (counting men still in hand) or no move
  if (count(next, other) + next.inHand[other] < 3 || !steps(next, other).length) return { ...next, winner: side };
  if (next.quiet >= s.config.drawAfter) return { ...next, winner: 'draw' };
  return next;
}

export const pointName = (p: number) => `${'abcdefg'[POINTS[p][0]]}${7 - POINTS[p][1]}`;

/** "places on d7", or "place on d7" when `you` is the subject. */
export function describe(t: Turn, you = false): string {
  const where = t.from === null ? `${you ? 'place' : 'places'} on ${pointName(t.to)}` : `${you ? 'move' : 'moves'} ${pointName(t.from)}→${pointName(t.to)}`;
  return t.remove === null ? where : `${where}, mill! ${you ? 'take' : 'takes'} ${pointName(t.remove)}`;
}
