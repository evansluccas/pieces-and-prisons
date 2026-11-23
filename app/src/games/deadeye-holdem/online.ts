/**
 * Deadeye Hold'em at an online table. Betting goes one player at a time;
 * the snipe is chosen by everyone still in at once.
 *
 * Hidden: the deck, every rival's hole cards (shown only for hands that
 * reach a showdown, as in solo play), and rival snipes until all are in.
 */
import type { Rng } from '../shared/rng';
import { Persona, botAct, botSnipe } from './bots';
import { Action as Bet, GameState, Snipe, act as bet, currentTurn, newGame, nextHand, snipe, snipers, standings } from './logic';

export const RESULT_MS = 10_000;
const PERSONAS: Persona[] = ['rock', 'shark', 'maniac'];
const BETS: Bet[] = ['fold', 'check', 'call', 'bet', 'raise'];

export interface OnlineState { game: GameState; rng: Rng }
export type Action = { type: 'bet'; action: Bet } | { type: 'snipe'; target: Snipe | null };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type === 'bet' && BETS.includes(action.action)) return { ...s, game: bet(s.game, seat, action.action) };
  if (action?.type === 'snipe') {
    const t = action.target;
    return { ...s, game: snipe(s.game, seat, t ? { cat: Number(t.cat), key: Number(t.key) } : null) };
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn({ game }: OnlineState): string[] {
  const turn = currentTurn(game);
  return turn ? [turn] : snipers(game);
}

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  if (game.phase === 'snipe') return { type: 'snipe', target: botSnipe(game, seat, rng) };
  const persona = PERSONAS[game.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  return { type: 'bet', action: botAct(game, seat, persona, rng) };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'result' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextHand(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.chips} chips${p.safe ? ' (safe)' : ''}` }));
}

export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  return {
    ...s,
    deck: [],
    players: s.players.map((p) => {
      if (p.id === viewer) return { ...p, id: 'you', name: 'You' };
      // a rival's snipe shows only as "ready" (null) until the hand is over
      return { ...p, hole: [], snipe: p.snipe === undefined || s.phase !== 'snipe' ? p.snipe : null };
    }),
    toAct: s.toAct.map(r),
    actions: s.actions.map((x) => ({ ...x, player: r(x.player) })),
    results: s.results.map((h) => ({
      ...h, holes: keys(h.holes), values: keys(h.values), snipes: keys(h.snipes), sniped: h.sniped.map(r),
      winnings: keys(h.winnings), foldWin: h.foldWin && r(h.foldWin), actions: h.actions.map((x) => ({ ...x, player: r(x.player) })),
    })),
  };
}
