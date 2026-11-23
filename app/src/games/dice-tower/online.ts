/**
 * Dice Tower at an online table. Turn-based: the draft goes one pick at a
 * time in snake order, then everyone bets at once. The viewer appears as id
 * 'you' (name "You"), so the solo drawing code is reused.
 *
 * Hidden until the reveal: every rival's secret die and their bet.
 */
import type { Rng } from '../shared/rng';
import { Persona, botDraft, botPredict } from './bots';
import { GameState, RoundRecord, currentPicker, draft, handOf, newGame, nextRound, predict, standings } from './logic';

export type Action = { type: 'draft'; die: number } | { type: 'bet'; value: number };

export const RESULT_MS = 8000;
const PERSONAS: Persona[] = ['sharp', 'gambler', 'cautious'];

/** The game plus its own dice roller (new rounds are rolled between turns). */
export interface OnlineState { game: GameState; rng: Rng }

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type === 'draft') return { ...s, game: draft(s.game, seat, Number(action.die)) };
  if (action?.type === 'bet') {
    if (s.game.players.find((p) => p.id === seat)?.prediction !== null) throw new Error('Your bet is already placed.');
    return { ...s, game: predict(s.game, seat, Number(action.value)) };
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn({ game }: OnlineState): string[] {
  if (game.phase === 'draft') return [currentPicker(game)!];
  if (game.phase === 'predict') return game.players.filter((p) => p.prediction === null).map((p) => p.id);
  return [];
}

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  const i = game.players.findIndex((p) => p.id === seat);
  const me = game.players[i];
  const persona = PERSONAS[i % PERSONAS.length];
  if (game.phase === 'draft') return { type: 'draft', die: botDraft(me.secret, me.picks, game.pool, persona, rng) };
  // a bot sees every white die plus only its own secret die
  const hands = { ...Object.fromEntries(game.players.map((p) => [p.id, p.picks])), [seat]: handOf(me) };
  return { type: 'bet', value: botPredict(seat, hands, persona, rng) };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'result' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextRound(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  return standings(s.game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.score} pts, ${p.correct} bet${p.correct === 1 ? '' : 's'} right` }));
}

/** What `viewer` may see: rival secret dice and bets stay hidden until the reveal. */
export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const rename = (id: string | null) => (id !== null && id === viewer ? 'you' : id);
  const keys = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k)!, v]));
  const revealed = s.phase === 'result' || s.phase === 'gameOver';
  const history: RoundRecord[] = s.history.map((r) => ({
    ...r, hands: keys(r.hands), combos: keys(r.combos), predictions: keys(r.predictions), base: keys(r.base), places: keys(r.places), earned: keys(r.earned),
  }));
  return {
    ...s,
    players: s.players.map((p) => {
      const mine = p.id === viewer;
      return {
        ...p,
        id: rename(p.id)!,
        name: mine ? 'You' : p.name,
        secret: mine || revealed ? p.secret : 0,
        // a rival's bet shows only as "placed" (-1) until the reveal
        prediction: mine || revealed || p.prediction === null ? p.prediction : -1,
      };
    }),
    pool: s.pool.map((d) => ({ ...d, takenBy: rename(d.takenBy) })),
    order: s.order.map((id) => rename(id)!),
    history,
  };
}
