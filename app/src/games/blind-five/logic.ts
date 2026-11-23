/**
 * BLIND FIVE — rules (our own memory twist on five-in-a-row)
 *
 * - An 11×11 board. You and your opponent take turns placing one stone on
 *   any empty square. Every stone is FACE DOWN: once placed, nobody can see
 *   whose it is. You only know which ones are yours if you remember.
 * - On your turn, instead of placing a stone, you may CALL FIVE: point at
 *   five stones in a straight line (across, down or diagonal). If all five
 *   are yours, you win. If not, you take a strike — and learn nothing else.
 * - Two strikes and you lose. A full board with no winner is a draw.
 */

export type Side = 0 | 1;
export const N = 11;
export const CELLS = N * N;
export const MAX_STRIKES = 2;

export type Move = { kind: 'place'; cell: number } | { kind: 'call'; cells: number[] };
export interface Turn { side: Side; move: Move; ok?: boolean }

export interface GameState {
  board: (Side | null)[];
  turn: Side;
  strikes: [number, number];
  history: Turn[];
  winner: Side | 'draw' | null;
  /** The line that won, or the last wrong call (for the end-of-game reveal). */
  winLine: number[] | null;
}

export const xy = (c: number) => [c % N, Math.floor(c / N)] as const;
export const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1);
export const DIRS: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function newGame(): GameState {
  return { board: Array(CELLS).fill(null), turn: 0, strikes: [0, 0], history: [], winner: null, winLine: null };
}

/** The five cells from a to b, if they form a straight line of exactly five. */
export function lineBetween(a: number, b: number): number[] | null {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  const dx = bx - ax;
  const dy = by - ay;
  if (!((Math.abs(dx) === 4 || dx === 0) && (Math.abs(dy) === 4 || dy === 0)) || (dx === 0 && dy === 0)) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  return [0, 1, 2, 3, 4].map((i) => at(ax + i * sx, ay + i * sy));
}

/** Five distinct cells in one straight, unbroken line. */
export function isLine(cells: number[]): boolean {
  if (cells.length !== 5 || new Set(cells).size !== 5) return false;
  const sorted = [...cells].sort((p, q) => p - q);
  const line = lineBetween(sorted[0], sorted[4]);
  return !!line && [...line].sort((p, q) => p - q).every((c, i) => c === sorted[i]);
}

/** Every line of five on the board where all stones belong to `side`. */
export function fives(board: (Side | null)[], side: Side): number[][] {
  const out: number[][] = [];
  for (let c = 0; c < CELLS; c++) {
    const [x, y] = xy(c);
    for (const [dx, dy] of DIRS) {
      const line = [0, 1, 2, 3, 4].map((i) => at(x + i * dx, y + i * dy));
      if (line.every((d) => d >= 0 && board[d] === side)) out.push(line);
    }
  }
  return out;
}

const other = (s: Side) => (1 - s) as Side;

export function play(s: GameState, side: Side, move: Move): GameState {
  if (s.winner !== null || s.turn !== side) throw new Error('not your turn');
  if (move.kind === 'place') {
    if (s.board[move.cell] !== null || move.cell < 0 || move.cell >= CELLS) throw new Error('that square is taken');
    const board = [...s.board];
    board[move.cell] = side;
    const history = [...s.history, { side, move }];
    const full = board.every((b) => b !== null);
    return { ...s, board, history, turn: other(side), winner: full ? 'draw' : null };
  }
  if (!isLine(move.cells) || move.cells.some((c) => s.board[c] === null)) throw new Error('pick five stones in a straight line');
  const ok = move.cells.every((c) => s.board[c] === side);
  const history = [...s.history, { side, move, ok }];
  if (ok) return { ...s, history, winner: side, winLine: move.cells };
  const strikes: [number, number] = [...s.strikes];
  strikes[side]++;
  if (strikes[side] >= MAX_STRIKES) return { ...s, history, strikes, winner: other(side), winLine: move.cells };
  return { ...s, history, strikes, turn: other(side) };
}

export const stones = (s: GameState, side: Side) => s.board.filter((b) => b === side).length;
export const square = (c: number) => `${'abcdefghijk'[xy(c)[0]]}${N - xy(c)[1]}`;

/** A face-down stone: everyone sees it is there, nobody sees whose it is. */
export const DOWN = 'down';
export type Spot = Side | typeof DOWN | null;

/**
 * What one player can see, drawn with them as side 0. Owners stay hidden
 * until the game ends; until then all you get is the opponent's newest stone
 * (ringed) and the last call, if that was the last move.
 */
export interface Screen {
  board: Spot[];
  turn: Side;
  strikes: [number, number];
  winner: Side | 'draw' | null;
  winLine: number[] | null;
  /** Moves made so far (only to notice a new one). */
  moves: number;
  /** The opponent's newest stone, while it is the last move. */
  ring: number | null;
  /** The last move, if it was a call. */
  call: { side: Side; cells: number[]; ok: boolean } | null;
  /** Every move, only once the game is over. */
  history: Turn[];
}

export function screenOf(s: GameState, me: Side): Screen {
  const rel = (x: Side): Side => (x === me ? 0 : 1);
  const over = s.winner !== null;
  const last = s.history[s.history.length - 1];
  return {
    board: s.board.map((b) => (b === null ? null : over ? rel(b) : DOWN)),
    turn: rel(s.turn),
    strikes: [s.strikes[me], s.strikes[other(me)]],
    winner: s.winner === null || s.winner === 'draw' ? s.winner : rel(s.winner),
    winLine: s.winLine,
    moves: s.history.length,
    ring: !over && last?.move.kind === 'place' && last.side !== me ? last.move.cell : null,
    call: last?.move.kind === 'call' ? { side: rel(last.side), cells: last.move.cells, ok: !!last.ok } : null,
    history: over ? s.history.map((t) => ({ ...t, side: rel(t.side) })) : [],
  };
}
