/**
 * High or Low at an online table: a duel. A coin flip at the start decides
 * who deals first; after that the deal alternates as in solo play. After each
 * call both cards are shown for a short pause (Ready skips it).
 *
 * Hidden: the dealer's face-down card, until the call is made. The solo
 * screen draws "you" as side 0, so the second seat gets the sides swapped.
 */
import type { Rng } from '../shared/rng';
import { botCall, botDeal } from './bots';
import { Call, DEFAULT_CONFIG, GameState, Side, call, deal, guesser, newGame, winner } from './logic';

export const REVEAL_MS = 8_000;

/** `reveal`: the last round's cards are on show (the pause between rounds). */
export interface OnlineState { game: GameState; seats: [string, string]; names: [string, string]; reveal: boolean }
export type Action = { type: 'deal'; shown: number; hidden: number } | { type: 'call'; call: Call };

/** What one seat sees: the solo screen's inputs. */
export interface View { game: GameState; reveal: boolean; opponent: string }

export function start(seats: { id: string; name: string }[], rng: Rng): OnlineState {
  const first: Side = rng() < 0.5 ? 0 : 1;
  return { game: newGame(DEFAULT_CONFIG, first), seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name], reveal: false };
}

const card = (x: unknown) => {
  const n = Number(x);
  if (!Number.isInteger(n)) throw new Error('Pick two of your cards.');
  return n;
};

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  const side = s.seats.indexOf(seat) as Side;
  if (s.reveal || side < 0) throw new Error('Not your move right now.');
  const g = s.game;
  if (action?.type === 'deal') {
    if (g.phase !== 'deal' || g.dealer !== side) throw new Error('Not your deal right now.');
    const shown = card(action.shown);
    const hidden = card(action.hidden);
    if (shown === hidden || !g.hands[side].includes(shown) || !g.hands[side].includes(hidden)) throw new Error('Pick two different cards you still hold.');
    return { ...s, game: deal(g, side, shown, hidden) };
  }
  if (action?.type === 'call') {
    if (g.phase !== 'call' || guesser(g) !== side) throw new Error('Not your call right now.');
    if (action.call !== 'higher' && action.call !== 'lower') throw new Error('Call HIGHER or LOWER.');
    return { ...s, game: call(g, side, action.call), reveal: true };
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn(s: OnlineState): string[] {
  const g = s.game;
  if (s.reveal || g.phase === 'gameOver') return [];
  return [s.seats[g.phase === 'deal' ? g.dealer : guesser(g)]];
}

/** Bots play the seat at the solo game's Normal level, on the real state. */
export function botAction(s: OnlineState, _seat: string, rng: Rng): Action {
  const g = s.game;
  if (g.phase === 'deal') return { type: 'deal', ...botDeal(g, 'normal', rng) };
  return { type: 'call', call: botCall(g, 'normal', rng) };
}

export const pause = (s: OnlineState) => (s.reveal ? { ms: REVEAL_MS, next: (x: OnlineState) => ({ ...x, reveal: false }) } : null);

export const over = (s: OnlineState) => s.game.phase === 'gameOver' && !s.reveal;

export function results(s: OnlineState) {
  const w = winner(s.game);
  return ([0, 1] as Side[]).map((side) => ({
    seat: s.seats[side],
    place: w === 'draw' || w === side ? 1 : 2,
    detail: `${w === 'draw' ? 'draw' : w === side ? 'won' : 'lost'}, ${s.game.scores[side]}–${s.game.scores[1 - side]}`,
  }));
}

const flip = (x: Side): Side => (1 - x) as Side;

export function view(s: OnlineState, viewer: string | null): View {
  const second = viewer === s.seats[1];
  const g = s.game;
  // the face-down card is only for the dealer's eyes (a spectator never sees it)
  const mine = viewer !== null && s.seats[g.dealer] === viewer;
  const game: GameState = {
    ...g,
    hidden: mine ? g.hidden : null,
    ...(second && {
      hands: [g.hands[1], g.hands[0]],
      dealer: flip(g.dealer),
      scores: [g.scores[1], g.scores[0]],
      history: g.history.map((r) => ({ ...r, dealer: flip(r.dealer) })),
    }),
  };
  return { game, reveal: s.reveal, opponent: second ? s.names[0] : s.names[1] };
}
