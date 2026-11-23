/**
 * Nine Men's Morris at an online table: a duel. The first seat plays blue
 * (side 0) and moves first. Nothing is hidden; the solo board draws "you" as
 * side 0, so the second seat gets a view with the two sides swapped.
 */
import type { Rng } from '../shared/rng';
import { botTurn } from './bots';
import { GameState, Side, count, newGame, play } from './logic';

export interface OnlineState { game: GameState; seats: [string, string]; names: [string, string] }
export type Action = { type: 'turn'; from: number | null; to: number; remove: number | null };

/** What one seat sees. */
export interface View { game: GameState; opponent: string }

export function start(seats: { id: string; name: string }[]): OnlineState {
  return { game: newGame(), seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name] };
}

const pt = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type !== 'turn') throw new Error('That move isn’t part of this game.');
  if (s.seats[s.game.turn] !== seat) throw new Error('Not your move right now.');
  return { ...s, game: play(s.game, { from: pt(action.from), to: Number(action.to), remove: pt(action.remove) }) };
}

export const waitingOn = (s: OnlineState): string[] => (s.game.winner === null ? [s.seats[s.game.turn]] : []);
export const botAction = (s: OnlineState, _seat: string, rng: Rng): Action => ({ type: 'turn', ...botTurn(s.game, 'normal', rng) });
export const over = (s: OnlineState) => s.game.winner !== null;

export function results(s: OnlineState) {
  const w = s.game.winner;
  return ([0, 1] as Side[]).map((side) => ({
    seat: s.seats[side],
    place: w === 'draw' || w === side ? 1 : 2,
    detail: `${w === 'draw' ? 'draw' : w === side ? 'won' : 'lost'}, ${count(s.game, side) + s.game.inHand[side]} men left`,
  }));
}

const flip = (x: Side): Side => (1 - x) as Side;

export function view(s: OnlineState, viewer: string | null): View {
  const second = viewer === s.seats[1];
  const g = s.game;
  const game: GameState = !second ? g : {
    ...g,
    board: g.board.map((b) => (b === null ? null : flip(b))),
    inHand: [g.inHand[1], g.inHand[0]],
    turn: flip(g.turn),
    history: g.history.map((h) => ({ ...h, side: flip(h.side) })),
    winner: g.winner === null || g.winner === 'draw' ? g.winner : flip(g.winner),
  };
  return { game, opponent: second ? s.names[0] : s.names[1] };
}
