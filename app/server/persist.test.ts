/** Tables survive a restart: saved by one server, picked up by the next. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededRng } from '../src/games/shared/rng';
import type { GameState as LonelyState } from '../src/games/lonely-number/logic';
import type { View as SandView } from '../src/games/sand-bid/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { decode, encode, saveTables, takeTables } from './persist';
import { ClientMessage, RoomView, Rooms, ServerMessage, TURN_MS } from './rooms';
import { ONLINE_GAMES } from './games';

let db: Db;
let inbox: Map<number, ServerMessage[]>;
let a: User;
let b: User;
const sendTo = (id: number, m: ServerMessage) => inbox.set(id, [...(inbox.get(id) ?? []), m]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  db = openDb(':memory:');
  inbox = new Map();
  a = guest(db, 'Ana').user;
  b = guest(db, 'Ben').user;
});
afterEach(() => vi.useRealTimers());

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const game = (u: User) => last(u, 'game')!;

/** Stop one server (saving its tables) and start a new one that picks them up. */
function restart(old: Rooms): Rooms {
  old.stop();
  saveTables(db, old.snapshot(), Date.now());
  inbox = new Map();
  const next = new Rooms(sendTo, db);
  expect(next.restore(takeTables(db))).toBeGreaterThan(0);
  return next;
}

describe('saving tables', () => {
  it('a seeded generator carries on exactly where it left off; Maps and Sets come back', () => {
    const r = seededRng(42);
    r();
    r();
    const back = decode<{ r: () => number; m: Map<string, number>; s: Set<number> }>(encode({ r, m: new Map([['x', 1]]), s: new Set([3]) }));
    expect(back.r()).toBe(r());
    expect(back.m.get('x')).toBe(1);
    expect(back.s.has(3)).toBe(true);
    expect(() => encode({ f: () => 1 })).toThrow(/function/);
  });

  it('a turn-based game carries on after a restart, with the same secrets and turns', () => {
    let rooms = new Rooms(sendTo, db);
    rooms.handle(a, { type: 'create', gameId: 'lonely-number' });
    const code = room(a).code;
    rooms.handle(b, { type: 'join', code });
    rooms.handle(a, { type: 'addBot' });
    rooms.handle(a, { type: 'start' });
    const before = game(a).view as LonelyState;
    const hand = before.players.find((p) => p.id === 'you')!.hand;
    rooms.handle(a, { type: 'act', action: { type: 'pair', pair: [hand[0], hand[1]] } });

    rooms = restart(rooms);
    // nobody is connected until they say hello
    rooms.handle(a, { type: 'hello' } as ClientMessage);
    rooms.handle(b, { type: 'hello' } as ClientMessage);
    expect(room(a)).toMatchObject({ code, status: 'playing' });
    const after = game(a).view as LonelyState;
    expect(after.players.find((p) => p.id === 'you')!.hand).toEqual(hand);
    expect(after.pairs.you).toEqual([hand[0], hand[1]]); // Ana's move is still there
    expect(game(b).waiting).toBe(true);                   // Ben still has to pick
    // and the game plays on to the end
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 400) vi.advanceTimersByTime(TURN_MS + 10);
    expect(room(a).status).toBe('over');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'lonely-number'").get()).toEqual({ n: 1 });
  });

  it('a real-time game and a puzzle race come back too', () => {
    let rooms = new Rooms(sendTo, db);
    rooms.handle(a, { type: 'create', gameId: 'sand-bid' });
    rooms.handle(b, { type: 'join', code: room(a).code });
    rooms.handle(a, { type: 'addBot' });
    rooms.handle(a, { type: 'start' });
    const c = guest(db, 'Cy').user;
    rooms.handle(c, { type: 'create', gameId: 'magic-squares' });
    rooms.handle(c, { type: 'start' });

    rooms = restart(rooms);
    rooms.handle(a, { type: 'hello' } as ClientMessage);
    rooms.handle(c, { type: 'hello' } as ClientMessage);
    expect((game(a).view as SandView).game.round).toBe(1);
    expect(room(c).status).toBe('playing');
    expect(rooms.count()).toBe(2);
  });

  it('a lobby comes back, and a seat whose owner never returns is given up', () => {
    let rooms = new Rooms(sendTo, db);
    rooms.handle(a, { type: 'create', gameId: 'lonely-number' });
    rooms.handle(b, { type: 'join', code: room(a).code });
    rooms = restart(rooms);
    rooms.handle(a, { type: 'hello' } as ClientMessage);
    expect(room(a).seats.map((s) => [s.name, s.connected])).toEqual([['Ana', true], ['Ben', false]]);
    vi.advanceTimersByTime(60_000);
    expect(room(a).seats.map((s) => s.name)).toEqual(['Ana']);
  });

  it('every online game can be saved right after it starts', () => {
    const rooms = new Rooms(sendTo, db);
    const ids = Object.keys(ONLINE_GAMES);
    const users = ids.map((_, i) => guest(db, `P${i + 1}`).user);
    ids.forEach((id, i) => {
      const u = users[i];
      rooms.handle(u, { type: 'create', gameId: id });
      while (room(u).seats.length < Math.max(2, ONLINE_GAMES[id].minPlayers)) rooms.handle(u, { type: 'addBot' });
      rooms.handle(u, { type: 'start' });
      expect(room(u).status, id).toBe('playing');
    });
    const saved = rooms.snapshot();
    expect(saved.map((s) => decode<{ gameId: string }>(s.data).gameId).sort()).toEqual([...ids].sort());
  });
});
