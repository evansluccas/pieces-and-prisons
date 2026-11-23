/** Piggy Bluff online: a memory game, so coin colours, rival choices and the claim log must never reach a player early. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, View, act as gameAct, start, view as gameView } from '../src/games/piggy-bluff/online';
import { add } from '../src/games/piggy-bluff/logic';
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
const view = (u: User) => game(u).view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);
/** Any coin count other than zero — the bank and coin colours are never sent before a reveal. */
const COINS = /"(black|white)":[1-9]/;
const idOf = (u: User, name: string) => view(u).game.players.find((p) => p.name === name)!.id;

function started(bots = 1) {
  say(a, { type: 'create', gameId: 'piggy-bluff' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('Piggy Bluff online', () => {
  it('coin colours and the bank are never sent — not even to the player who dropped them', () => {
    started();
    expect(view(a).game.holder).toBe('you');
    expect(view(b).game.holder).toBe(idOf(b, 'Ana'));
    act(a, { type: 'add', black: 2, white: 1, to: idOf(a, 'Ben') });
    for (const u of [a, b]) {
      const v = view(u);
      expect(v.game.bank).toEqual({ black: 0, white: 0 });
      expect(v.game.additions).toEqual([]);
      expect(v.drop!.count).toBe(3);
      expect(sent(u)).not.toMatch(COINS);
    }
    expect(view(a).drop!.player).toBe('you');
    expect(view(b).game.receiver).toBe('you');
    act(b, { type: 'claim', count: 3 });
    expect(view(a).game.phase).toBe('doubt');
    for (const u of [a, b]) expect(sent(u)).not.toMatch(COINS);
  });

  it('only the player asked may move, and bad moves are refused', () => {
    started();
    const ben = idOf(a, 'Ben');
    act(b, { type: 'add', black: 1, white: 0, to: idOf(b, 'Ana') });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'add', black: 4, white: 0, to: ben });
    expect(error(a)).toMatch(/Drop 1 to 3/);
    act(a, { type: 'add', black: 0, white: 0, to: ben });
    expect(error(a)).toMatch(/Drop 1 to 3/);
    act(a, { type: 'add', black: 1, white: 0, to: 'you' });
    expect(error(a)).toMatch(/another player/);
    act(a, { type: 'add', black: 1, white: 0, to: 'nobody' });
    expect(error(a)).toMatch(/another player/);
    act(a, { type: 'add', black: '1', white: 0, to: ben });
    expect(error(a)).toMatch(/each colour/);
    act(a, { type: 'claim', count: 2 });
    expect(error(a)).toMatch(/isn’t allowed|not your claim/i);
    act(a, { type: 'dance' });
    expect(error(a)).toMatch(/isn’t part of this game/);
    expect(view(a).game.phase).toBe('add');

    act(a, { type: 'add', black: 1, white: 0, to: ben });
    act(a, { type: 'claim', count: 2 });
    expect(error(a)).toMatch(/Not your move/);
    act(b, { type: 'claim', count: 1.5 });
    expect(error(b)).toMatch(/whole number/);
    act(b, { type: 'claim', count: 99 });
    expect(error(b)).toMatch(/impossible/);
    act(b, { type: 'claim', count: 2 });
    act(b, { type: 'respond', doubt: true });
    expect(error(b)).toMatch(/Not your move/); // the claimer doesn't doubt their own claim
    act(a, { type: 'respond', doubt: 'yes' });
    expect(error(a)).toMatch(/Doubt or believe/);
  });

  it('rival choices stay secret until the reveal; then the log is sealed again', () => {
    started();
    const ben = idOf(a, 'Ben');
    act(a, { type: 'add', black: 2, white: 1, to: ben }); // bank: 3 black, 2 white
    act(b, { type: 'claim', count: 2 }); // wrong
    act(a, { type: 'respond', doubt: true });
    expect(view(a).game.responses).toEqual({ you: true });
    expect(view(b).game.responses).toEqual({ [idOf(b, 'Ana')]: false }); // "decided", not which way
    act(a, { type: 'respond', doubt: false });
    expect(error(a)).toMatch(/Not your move/);
    expect(sent(b)).not.toMatch(/"responses":\{[^}]*true/);

    vi.advanceTimersByTime(BOT_MAX_MS); // the bot decides too
    const r = view(a).game;
    expect(r.phase).toBe('reveal');
    expect(game(a).pauseUntil).not.toBeNull();
    expect(r.responses).toEqual({});
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ claimer: ben, claim: 2, opened: true, correct: false, actual: { black: 3, white: 2 } });
    expect(r.history[0].doubters).toContain('you');
    expect(view(b).game.history[0].claimer).toBe('you');
    expect(view(b).game.players.find((p) => p.id === 'you')!.points).toBe(-1);

    // both people press Ready: the next turn starts and the log is sealed again
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    const next = view(a);
    expect(next.game.phase).toBe('add');
    expect(next.game.history).toEqual([]);
    expect(next.drop).toBeNull();
    expect(JSON.stringify(next)).not.toContain('actual');
    expect(next.game.players.every((p) => p.wrongClaims === 0)).toBe(true); // Ben's miss isn't tallied for you
  });

  it('past coins in an unopened bank stay hidden; a spectator sees no secrets either', () => {
    let s = start([{ id: 'p', name: 'P', isBot: false }, { id: 'q', name: 'Q', isBot: false }, { id: 'r', name: 'R', isBot: false }]);
    s = add(s, 'p', { black: 3, white: 0 }, 'q');
    s = gameAct(s, 'q', { type: 'claim', count: 4 });
    s = gameAct(s, 'p', { type: 'respond', doubt: false });
    s = gameAct(s, 'r', { type: 'respond', doubt: false }); // nobody doubted: the bank keeps its coins
    for (const v of ['p', 'q', 'r', null]) expect(JSON.stringify(gameView(s, v))).not.toMatch(COINS);
    expect(gameView(s, 'p').game.history[0]).toMatchObject({ opened: false, actual: null });
    expect(JSON.stringify(gameView(s, null))).not.toContain('"you"');
  });

  it('a whole match plays out and is recorded', () => {
    started();
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 2000) {
      vi.advanceTimersByTime(game(a).pauseUntil ? RESULT_MS : game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
    }
    expect(room(a).status).toBe('over');
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('piggy-bluff')).toEqual({ n: 1 });
    expect(room(a).results!.map((x) => x.place)).toEqual([1, 2, 3]);
    const end = view(a).game;
    expect(end.phase).toBe('gameOver');
    expect(end.history.length).toBe(end.claims); // the full log opens at the end
  });
});
