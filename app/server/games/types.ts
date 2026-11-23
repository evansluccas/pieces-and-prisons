/**
 * How a game plugs into an online table. The server holds the real state and
 * only ever sends each seat its own VIEW, so hidden cards stay hidden.
 */
import type { Rng } from '../../src/games/shared/rng';

export interface Seat { id: string; name: string; isBot: boolean }

export interface Result { seat: string; place: number; detail: string }

export interface OnlineGame<S = unknown> {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  start(seats: Seat[], rng: Rng): S;
  /** Apply one player's action; throws with a friendly message if it isn't allowed. */
  act(state: S, seat: string, action: unknown): S;
  /** What `seat` may see (null = a spectator). */
  view(state: S, seat: string | null): unknown;
  /** Seats the game is waiting on right now. */
  waitingOn(state: S): string[];
  /** A bot's move for `seat` (only called for seats in waitingOn). */
  botAction(state: S, seat: string, rng: Rng): unknown;
  /**
   * A pause in the game (e.g. a round result on screen): how long to show it,
   * and what happens after. Players may skip it with the 'ready' action.
   */
  pause?(state: S): { ms: number; next: (s: S) => S } | null;
  over(state: S): boolean;
  results(state: S): Result[];
}
