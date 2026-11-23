import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/blind-bingo/logic';
import { RESULT_MS, SECRET } from '../src/games/blind-bingo/online';
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
const settle = () => vi.advanceTimersByTime(BOT_MAX_MS * 2);
const me = (u: User) => view(u).players.find((p) => p.id === 'you')!;
const ben = (u: User) => view(u).players.find((p) => p.name === 'Ben')!;

function started() {
  say(a, { type: 'create', gameId: 'blind-bingo' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('Blind Bingo online', () => {
  it('cards, coins, choices and bids stay hidden; choices show once everyone has chosen', () => {
    started();
    expect(me(a).card).toHaveLength(9);
    expect(me(a).coins).toHaveLength(10);
    expect(ben(a).card).toEqual([]);
    expect(ben(a).coins).toEqual([]);
    act(b, { type: 'choose', shape: 'star' });
    expect(ben(a).choice).toBe(SECRET);
    expect(me(b).choice).toBe('star');
    act(a, { type: 'choose', shape: 'star' });
    settle();
    expect(view(a).phase).toBe('bid');
    expect(ben(a).choice).toBe('star');
    act(b, { type: 'bid', coins: [10, 5, 3] }); // 18: more than a bot ever bids before the last round
    expect(ben(a).bid).toEqual([]); // "bid placed", amount hidden
    act(a, { type: 'bid', coins: [1] });
    settle();
    const v = view(a);
    expect(v.phase).toBe('result');
    const r = v.history[0];
    expect(r.results.star.amount).toBe(18);
    expect(r.results.star.winners).toEqual([SECRET]); // Ana can't see that Ben won
    expect(r.bids).toEqual({ you: 1 });
    expect(Object.keys(r.gained)).toEqual(['you']);
    expect(view(b).history[0].results.star.winners).toEqual(['you']); // Ben knows he won
    expect(me(b).coins.reduce((x, y) => x + y, 0)).toBe(12);
  });

  it('refuses coins you do not have and empty bids', () => {
    started();
    act(a, { type: 'choose', shape: 'circle' });
    act(b, { type: 'choose', shape: 'circle' });
    settle();
    act(a, { type: 'bid', coins: [10, 10] });
    expect(last(a, 'error')!.message).toMatch(/coins/);
    act(a, { type: 'bid', coins: [] });
    expect(last(a, 'error')!.message).toMatch(/at least one/);
    act(a, { type: 'choose', shape: 'hexagon' });
    expect(view(a).phase).toBe('bid');
  });

  it('a whole match plays out, everything is revealed at the end, and it is recorded', () => {
    started();
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 500) {
      for (const u of [a, b]) {
        if (!game(u).waiting) continue;
        const v = view(u);
        if (v.phase === 'choose') act(u, { type: 'choose', shape: 'triangle' });
        else if (v.phase === 'bid') act(u, { type: 'bid', coins: me(u).coins.slice(0, 1) });
      }
      if (view(a).phase === 'result') vi.advanceTimersByTime(RESULT_MS);
      else settle();
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    const v = view(a);
    expect(v.history).toHaveLength(7);
    expect(ben(a).card).toHaveLength(9);
    expect(v.history.every((r) => Object.keys(r.bids).length === 3)).toBe(true);
    expect(v.history.flatMap((r) => r.results.triangle.winners)).not.toContain(SECRET);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'blind-bingo'").get()).toEqual({ n: 1 });
  });
});
