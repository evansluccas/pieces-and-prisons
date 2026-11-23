import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/walls-and-wards/logic';
import { freeSides } from '../src/games/walls-and-wards/logic';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { BOT_MAX_MS, ClientMessage, RoomView, Rooms, ServerMessage, TURN_MS } from './rooms';

let db: Db;
let inbox: Map<number, ServerMessage[]>;
let rooms: Rooms;
let a: User;
let b: User;

beforeEach(() => {
  vi.useFakeTimers();
  db = openDb(':memory:');
  inbox = new Map();
  rooms = new Rooms((id, m) => inbox.set(id, [...(inbox.get(id) ?? []), m]), db);
  a = guest(db, 'Ana').user;
  b = guest(db, 'Ben').user;
});
afterEach(() => vi.useRealTimers());

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const game = (u: User) => last(u, 'game')!;
const view = (u: User) => game(u).view as GameState;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;

/** Ana and Ben, and optionally a bot. */
function started(bot = false) {
  say(a, { type: 'create', gameId: 'walls-and-wards' });
  say(b, { type: 'join', code: room(a).code });
  if (bot) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('Walls & Wards online', () => {
  it('two people can play; each sees themselves as "you" and the same board', () => {
    started();
    expect(room(a).status).toBe('playing');
    expect(view(a).turn).toBe('you');
    expect(view(b).turn).not.toBe('you');
    expect(game(a).waiting).toBe(true);
    act(b, { type: 'place', cell: { x: 0, y: 0 } });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'place', cell: { x: 3, y: 3 } });
    expect(view(a).counters).toEqual([expect.objectContaining({ owner: 'you', kind: 'square', x: 3, y: 3 })]);
    expect(view(b).counters[0].owner).not.toBe('you');
    expect(view(b).counters[0].id).toBe(view(a).counters[0].id); // counter ids are the same for everyone
    expect(view(b).turn).toBe('you');
  });

  it('moves are checked: reach, a wall on a free side, your own counters only', () => {
    started();
    act(a, { type: 'place', cell: { x: 1, y: 1 } });
    act(b, { type: 'place', cell: { x: 5, y: 5 } });
    act(b, { type: 'place', cell: { x: 5, y: 1 } });
    act(a, { type: 'place', cell: { x: 1, y: 5 } });
    expect(view(a).phase).toBe('play');
    const mine = view(a).counters.find((c) => c.owner === 'you' && c.kind === 'square')!;
    const theirs = view(a).counters.find((c) => c.owner !== 'you')!;
    act(a, { type: 'move', counter: theirs.id, to: { x: theirs.x, y: theirs.y }, wall: 'N' });
    expect(error(a)).toMatch(/not your counter/);
    act(a, { type: 'move', counter: mine.id, to: { x: 6, y: 6 }, wall: 'N' });
    expect(error(a)).toMatch(/reach/);
    act(a, { type: 'move', counter: mine.id, to: { x: 1, y: 3 }, wall: 'X' });
    expect(error(a)).toMatch(/side/);
    act(a, { type: 'move', counter: mine.id, to: { x: 1, y: 3 }, wall: 'E' });
    const v = view(b);
    expect(v.walls).toHaveLength(1);
    expect(v.history[0]).toMatchObject({ player: expect.not.stringMatching(/^you$/), to: { x: 1, y: 3 }, wall: 'E' });
    expect(v.turn).toBe('you');
    expect(freeSides(v, { x: 1, y: 3 })).not.toContain('E');
  });

  it('a whole match plays out (time-outs move for absent players) and is recorded', () => {
    started(true);
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 400) vi.advanceTimersByTime(game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(view(a).phase).toBe('gameOver');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'walls-and-wards'").get()).toEqual({ n: 1 });
  });
});
