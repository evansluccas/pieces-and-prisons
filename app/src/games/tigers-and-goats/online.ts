/**
 * Tigers & Goats at an online table: a duel of two games with sides swapped.
 * The first seat plays the goats in game 1 and the tigers in game 2. Between
 * the games there's a short pause (Ready skips it). Nothing is hidden.
 */
import type { Rng } from '../shared/rng';
import { botMove } from './bots';
import { GameState, MatchResult, Role, matchWinner, newGame, play } from './logic';

export const BETWEEN_MS = 10_000;

interface Played { goats: string; winner: Role | 'draw'; captured: number; moves: number }

export interface OnlineState { game: GameState; number: 0 | 1; seats: [string, string]; names: [string, string]; played: Played[] }
export type Action = { type: 'move'; from: number | null; to: number; jumped: number | null };

/** What one seat sees: the solo screen's inputs. */
export interface View { game: GameState; number: 0 | 1; mine: Role; results: MatchResult[]; opponent: string }

export function start(seats: { id: string; name: string }[]): OnlineState {
  return { game: newGame(), number: 0, seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name], played: [] };
}

/** The goats seat of the current game. */
const goats = (s: OnlineState) => s.seats[s.number];
const seatOf = (s: OnlineState, role: Role) => (role === 'G' ? goats(s) : s.seats[1 - s.number]);
const pt = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type !== 'move') throw new Error('That move isn’t part of this game.');
  if (seatOf(s, s.game.turn) !== seat) throw new Error('Not your move right now.');
  const game = play(s.game, { from: pt(action.from), to: Number(action.to), jumped: pt(action.jumped) });
  const played = game.winner === null ? s.played
    : [...s.played, { goats: goats(s), winner: game.winner, captured: game.captured, moves: game.history.length }];
  return { ...s, game, played };
}

export const waitingOn = (s: OnlineState): string[] => (s.game.winner === null ? [seatOf(s, s.game.turn)] : []);
export const botAction = (s: OnlineState, _seat: string, rng: Rng): Action => ({ type: 'move', ...botMove(s.game, 'normal', rng) });

export const pause = (s: OnlineState) =>
  s.number === 0 && s.game.winner !== null ? { ms: BETWEEN_MS, next: (x: OnlineState) => ({ ...x, number: 1 as const, game: newGame() }) } : null;

export const over = (s: OnlineState) => s.number === 1 && s.game.winner !== null;

const resultsFor = (s: OnlineState, seat: string): MatchResult[] =>
  s.played.map((p) => ({ youAs: p.goats === seat ? 'G' : 'T', winner: p.winner, captured: p.captured, moves: p.moves }));

export function results(s: OnlineState) {
  const w = matchWinner(resultsFor(s, s.seats[0])); // 'you' = first seat
  return s.seats.map((seat, i) => {
    const mine = resultsFor(s, seat);
    const won = mine.filter((r) => r.winner === r.youAs).length;
    const taken = mine.find((r) => r.youAs === 'T')?.captured ?? 0;
    const first = w === 'draw' || (w === 'you') === (i === 0);
    return { seat, place: first ? 1 : 2, detail: `${won} game${won === 1 ? '' : 's'} won, ${taken} goats taken as tigers` };
  });
}

export function view(s: OnlineState, viewer: string | null): View {
  const me = viewer ?? s.seats[0];
  const mine: Role = goats(s) === me ? 'G' : 'T';
  return { game: s.game, number: s.number, mine, results: resultsFor(s, me), opponent: me === s.seats[0] ? s.names[1] : s.names[0] };
}
