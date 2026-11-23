import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATHER_MS, LATENCY_ALLOWANCE, View } from '../src/games/sand-bid/online';
import { COUNTDOWN_MS } from '../src/games/sand-bid/round';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

let db: Db;
let inbox: Map<number, ServerMessage[]>;
let rooms: Rooms;
let a: User;
let b: User;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
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
const view = (u: User) => last(u, 'game')!.view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });

/** Ana, Ben and one bot at a Sand Bid table, game started. */
function started() {
  say(a, { type: 'create', gameId: 'sand-bid' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('Sand Bid online', () => {
  it('everyone presses, the countdown runs, holds are timed by the server', () => {
    started();
    expect(view(a).stage).toBe('gathering');
    expect(view(a).notReady).toBe(2); // the bot pressed straight away
    act(a, { type: 'press' });
    expect(view(b).notReady).toBe(1);
    act(b, { type: 'press' });
    expect(view(a).stage).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(view(a).stage).toBe('running');

    // Ana lets go after 2 s and says so: accepted as is
    vi.advanceTimersByTime(2000);
    act(a, { type: 'release', heldMs: 2000 });
    expect(view(a).me).toEqual({ status: 'released', bid: 2000 });
    // Ben claims far less than the server measured: only the latency allowance is forgiven
    vi.advanceTimersByTime(2000);
    act(b, { type: 'release', heldMs: 100 });
    expect(view(b).me!.bid).toBe(4000 - LATENCY_ALLOWANCE);
    // a claim longer than the real hold is cut to what the server saw
  });

  it('a claimed hold can never be longer than the real one', () => {
    started();
    act(a, { type: 'press' });
    act(b, { type: 'press' });
    vi.advanceTimersByTime(COUNTDOWN_MS + 1000);
    act(a, { type: 'release', heldMs: 60_000 });
    expect(view(a).me!.bid).toBe(1000);
  });

  it('rival banks and holds stay secret until the end; the clock is public', () => {
    started();
    act(a, { type: 'press' });
    act(b, { type: 'press' });
    vi.advanceTimersByTime(COUNTDOWN_MS + 500);
    act(a, { type: 'release', heldMs: 500 });
    act(b, { type: 'release' });
    // run until the bot lets go and the round resolves
    for (let i = 0; i < 200 && view(a).game.phase === 'bidding'; i++) vi.advanceTimersByTime(1000);
    const v = view(a);
    expect(v.game.phase).toBe('result');
    const ben = v.game.players.find((p) => p.name === 'Ben')!;
    expect(ben.bankMs).toBe(-1);
    expect(v.game.players.find((p) => p.id === 'you')!.bankMs).toBe(180_000 - 500);
    const r = v.game.history[0];
    expect(r.bids.you).toBe(500);
    if (r.winner !== ben.id) expect(r.bids[ben.id]).toBe(-1);
    expect(v.clocks[0]).toBeGreaterThanOrEqual(500);
  });

  it('whoever never presses sits the round out', () => {
    started();
    act(a, { type: 'press' });
    vi.advanceTimersByTime(GATHER_MS);
    expect(view(b).me!.status).toBe('out');
    expect(['countdown', 'running', 'over']).toContain(view(a).stage);
  });

  it('losing connection while holding lets go', () => {
    started();
    act(a, { type: 'press' });
    act(b, { type: 'press' });
    vi.advanceTimersByTime(COUNTDOWN_MS + 3000);
    rooms.disconnected(b.id);
    say(b, { type: 'hello' });
    expect(view(b).me!.status).toBe('released');
    expect(view(b).me!.bid).toBe(3000);
  });

  it('a whole match plays out, with a seat handed to a bot, and is recorded', () => {
    started();
    say(b, { type: 'leave' });
    expect(room(a).seats.map((s) => s.name)).toContain('Ben (bot)');
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 2000) {
      const v = view(a);
      if (v.game.phase === 'bidding' && v.stage === 'gathering' && v.me?.status === 'waiting') act(a, { type: 'press' });
      else if (v.stage === 'running' && v.me?.status === 'holding') act(a, { type: 'release' });
      vi.advanceTimersByTime(500);
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    // once it's over, every bank is shown
    expect(view(a).game.players.every((p) => p.bankMs >= 0)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'sand-bid'").get()).toEqual({ n: 1 });
  });
});
