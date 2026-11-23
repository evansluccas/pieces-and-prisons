/**
 * Turf War at an online table. Turn-based with nothing hidden.
 *
 * The solo board draws "you" as player 0, so each viewer gets the player
 * order rotated to put them first: owner numbers, the turn and the history
 * are shifted to match. Board squares themselves don't move, so the cells a
 * player sends back need no translation. (Colours are therefore relative:
 * you are always blue, as in solo play.)
 */
import type { Rng } from '../shared/rng';
import { botMove, botRock } from './bots';
import { GameState, ROCK, dropRock, newGame, pass, standings, takePiece, usePatch } from './logic';

export type Action =
  | { type: 'piece'; pick: number; cells: number[] }
  | { type: 'patch'; cell: number }
  | { type: 'pass' }
  | { type: 'rock'; cell: number };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng) => newGame(seats.map((s) => ({ ...s, patches: 0 })), rng);

const indexOf = (s: GameState, seat: string) => {
  const i = s.players.findIndex((p) => p.id === seat);
  if (i < 0) throw new Error('You’re not playing this game.');
  return i;
};

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  const me = indexOf(s, seat);
  if (action?.type === 'piece' && Array.isArray(action.cells) && action.cells.length <= 8) return takePiece(s, me, Number(action.pick), action.cells.map(Number));
  if (action?.type === 'patch') return usePatch(s, me, Number(action.cell));
  if (action?.type === 'pass') return pass(s, me);
  if (action?.type === 'rock') return dropRock(s, me, Number(action.cell));
  throw new Error('That move isn’t part of this game.');
}

export const waitingOn = (s: GameState): string[] => (s.phase === 'gameOver' ? [] : [s.players[s.turn].id]);

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  const me = indexOf(s, seat);
  if (s.phase === 'rock') return { type: 'rock', cell: botRock(s, me, rng) };
  const m = botMove(s, me, 'normal', rng);
  return m.kind === 'piece' ? { type: 'piece', pick: m.pick, cells: m.cells } : m.kind === 'patch' ? { type: 'patch', cell: m.cell } : { type: 'pass' };
}

export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `biggest square ${p.square}×${p.square}, ${p.turf} turf` }));
}

/** Rotate the players so the viewer is player 0 (and called 'you'). */
export function view(s: GameState, viewer: string | null): GameState {
  const n = s.players.length;
  const v = Math.max(0, s.players.findIndex((p) => p.id === viewer));
  const r = (i: number) => (i - v + n) % n;
  const players = s.players.map((_, i) => s.players[(i + v) % n]).map((p) => (p.id === viewer ? { ...p, id: 'you', name: 'You' } : p));
  return {
    ...s,
    players,
    owner: s.owner.map((o) => (o === null || o === ROCK ? o : r(o))),
    turn: r(s.turn),
    history: s.history.map((m) => ({ ...m, player: r(m.player) })),
  };
}
