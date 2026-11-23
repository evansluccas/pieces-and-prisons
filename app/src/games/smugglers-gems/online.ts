/**
 * Smuggler's Gems at an online table. Turns go round the table (and back);
 * on your turn you swap blind or pass, and may use your one peek first.
 *
 * A memory game, so a seat is sent only what the solo screen shows it:
 * - its own card; every other card is null (face down) until the reveal;
 * - only the latest move, as that seat may see it — earlier moves, and what
 *   you gave, got or peeked before, are not sent again;
 * - its own secret partner; everyone else's partner is '' until the match ends;
 * - at a reveal, that round's cards and scores; earlier rounds are dropped
 *   until the final log, which shows every move as that seat saw it.
 */
import type { Rng } from '../shared/rng';
import { botTurn } from './bots';
import {
  BUYER, Card, DISCARD, GameState, TurnEvent, canSwapWith, currentTurn, locations, nextRound, newGame, pass, peek,
  standings, swap, visibleEvent,
} from './logic';

export const RESULT_MS = 10_000;

export interface OnlineState { game: GameState; rng: Rng }
/** `peek` on a swap or pass means "peek there first" (bots use it so a peek never stalls the turn). */
export type Action =
  | { type: 'swap'; target: string; peek?: string }
  | { type: 'pass'; peek?: string }
  | { type: 'peek'; target: string };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

/** A location named by the client: 'you' means the seat itself. */
function locOf(s: GameState, seat: string, loc: unknown): string {
  if (typeof loc !== 'string') throw new Error('Pick a card.');
  const real = loc === 'you' ? seat : loc;
  if (!locations(s).includes(real)) throw new Error('No such card on the table.');
  return real;
}

function doPeek(s: GameState, seat: string, loc: unknown): GameState {
  const real = locOf(s, seat, loc);
  if (s.players.find((p) => p.id === seat)!.peeked) throw new Error('You already used your peek.');
  if (![...BUYER, DISCARD].includes(real as never)) throw new Error('You can only peek at a Buyer or Discard card.');
  return peek(s, seat, real);
}

export function act(st: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  let s = st.game;
  if (currentTurn(s) !== seat) throw new Error('Not your move right now.');
  if (action?.type === 'peek') return { ...st, game: doPeek(s, seat, action.target) };
  if (action?.type !== 'swap' && action?.type !== 'pass') throw new Error('That move isn’t part of this game.');
  if (action.peek !== undefined) s = doPeek(s, seat, action.peek);
  if (action.type === 'pass') return { ...st, game: pass(s, seat) };
  const target = locOf(s, seat, action.target);
  if (target === seat) throw new Error('Swap with another card, or pass.');
  if (!canSwapWith(s, seat, target)) throw new Error('A bomb can only be swapped with another player.');
  return { ...st, game: swap(s, seat, target) };
}

export function waitingOn({ game }: OnlineState): string[] {
  const t = currentTurn(game);
  return t ? [t] : [];
}

/** Bots play the middle persona, on what that seat really knows. */
export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  const first = botTurn(game, seat, 'greedy', rng);
  if (first.kind !== 'peek') return first.kind === 'swap' ? { type: 'swap', target: first.target } : { type: 'pass' };
  // a peek doesn't use the turn: decide the real move with what it saw
  const then = botTurn(peek(game, seat, first.target), seat, 'greedy', rng);
  return then.kind === 'swap' ? { type: 'swap', target: then.target, peek: first.target } : { type: 'pass', peek: first.target };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'reveal' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextRound(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.total} + ${p.final - p.total} partner = ${p.final}` }));
}

export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  const ev = (e: TurnEvent): TurnEvent => {
    const v = visibleEvent(e, viewer ?? '');
    return { ...v, player: r(v.player), ...(v.target ? { target: r(v.target) } : {}) };
  };
  const over = s.phase === 'gameOver';
  const reveal = s.phase === 'reveal' || over;
  const lastMove = s.events[s.events.length - 1];
  const lastRound = s.history[s.history.length - 1];
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      id: r(p.id),
      name: p.id === viewer ? 'You' : p.name,
      // partners and used peeks are only known to their owner until the end
      partner: over || p.id === viewer ? r(p.partner) : '',
      peeked: over || p.id === viewer ? p.peeked : false,
    })),
    order: s.order.map(r),
    // face down: every location is there (so swaps can be offered), only your own card has a face
    hands: Object.fromEntries(Object.entries(s.hands).map(([loc, c]) => [r(loc), reveal || loc === viewer ? c : null])) as Record<string, Card>,
    // only the move that just happened is announced
    events: s.phase === 'exchange' && lastMove ? [ev(lastMove)] : [],
    history: over
      ? s.history.map((h) => ({ ...h, hands: keys(h.hands), scores: keys(h.scores), events: h.events.map(ev) }))
      : s.phase === 'reveal' && lastRound
        ? [{ ...lastRound, hands: keys(lastRound.hands), scores: keys(lastRound.scores), events: [] }]
        : [],
  };
}
