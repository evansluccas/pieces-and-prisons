/** Six Chambers online: a memory game, so the view sends only what the solo screen shows that seat right now. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/six-chambers/logic';
import { OnlineState, RESULT_MS, TURN_MS } from '../src/games/six-chambers/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { BOT_MAX_MS, ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

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
const move = (u: User, kind: string, seat?: number) => act(u, { type: 'move', kind, seat });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);
/** Every game view this person was sent. */
const views = (u: User) => (inbox.get(u.id) ?? []).filter((m) => m.type === 'game').map((m) => (m as { view: GameState }).view);
/** The server's real state (tests only). */
const real = () => (rooms as unknown as { rooms: Map<string, { state: OnlineState }> }).rooms.get(room(a).code)!.state.game;

function started() {
  say(a, { type: 'create', gameId: 'six-chambers' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

function playOut() {
  let guard = 0;
  while (room(a).status === 'playing' && guard++ < 2000) {
    vi.advanceTimersByTime(game(a).pauseUntil ? RESULT_MS : game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
  }
  expect(room(a).status).toBe('over');
  expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('six-chambers')).toEqual({ n: 1 });
  return room(a).results!;
}

describe('Six Chambers online', () => {
  it('the chambers are never sent while the round is on', () => {
    started();
    const v = view(a);
    expect(real().chambers.filter(Boolean)).toHaveLength(2);
    expect(v.chambers).toEqual([]);
    expect(v.events).toEqual([]);
    expect(v.turn).toBe('you');
    expect(v.players.map((p) => p.name)).toEqual(['You', 'Ben', expect.any(String)]);
    expect(view(b).players[1]).toMatchObject({ id: 'you', name: 'You' });
    for (const u of [a, b]) expect(sent(u)).not.toMatch(/"chambers":\[(true|false)/);
  });

  it('only the player to move may act, and only with legal moves', () => {
    started();
    move(b, 'peekPublic', 0);
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'shoot' });
    expect(error(a)).toMatch(/isn’t part/);
    move(a, 'nuke', 0);
    expect(error(a)).toMatch(/No such action/);
    move(a, 'peekPublic', 6);
    expect(error(a)).toMatch(/neighbouring/);
    act(a, { type: 'move', kind: 'swap', seat: '1' });
    expect(error(a)).toMatch(/neighbouring/);
    move(a, 'peekPublic', 1.5);
    expect(error(a)).toMatch(/neighbouring/);
    expect(real().events).toEqual([]);
    move(a, 'spin1');
    expect(real().players[0].credits).toBe(13);
    expect(view(b).turn).toBe('you');
    expect(view(a).turn).not.toBe('you');
    // run Ana dry to check credit limits: she can't pay a 6 with 1 left
    const g = real();
    (g.players[0] as { credits: number }).credits = 1;
    move(b, 'spin2');
    vi.advanceTimersByTime(BOT_MAX_MS);
    expect(view(a).turn).toBe('you');
    move(a, 'swap', 0);
    expect(error(a)).toMatch(/Not enough credits/);
  });

  it('a private peek reaches only the peeker, and only until the next move', () => {
    started();
    move(a, 'peekPrivate', 0);
    const truth = real().events[0].result!;
    expect(view(a).events).toEqual([{ player: 'you', kind: 'peekPrivate', cost: 2, seat: 0, result: truth }]);
    const benSees = view(b).events;
    expect(benSees).toEqual([{ player: expect.any(String), kind: 'peekPrivate', cost: 2 }]);
    expect(sent(b)).not.toContain('"result"');
    // Ben moves: Ana's own result is no longer sent — she has to remember it
    move(b, 'spin1');
    expect(JSON.stringify(view(a))).not.toContain('"result"');
    expect(view(a).events).toEqual([{ player: expect.any(String), kind: 'spin1', cost: 3 }]);
  });

  it('a secret swap shows others only that a 6-credit move was made', () => {
    started();
    move(a, 'swap', 2);
    expect(view(a).events[0]).toEqual({ player: 'you', kind: 'swap', cost: 6, seat: 2 });
    expect(view(b).events[0]).toEqual({ player: expect.any(String), kind: 'swap', cost: 6 });
    // a public peek is everyone's
    move(b, 'peekPublic', 3);
    expect(view(a).events[0].result).toEqual(real().events[1].result);
  });

  it('chambers show only once the cylinder fires; the log opens only at the end, without others’ secrets', () => {
    started();
    move(a, 'peekPrivate', 0);
    move(b, 'swap', 4);
    let guard = 0;
    while (real().phase === 'turns' && guard++ < 200) {
      if (game(a).waiting) move(a, 'peekPublic', 1);
      else if (game(b).waiting) move(b, 'peekPublic', 1);
      else vi.advanceTimersByTime(BOT_MAX_MS);
    }
    expect(real().phase).toBe('fired');
    const fired = view(a);
    expect(game(a).pauseUntil).not.toBeNull();
    expect(fired.history[0].chambers).toEqual(real().history[0].chambers);
    expect(fired.history[0].events).toEqual([]);
    expect(fired.events).toEqual([]);
    // no view sent during the turns carried chambers or the round log
    for (const u of [a, b]) {
      for (const v of views(u)) {
        expect(v.chambers).toEqual([]);
        expect(v.events.length).toBeLessThanOrEqual(1);
        for (const h of v.history) expect(h.events).toEqual([]);
      }
    }
    // Ready from both people skips the pause
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    expect(view(a).round).toBe(2);
    playOut();
    const endA = view(a);
    const endB = view(b);
    expect(endA.phase).toBe('gameOver');
    expect(endA.history).toHaveLength(3);
    const peekA = endA.history[0].events[0];
    const peekB = endB.history[0].events[0];
    expect(peekA).toMatchObject({ player: 'you', kind: 'peekPrivate', seat: 0 });
    expect(peekA.result).toBeDefined();
    expect(peekB).toEqual({ player: expect.any(String), kind: 'peekPrivate', cost: 2 });
    expect(endA.history[0].events[1]).toEqual({ player: expect.any(String), kind: 'swap', cost: 6 });
    expect(endB.history[0].events[1]).toEqual({ player: 'you', kind: 'swap', cost: 6, seat: 4 });
  });

  it('a whole match plays out and is recorded', () => {
    started();
    const res = playOut();
    expect(res.map((x) => x.place)).toEqual([1, 2, 3]);
    expect(res[0].detail).toMatch(/points?, \d+ credits saved/);
  });
});
