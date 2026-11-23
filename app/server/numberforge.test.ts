import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluate, solve, winningOrder } from '../src/games/number-forge/logic';
import { RESULT_MS, View } from '../src/games/number-forge/online';
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
const game = (u: User) => last(u, 'game')!;
const view = (u: User) => game(u).view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
const points = (u: User) => view(u).game.players.find((p) => p.id === 'you')!.points;

/** Ana, Ben and `bots` bots at a Number Forge table, game started. */
function started(bots = 0) {
  say(a, { type: 'create', gameId: 'number-forge' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Every answer to this round, in a winning order (worked out from the public tiles). */
function answers(u: User) {
  const g = view(u).game;
  return solve(g.tiles, g.target).map((set) => winningOrder(g.tiles, set, g.target));
}

function wrongOrder(u: User) {
  const g = view(u).game;
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) for (let z = 0; z < 10; z++) {
    if (new Set([x, y, z]).size === 3 && evaluate(g.tiles, [x, y, z]) !== g.target) return [x, y, z];
  }
  throw new Error('no wrong order');
}

describe('Number Forge online', () => {
  it('the server’s arrival order decides who claims a combination', () => {
    started();
    const [first, second] = answers(a);
    // both forge the same tiles in the same millisecond: whoever reaches the server first claims it
    act(a, { type: 'forge', order: first });
    act(b, { type: 'forge', order: first });
    expect(points(a)).toBe(1);
    expect(points(b)).toBe(-1);
    const claims = view(a).game.claims;
    expect(claims[1]).toMatchObject({ kind: 'forge', ok: false, repeat: true });
    expect(claims[1].player).not.toBe('you');
    // this time Ben is first
    act(b, { type: 'forge', order: second });
    act(a, { type: 'forge', order: second });
    expect(points(a)).toBe(0);
    expect(points(b)).toBe(0);
  });

  it('wrong and already-claimed forges cost a point', () => {
    started();
    act(a, { type: 'forge', order: wrongOrder(a) });
    expect(points(a)).toBe(-1);
    const [x] = answers(a);
    act(a, { type: 'forge', order: x });
    act(a, { type: 'forge', order: x }); // the same forge again
    expect(points(a)).toBe(-1);
    expect(view(a).game.claims.at(-1)).toMatchObject({ player: 'you', ok: false, repeat: true });
  });

  it('closing the forge: too early costs 1, after every answer scores 3 and ends the round', () => {
    started();
    act(b, { type: 'close' });
    expect(view(b).game.players.find((p) => p.id === 'you')!.points).toBe(-1);
    expect(view(a).game.phase).toBe('play');
    const all = answers(a);
    for (const o of all) act(a, { type: 'forge', order: o });
    act(a, { type: 'close' });
    expect(points(a)).toBe(all.length + 3);
    expect(view(a).game.phase).toBe('result');
    expect(view(a).game.history[0].end).toBe('closed');
    expect(game(a).pauseUntil).toBe(Date.now() + RESULT_MS);
    // no forging during the pause
    act(a, { type: 'forge', order: all[0] });
    expect(error(a)).toBeTruthy();
  });

  it('the 60 s cap ends a round on its own; Ready starts the next one', () => {
    started();
    expect(view(a).left).toBe(60_000);
    vi.advanceTimersByTime(20_000);
    act(a, { type: 'forge', order: answers(a)[0] });
    expect(view(a).left).toBe(40_000);
    expect(view(a).game.claims[0].at).toBe(20_000);
    vi.advanceTimersByTime(40_000);
    expect(view(a).game.phase).toBe('result');
    expect(view(a).game.history[0].end).toBe('time');
    expect(view(a).left).toBeNull();
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    expect(view(a).game.round).toBe(2);
    expect(view(a).game.phase).toBe('play');
    expect(view(a).left).toBe(60_000);
  });

  it('a forge that arrives after the cap is refused', () => {
    started();
    const [x] = answers(a);
    vi.setSystemTime(Date.now() + 60_000); // the clock passes 60 s before the timer fires
    act(a, { type: 'forge', order: x });
    expect(error(a)).toMatch(/round is over/i);
  });

  it('bad moves get friendly errors', () => {
    started();
    act(a, { type: 'forge', order: [0, 0, 1] });
    expect(error(a)).toMatch(/three different tiles/i);
    act(a, { type: 'forge', order: [0, 1, 10] });
    expect(error(a)).toMatch(/three different tiles/i);
    act(a, { type: 'forge', order: [0, 1] });
    expect(error(a)).toMatch(/three different tiles/i);
    act(a, { type: 'forge', order: ['A', 'B', 'C'] });
    expect(error(a)).toMatch(/three different tiles/i);
    act(a, { type: 'dance' });
    expect(error(a)).toMatch(/isn’t part of this game/);
    expect(points(a)).toBe(0);
    expect(view(a).game.claims).toEqual([]);
  });

  it('views rename you, hide the answers until the round ends, and send the time left', () => {
    started();
    const v = view(a);
    expect(v.game.players.map((p) => p.name)).toEqual(['You', 'Ben']);
    expect(v.game.answers).toEqual([]);
    const [x] = answers(b);
    act(b, { type: 'forge', order: x });
    expect(view(b).game.claims[0].player).toBe('you');
    expect(view(a).game.claims[0].player).not.toBe('you');
    expect(view(a).game.found).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(view(a).game.answers.length).toBeGreaterThan(0);
    expect(view(a).game.history[0].claims[0].player).not.toBe('you');
    expect(view(b).game.history[0].claims[0].player).toBe('you');
  });

  it('bots forge on their own', () => {
    started(2);
    let guard = 0;
    const bots = view(a).game.players.filter((p) => p.isBot).map((p) => p.id);
    const botClaims = () => [...view(a).game.history.flatMap((r) => r.claims), ...view(a).game.claims].filter((c) => bots.includes(c.player));
    while (!botClaims().length && guard++ < 400) {
      vi.advanceTimersByTime(500);
      if (game(a).pauseUntil) vi.advanceTimersByTime(RESULT_MS);
    }
    expect(botClaims().length).toBeGreaterThan(0);
    // a bot's forge lands inside the round
    for (const c of botClaims()) expect(c.at).toBeLessThan(60_000);
  });

  it('a disconnected player doesn’t stall the round or the pause', () => {
    started();
    rooms.disconnected(b.id);
    vi.advanceTimersByTime(60_000);
    expect(view(a).game.phase).toBe('result');
    say(a, { type: 'ready' }); // Ben isn't connected, so Ana's Ready is enough
    expect(view(a).game.round).toBe(2);
    vi.advanceTimersByTime(60_000 + RESULT_MS);
    expect(view(a).game.round).toBe(3);
  });

  it('a whole match plays out, with a seat handed to a bot, and is recorded', () => {
    started(1);
    say(b, { type: 'leave' });
    expect(room(a).seats.map((s) => s.name)).toContain('Ben (bot)');
    const benId = view(a).game.players.find((p) => p.name === 'Ben')!.id;
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 5000) {
      const v = view(a);
      if (v.game.phase === 'play' && guard % 20 === 0) {
        const open = answers(a).find((o) => !v.game.found.some((f) => f.join() === [...o].sort((x, y) => x - y).join()));
        if (open) act(a, { type: 'forge', order: open });
      }
      vi.advanceTimersByTime(game(a).pauseUntil ? RESULT_MS : 500);
    }
    expect(room(a).status).toBe('over');
    const v = view(a);
    expect(v.game.phase).toBe('gameOver');
    expect(v.game.history).toHaveLength(6);
    expect(v.game.history.some((r) => r.claims.some((c) => c.player === benId))).toBe(true);
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'number-forge'").get()).toEqual({ n: 1 });
  });
});
