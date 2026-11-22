/**
 * TIGERS & GOATS — the classic hunt game (public domain; known as Bagh Chal)
 *
 * - A 5×5 grid of points joined by lines; every other point also has
 *   diagonal lines. 4 TIGERS start on the corners. The GOATS player has 20
 *   goats off the board. Goats move first.
 * - GOATS: place one goat per turn on any empty point until all 20 are down;
 *   only then may goats slide to a neighbouring empty point.
 * - TIGERS: slide to a neighbouring empty point, or JUMP over a single goat
 *   along a line to the empty point right behind it — that goat is captured.
 * - Tigers win by capturing 5 goats (or if the goats can't move).
 *   Goats win when no tiger can move. 60 moves in a row without a capture,
 *   once every goat is placed, is a draw.
 * - A MATCH is two games with swapped sides: you play goats, then tigers.
 *   Most games won wins; at 1–1 the better tiger (more captures) wins.
 */

export type Piece = 'T' | 'G';
export type Role = Piece;
export const SIZE = 5;

export const xy = (p: number) => [p % SIZE, Math.floor(p / SIZE)] as const;
const idx = (x: number, y: number) => y * SIZE + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const hasDiagonals = (p: number) => (xy(p)[0] + xy(p)[1]) % 2 === 0;

/** Directions available from a point. */
export function dirs(p: number): [number, number][] {
  const out: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (hasDiagonals(p)) out.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  return out;
}

export const ADJ: number[][] = Array.from({ length: SIZE * SIZE }, (_, p) => {
  const [x, y] = xy(p);
  return dirs(p).filter(([dx, dy]) => inside(x + dx, y + dy)).map(([dx, dy]) => idx(x + dx, y + dy));
});

export interface Config { goats: number; toWin: number; drawAfter: number }
export const DEFAULT_CONFIG: Config = { goats: 20, toWin: 5, drawAfter: 60 };

export interface Move { from: number | null; to: number; jumped: number | null }

export interface GameState {
  config: Config;
  board: (Piece | null)[];
  toPlace: number;
  captured: number;
  turn: Role;
  quiet: number;
  history: { role: Role; move: Move }[];
  winner: Role | 'draw' | null;
}

export function newGame(config = DEFAULT_CONFIG): GameState {
  const board: (Piece | null)[] = Array(SIZE * SIZE).fill(null);
  for (const c of [idx(0, 0), idx(4, 0), idx(0, 4), idx(4, 4)]) board[c] = 'T';
  return { config, board, toPlace: config.goats, captured: 0, turn: 'G', quiet: 0, history: [], winner: null };
}

export function tigerMoves(board: (Piece | null)[]): Move[] {
  const out: Move[] = [];
  board.forEach((b, p) => {
    if (b !== 'T') return;
    const [x, y] = xy(p);
    for (const [dx, dy] of dirs(p)) {
      const [ax, ay] = [x + dx, y + dy];
      if (!inside(ax, ay)) continue;
      const a = idx(ax, ay);
      if (board[a] === null) out.push({ from: p, to: a, jumped: null });
      else if (board[a] === 'G' && inside(ax + dx, ay + dy) && board[idx(ax + dx, ay + dy)] === null) {
        out.push({ from: p, to: idx(ax + dx, ay + dy), jumped: a });
      }
    }
  });
  return out;
}

export function goatMoves(s: GameState): Move[] {
  if (s.toPlace > 0) return s.board.map((b, p) => (b === null ? { from: null, to: p, jumped: null } : null)).filter(Boolean) as Move[];
  const out: Move[] = [];
  s.board.forEach((b, p) => {
    if (b === 'G') for (const q of ADJ[p]) if (s.board[q] === null) out.push({ from: p, to: q, jumped: null });
  });
  return out;
}

export const legalMoves = (s: GameState): Move[] => (s.winner !== null ? [] : s.turn === 'T' ? tigerMoves(s.board) : goatMoves(s));

export function play(s: GameState, m: Move): GameState {
  if (!legalMoves(s).some((x) => x.from === m.from && x.to === m.to && x.jumped === m.jumped)) throw new Error('illegal move');
  const board = [...s.board];
  const piece = s.turn;
  if (m.from !== null) board[m.from] = null;
  board[m.to] = piece;
  if (m.jumped !== null) board[m.jumped] = null;
  const captured = s.captured + (m.jumped !== null ? 1 : 0);
  const toPlace = piece === 'G' && m.from === null ? s.toPlace - 1 : s.toPlace;
  const quiet = m.jumped !== null || toPlace > 0 ? 0 : s.quiet + 1;
  const next: GameState = {
    ...s, board, captured, toPlace, quiet,
    turn: piece === 'G' ? 'T' : 'G',
    history: [...s.history, { role: piece, move: m }],
  };
  if (captured >= s.config.toWin) return { ...next, winner: 'T' };
  if (next.turn === 'T' && !tigerMoves(board).length) return { ...next, winner: 'G' };
  if (next.turn === 'G' && !goatMoves(next).length) return { ...next, winner: 'T' };
  if (quiet >= s.config.drawAfter) return { ...next, winner: 'draw' };
  return next;
}

/** Tigers that can't move at all right now. */
export function trapped(board: (Piece | null)[]): number[] {
  const free = new Set(tigerMoves(board).map((m) => m.from));
  return board.map((b, p) => (b === 'T' && !free.has(p) ? p : -1)).filter((p) => p >= 0);
}

export const pointName = (p: number) => `${'abcde'[xy(p)[0]]}${SIZE - xy(p)[1]}`;

export function describe(role: Role, m: Move, you: boolean): string {
  const who = role === 'T' ? 'tiger' : 'goat';
  if (m.from === null) return `${you ? 'place' : 'places'} a goat on ${pointName(m.to)}`;
  const base = `${you ? 'move' : 'moves'} a ${who} ${pointName(m.from)}→${pointName(m.to)}`;
  return m.jumped !== null ? `${base}, capturing the goat on ${pointName(m.jumped)}` : base;
}

// ------------------------------------------------------------- the match ----

/** Game 1: you are the goats. Game 2: you are the tigers. */
export interface MatchResult { youAs: Role; winner: Role | 'draw'; captured: number; moves: number }

/** Who wins the two-game match: 'you', 'bot' or 'draw'. */
export function matchWinner(results: MatchResult[]): 'you' | 'bot' | 'draw' {
  let you = 0;
  let bot = 0;
  for (const r of results) {
    if (r.winner === 'draw') continue;
    if (r.winner === r.youAs) you++;
    else bot++;
  }
  if (you !== bot) return you > bot ? 'you' : 'bot';
  // tie-break: captures made as the tiger
  const yourCaptures = results.find((r) => r.youAs === 'T')?.captured ?? 0;
  const botCaptures = results.find((r) => r.youAs === 'G')?.captured ?? 0;
  return yourCaptures === botCaptures ? 'draw' : yourCaptures > botCaptures ? 'you' : 'bot';
}
