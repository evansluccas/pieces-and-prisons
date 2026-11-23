import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/lonely-number/logic';
import { RESULT_MS } from '../src/games/lonely-number/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { BOT_MAX_MS, ClientMessage, RoomView, Rooms, ServerMessage, TURN_MS } from './rooms';

let db: Db;
let inbox: Map<number, ServerMessage[]>;
let rooms: Rooms;
let users: User[];

beforeEach(() => {
  vi.useFakeTimers();
  db = openDb(':memory:');
  inbox = new Map();
  rooms = new Rooms((id, m) => inbox.set(id, [...(inbox.get(id) ?? []), m]), db);
  users = ['Ana', 'Ben', 'Cy'].map((n) => guest(db, n).user);
});
afterEach(() => vi.useRealTimers());

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const game = (u: User) => last(u, 'game')! as { view: GameState; waiting: boolean; pauseUntil: number | null };
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const error = (u: User) => last(u, 'error')?.message;

function table() {
  const [a, b] = users;
  say(a, { type: 'create', gameId: 'lonely-number' });
  const code = room(a).code;
  say(b, { type: 'join', code: code.toLowerCase() });
  return code;
}

describe('lobby', () => {
  it('creates a table with a code; others join; the host adds bots and starts', () => {
    const [a, b] = users;
    const code = table();
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(room(a).seats.map((s) => s.name)).toEqual(['Ana', 'Ben']);
    expect(room(b).host).toBe(false);
    say(b, { type: 'addBot' });
    expect(error(b)).toMatch(/host/);
    say(a, { type: 'start' });
    expect(error(a)).toMatch(/at least 3/);
    say(a, { type: 'addBot' });
    expect(room(b).seats.map((s) => [s.name, s.bot])).toEqual([['Ana', false], ['Ben', false], ['Hana', true]]);
    say(a, { type: 'start' });
    expect(room(a).status).toBe('playing');
    expect(game(b).waiting).toBe(true);
  });

  it('refuses unknown codes, unknown games and started tables', () => {
    const [a, , c] = users;
    say(c, { type: 'join', code: 'ZZZZ' });
    expect(error(c)).toMatch(/No table/);
    say(c, { type: 'create', gameId: 'not-a-game' });
    expect(error(c)).toMatch(/online/);
    table();
    say(a, { type: 'addBot' });
    say(a, { type: 'start' });
    say(c, { type: 'join', code: room(a).code });
    expect(error(c)).toMatch(/already started/);
  });

  it('a bot gives up its seat when a person joins a full table', () => {
    const [a, , c] = users;
    say(a, { type: 'create', gameId: 'lonely-number' });
    for (let i = 0; i < 5; i++) say(a, { type: 'addBot' });
    expect(room(a).seats).toHaveLength(6);
    say(c, { type: 'join', code: room(a).code });
    expect(room(c).seats.filter((s) => !s.bot).map((s) => s.name)).toEqual(['Ana', 'Cy']);
    expect(room(c).seats).toHaveLength(6);
  });

  it('leaving the lobby frees the seat and hands over the host', () => {
    const [a, b] = users;
    table();
    say(a, { type: 'leave' });
    expect(last(a, 'left')).toBeTruthy();
    expect(room(b).seats.map((s) => s.name)).toEqual(['Ben']);
    expect(room(b).host).toBe(true);
  });
});

describe('playing', () => {
  function started() {
    const [a, b] = users;
    table();
    say(a, { type: 'addBot' });
    say(a, { type: 'start' });
    return { a, b };
  }

  it('each player sees only their own pair until everyone has picked', () => {
    const { a, b } = started();
    say(a, { type: 'act', action: { type: 'pair', pair: [1, 2] } });
    // Ben sees Ana is ready, but not her cards; Ana sees her own
    const seenByB = game(b).view;
    const anaForB = seenByB.players.find((p) => p.name === 'Ana')!;
    expect(seenByB.pairs[anaForB.id]).toEqual([0, 0]);
    expect(game(a).view.pairs.you).toEqual([1, 2]);
    expect(anaForB.hand).toEqual([]); // other hands aren't sent
    expect(game(a).waiting).toBe(false);
    say(a, { type: 'act', action: { type: 'pair', pair: [3, 4] } });
    expect(error(a)).toMatch(/Not your move/);
  });

  it('a round: people pick and keep, the bot moves on its own, the result pauses, then the next round', () => {
    const { a, b } = started();
    say(a, { type: 'act', action: { type: 'pair', pair: [1, 2] } });
    say(b, { type: 'act', action: { type: 'pair', pair: [1, 3] } });
    vi.advanceTimersByTime(BOT_MAX_MS);
    expect(game(a).view.phase).toBe('keep');
    // pairs are now open to everyone
    expect(Object.values(game(b).view.pairs).every((p) => p[0] > 0)).toBe(true);
    say(a, { type: 'act', action: { type: 'keep', card: 1 } });
    // Ben can't see Ana's kept card yet
    expect(Object.keys(game(b).view.kept)).toEqual([]);
    say(b, { type: 'act', action: { type: 'keep', card: 3 } });
    vi.advanceTimersByTime(BOT_MAX_MS);
    expect(game(a).view.phase).toBe('result');
    expect(game(a).pauseUntil).not.toBeNull();
    // both ready → next round straight away
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    expect(game(a).view.round).toBe(2);
    expect(game(a).view.phase).toBe('pick');
  });

  it('when time runs out a bot moves for you', () => {
    const { a, b } = started();
    say(a, { type: 'act', action: { type: 'pair', pair: [1, 2] } });
    vi.advanceTimersByTime(TURN_MS + 10);
    expect(error(b)).toMatch(/Time ran out/);
    expect(game(b).view.phase).toBe('keep');
  });

  it('a pause ends by itself', () => {
    const { a, b } = started();
    say(a, { type: 'act', action: { type: 'pair', pair: [1, 2] } });
    say(b, { type: 'act', action: { type: 'pair', pair: [1, 3] } });
    vi.advanceTimersByTime(BOT_MAX_MS);
    say(a, { type: 'act', action: { type: 'keep', card: 1 } });
    say(b, { type: 'act', action: { type: 'keep', card: 3 } });
    vi.advanceTimersByTime(BOT_MAX_MS + RESULT_MS + 10);
    expect(game(a).view.round).toBe(2);
  });

  it('dropping out keeps your seat; leaving hands it to a bot', () => {
    const { a, b } = started();
    rooms.disconnected(b.id);
    expect(room(a).seats.find((s) => s.name === 'Ben')!.connected).toBe(false);
    say(b, { type: 'hello' });
    expect(room(a).seats.find((s) => s.name === 'Ben')!.connected).toBe(true);
    expect(game(b).view.players[1].name).toBe('You'); // back in the same seat
    say(b, { type: 'leave' });
    expect(room(a).seats.map((s) => [s.name, s.bot])).toContainEqual(['Ben (bot)', true]);
    // the game goes on without Ben
    say(a, { type: 'act', action: { type: 'pair', pair: [1, 2] } });
    vi.advanceTimersByTime(BOT_MAX_MS);
    expect(game(a).view.phase).toBe('keep');
  });

  it('plays to the end, records the result, and the host can set up again', () => {
    const { a, b } = started();
    rooms.disconnected(b.id); // Ben wanders off: time-outs play for him
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 400) {
      const g = game(a);
      if (g.waiting) {
        const me = g.view.players.find((p) => p.id === 'you')!;
        if (g.view.phase === 'pick') say(a, { type: 'act', action: { type: 'pair', pair: [me.hand[0], me.hand[1]] } });
        else say(a, { type: 'act', action: { type: 'keep', card: g.view.pairs.you[0] } });
      } else if (g.pauseUntil) say(a, { type: 'ready' });
      vi.advanceTimersByTime(TURN_MS + 10);
    }
    expect(room(a).status).toBe('over');
    const results = room(a).results!;
    expect(results.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM match_players').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT game_id FROM matches').get()).toEqual({ game_id: 'lonely-number' });
    say(a, { type: 'again' });
    expect(room(a).status).toBe('lobby');
  });
});
