import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/dice-tower/logic';
import { RESULT_MS } from '../src/games/dice-tower/online';
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

function started() {
  say(a, { type: 'create', gameId: 'dice-tower' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Let bots move until a person has to act (or the round ends). */
const settle = () => vi.advanceTimersByTime(BOT_MAX_MS * 3);

/** Play my move whenever it's my turn: take the first free die, bet 0. */
function playFor(u: User) {
  if (!game(u).waiting) return false;
  const v = view(u);
  if (v.phase === 'draft') act(u, { type: 'draft', die: v.pool.find((d) => !d.takenBy)!.id });
  else if (v.phase === 'predict') act(u, { type: 'bet', value: 0 });
  return true;
}

describe('Dice Tower online', () => {
  it('rival secret dice and bets stay hidden until the reveal', () => {
    started();
    const v = view(a);
    const me = v.players.find((p) => p.id === 'you')!;
    expect(me.secret).toBeGreaterThan(0);
    expect(v.players.filter((p) => p.id !== 'you').every((p) => p.secret === 0)).toBe(true);
    // draft through to the bets
    for (let i = 0; i < 50 && view(a).phase === 'draft'; i++) {
      for (const u of [a, b]) if (view(u).phase === 'draft') playFor(u);
      settle();
    }
    expect(view(a).phase).toBe('predict');
    act(b, { type: 'bet', value: 3 });
    expect(view(a).players.find((p) => p.name === 'Ben')!.prediction).toBe(-1);
    expect(view(b).players.find((p) => p.id === 'you')!.prediction).toBe(3);
    expect(() => act(b, { type: 'bet', value: 6 })).not.toThrow(); // sent as an error message, not a crash
    expect(last(b, 'error')!.message).toMatch(/Not your move/);
    act(a, { type: 'bet', value: 0 });
    settle();
    const r = view(a);
    expect(r.phase).toBe('result');
    expect(r.players.every((p) => p.secret > 0)).toBe(true);
    expect(r.history[0].predictions.you).toBe(0);
  });

  it('only the player whose pick it is may draft', () => {
    started();
    settle();
    const waiting = game(a).waiting ? a : b;
    const other = waiting === a ? b : a;
    act(other, { type: 'draft', die: 0 });
    expect(last(other, 'error')!.message).toMatch(/Not your move/);
  });

  it('a whole match plays out and is recorded', () => {
    started();
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 500) {
      playFor(a);
      playFor(b);
      if (view(a).phase === 'result') vi.advanceTimersByTime(RESULT_MS);
      else settle();
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(view(a).history).toHaveLength(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'dice-tower'").get()).toEqual({ n: 1 });
  });
});
