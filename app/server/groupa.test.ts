/** Group A online games: Tipping Scales and Rumor Exchange (simultaneous secret choices). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { View as ScalesView } from '../src/games/tipping-scales/online';
import { RESULT_MS } from '../src/games/tipping-scales/online';
import type { GameState as RumorState } from '../src/games/rumor-exchange/logic';
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
const view = <V>(u: User) => game(u).view as V;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;

function started(gameId: string, bots = 0) {
  say(a, { type: 'create', gameId });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

function playOut(gameId: string, pauseMs = 0) {
  let guard = 0;
  while (room(a).status === 'playing' && guard++ < 600) {
    vi.advanceTimersByTime(game(a).pauseUntil ? pauseMs : game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
  }
  expect(room(a).status).toBe('over');
  expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get(gameId)).toEqual({ n: 1 });
  return room(a).results!;
}

describe('Tipping Scales online', () => {
  it('plays stay secret until everyone has played; then the round resolves for all', () => {
    started('tipping-scales', 1);
    vi.advanceTimersByTime(BOT_MAX_MS); // the bot plays
    expect(view<ScalesView>(a).chosen).toHaveLength(1);
    expect(Object.keys(view<ScalesView>(a).game.plays)).toEqual([]); // the bot's play is hidden
    act(b, { type: 'play', card: 6, chip: 'ruby', scale: 'ruby' });
    expect(view<ScalesView>(b).game.plays.you).toEqual({ card: 6, chip: 'ruby', scale: 'ruby' });
    expect(Object.keys(view<ScalesView>(a).game.plays)).toEqual([]);
    expect(view<ScalesView>(a).chosen).toHaveLength(2);
    expect(view<ScalesView>(b).chosen).toContain('you');
    act(b, { type: 'play', card: 5, chip: 'ruby', scale: 'ruby' });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'play', card: 3, chip: 'rainbow', scale: 'emerald' });
    const v = view<ScalesView>(a);
    expect(v.game.phase).toBe('result');
    expect(v.game.history[0].plays.you).toEqual({ card: 3, chip: 'rainbow', scale: 'emerald' });
    // rainbow plays place first
    const h = v.game.history[0];
    expect(h.plays[h.order[0]].chip).toBe('rainbow');
    expect(h.order.indexOf('you')).toBeLessThan(h.order.findIndex((id) => h.plays[id].chip !== 'rainbow'));
    expect(v.game.players.find((p) => p.name === 'Ben')!.cards).not.toContain(6);
  });

  it('refuses plays you can’t make', () => {
    started('tipping-scales', 1);
    act(a, { type: 'play', card: 9, chip: 'ruby', scale: 'ruby' });
    expect(error(a)).toMatch(/illegal/);
    act(a, { type: 'play', card: 2, chip: 'ruby', scale: 'emerald' });
    expect(error(a)).toMatch(/illegal/);
    act(a, { type: 'play', card: 2, chip: 'gold', scale: 'ruby' });
    expect(error(a)).toMatch(/isn’t part/);
  });

  it('a whole match plays out and is recorded', () => {
    started('tipping-scales', 1);
    expect(playOut('tipping-scales', RESULT_MS).map((r) => r.place)).toEqual([1, 2, 3]);
  });
});

describe('Rumor Exchange online', () => {
  it('rules, rivals and rumors stay hidden; a rumor shows only to its buyer and keeps the clock', () => {
    started('rumor-exchange');
    const v = view<RumorState>(a);
    expect(v.rules.every((r) => r === null)).toBe(true);
    expect(v.publishOrder).toEqual([]);
    const deadline = game(a).deadline;
    vi.advanceTimersByTime(5000);
    act(a, { type: 'rumor', company: 2 });
    expect(error(a)).toBeUndefined();
    expect(game(a).deadline).toBe(deadline); // buying a rumor doesn't restart the clock
    expect(view<RumorState>(a).rules[2]).not.toBeNull();
    expect(view<RumorState>(a).players.find((p) => p.id === 'you')!.cash).toBe(94_000);
    expect(view<RumorState>(b).rules[2]).toBeNull();
    expect(view<RumorState>(b).players.find((p) => p.name === 'Ana')).toMatchObject({ cash: 0, rumors: [] });
    act(a, { type: 'orders', orders: { 0: 3 } });
    expect(view<RumorState>(b).players.find((p) => p.name === 'Ana')!.orders).toEqual({}); // placed, contents hidden
    act(b, { type: 'orders', orders: { 1: 2 } });
    const after = view<RumorState>(b);
    expect(after.round).toBe(2);
    expect(after.records[0].orders).toEqual({ you: { 1: 2 } });
    expect(after.records[0].rumors).toEqual({});
    expect(view<RumorState>(a).records[0].rumors).toEqual({ you: [2] });
    expect(view<RumorState>(a).players.find((p) => p.id === 'you')!.shares[0]).toBe(3);
  });

  it('refuses orders you can’t afford or shares you don’t own', () => {
    started('rumor-exchange');
    act(a, { type: 'orders', orders: { 0: 50 } });
    expect(error(a)).toMatch(/afford/);
    act(a, { type: 'orders', orders: { 0: -1 } });
    expect(error(a)).toMatch(/afford|own/);
    act(a, { type: 'orders', orders: { 9: 1 } });
    expect(error(a)).toMatch(/company/);
  });

  it('a whole match plays out; everything is revealed at the end', () => {
    started('rumor-exchange', 1);
    expect(playOut('rumor-exchange').map((r) => r.place)).toEqual([1, 2, 3]);
    const v = view<RumorState>(a);
    expect(v.rules.every((r) => r !== null)).toBe(true);
    expect(v.players.find((p) => p.name === 'Ben')!.cash).toBeGreaterThan(0);
  });
});
