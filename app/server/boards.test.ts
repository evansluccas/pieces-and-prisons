/** Group C online games: open boards (Turf War, Tri-Mancala) and the duels (Morris, Tigers & Goats). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState as TurfState, placements } from '../src/games/turf-war/logic';
import { GameState as MancalaState, SEG, pitsOf } from '../src/games/tri-mancala/logic';
import type { View as MorrisView } from '../src/games/nine-mens-morris/online';
import { BETWEEN_MS, View as TigersView } from '../src/games/tigers-and-goats/online';
import { legalMoves } from '../src/games/tigers-and-goats/logic';
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

/** Let time-outs and bots play the rest; returns once the table is over. */
function playOut(gameId: string) {
  let guard = 0;
  while (room(a).status === 'playing' && guard++ < 600) vi.advanceTimersByTime(game(a).waiting || game(b).waiting ? TURN_MS + 10 : Math.max(BOT_MAX_MS, game(a).pauseUntil ? BETWEEN_MS : 0));
  expect(room(a).status).toBe('over');
  expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get(gameId)).toEqual({ n: 1 });
  return room(a).results!;
}

describe('Turf War online', () => {
  it('each player sees themselves as player 0, and moves found in that view are legal', () => {
    started('turf-war', 1);
    const va = view<TurfState>(a);
    const vb = view<TurfState>(b);
    expect(va.players[0]).toMatchObject({ id: 'you', name: 'You' });
    expect(vb.players[0]).toMatchObject({ id: 'you', name: 'You' });
    expect(va.players[1].name).toBe('Ben');
    expect(vb.players.map((p) => p.name)).toEqual(['You', expect.any(String), 'Ana']);
    // Ana's start square is "0" for Ana and "2" for Ben (3 players)
    const anaStart = va.owner.findIndex((o) => o === 0);
    expect(vb.owner[anaStart]).toBe(2);
    expect(va.turn).toBe(0);
    expect(vb.turn).toBe(2);
    // a placement worked out from Ana's own view is accepted
    const p = placements(va, 0)[0];
    act(a, { type: 'piece', pick: p.pick, cells: p.cells });
    expect(error(a)).toBeUndefined();
    expect(view<TurfState>(b).owner[p.cells[0]]).toBe(2);
    expect(view<TurfState>(b).turn).toBe(0); // Ben is next
    act(a, { type: 'pass' });
    expect(error(a)).toMatch(/Not your move/);
  });

  it('a whole match plays out and is recorded', () => {
    started('turf-war');
    expect(playOut('turf-war').map((r) => r.place)).toEqual([1, 2]);
  });
});

describe('Tri-Mancala online', () => {
  it('the ring is turned for each player; pits chosen in your view are your real pits', () => {
    started('tri-mancala');
    const va = view<MancalaState>(a);
    expect(va.turn).toBe(0);
    // Ana sows her first pit, as she sees it
    act(a, { type: 'sow', pit: 0, order: va.slots[0] });
    const vb = view<MancalaState>(b);
    // Ben sees Ana's pits as the second segment of the ring, with her first pit empty
    expect(vb.slots[SEG]).toEqual([]);
    expect(view<MancalaState>(a).slots[0]).toEqual([]);
    if (vb.turn === 0) {
      const pit = pitsOf(0).find((p) => vb.slots[p].length)!;
      act(b, { type: 'sow', pit, order: vb.slots[pit] });
      expect(error(b)).toBeUndefined();
      expect(view<MancalaState>(a).slots[SEG + pit]).toEqual([]);
    }
    act(b, { type: 'sow', pit: SEG, order: [] });
    expect(error(b)).toBeTruthy(); // not his pit (or not his turn)
  });

  it('a whole match plays out and is recorded', () => {
    started('tri-mancala', 1);
    expect(playOut('tri-mancala').map((r) => r.place)).toEqual([1, 2, 3]);
  });
});

describe("Nine Men's Morris online", () => {
  it('the second player sees the sides swapped, with names', () => {
    started('nine-mens-morris');
    const va = view<MorrisView>(a);
    const vb = view<MorrisView>(b);
    expect(va.opponent).toBe('Ben');
    expect(vb.opponent).toBe('Ana');
    expect(va.game.turn).toBe(0);
    expect(vb.game.turn).toBe(1);
    act(b, { type: 'turn', from: null, to: 0, remove: null });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'turn', from: null, to: 0, remove: null });
    expect(view<MorrisView>(a).game.board[0]).toBe(0);
    expect(view<MorrisView>(b).game.board[0]).toBe(1); // Ana's man is "theirs" for Ben
    expect(view<MorrisView>(b).game.turn).toBe(0);
    act(b, { type: 'turn', from: null, to: 0, remove: null });
    expect(error(b)).toMatch(/illegal/);
  });

  it('a whole duel plays out and is recorded', () => {
    started('nine-mens-morris');
    const places = playOut('nine-mens-morris').map((r) => r.place).sort();
    expect([[1, 2], [1, 1]]).toContainEqual(places);
  });
});

describe('Tigers & Goats online', () => {
  it('two games with sides swapped, a pause between, then the match result', () => {
    started('tigers-and-goats');
    expect(view<TigersView>(a)).toMatchObject({ number: 0, mine: 'G', opponent: 'Ben' });
    expect(view<TigersView>(b)).toMatchObject({ number: 0, mine: 'T', opponent: 'Ana' });
    // Ana (goats) moves first; a legal goat placement is accepted
    const m = legalMoves(view<TigersView>(a).game)[0];
    act(a, { type: 'move', ...m });
    expect(error(a)).toBeUndefined();
    expect(game(b).waiting).toBe(true);
    // play game 1 out
    let guard = 0;
    while (view<TigersView>(a).number === 0 && !game(a).pauseUntil && guard++ < 300) vi.advanceTimersByTime(TURN_MS + 10);
    expect(game(a).pauseUntil).not.toBeNull();
    expect(view<TigersView>(a).results).toHaveLength(1);
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    expect(view<TigersView>(a)).toMatchObject({ number: 1, mine: 'T' });
    expect(view<TigersView>(b)).toMatchObject({ number: 1, mine: 'G' });
    const results = playOut('tigers-and-goats');
    expect(results).toHaveLength(2);
    expect(view<TigersView>(b).results.map((r) => r.youAs)).toEqual(['T', 'G']);
  });
});
