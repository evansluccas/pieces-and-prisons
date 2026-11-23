/**
 * Color Doubt at an online table. Bidding goes round the table one player at
 * a time; when a bid is doubted, everyone else backs a side at once.
 *
 * Hidden until the reveal: every rival's hand (sent face down) and, while
 * backing, which side each rival backed.
 */
import type { Rng } from '../shared/rng';
import { Persona, botBack, botMove } from './bots';
import { COLOR_ORDER, Color, GameState, back, backers, doubt, newGame, nextRound, raise, standings } from './logic';

export const RESULT_MS = 10_000;
const PERSONAS: Persona[] = ['cautious', 'bluffer', 'doubter'];

export interface OnlineState { game: GameState; rng: Rng }
export type Action = { type: 'raise'; count: number; color: Color } | { type: 'doubt' } | { type: 'back'; side: 'bid' | 'doubt' };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type === 'raise') {
    if (!COLOR_ORDER.includes(action.color)) throw new Error('No such colour.');
    return { ...s, game: raise(s.game, seat, Number(action.count), action.color) };
  }
  if (action?.type === 'doubt') return { ...s, game: doubt(s.game, seat) };
  if (action?.type === 'back' && (action.side === 'bid' || action.side === 'doubt')) return { ...s, game: back(s.game, seat, action.side) };
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn({ game }: OnlineState): string[] {
  if (game.phase === 'bid') return game.turn ? [game.turn] : [];
  return backers(game);
}

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  if (game.phase === 'back') return { type: 'back', side: botBack(game, seat, rng) };
  const persona = PERSONAS[game.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  const m = botMove(game, seat, persona, rng);
  return m.kind === 'doubt' ? { type: 'doubt' } : { type: 'raise', count: m.count, color: m.color };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'reveal' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextRound(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.chips} chips, ${p.won} doubt${p.won === 1 ? '' : 's'} won` }));
}

export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  const shown = s.phase === 'reveal' || s.phase === 'gameOver';
  return {
    ...s,
    players: s.players.map((p) => {
      if (p.id === viewer) return { ...p, id: 'you', name: 'You' };
      return {
        ...p,
        // face down: the right number of cards, no colours
        hand: shown ? p.hand : (p.hand.map(() => null) as unknown as Color[]),
        // while backing, a rival's side shows only as "decided"
        back: p.back && s.phase === 'back' ? ('bid' as const) : p.back,
      };
    }),
    turn: s.turn && r(s.turn),
    bids: s.bids.map((b) => ({ ...b, player: r(b.player) })),
    doubter: s.doubter && r(s.doubter),
    history: s.history.map((h) => ({
      ...h, bids: h.bids.map((b) => ({ ...b, player: r(b.player) })), doubter: r(h.doubter),
      hands: keys(h.hands), backs: keys(h.backs), delta: keys(h.delta),
    })),
  };
}
