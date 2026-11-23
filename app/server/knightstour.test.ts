/** Knight's Tour as an online puzzle race: the server checks tours, times them and charges hints. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceView } from '../src/games/shared/race';
import { nextSquares, solve, stuck } from '../src/games/knights-tour/logic';
import { LIMIT_MS, View } from '../src/games/knights-tour/online';
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
const view = (u: User) => last(u, 'game')!.view as RaceView;
const board = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Forget old errors, so each check reads a fresh one. */
const clearErrors = () => { for (const [id, ms] of inbox) inbox.set(id, ms.filter((m) => m.type !== 'error')); };
/** The board size, read from the server's own state. */
const size = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: { n: number }[]; round: number } }> }).rooms;
  const s = [...r.values()][0].state;
  return s.puzzles[s.round].n;
};
const tour = (n = size()) => solve(n, [0])!;

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'knights-tour' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe("knight's tour race", () => {
  it('three boards, 6×6 first, with limits that grow with the board', () => {
    started();
    expect(view(a).rounds).toBe(3);
    expect(board(a)).toMatchObject({ n: 6, hints: 0, hint: null, tour: null });
    expect(view(a).leftMs).toBe(LIMIT_MS[6]);
    expect(LIMIT_MS[6] < LIMIT_MS[7] && LIMIT_MS[7] < LIMIT_MS[8]).toBe(true);
  });

  it('a valid tour is accepted and timed by the server', () => {
    started();
    vi.advanceTimersByTime(42_000);
    act(a, { type: 'submit', path: tour() });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 42_000, points: 1, detail: '' });
    expect(board(a).tour).toEqual(tour());
    // Ben sees Ana's time, not her tour
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(42_000);
    expect(board(b).tour).toBeNull();
    act(a, { type: 'submit', path: tour() });
    expect(error(a)).toMatch(/finished/);
  });

  it('refuses bad tours and malformed data, without stopping the clock', () => {
    started();
    const t = tour();
    const bad: [unknown, RegExp][] = [
      [{ type: 'submit', path: t.slice(0, -1) }, /1 square still unvisited/],
      [{ type: 'submit', path: [...t.slice(0, -1), t[t.length - 2]] }, /twice/],
      [{ type: 'submit', path: [t[0], t[2], ...t.slice(1)].slice(0, 36) }, /isn’t a knight move/],
      [{ type: 'submit', path: [...t, t[0]] }, /longer than the board/],
      [{ type: 'submit', path: [...t.slice(0, -1), 36] }, /off the board/],
      [{ type: 'submit', path: [...t.slice(0, -1), 1.5] }, /off the board/],
      [{ type: 'submit', path: [...t.slice(0, -1), '5'] }, /off the board/],
      [{ type: 'submit', path: [...t.slice(0, -1), -1] }, /off the board/],
      [{ type: 'submit', path: 'a1 b3' }, /list of squares/],
      [{ type: 'submit' }, /list of squares/],
      [{ type: 'teleport', path: t }, /Unknown move/],
      [null, /Unknown move/],
      ['submit', /Unknown move/],
    ];
    for (const [action, msg] of bad) {
      clearErrors();
      act(a, action);
      expect(error(a), JSON.stringify(action)).toMatch(msg);
    }
    expect(view(b).board.find((r) => r.name === 'Ana')!.round).toBeNull();
  });

  it('7×7 must start on a corner-coloured square', () => {
    started();
    act(a, { type: 'submit', path: tour() });
    act(b, { type: 'submit', path: tour() });
    vi.advanceTimersByTime(RESULT_MS);
    expect(board(a).n).toBe(7);
    // a path from b7 (square 1, the other colour): legal jumps, wrong start
    clearErrors();
    act(a, { type: 'submit', path: [1, 12, 5] });
    expect(error(a)).toMatch(/coloured like the corners/);
    clearErrors();
    act(a, { type: 'hint', path: [1] });
    expect(error(a)).toMatch(/coloured like the corners/);
    act(a, { type: 'submit', path: tour(7) });
    expect(view(a).me!.result!.finished).toBe(true);
  });

  it('a hint costs 30 s and reaches only the asker', () => {
    started();
    vi.advanceTimersByTime(10_000);
    act(a, { type: 'hint', path: [0] });
    const h = board(a).hint!;
    expect(h.path).toEqual([0]);
    expect(h.h.kind).toBe('move');
    expect(board(a).hints).toBe(1);
    expect(view(a).me!.penaltyMs).toBe(30_000);
    expect(board(b).hint).toBeNull();
    expect(view(b).me!.penaltyMs).toBe(0);
    // asking again for the same path is free; a new path costs again
    act(a, { type: 'hint', path: [0] });
    expect(view(a).me!.penaltyMs).toBe(30_000);
    if (h.h.kind === 'move') act(a, { type: 'hint', path: [0, h.h.to] });
    expect(view(a).me!.penaltyMs).toBe(60_000);
    // no hint for an empty, broken or stuck path (and no charge)
    for (const [path, msg] of [[[], /starting square/], [[0, 1], /knight move/], [tour(), /already complete/]] as const) {
      clearErrors();
      act(a, { type: 'hint', path });
      expect(error(a)).toMatch(msg);
    }
    vi.advanceTimersByTime(5000);
    act(a, { type: 'submit', path: tour() });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 15_000 + 60_000, detail: '2 hints' });
  });

  it('a stuck path gets no hint and no charge', () => {
    started();
    // walk from a corner, always to the first free square, until the knight is stuck
    const path = [0];
    while (nextSquares(6, path).length) path.push(nextSquares(6, path)[0]);
    expect(stuck(6, path)).toBe(true);
    act(a, { type: 'hint', path });
    expect(error(a)).toMatch(/stuck/);
    expect(view(a).me!.penaltyMs).toBe(0);
  });

  it('bots finish at ghost-like times; a whole race is played, ranked and recorded', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      const n = size();
      expect(board(a).n).toBe([6, 7, 8][round]);
      vi.advanceTimersByTime(20_000);
      act(a, { type: 'submit', path: tour(n) });
      // Ben never finishes; the round runs to its limit
      vi.advanceTimersByTime(LIMIT_MS[n] - 20_000);
      expect(view(a).stage).toBe('result');
      const bot = view(a).board.find((r) => r.bot)!;
      expect(bot.round).toMatchObject({ finished: true, points: 1 });
      expect(bot.round!.ms).toBeGreaterThan(20_000); // the quickest ghost needs well over 20 s
      expect(view(b).me!.result).toMatchObject({ finished: false, ms: LIMIT_MS[n] });
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(room(a).results![0]).toMatchObject({ name: 'Ana', detail: '3 points, 1:00' });
    expect(room(a).results![2].name).toBe('Ben');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'knights-tour'").get()).toEqual({ n: 1 });
  });
});
