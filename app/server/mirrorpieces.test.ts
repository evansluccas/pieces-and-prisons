/** Mirror Pieces as an online puzzle race: the server checks every build and keeps the answer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceView } from '../src/games/shared/race';
import { Puzzle, makePuzzle, turns } from '../src/games/mirror-pieces/logic';
import { LIMIT_MS, View, puzzle as mirrorRace } from '../src/games/mirror-pieces/online';
import { flip } from '../src/games/piece-together/logic';
import { seededRng } from '../src/games/shared/rng';
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
afterEach(() => {
  vi.useRealTimers();
});

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const view = (u: User) => last(u, 'game')!.view as RaceView;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
const submit = (placements: unknown) => ({ type: 'submit', placements });
/** The current puzzle, read from the server's own state. */
const current = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: Puzzle[]; round: number } }> }).rooms;
  const s = [...r.values()][0].state;
  return s.puzzles[s.round];
};
const answer = () => current().target;

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'mirror-pieces' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** A seeded puzzle with a lopsided piece (its flip is not one of its turns). */
function lopsided(): { p: Puzzle; i: number } {
  for (let seed = 1; ; seed++) {
    const p = makePuzzle(seededRng(seed), 'normal');
    const i = p.target.findIndex((t) => !turns(flip(t.cells)).some((o) => JSON.stringify(o) === JSON.stringify(t.cells)));
    if (i >= 0) return { p, i };
  }
}

describe('mirror pieces race', () => {
  it('accepts the exact reflection and times it on the server', () => {
    started();
    expect(view(a).stage).toBe('solve');
    expect((view(a).puzzle as View).left).toHaveLength(5); // normal: 5 pieces
    vi.advanceTimersByTime(12_000);
    act(a, submit(answer()));
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 12_000, points: 1 });
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(12_000);
    // a placement in any order, with the cells listed any way round, still counts
    const shuffled = [...answer()].reverse().map((t) => ({ ...t, cells: [...t.cells].reverse() }));
    vi.advanceTimersByTime(3_000);
    act(b, submit(shuffled));
    expect(view(b).me!.result).toMatchObject({ finished: true, ms: 15_000 });
    expect(view(b).stage).toBe('result');
  });

  it('refuses wrong builds, with no penalty', () => {
    started();
    const t = answer();
    const moved = t.map((p, i) => (i === 0 ? { ...p, at: [p.at[0], p.at[1] + 1] } : p));
    const wrongTurn = t.map((p) => ({ ...p, cells: turns(p.cells).find((o) => JSON.stringify(o) !== JSON.stringify(p.cells)) ?? p.cells }));
    const leftHalf = t.map((p, i) => (i === 0 ? { ...p, at: [0, p.at[1]] } : p));
    const overlap = t.map((p, i) => (i === 1 ? { ...p, at: t[0].at } : p));
    for (const [build, msg] of [
      [moved, /mirror image|right half/],
      [leftHalf, /right half/],
      [overlap, /right half|overlapping/],
      [t.slice(1), /every piece/],
      [[...t.slice(1), t[1]], /only be placed once/],
      [[{ ...t[0], cells: t[0].cells.slice(1) }, ...t.slice(1)], /wrong shape/],
    ] as [unknown, RegExp][]) {
      act(a, submit(build));
      expect(error(a)).toMatch(msg);
      expect(view(a).me!.finished).toBe(false);
    }
    // a different turn is refused too, unless every piece happens to look the same turned
    if (JSON.stringify(wrongTurn) !== JSON.stringify(t)) {
      act(a, submit(wrongTurn));
      expect(error(a)).toMatch(/mirror image|right half/);
    }
    expect(view(a).me!.penaltyMs).toBe(0);
    act(a, submit(t));
    expect(view(a).me!.finished).toBe(true);
  });

  it('refuses a flipped piece, even one sitting on the right squares', () => {
    const { p, i } = lopsided();
    const build = p.target.map((t, j) => (j === i ? { ...t, cells: flip(t.cells) } : t));
    expect(() => mirrorRace.act(p, null, submit(build), 0)).toThrow(/never flipped/);
    expect(mirrorRace.act(p, null, submit(p.target), 0).finish).toEqual({ points: 1 });
  });

  it('refuses malformed data with a friendly message', () => {
    started();
    const t = answer();
    const bad: unknown[] = [
      null, 'submit', 42, [], {}, { type: 'place' }, submit(null), submit('abc'), submit({}),
      submit([...t, t[0]]),
      submit(t.map((p, i) => (i === 0 ? null : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, piece: 99 } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, piece: 0.5 } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, piece: '0' } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, at: undefined } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, at: [1e9, 0] } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, at: [NaN, 0] } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, at: [1, 2, 3] } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, cells: 'x' } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, cells: p.cells.map(() => ['0', '0']) } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, cells: p.cells.map(() => [0, 0]) } : p))),
      submit(t.map((p, i) => (i === 0 ? { ...p, cells: [...p.cells.slice(1), [0.5, 0]] } : p))),
    ];
    for (const action of bad) {
      const before = inbox.get(a.id)!.length;
      act(a, action);
      const msg = inbox.get(a.id)!.slice(before).find((m) => m.type === 'error')?.message;
      expect(msg, JSON.stringify(action)).toBeTruthy();
      expect(msg).not.toMatch(/undefined|null|Cannot|TypeError|is not/);
    }
    expect(view(a).me!.finished).toBe(false);
  });

  it('never sends the answer before the round ends', () => {
    started();
    const target = answer();
    const sentSoFar = () => JSON.stringify([...(inbox.get(a.id) ?? []), ...(inbox.get(b.id) ?? [])]);
    vi.advanceTimersByTime(5000);
    act(a, submit(target)); // even after Ana finishes, Ben must not see it
    act(b, submit(target.slice(1))); // a refused try reveals nothing either
    vi.advanceTimersByTime(30_000);
    expect(view(b).stage).toBe('solve');
    const early = sentSoFar();
    expect(early).not.toContain('"target"');
    expect(early).not.toContain(JSON.stringify(target));
    for (const p of target) expect(early).not.toContain(JSON.stringify({ piece: p.piece, cells: p.cells, at: p.at }));
    // the view itself only has the picture and the tray
    expect(Object.keys(view(b).puzzle as object).sort()).toEqual(['cols', 'left', 'rows', 'tray']);
    // once the round ends, the reflection is shown
    vi.advanceTimersByTime(LIMIT_MS - 35_000);
    expect(view(b).stage).toBe('result');
    expect((view(b).puzzle as View).target).toEqual(target);
  });

  it('bots finish at a solo ghost time', () => {
    started(1);
    const p = current();
    const pieces = p.tray.length;
    // the bot sits third: skill 1.25, times 0.8–1.3 of the base
    const base = (10_000 + pieces * 10_000) * 1.25;
    vi.advanceTimersByTime(Math.ceil(base * 1.3) + 1000);
    const bot = view(a).board.find((r) => r.bot)!;
    expect(bot.round).toMatchObject({ finished: true, points: 1 });
    expect(bot.round!.ms).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
    expect(bot.round!.ms).toBeLessThanOrEqual(Math.ceil(base * 1.3));
  });

  it('plays a whole race to the end and records it', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      expect(view(a).round).toBe(round);
      vi.advanceTimersByTime(20_000);
      act(a, submit(answer()));
      expect(view(a).me!.result!.ms).toBe(20_000);
      vi.advanceTimersByTime(LIMIT_MS - 20_000); // time's up for Ben; the bot has finished
      expect(view(a).stage).toBe('result');
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    const res = room(a).results!;
    expect(res.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(res[0]).toMatchObject({ name: 'Ana', detail: '3 points, 1:00' });
    expect(res[2]).toMatchObject({ name: 'Ben', detail: '0 points, 9:00' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'mirror-pieces'").get()).toEqual({ n: 1 });
  });
});
