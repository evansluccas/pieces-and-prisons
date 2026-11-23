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
 * - In the lobby a lost connection (a page reload, a flaky network) keeps the
 *   seat, marked away, for LOBBY_GRACE_MS before it's given up.
 */
import { randomInt } from 'node:crypto';
import { seededRng, type Rng } from '../src/games/shared/rng';
import type { User } from './auth';
import type { Db } from './db';
import { ONLINE_GAMES } from './games';
import { decode, encode } from './persist';
import type { OnlineGame, Result } from './games/types';

export const TURN_MS = 60_000;
export const LOBBY_GRACE_MS = 45_000;
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
  decisionKey: string | null;     // the game's own name for the current decision, if it gives one
  startedAt: number | null;       // when the current game began
}

/** What is kept of a room when the server stops (see snapshot/restore). */
type SavedRoom = Omit<Room, 'game' | 'timers' | 'ready'> & { ready: string[] };

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

export interface TableInfo { code: string; gameId: string; status: Status }

export type ServerMessage =
  | { type: 'room'; room: RoomView }
  /** `now` is the server's clock when sent, so clients can count down without trusting their own clock. */
  | { type: 'game'; view: unknown; waiting: boolean; deadline: number | null; pauseUntil: number | null; now: number }
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
  | { type: 'report'; seat: number }
  | { type: 'hello' };

class TableError extends Error {}

export class Rooms {
  private rooms = new Map<string, Room>();
  private where = new Map<number, string>(); // user id -> room code
  private grace = new Map<number, ReturnType<typeof setTimeout>>(); // lobby seats waiting for their owner to come back

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
        case 'report': return this.report(user, Number(msg.seat));
        default: throw new TableError('Unknown request.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      this.send(user.id, { type: 'error', message });
    }
  }

  /** A connection opened: if this person is seated somewhere, put them back. */
  private hello(user: User) {
    this.endGrace(user.id);
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
    seat.connected = false;
    if (!room.seats.some((s) => s.connected && !s.isBot)) room.emptySince = this.now();
    if (room.status === 'lobby') {
      // keep the seat for a while: a reload shouldn't cost you your place
      this.endGrace(userId);
      this.grace.set(userId, setTimeout(() => {
        this.grace.delete(userId);
        const r = this.roomOf(userId);
        const s = r?.seats.find((x) => x.userId === userId);
        if (r && s && r.status === 'lobby' && !s.connected) this.removeUser(r, userId);
      }, LOBBY_GRACE_MS));
      return this.broadcast(room);
    }
    if (room.status === 'playing' && room.game.realtime) {
      room.state = room.game.realtime.dropped(room.state, seat.id, this.now());
      return this.advance(room);
    }
    this.broadcast(room);
  }

  private endGrace(userId: number) {
    const t = this.grace.get(userId);
    if (t) clearTimeout(t);
    this.grace.delete(userId);
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
      timers: new Set(), emptySince: null, nextSeat: 0, decision: 0, decisionKey: null, startedAt: null,
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
    this.endGrace(userId);
    this.where.delete(userId);
    const seat = room.seats.find((s) => s.userId === userId);
    if (seat) {
      if (room.status === 'playing') {
        // mid-game the seat stays, played by a bot from now on
        seat.userId = null;
        seat.isBot = true;
        seat.connected = true;
        seat.name = `${seat.name} (bot)`;
        if (room.game.realtime) {
          const rt = room.game.realtime;
          room.state = rt.takeover(rt.dropped(room.state, seat.id, this.now()), seat.id);
        }
      } else room.seats.splice(room.seats.indexOf(seat), 1);
    }
    const humans = room.seats.filter((s) => s.userId !== null);
    if (!humans.length) return this.close(room);
    if (room.hostId === userId) room.hostId = humans[0].userId!;
    if (room.status === 'playing') this.advance(room);
    else this.broadcast(room);
  }

  private close(room: Room) {
    for (const t of room.timers) clearTimeout(t);
    for (const s of room.seats) {
      if (s.userId === null) continue;
      this.where.delete(s.userId);
      this.endGrace(s.userId);
    }
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
      this.endGrace(seat.userId);
      this.send(seat.userId, { type: 'left' });
      this.send(seat.userId, { type: 'error', message: 'The host removed you from the table.' });
    }
    this.broadcast(room);
  }

  private start(user: User) {
    const room = this.mustHost(user);
    if (room.status !== 'lobby') throw new TableError('The game has already started.');
    if (room.seats.length < room.game.minPlayers) throw new TableError(`This game needs at least ${room.game.minPlayers} players — add bots to fill seats.`);
    room.state = room.game.start(room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })), room.rng, this.now());
    room.status = 'playing';
    room.startedAt = this.now();
    room.results = null;
    this.advance(room);
  }

  private act(user: User, action: unknown) {
    const room = this.mustRoom(user);
    if (room.status !== 'playing') throw new TableError('The game isn’t running.');
    const seat = room.seats.find((s) => s.userId === user.id)!;
    if (room.game.realtime) {
      if (room.pauseUntil !== null) throw new TableError('Not your move right now.');
      try {
        room.state = room.game.act(room.state, seat.id, action, this.now());
      } catch (e) {
        throw new TableError(e instanceof Error ? e.message : 'That move isn’t allowed.');
      }
      return this.advance(room);
    }
    const before = room.game.waitingOn(room.state);
    if (room.pauseUntil !== null || !before.includes(seat.id)) throw new TableError('Not your move right now.');
    try {
      room.state = room.game.act(room.state, seat.id, action, this.now());
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
    const key = room.game.decisionKey?.(room.state);
    const fresh = key !== undefined ? key !== room.decisionKey : now.some((id) => !still.has(id));
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

  /** Report another person's name at this table; kept for review (server/admin.ts). */
  private report(user: User, index: number) {
    const room = this.mustRoom(user);
    const seat = room.seats[index];
    if (!seat || seat.userId === null) throw new TableError('Only players can be reported, not bots.');
    if (seat.userId === user.id) throw new TableError('You can’t report yourself.');
    if (this.db) {
      const day = this.now() - 24 * 60 * 60 * 1000;
      const again = this.db.prepare('SELECT 1 FROM reports WHERE reporter_id = ? AND reported_id = ? AND created_at > ?').get(user.id, seat.userId, day);
      if (!again) {
        this.db.prepare('INSERT INTO reports (reporter_id, reported_id, name, table_code, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, seat.userId, seat.name, room.code, this.now());
      }
    }
    this.send(user.id, { type: 'error', message: `Thanks — “${seat.name}” has been reported and will be looked at.` });
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
    room.decisionKey = room.game.decisionKey?.(room.state) ?? null;
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
    if (game.realtime) {
      // real-time: no move clock; wake the game when its timing needs it
      room.deadline = null;
      this.broadcast(room);
      const at = game.realtime.wakeAt(room.state, this.now());
      if (at !== null) {
        this.timer(room, Math.max(0, at - this.now()), () => {
          room.state = game.realtime!.tick(room.state, this.now());
          this.advance(room);
        });
      }
      return;
    }
    room.deadline = this.now() + (game.turnMs?.(room.state) ?? TURN_MS);
    this.broadcast(room);
    this.schedule(room);
  }

  private endPause(room: Room) {
    const p = room.game.pause?.(room.state);
    if (!p) return;
    room.state = p.next(room.state, this.now());
    this.advance(room);
  }

  /** Bots move after a short think; people get the decision's time limit before a bot moves for them. */
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
    room.state = room.game.act(room.state, seatId, room.game.botAction(room.state, seatId, room.rng), this.now());
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
    const { lastInsertRowid } = this.db.prepare('INSERT INTO matches (game_id, started_at, finished_at) VALUES (?, ?, ?)').run(room.gameId, room.startedAt ?? at, at);
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
          view: room.game.view(room.state, seat.id, this.now()),
          waiting: room.status === 'playing' && room.pauseUntil === null && room.game.waitingOn(room.state).includes(seat.id),
          deadline: room.deadline,
          pauseUntil: room.pauseUntil,
          now: this.now(),
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

  /** The table this person is seated at, if any — so the hub can offer to rejoin it. */
  tableOf(userId: number): TableInfo | null {
    const room = this.roomOf(userId);
    return room ? { code: room.code, gameId: room.gameId, status: room.status } : null;
  }

  /** For tests and the admin log. */
  count() {
    return this.rooms.size;
  }

  // ------------------------------------------------------------ restarts ----

  /**
   * Every table, ready to save (the server calls this when it stops, and now
   * and then in case it stops without warning). A table whose state can't be
   * saved exactly is left out rather than saved broken.
   */
  snapshot(): { code: string; data: string }[] {
    const out: { code: string; data: string }[] = [];
    for (const room of this.rooms.values()) {
      const { game: _game, timers: _timers, ready, ...rest } = room;
      const saved: SavedRoom = { ...rest, ready: [...ready] };
      try {
        out.push({ code: room.code, data: encode(saved) });
      } catch (e) {
        console.warn(`table ${room.code} (${room.gameId}) can't be saved: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
  }

  /**
   * Bring saved tables back after a restart. Everyone starts as disconnected —
   * their pages reconnect on their own and say hello, which puts them back in
   * their seats. Clocks start afresh: a move clock or a pause begins again,
   * and real-time games carry on from their own timestamps.
   */
  restore(saved: { code: string; data: string }[]): number {
    let count = 0;
    for (const row of saved) {
      try {
        const s = decode<SavedRoom>(row.data);
        const game = ONLINE_GAMES[s.gameId];
        if (!game || this.rooms.has(s.code)) continue;
        const room: Room = { ...s, game, timers: new Set(), ready: new Set(s.ready), emptySince: this.now() };
        for (const seat of room.seats) {
          if (seat.userId === null) continue;
          seat.connected = false;
          this.where.set(seat.userId, room.code);
        }
        this.rooms.set(room.code, room);
        if (room.status === 'playing') this.advance(room);
        // treat each person as just disconnected: lobby seats wait for them, real-time games let go of holds
        for (const seat of room.seats) if (seat.userId !== null) this.disconnected(seat.userId);
        count++;
      } catch (e) {
        console.warn(`saved table ${row.code} couldn't be restored: ${e instanceof Error ? e.message : e}`);
      }
    }
    return count;
  }

  /** Stop every timer (the server is shutting down; nothing should move after the last save). */
  stop() {
    for (const room of this.rooms.values()) this.clearTimers(room);
    for (const t of this.grace.values()) clearTimeout(t);
    this.grace.clear();
  }

  /** A message to everyone seated anywhere (e.g. "the server is restarting"). */
  notice(message: string) {
    for (const userId of this.where.keys()) this.send(userId, { type: 'error', message });
  }
}
