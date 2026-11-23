/**
 * Blind Bingo at an online table. Both steps are simultaneous: everyone
 * chooses a shape, then (choices shown) everyone bids. The viewer appears as
 * id 'you' (name "You"), so the solo drawing code is reused.
 *
 * Hidden until the match ends, exactly as in solo play: rival cards, stamps
 * and coins, every bid but your own, and who won each shape (a tie still
 * shows, since the stamp count gives it away). While choosing, rival choices
 * show only as "chose".
 */
import type { Rng } from '../shared/rng';
import { Persona, botBid, botChoose } from './bots';
import { GameState, RoundRecord, SHAPES, Shape, bid, choose, newGame, nextRound, standings } from './logic';

export type Action = { type: 'choose'; shape: Shape } | { type: 'bid'; coins: number[] };

export const RESULT_MS = 8000;
const PERSONAS: Persona[] = ['saver', 'shark', 'wild'];
/** Stands in for a rival's secret choice or winner. */
export const SECRET = '?';

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng) => newGame(seats, rng);

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type === 'choose') {
    if (!SHAPES.includes(action.shape)) throw new Error('Pick a triangle, circle or star.');
    return choose(s, seat, action.shape);
  }
  if (action?.type === 'bid' && Array.isArray(action.coins) && action.coins.length <= 10) {
    return bid(s, seat, action.coins.map(Number));
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn(s: GameState): string[] {
  if (s.phase === 'choose') return s.players.filter((p) => !p.choice).map((p) => p.id);
  if (s.phase === 'bid') return s.players.filter((p) => p.bid === null).map((p) => p.id);
  return [];
}

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  const persona = PERSONAS[s.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  if (s.phase === 'choose') return { type: 'choose', shape: botChoose(s, seat, persona, rng) };
  return { type: 'bid', coins: botBid(s, seat, persona, rng) };
}

export const pause = (s: GameState) => (s.phase === 'result' ? { ms: RESULT_MS, next: nextRound } : null);
export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.bingos} bingo, ${p.cells} cells, ${p.left} coins left` }));
}

export function view(s: GameState, viewer: string | null): GameState {
  const done = s.phase === 'gameOver';
  const rename = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k), v]));
  const history: RoundRecord[] = s.history.map((r) => ({
    ...r,
    choices: keys(r.choices),
    bids: Object.fromEntries(Object.entries(r.bids).filter(([id]) => done || id === viewer).map(([id, b]) => [rename(id), b])),
    gained: Object.fromEntries(Object.entries(r.gained).filter(([id]) => done || id === viewer).map(([id, c]) => [rename(id), c])),
    results: Object.fromEntries(SHAPES.map((sh) => {
      const res = r.results[sh];
      return [sh, { ...res, winners: res.winners.map((w) => (done || w === viewer ? rename(w) : SECRET)) }];
    })) as RoundRecord['results'],
  }));
  return {
    ...s,
    players: s.players.map((p) => {
      if (p.id === viewer) return { ...p, id: 'you', name: 'You' };
      return {
        ...p,
        card: done ? p.card : [],
        stamped: done ? p.stamped : Array(9).fill(false),
        coins: done ? p.coins : [],
        choice: s.phase === 'choose' && p.choice ? (SECRET as Shape) : p.choice,
        bid: p.bid === null ? null : [],
      };
    }),
    history,
  };
}
