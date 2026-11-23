/** Cipher Lock as an online puzzle race, played through the real server. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceView } from '../src/games/shared/race';
import { Code, Puzzle, ghostTime, holds, solutions } from '../src/games/cipher-lock/logic';
import { View, limitFor, puzzle } from '../src/games/cipher-lock/online';
import { seededRng } from '../src/games/shared/rng';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { RoomView, Rooms, ServerMessage, ClientMessage } from './rooms';

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
const lock = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const tryCode = (u: User, code: unknown) => say(u, { type: 'act', action: { type: 'try', code } });
const error = (u: User) => last(u, 'error')?.message;

/** The server's own state (for the answers). */
const state = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: Puzzle[]; round: number } }> }).rooms;
  return [...r.values()][0].state;
};
const code = () => state().puzzles[state().round].code;
/** A wrong code: the answer with its first two letters swapped. */
const wrongCode = (): Code => {
  const c = code();
  return [c[1], c[0], c[2], c[3]];
};

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'cipher-lock' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('cipher lock puzzle', () => {
  it('makes normal locks with one answer, sensible time limits, and ghost bots', () => {
    const rng = seededRng(11);
    for (let i = 0; i < 5; i++) {
      const p = puzzle.make(rng, i);
      expect(p.difficulty).toBe('normal');
      expect(p.letters).toBe(8);
      expect(solutions(p.clues, p.letters)).toHaveLength(1);
      for (const c of p.clues) expect(holds(c, p.code)).toBe(true);
      const limit = limitFor(p);
      expect(limit).toBeGreaterThanOrEqual(120_000);
      expect(limit).toBeLessThanOrEqual(360_000);
      // the same seed gives the same ghost time as the solo model
      const bot = puzzle.bot(p, seededRng(5), 1);
      expect(bot).toEqual({ ms: ghostTime(p, 1, seededRng(5)), points: 1 });
      // even the slowest ghost finishes inside the limit
      const slow = [0.999, 0]; // the slowest pace, plus a wrong try
      expect(puzzle.bot(p, () => slow.shift() ?? 0, 2).ms).toBeLessThan(limit);
    }
  });
});

describe('cipher lock race', () => {
  it('the right code finishes at the server’s time', () => {
    started();
    expect(view(a).stage).toBe('solve');
    expect(lock(a).letters).toBe(8);
    expect(lock(a).clues.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(42_000);
    tryCode(a, code());
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 42_000, points: 1, detail: '' });
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(42_000);
    tryCode(a, code());
    expect(error(a)).toMatch(/finished/);
  });

  it('wrong tries add 30 s each and are seen only by the player who made them', () => {
    started();
    vi.advanceTimersByTime(10_000);
    tryCode(a, wrongCode());
    tryCode(a, wrongCode());
    expect(view(a).me!.penaltyMs).toBe(60_000);
    expect(lock(a).wrong).toEqual([wrongCode(), wrongCode()]);
    // Ben sees none of Ana's tries
    expect(lock(b).wrong).toEqual([]);
    expect(view(b).me!.penaltyMs).toBe(0);
    expect(JSON.stringify(inbox.get(b.id))).not.toContain(JSON.stringify(wrongCode()));
    vi.advanceTimersByTime(5_000);
    tryCode(a, code());
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 75_000, detail: '2 wrong tries' });
  });

  it('refuses malformed tries without a penalty', () => {
    started();
    const c = code();
    const bad: [unknown, RegExp][] = [
      [null, /Unknown move/],
      [{ type: 'guess', code: c }, /Unknown move/],
      ['ABCD', /Unknown move/],
    ];
    for (const [action, msg] of bad) {
      say(a, { type: 'act', action });
      expect(error(a)).toMatch(msg);
    }
    const codes: [unknown, RegExp][] = [
      [undefined, /four letters/],
      [c.slice(0, 3), /four letters/],
      [[...c, 7], /four letters/],
      ['ABCD', /four letters/],
      [[0, 1, 2, 8], /only the letters/],
      [[0, 1, 2, -1], /only the letters/],
      [[0, 1, 2, 2.5], /only the letters/],
      [[0, 1, '2', 3], /only the letters/],
      [[0, 1, 2, null], /only the letters/],
      [[0, 1, 1, 3], /different/],
    ];
    for (const [x, msg] of codes) {
      tryCode(a, x);
      expect(error(a)).toMatch(msg);
    }
    expect(view(a).me!.penaltyMs).toBe(0);
    expect(lock(a).wrong).toEqual([]);
    expect(view(a).me!.finished).toBe(false);
  });

  it('never sends a lock’s code before its round ends', () => {
    started(1);
    const codes = state().puzzles.map((p) => JSON.stringify(p.code));
    for (let round = 0; round < 3; round++) {
      vi.advanceTimersByTime(5_000);
      tryCode(a, wrongCode());
      tryCode(b, wrongCode());
      vi.advanceTimersByTime(5_000);
      tryCode(a, code());
      vi.advanceTimersByTime(limitFor(state().puzzles[round]) - 10_000); // Ben runs out of time; the bot finishes
      expect(view(b).stage).toBe('result');
      // once the round is over, the code shows
      expect(lock(b).code).toEqual(code());
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    let checked = 0;
    for (const u of [a, b]) {
      for (const m of inbox.get(u.id) ?? []) {
        const text = JSON.stringify(m);
        if (m.type === 'game') {
          const v = m.view as RaceView;
          const settled = v.stage === 'result' || v.stage === 'over';
          // this round's code only once settled; later rounds' codes never
          const hidden = codes.slice(settled ? v.round + 1 : v.round);
          for (const c of hidden) expect(text).not.toContain(c);
          if (!settled) expect((v.puzzle as View).code).toBeNull();
          checked++;
        } else {
          for (const c of codes) expect(text).not.toContain(c);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('bots finish at their ghost time', () => {
    started(2);
    const s = state() as unknown as { botPlans: Record<string, { at: number; points: number }> };
    const plans = Object.values(s.botPlans);
    expect(plans).toHaveLength(2);
    for (const p of plans) expect(p.points).toBe(1);
    const first = Math.min(...plans.map((p) => p.at));
    vi.advanceTimersByTime(first);
    const done = view(a).board.filter((r) => r.bot && r.round?.finished);
    expect(done.length).toBeGreaterThanOrEqual(1);
    expect(done[0].round).toMatchObject({ finished: true, ms: first, points: 1 });
  });

  it('a whole race is played, ranked and recorded', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      vi.advanceTimersByTime(3_000);
      tryCode(a, code());
      tryCode(b, wrongCode()); // Ben tries once, then never opens it
      vi.advanceTimersByTime(limitFor(state().puzzles[round]) - 3_000); // time is up
      expect(view(a).stage).toBe('result');
      const ben = view(a).board.find((r) => r.name === 'Ben')!;
      expect(ben.round).toMatchObject({ finished: false, points: 0, detail: '1 wrong try' });
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    expect(view(a).stage).toBe('over');
    expect(room(a).results!.map((r) => [r.name, r.place])).toEqual([['Ana', 1], ['Hana', 2], ['Ben', 3]]);
    expect(room(a).results![0].detail).toBe('3 points, 0:09');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'cipher-lock'").get()).toEqual({ n: 1 });
  });
});
