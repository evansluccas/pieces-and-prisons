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
  /** `now` is the server's clock (ms); real-time games keep their timing from it. */
  start(seats: Seat[], rng: Rng, now: number): S;
  /** Apply one player's action; throws with a friendly message if it isn't allowed. */
  act(state: S, seat: string, action: unknown, now: number): S;
  /** What `seat` may see (null = a spectator), as of `now`. */
  view(state: S, seat: string | null, now: number): unknown;
  /** Seats the game is waiting on right now (turn-based games; real-time games may return []). */
  waitingOn(state: S): string[];
  /** A bot's move for `seat` (only called for seats in waitingOn). */
  botAction(state: S, seat: string, rng: Rng): unknown;
  /**
   * A pause in the game (e.g. a round result on screen): how long to show it,
   * and what happens after. Players may skip it with the 'ready' action.
   */
  pause?(state: S): { ms: number; next: (s: S, now: number) => S } | null;
  over(state: S): boolean;
  results(state: S): Result[];

  /**
   * REAL-TIME games (moves depend on timing, not turns) set this. The room
   * then skips the per-move time limit and instead wakes the game at
   * `wakeAt` and calls `tick`; bots are driven inside the game.
   */
  realtime?: {
    wakeAt(state: S, now: number): number | null;
    tick(state: S, now: number): S;
    /** A player lost connection or left: let go of anything they're holding. */
    dropped(state: S, seat: string, now: number): S;
    /** A player left for good: a bot plays the seat from now on. */
    takeover(state: S, seat: string): S;
  };
}
