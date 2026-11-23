/**
 * Hex Sum at an online table: a duel. The first seat starts round 1.
 *
 * Memory is the game, so the view is careful: while both players study the
 * board (a server-timed pause) every number is sent; after that a tile's
 * number is only sent once it has been flipped face up for everyone (and the
 * whole board at the end). The solo board draws "you" as side 0, so the
 * second seat gets a view with the two sides swapped.
 */
import type { Rng } from '../shared/rng';
import { Memory, botLine, memorize } from './bots';
import { GameState, HEXES, LINES, Side, lineOf, newGame, startPlay, tryLine, winner } from './logic';

/** How long both players study the board (the solo game's normal level). */
export const STUDY_MS = 30_000;
/** How long a round's result stays up before the next round. */
export const RESULT_MS = 8_000;

export interface OnlineState {
  game: GameState;
  seats: [string, string];
  names: [string, string];
  /** What each seat's bot remembers — used when a bot plays it (or moves for it). */
  memory: [Memory, Memory];
  /** A round just ended: show its result before the next one. */
  roundOver: boolean;
  /** The room's random numbers (new targets); never sent. */
  rng: Rng;
}

export type Action = { type: 'flip'; tiles: number[] };

/** The board as one seat sees it: numbers it can't see are null. */
export type SeenState = Omit<GameState, 'values'> & { values: (number | null)[] };

/** What one seat sees. */
export interface View { game: SeenState; opponent: string; studyMs: number; roundOver: boolean }

export function start(seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState {
  const game = newGame(rng);
  // bots study at the normal level; a person's seat only gets what everyone saw flipped
  const mem = (i: number): Memory => (seats[i].isBot ? memorize(game.values, 'normal', rng) : game.values.map(() => null));
  return {
    game, seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name],
    memory: [mem(0), mem(1)], roundOver: false, rng,
  };
}

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type !== 'flip') throw new Error('That move isn’t part of this game.');
  if (s.game.phase !== 'play' || s.seats[s.game.turn] !== seat) throw new Error('Not your move right now.');
  const tiles = action.tiles;
  if (!Array.isArray(tiles) || tiles.length !== 3 || !tiles.every((t) => Number.isInteger(t) && t >= 0 && t < HEXES.length) || new Set(tiles).size !== 3) {
    throw new Error('Pick three different tiles.');
  }
  const line = lineOf(tiles);
  if (line < 0) throw new Error('Those three aren’t a straight line.');
  if (s.game.claimed.includes(line)) throw new Error('That line is already claimed.');
  const game = tryLine(s.game, s.game.turn, line, s.rng);
  return { ...s, game, roundOver: game.phase === 'play' && game.round !== s.game.round };
}

export const waitingOn = (s: OnlineState): string[] => (s.game.phase === 'play' && !s.roundOver ? [s.seats[s.game.turn]] : []);

export function botAction(s: OnlineState, seat: string, rng: Rng): Action {
  const side: Side = s.seats[0] === seat ? 0 : 1;
  return { type: 'flip', tiles: LINES[botLine(s.game, s.memory[side], rng)] };
}

/** Studying the board, and each round's result, are server-timed pauses. */
export function pause(s: OnlineState) {
  if (s.game.phase === 'memorize') return { ms: STUDY_MS, next: (x: OnlineState) => ({ ...x, game: startPlay(x.game) }) };
  if (s.roundOver) return { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, roundOver: false }) };
  return null;
}

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  const w = winner(s.game);
  return ([0, 1] as Side[]).map((side) => ({
    seat: s.seats[side],
    place: w === 'draw' || w === side ? 1 : 2,
    detail: `${w === 'draw' ? 'draw' : w === side ? 'won' : 'lost'}, ${s.game.scores[side]}–${s.game.scores[1 - side]} rounds`,
  }));
}

const flip = (x: Side): Side => (1 - x) as Side;

/** Numbers a player may see: all while studying and at the end, otherwise only flipped tiles. */
export function seenValues(g: GameState): (number | null)[] {
  if (g.phase !== 'play') return [...g.values];
  const up = new Set(g.attempts.flatMap((a) => LINES[a.line]));
  return g.values.map((v, i) => (up.has(i) ? v : null));
}

export function view(s: OnlineState, viewer: string | null): View {
  const second = viewer === s.seats[1];
  const g = s.game;
  const seen: SeenState = { ...g, values: seenValues(g) };
  const game: SeenState = !second ? seen : {
    ...seen,
    turn: flip(g.turn),
    starter: flip(g.starter),
    scores: [g.scores[1], g.scores[0]],
    attempts: g.attempts.map((a) => ({ ...a, side: flip(a.side) })),
  };
  return { game, opponent: second ? s.names[0] : s.names[1], studyMs: STUDY_MS, roundOver: s.roundOver };
}
