/**
 * Blind Five at an online table: a duel. The first seat plays side 0 and
 * goes first.
 *
 * Hidden: whose every stone is, for BOTH players (yours too — remembering is
 * the game). Each seat is sent only what the solo screen shows: where the
 * stones are, the opponent's newest stone, and the last call. Owners and the
 * move list are sent once the game is over.
 */
import type { Rng } from '../shared/rng';
import { Level, Memory, botMove, fade, observe, wrongCall } from './bots';
import { CELLS, GameState, Move, Screen, Side, isLine, newGame, play, screenOf } from './logic';

const LEVEL: Level = 'normal';

export interface OnlineState {
  game: GameState;
  seats: [string, string];
  names: [string, string];
  /** What a bot playing each seat remembers (solo-bot memory, kept as moves happen). */
  mems: [Memory, Memory];
  rng: Rng;
}
export type Action = { type: 'place'; cell: number } | { type: 'call'; cells: number[] };

/** What one seat sees. */
export interface View { screen: Screen; opponent: string }

export const toAction = (m: Move): Action => (m.kind === 'place' ? { type: 'place', cell: m.cell } : { type: 'call', cells: m.cells });

export function start(seats: { id: string; name: string }[], rng: Rng): OnlineState {
  return { game: newGame(), seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name], mems: [new Map(), new Map()], rng };
}

const cellOf = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < CELLS ? (x as number) : null);

/** Check an incoming action and turn it into a move. */
function moveOf(a: unknown, g: GameState): Move {
  const action = a as Action;
  if (action?.type === 'place') {
    const cell = cellOf(action.cell);
    if (cell === null) throw new Error('Pick a square on the board.');
    if (g.board[cell] !== null) throw new Error('That square already has a stone.');
    return { kind: 'place', cell };
  }
  if (action?.type === 'call') {
    const cells = Array.isArray(action.cells) ? action.cells.map(cellOf) : [];
    if (cells.length !== 5 || cells.some((c) => c === null)) throw new Error('A call is five stones.');
    if (!isLine(cells as number[]) || cells.some((c) => g.board[c!] === null)) throw new Error('Pick five stones in a straight line.');
    return { kind: 'call', cells: cells as number[] };
  }
  throw new Error('That move isn’t part of this game.');
}

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const side = s.seats.indexOf(seat) as Side | -1;
  if (side === -1) throw new Error('You aren’t playing at this table.');
  if (s.game.winner !== null || s.game.turn !== side) throw new Error('Not your move right now.');
  const move = moveOf(a, s.game);
  const game = play(s.game, side, move);
  // both seats' bot memories see the move, just as the solo bot does
  const mems: [Memory, Memory] = [new Map(s.mems[0]), new Map(s.mems[1])];
  if (move.kind === 'place') ([0, 1] as Side[]).forEach((me) => observe(mems[me], move.cell, side, me, LEVEL, s.rng));
  else if (!game.history[game.history.length - 1].ok) wrongCall(mems[side], move.cells);
  // a little is forgotten before each of a seat's turns
  if (game.winner === null) fade(mems[game.turn], LEVEL, s.rng);
  return { ...s, game, mems };
}

export const waitingOn = (s: OnlineState): string[] => (s.game.winner === null ? [s.seats[s.game.turn]] : []);

/** The solo bot's move, from that seat's own (imperfect) memory — never the real owners. */
export function botAction(s: OnlineState, seat: string, rng: Rng): Action {
  const side = s.seats.indexOf(seat) as Side;
  return toAction(botMove(s.game, side, s.mems[side], LEVEL, rng));
}

export const over = (s: OnlineState) => s.game.winner !== null;

export function results(s: OnlineState) {
  const { winner, strikes, history } = s.game;
  const last = history[history.length - 1];
  return ([0, 1] as Side[]).map((side) => {
    const won = winner === side;
    const how = winner === 'draw' ? 'draw, board full' : last?.ok ? (won ? 'won, called five' : 'lost to a call of five') : won ? 'won, rival struck out' : 'lost, two wrong calls';
    return { seat: s.seats[side], place: winner === 'draw' || won ? 1 : 2, detail: `${how}, ${strikes[side]} strike${strikes[side] === 1 ? '' : 's'}` };
  });
}

export function view(s: OnlineState, viewer: string | null): View {
  const side: Side = viewer === s.seats[1] ? 1 : 0;
  return { screen: screenOf(s.game, side), opponent: s.names[1 - side] };
}
