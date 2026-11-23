/**
 * Piggy Bluff at an online table. The bank goes hand to hand: the holder adds
 * coins and picks a receiver, the receiver claims a count, then everyone else
 * doubts or believes at once.
 *
 * This is a memory game, so the view carries only what the solo screen shows
 * at that moment: never the bank's contents or anyone's coin colours (not even
 * your own — you're meant to remember them), only who dropped how many coins
 * last; rivals' doubt/believe choices only as "decided" until the reveal; and
 * only the latest claim's result, with the full log sealed until the end.
 */
import type { Rng } from '../shared/rng';
import { botAdd, botClaim, botRespond } from './bots';
import { GameState, add, claim, newGame, proceed, respond, responders, standings } from './logic';

export const RESULT_MS = 10_000;

export type Action =
  | { type: 'add'; black: number; white: number; to: string }
  | { type: 'claim'; count: number }
  | { type: 'respond'; doubt: boolean };

/** What one seat sees: the game with secrets taken out, and the latest drop (count only). */
export interface View { game: GameState; drop: { player: string; count: number } | null }

export const start = (seats: { id: string; name: string; isBot: boolean }[]): GameState => newGame(seats);

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type === 'add') {
    if (!isCount(action.black) || !isCount(action.white)) throw new Error('Pick how many coins of each colour.');
    if (typeof action.to !== 'string') throw new Error('Pick who gets the bank.');
    if (action.to === seat || action.to === 'you') throw new Error('Pass the bank to another player.');
    if (action.black < 0 || action.white < 0 || action.black + action.white < 1 || action.black + action.white > s.config.maxAdd) {
      throw new Error(`Drop 1 to ${s.config.maxAdd} coins.`);
    }
    if (!s.players.some((p) => p.id === action.to)) throw new Error('Pass the bank to another player.');
    return add(s, seat, { black: action.black, white: action.white }, action.to);
  }
  if (action?.type === 'claim') {
    if (!isCount(action.count)) throw new Error('Say a whole number of coins.');
    return claim(s, seat, action.count);
  }
  if (action?.type === 'respond') {
    if (typeof action.doubt !== 'boolean') throw new Error('Doubt or believe?');
    if (seat in s.responses) throw new Error('You’ve already decided.');
    return respond(s, seat, action.doubt);
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn(s: GameState): string[] {
  if (s.phase === 'add') return [s.holder];
  if (s.phase === 'claim') return s.receiver ? [s.receiver] : [];
  if (s.phase === 'doubt') return responders(s).filter((id) => !(id in s.responses));
  return [];
}

/** Bots play the steady persona: middling adds, honest counts, fair doubts. */
export function botAction(s: GameState, seat: string, rng: Rng): Action {
  if (s.phase === 'add') {
    const m = botAdd(s, seat, 'steady', rng);
    return { type: 'add', ...m.coins, to: m.to };
  }
  if (s.phase === 'claim') return { type: 'claim', count: botClaim(s, seat, rng) };
  return { type: 'respond', doubt: botRespond(s, seat, 'steady', rng) };
}

export const pause = (s: GameState) => (s.phase === 'reveal' ? { ms: RESULT_MS, next: proceed } : null);
export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({
    seat: p.id, place: i + 1, detail: `${p.points} point${p.points === 1 ? '' : 's'}, ${p.wrongClaims} wrong claim${p.wrongClaims === 1 ? '' : 's'}`,
  }));
}

export function view(s: GameState, viewer: string | null): View {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  const done = s.phase === 'gameOver';
  const latest = s.additions[s.additions.length - 1];
  // while deciding, a rival's choice shows only as "decided"
  const responses: Record<string, boolean> = {};
  if (s.phase === 'doubt') for (const [id, d] of Object.entries(s.responses)) responses[r(id)] = id === viewer ? d : false;
  // the claim log is sealed: only the claim being revealed, or all of it at the end
  const history = done ? s.history : s.phase === 'reveal' ? s.history.slice(-1) : [];
  return {
    game: {
      ...s,
      players: s.players.map((p) => ({
        ...p,
        ...(p.id === viewer ? { id: 'you', name: 'You' } : {}),
        // a tally of wrong claims is a memory aid: shown at the end
        wrongClaims: done ? p.wrongClaims : 0,
      })),
      // the bank is never looked into except at a reveal (sent in the claim record)
      bank: { black: 0, white: 0 },
      additions: [],
      holder: r(s.holder),
      receiver: s.receiver && r(s.receiver),
      responses,
      history: history.map((h) => ({ ...h, claimer: r(h.claimer), doubters: h.doubters.map(r), delta: keys(h.delta) })),
    },
    drop: latest ? { player: r(latest.player), count: latest.black + latest.white } : null,
  };
}
