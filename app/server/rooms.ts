/**
 * Online tables. A room has a short join code, a lobby of seats (people and
 * bots), and — once started — the authoritative game state.
 *
 * This file knows nothing about sockets: it receives (user, message) calls
 * and hands each user their messages through `send`. That keeps it easy to
 * test and lets the transport change later.
 *
 * Rules of the table:
 * - One room per person; joining another table leaves the current one.
 * - The host (whoever made the table, or the next person if they leave)
 *   adds or removes bots and starts the game.
 * - Every decision has a time limit; if it runs out, a bot plays that move
 *   for the player, so one absent person can't stall everyone.
 * - Leaving mid-game hands your seat to a bot. Losing connection keeps it:
 *   come back (same account or guest session) and you're in again.
 */
import { randomInt } from 'node:crypto';
import { seededRng, type Rng } from '../src/games/shared/rng';
import type { User } from './auth';
import type { Db } from './db';
import { ONLINE_GAMES } from './games';
import type { OnlineGame, Result } from './games/types';

export const TURN_MS = 60_000;
export const BOT_MIN_MS = 500;
export const BOT_MAX_MS = 1400;
export const IDLE_ROOM_MS = 10 * 60_000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const BOT_NAMES = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo', 'Rin'];

interface SeatState { id: string; userId: number | null; name: string; isBot: boolean; connected: boolean }

export type Status = 'lobby' | 'playing' | 'over';

interface Room {
  code: string;
  gameId: string;
  game: OnlineGame<any>;
  hostId: number;
  seats: SeatState[];
  status: Status;
  state: unknown;
  rng: Rng;
  results: Result[] | null;
  deadline: number | null;        // when the current decision times out
  pauseUntil: number | null;
  ready: Set<string>;             // seats that want to skip the pause
  timers: Set<ReturnType<typeof setTimeout>>;
  emptySince: number | null;
  nextSeat: number;
  decision: number;               // bumps each time a new decision begins
}

export interface SeatView { name: string; bot: boolean; connected: boolean; you: boolean; host: boolean }
export interface RoomView {
  code: string;
  gameId: string;
  status: Status;
  host: boolean;
  seats: SeatView[];
  minPlayers: number;
  maxPlayers: number;
  results: { name: string; place: number; detail: string; you: boolean }[] | null;
}

export type ServerMessage =
  | { type: 'room'; room: RoomView }
  | { type: 'game'; view: unknown; waiting: boolean; deadline: number | null; pauseUntil: number | null }
  | { type: 'left' }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'create'; gameId: string }
  | { type: 'join'; code: string }
  | { type: 'leave' }
  | { type: 'addBot' }
  | { type: 'removeSeat'; seat: number }
  | { type: 'start' }
  | { type: 'act'; action: unknown }
  | { type: 'ready' }
  | { type: 'again' }
  | { type: 'hello' };

class TableError extends Error {}

export class Rooms {
  private rooms = new Map<string, Room>();
  private where = new Map<number, string>(); // user id -> room code

  constructor(
    private send: (userId: number, msg: ServerMessage) => void,
    private db: Db | null = null,
    private now: () => number = Date.now,
  ) {}

  /** Handle one message from a user. Errors go back to that user only. */
  handle(user: User, msg: ClientMessage) {
    try {
      switch (msg?.type) {
        case 'hello': return this.hello(user);
        case 'create': return this.create(user, msg.gameId);
        case 'join': return this.join(user, String(msg.code ?? ''));
        case 'leave': return this.leave(user);
        case 'addBot': return this.addBot(user);
        case 'removeSeat': return this.removeSeat(user, Number(msg.seat));
        case 'start': return this.start(user);
        case 'act': return this.act(user, msg.action);
        case 'ready': return this.ready(user);
        case 'again': return this.again(user);
        default: throw new TableError('Unknown request.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      this.send(user.id, { type: 'error', message });
    }
  }

  /** A connection opened: if this person is seated somewhere, put them back. */
  private hello(user: User) {
    const room = this.roomOf(user.id);
    if (!room) return;
    const seat = room.seats.find((s) => s.userId === user.id);
    if (seat) seat.connected = true;
    room.emptySince = null;
    this.broadcast(room);
  }

  /** The last connection for this user closed. */
  disconnected(userId: number) {
    const room = this.roomOf(userId);
    if (!room) return;
    const seat = room.seats.find((s) => s.userId === userId);
    if (!seat) return;
    if (room.status === 'lobby') return this.removeUser(room, userId);
    seat.connected = false;
    if (!room.seats.some((s) => s.connected && !s.isBot)) room.emptySince = this.now();
    this.broadcast(room);
  }

  private roomOf(userId: number) {
    const code = this.where.get(userId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  private mustRoom(user: User) {
    const room = this.roomOf(user.id);
    if (!room) throw new TableError('You’re not at a table.');
    return room;
  }

  private mustHost(user: User) {
    const room = this.mustRoom(user);
    if (room.hostId !== user.id) throw new TableError('Only the host can do that.');
    return room;
  }

  private newCode() {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private create(user: User, gameId: string) {
    const game = ONLINE_GAMES[gameId];
    if (!game) throw new TableError('That game can’t be played online yet.');
    this.leave(user);
    const room: Room = {
      code: this.newCode(), gameId, game, hostId: user.id, seats: [], status: 'lobby', state: null,
      rng: seededRng(randomInt(1 << 30)), results: null, deadline: null, pauseUntil: null, ready: new Set(),
      timers: new Set(), emptySince: null, nextSeat: 0, decision: 0,
    };
    this.rooms.set(room.code, room);
    this.seat(room, user);
    this.broadcast(room);
  }

  private seat(room: Room, user: User) {
    room.seats.push({ id: `s${room.nextSeat++}`, userId: user.id, name: user.name, isBot: false, connected: true });
    this.where.set(user.id, room.code);
  }

  private join(user: User, raw: string) {
    const code = raw.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new TableError('No table with that code.');
    if (this.where.get(user.id) === code) return this.hello(user);
    if (room.status !== 'lobby') throw new TableError('That table has already started.');
    if (room.seats.length >= room.game.maxPlayers) {
      // a bot can make room for a person
      const bot = room.seats.findIndex((s) => s.isBot);
      if (bot < 0) throw new TableError('That table is full.');
      room.seats.splice(bot, 1);
    }
    this.leave(user);
    this.seat(room, user);
    this.broadcast(room);
  }

  leave(user: User) {
    const room = this.roomOf(user.id);
    if (!room) return;
    this.removeUser(room, user.id);
    this.send(user.id, { type: 'left' });
  }

  private removeUser(room: Room, userId: number) {
    this.where.delete(userId);
    const seat = room.seats.find((s) => s.userId === userId);
    if (seat) {
      if (room.status === 'playing') {
        // mid-game the seat stays, played by a bot from now on
        seat.userId = null;
        seat.isBot = true;
        seat.connected = true;
        seat.name = `${seat.name} (bot)`;
      } else room.seats.splice(room.seats.indexOf(seat), 1);
    }
    const humans = room.seats.filter((s) => s.userId !== null);
    if (!humans.length) return this.close(room);
    if (room.hostId === userId) room.hostId = humans[0].userId!;
    this.broadcast(room);
    if (room.status === 'playing') this.schedule(room);
  }

  private close(room: Room) {
    for (const t of room.timers) clearTimeout(t);
    for (const s of room.seats) if (s.userId !== null) this.where.delete(s.userId);
    this.rooms.delete(room.code);
  }

  private addBot(user: User) {
    const room = this.mustHost(user);
    if (room.status !== 'lobby') throw new TableError('The game has started.');
    if (room.seats.length >= room.game.maxPlayers) throw new TableError('The table is full.');
    const used = new Set(room.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${room.seats.length + 1}`;
    room.seats.push({ id: `s${room.nextSeat++}`, userId: null, name, isBot: true, connected: true });
    this.broadcast(room);
  }

  private removeSeat(user: User, index: number) {
    const room = this.mustHost(user);
    if (room.status !== 'lobby') throw new TableError('The game has started.');
    const seat = room.seats[index];
    if (!seat) throw new TableError('No such seat.');
    if (seat.userId === user.id) throw new TableError('Use Leave to leave the table.');
    room.seats.splice(index, 1);
    if (seat.userId !== null) {
      this.where.delete(seat.userId);
      this.send(seat.userId, { type: 'left' });
      this.send(seat.userId, { type: 'error', message: 'The host removed you from the table.' });
    }
    this.broadcast(room);
  }

  private start(user: User) {
    const room = this.mustHost(user);
    if (room.status !== 'lobby') throw new TableError('The game has already started.');
    if (room.seats.length < room.game.minPlayers) throw new TableError(`This game needs at least ${room.game.minPlayers} players — add bots to fill seats.`);
    room.state = room.game.start(room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })), room.rng);
    room.status = 'playing';
    room.results = null;
    this.advance(room);
  }

  private act(user: User, action: unknown) {
    const room = this.mustRoom(user);
    if (room.status !== 'playing') throw new TableError('The game isn’t running.');
    const seat = room.seats.find((s) => s.userId === user.id)!;
    const before = room.game.waitingOn(room.state);
    if (room.pauseUntil !== null || !before.includes(seat.id)) throw new TableError('Not your move right now.');
    try {
      room.state = room.game.act(room.state, seat.id, action);
    } catch (e) {
      throw new TableError(e instanceof Error ? e.message : 'That move isn’t allowed.');
    }
    this.moved(room, before, seat.id);
  }

  /**
   * After one seat moved: if a new decision has begun (someone is now asked
   * who wasn't before — or the game paused or ended), restart the clock;
   * otherwise others are still deciding, so just show the change.
   */
  private moved(room: Room, before: string[], actor: string) {
    const still = new Set(before.filter((id) => id !== actor));
    const now = room.game.waitingOn(room.state);
    const fresh = now.some((id) => !still.has(id));
    if (fresh || !now.length || room.game.over(room.state) || room.game.pause?.(room.state)) this.advance(room);
    else this.broadcast(room);
  }

  private ready(user: User) {
    const room = this.mustRoom(user);
    if (room.pauseUntil === null) return;
    const seat = room.seats.find((s) => s.userId === user.id)!;
    room.ready.add(seat.id);
    const people = room.seats.filter((s) => !s.isBot && s.connected);
    if (people.every((s) => room.ready.has(s.id))) this.endPause(room);
  }

  private again(user: User) {
    const room = this.mustHost(user);
    if (room.status !== 'over') throw new TableError('The game isn’t over yet.');
    // people who left mid-game were replaced by bots: tidy those names
    room.seats = room.seats.filter((s) => s.userId !== null || !s.name.endsWith('(bot)'));
    room.status = 'lobby';
    room.state = null;
    room.results = null;
    this.broadcast(room);
  }

  // ------------------------------------------------------------ the flow ----

  /** After any change: finish, pause, or wait for the next moves. */
  private advance(room: Room) {
    this.clearTimers(room);
    room.decision++;
    const { game } = room;
    if (game.over(room.state)) return this.finish(room);
    const p = game.pause?.(room.state);
    if (p) {
      room.pauseUntil = this.now() + p.ms;
      room.deadline = null;
      room.ready.clear();
      this.timer(room, p.ms, () => this.endPause(room));
      return this.broadcast(room);
    }
    room.pauseUntil = null;
    room.deadline = this.now() + TURN_MS;
    this.broadcast(room);
    this.schedule(room);
  }

  private endPause(room: Room) {
    const p = room.game.pause?.(room.state);
    if (!p) return;
    room.state = p.next(room.state);
    this.advance(room);
  }

  /** Bots move after a short think; people get TURN_MS before a bot moves for them. */
  private schedule(room: Room) {
    if (room.status !== 'playing' || room.pauseUntil !== null) return;
    const waiting = room.game.waitingOn(room.state);
    for (const id of waiting) {
      const seat = room.seats.find((s) => s.id === id)!;
      if (seat.isBot) this.timer(room, BOT_MIN_MS + room.rng() * (BOT_MAX_MS - BOT_MIN_MS), () => this.autoMove(room, id));
    }
    if (waiting.some((id) => !room.seats.find((s) => s.id === id)!.isBot)) {
      const left = Math.max(0, (room.deadline ?? this.now()) - this.now());
      const decision = room.decision;
      this.timer(room, left, () => {
        // stop as soon as a new decision begins (advance() sets a new deadline)
        for (const id of room.game.waitingOn(room.state)) {
          if (room.decision !== decision) break;
          this.autoMove(room, id, true);
        }
      });
    }
  }

  private autoMove(room: Room, seatId: string, timedOut = false) {
    if (room.status !== 'playing' || room.pauseUntil !== null) return;
    const before = room.game.waitingOn(room.state);
    if (!before.includes(seatId)) return;
    room.state = room.game.act(room.state, seatId, room.game.botAction(room.state, seatId, room.rng));
    if (timedOut) {
      const seat = room.seats.find((s) => s.id === seatId)!;
      if (seat.userId !== null) this.send(seat.userId, { type: 'error', message: 'Time ran out — a bot made that move for you.' });
    }
    this.moved(room, before, seatId);
  }

  private finish(room: Room) {
    room.status = 'over';
    room.deadline = null;
    room.pauseUntil = null;
    room.results = room.game.results(room.state);
    this.record(room);
    this.broadcast(room);
  }

  /** Save the final table to the database. */
  private record(room: Room) {
    if (!this.db || !room.results) return;
    const at = this.now();
    const { lastInsertRowid } = this.db.prepare('INSERT INTO matches (game_id, started_at, finished_at) VALUES (?, ?, ?)').run(room.gameId, at, at);
    const insert = this.db.prepare('INSERT INTO match_players (match_id, user_id, name, seat, place, detail) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of room.results) {
      const i = room.seats.findIndex((s) => s.id === r.seat);
      const seat = room.seats[i];
      insert.run(Number(lastInsertRowid), seat.userId, seat.name, i, r.place, r.detail);
    }
  }

  private timer(room: Room, ms: number, fn: () => void) {
    const t = setTimeout(() => {
      room.timers.delete(t);
      fn();
    }, ms);
    room.timers.add(t);
  }

  private clearTimers(room: Room) {
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
  }

  // ------------------------------------------------------------ messages ----

  private roomView(room: Room, userId: number): RoomView {
    return {
      code: room.code,
      gameId: room.gameId,
      status: room.status,
      host: room.hostId === userId,
      seats: room.seats.map((s) => ({ name: s.name, bot: s.isBot, connected: s.connected, you: s.userId === userId, host: s.userId === room.hostId })),
      minPlayers: room.game.minPlayers,
      maxPlayers: room.game.maxPlayers,
      results: room.results?.map((r) => {
        const seat = room.seats.find((s) => s.id === r.seat)!;
        return { name: seat.name, place: r.place, detail: r.detail, you: seat.userId === userId };
      }) ?? null,
    };
  }

  private broadcast(room: Room) {
    for (const seat of room.seats) {
      if (seat.userId === null) continue;
      this.send(seat.userId, { type: 'room', room: this.roomView(room, seat.userId) });
      if (room.status !== 'lobby' && room.state !== null) {
        this.send(seat.userId, {
          type: 'game',
          view: room.game.view(room.state, seat.id),
          waiting: room.status === 'playing' && room.pauseUntil === null && room.game.waitingOn(room.state).includes(seat.id),
          deadline: room.deadline,
          pauseUntil: room.pauseUntil,
        });
      }
    }
  }

  /** Drop tables nobody has been connected to for a while. */
  sweep() {
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince !== null && this.now() - room.emptySince > IDLE_ROOM_MS) this.close(room);
    }
  }

  /** For tests and the admin log. */
  count() {
    return this.rooms.size;
  }
}
