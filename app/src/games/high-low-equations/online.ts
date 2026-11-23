/**
 * High-Low Equations at an online table. Betting goes one player at a time;
 * everyone still in then builds and declares their equation at once.
 *
 * Hidden: the deck, every rival's hidden card (shown only for hands that
 * reach a showdown), and rival declarations until all are in.
 */
import type { Rng } from '../shared/rng';
import { Persona, botAct, botDeclare } from './bots';
import { Action as Bet, Declaration, GameState, Side, act as bet, currentTurn, declare, declarers, newGame, nextHand, standings } from './logic';

export const RESULT_MS = 12_000;
const PERSONAS: Persona[] = ['rock', 'shark', 'maniac'];
const BETS: Bet[] = ['fold', 'check', 'call', 'bet', 'raise'];
const SIDES: Side[] = ['high', 'low', 'swing'];

export interface OnlineState { game: GameState; rng: Rng }
export type Action = { type: 'bet'; action: Bet } | { type: 'declare'; declaration: Declaration };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type === 'bet' && BETS.includes(action.action)) return { ...s, game: bet(s.game, seat, action.action) };
  if (action?.type === 'declare') {
    const d = action.declaration;
    if (!d || !SIDES.includes(d.side)) throw new Error('Choose high, low or swing.');
    return { ...s, game: declare(s.game, seat, { side: d.side, high: d.high ?? null, low: d.low ?? null }) };
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn({ game }: OnlineState): string[] {
  const turn = currentTurn(game);
  return turn ? [turn] : declarers(game);
}

/** Building an equation takes longer than a bet. */
export const turnMs = ({ game }: OnlineState) => (game.phase === 'declare' ? 90_000 : 60_000);

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  if (game.phase === 'declare') return { type: 'declare', declaration: botDeclare(game, seat, rng) };
  const persona = PERSONAS[game.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  return { type: 'bet', action: botAct(game, seat, persona, rng) };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'result' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextHand(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.chips} chips` }));
}

export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  const last = s.phase === 'result' || s.phase === 'gameOver' ? s.results[s.results.length - 1] : null;
  return {
    ...s,
    deck: [],
    players: s.players.map((p) => {
      if (p.id === viewer) return { ...p, id: 'you', name: 'You' };
      return {
        ...p,
        // the hidden card shows only once it has been shown down
        hidden: last?.showings[p.id] ? p.hidden : null,
        // a declaration shows only as "declared" until the hand is over
        declared: p.declared === undefined || s.phase !== 'declare' ? p.declared : null,
      };
    }),
    toAct: s.toAct.map(r),
    actions: s.actions.map((x) => ({ ...x, player: r(x.player) })),
    results: s.results.map((h) => ({
      ...h, showings: keys(h.showings), highWinner: h.highWinner && r(h.highWinner), lowWinner: h.lowWinner && r(h.lowWinner),
      failedSwing: h.failedSwing.map(r), winnings: keys(h.winnings), foldWin: h.foldWin && r(h.foldWin),
      actions: h.actions.map((x) => ({ ...x, player: r(x.player) })),
    })),
  };
}
