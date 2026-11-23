/**
 * Lonely Number at an online table: actions players send, and the masked
 * view each seat receives. The viewer always appears as id 'you' (name
 * "You"), so the same drawing code serves solo and online play.
 */
import type { Rng } from '../shared/rng';
import { Persona, botKeep, botPickPair } from './bots';
import { Card, GameState, RoundRecord, newGame, nextRound, standings, submitKeep, submitPair } from './logic';

export type Action = { type: 'pair'; pair: [Card, Card] } | { type: 'keep'; card: Card };

const PERSONAS: Persona[] = ['cautious', 'greedy', 'wild'];
export const RESULT_MS = 6000;

export const start = (seats: { id: string; name: string; isBot: boolean }[]) => newGame(seats);

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type === 'pair' && Array.isArray(action.pair) && action.pair.length === 2) return submitPair(s, seat, [Number(action.pair[0]), Number(action.pair[1])]);
  if (action?.type === 'keep') return submitKeep(s, seat, Number(action.card));
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn(s: GameState): string[] {
  if (s.phase === 'pick') return s.players.filter((p) => !s.pairs[p.id]).map((p) => p.id);
  if (s.phase === 'keep') return s.players.filter((p) => s.kept[p.id] === undefined).map((p) => p.id);
  return [];
}

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  const i = s.players.findIndex((p) => p.id === seat);
  const persona = PERSONAS[i % PERSONAS.length];
  const me = s.players[i];
  if (s.phase === 'pick') return { type: 'pair', pair: botPickPair(me.hand, persona, rng) };
  const others = s.players.filter((o) => o.id !== seat).map((o) => s.pairs[o.id]);
  return { type: 'keep', card: botKeep(s.pairs[seat], others, persona, rng) };
}

export const pause = (s: GameState) => (s.phase === 'result' ? { ms: RESULT_MS, next: nextRound } : null);
export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.tokens}★ ${p.wins} wins` }));
}

/** Hide what `viewer` mustn't see yet, and rename the viewer to 'you'. */
export function view(s: GameState, viewer: string | null): GameState {
  const rename = (id: string) => (id === viewer ? 'you' : id);
  const renameKeys = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k), v]));
  // during PICK only your own pair is shown; the others are just "ready" (a face-down placeholder)
  const pairs: Record<string, [Card, Card]> = {};
  for (const [id, pair] of Object.entries(s.pairs)) pairs[rename(id)] = s.phase === 'pick' && id !== viewer ? [0, 0] : pair;
  // during KEEP only your own choice is shown
  const kept: Record<string, Card> = {};
  for (const [id, card] of Object.entries(s.kept)) if (s.phase !== 'keep' || id === viewer) kept[rename(id)] = card;
  const history: RoundRecord[] = s.history.map((r) => ({
    ...r, pairs: renameKeys(r.pairs), kept: renameKeys(r.kept), winner: r.winner === null ? null : rename(r.winner),
  }));
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      id: rename(p.id),
      name: p.id === viewer ? 'You' : p.name,
      // everyone can work out other hands from the log, but only your own is shown
      hand: p.id === viewer ? p.hand : [],
    })),
    pairs,
    kept,
    history,
  };
}
