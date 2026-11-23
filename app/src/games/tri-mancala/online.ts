/**
 * Tri-Mancala at an online table. Turn-based with nothing hidden.
 *
 * The solo board draws "you" as player 0, so each viewer gets the ring
 * turned to start at their own pits: a turned ring is the same game, just
 * seen from another seat. Pit numbers a player sends back are turned back
 * by the server.
 */
import type { Rng } from '../shared/rng';
import { botSow } from './bots';
import { Colour, GameState, SEG, newGame, sow, standings } from './logic';

export type Action = { type: 'sow'; pit: number; order: Colour[] };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng) => newGame(seats, rng);

const indexOf = (s: GameState, seat: string) => {
  const i = s.players.findIndex((p) => p.id === seat);
  if (i < 0) throw new Error('You’re not playing this game.');
  return i;
};

/** Slot number as seen from seat `v` → real slot (and back). */
const toReal = (s: GameState, v: number, slot: number) => (slot + v * SEG) % s.slots.length;
const toSeen = (s: GameState, v: number, slot: number) => (slot - v * SEG + s.slots.length) % s.slots.length;

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type !== 'sow' || !Array.isArray(action.order) || action.order.length > 60) throw new Error('That move isn’t part of this game.');
  const me = indexOf(s, seat);
  const pit = Number(action.pit);
  if (!Number.isInteger(pit) || pit < 0 || pit >= s.slots.length) throw new Error('pick one of your own pits');
  return sow(s, me, toReal(s, me, pit), action.order.map((c) => Number(c) as Colour));
}

export const waitingOn = (s: GameState): string[] => (s.over ? [] : [s.players[s.turn].id]);

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  const me = indexOf(s, seat);
  const c = botSow(s, me, 'normal', rng);
  return { type: 'sow', pit: toSeen(s, me, c.pit), order: c.order };
}

export const over = (s: GameState) => s.over;

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `score ${p.score} (red ${p.counts[0]}, blue ${p.counts[1]}, gold ${p.counts[2]})` }));
}

/** Turn the ring (and players) so the viewer sits at player 0 and is called 'you'. */
export function view(s: GameState, viewer: string | null): GameState {
  const n = s.players.length;
  const v = Math.max(0, s.players.findIndex((p) => p.id === viewer));
  const r = (i: number) => (i - v + n) % n;
  const seen = (slot: number) => toSeen(s, v, slot);
  return {
    ...s,
    players: s.players.map((_, i) => s.players[(i + v) % n]).map((p) => (p.id === viewer ? { ...p, id: 'you', name: 'You' } : p)),
    slots: s.slots.map((_, i) => s.slots[toReal(s, v, i)]),
    turn: r(s.turn),
    history: s.history.map((h) => ({ ...h, player: r(h.player), pit: seen(h.pit), path: h.path.map(seen), captured: h.captured.map(seen) })),
  };
}
