/** Magic Squares as an online puzzle race: the server checks squares, times them and keeps the answer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceView } from '../src/games/shared/race';
import type { Grid, Puzzle } from '../src/games/magic-squares/logic';
import { HINT_MS } from '../src/games/magic-squares/logic';
import { LIMIT_MS, View } from '../src/games/magic-squares/online';
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
const puzzle = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
/** Send a move; return the error it caused, if any. */
const tryAct = (u: User, action: unknown) => {
  const before = (inbox.get(u.id) ?? []).length;
  act(u, action);
  const e = (inbox.get(u.id) ?? []).slice(before).find((m) => m.type === 'error') as { message: string } | undefined;
  return e?.message;
};

interface State { puzzles: Puzzle[]; round: number; botPlans: Record<string, { at: number }> }
/** The server's own state (the only place the answer lives). */
const state = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: State }> }).rooms;
  return [...r.values()][0].state;
};
const p = () => state().puzzles[state().round];
const solution = () => p().solution as number[];

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'magic-squares' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Every array found anywhere inside a value. */
function arrays(x: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(x)) out.push(x);
  if (x && typeof x === 'object') Object.values(x).forEach((y) => arrays(y, out));
  return out;
}

describe('magic squares race', () => {
  it('sends the size and givens only; a correct square is accepted and timed by the server', () => {
    started();
    const v = puzzle(a);
    expect(v.n).toBe(3);
    expect(v.solution).toBeNull();
    expect(v.givens).toEqual(p().givens);
    expect(v.limitMs).toBe(LIMIT_MS[3]);
    vi.advanceTimersByTime(12_000);
    act(a, { type: 'submit', grid: solution() });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 12_000, points: 1, detail: '' });
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(12_000);
    expect(tryAct(a, { type: 'submit', grid: solution() })).toMatch(/finished/);
  });

  it('refuses wrong or malformed squares, with no penalty', () => {
    started();
    const sol = solution();
    const n2 = sol.length;
    const given = p().givens.findIndex((x) => x !== null);
    const open = p().givens.findIndex((x) => x === null);
    const open2 = p().givens.findIndex((x, c) => x === null && c !== open);
    const swapped = [...sol];
    [swapped[open], swapped[open2]] = [swapped[open2], swapped[open]];
    const changedGiven = [...sol];
    changedGiven[given] = sol[open];
    changedGiven[open] = sol[given];
    const bad: unknown[] = [
      null, 'submit', 42, {}, { type: 'nope' }, { type: 'submit' },
      { type: 'submit', grid: 'grid' },
      { type: 'submit', grid: sol.slice(1) },
      { type: 'submit', grid: [...sol, 1] },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? null : x)) },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? String(x) : x)) },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? x + 0.5 : x)) },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? 0 : x)) },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? n2 + 1 : x)) },
      { type: 'submit', grid: sol.map((x, c) => (c === open ? sol[open2] : x)) }, // a number twice
      { type: 'submit', grid: changedGiven },
      { type: 'submit', grid: swapped }, // not magic
      { type: 'hint', grid: null },
      { type: 'hint', grid: Array(n2 - 1).fill(null) },
      { type: 'hint', grid: Array(n2).fill(-3) },
      { type: 'hint', grid: Array(n2).fill({}) },
    ];
    for (const action of bad) expect(tryAct(a, action), JSON.stringify(action)).toBeTruthy();
    expect(tryAct(a, { type: 'submit', grid: swapped })).toMatch(/Not magic/);
    expect(view(a).me).toMatchObject({ finished: false, penaltyMs: 0 });
    // the right square still goes through afterwards
    act(a, { type: 'submit', grid: sol });
    expect(view(a).me!.result!.finished).toBe(true);
  });

  it('a hint costs 30 s, reveals one correct number, and reaches only the asker', () => {
    started();
    const sol = solution();
    vi.advanceTimersByTime(5000);
    expect(tryAct(a, { type: 'hint', grid: p().givens })).toBeUndefined();
    const mine = puzzle(a);
    expect(view(a).me!.penaltyMs).toBe(HINT_MS);
    expect(mine.hints).toBe(1);
    const shown = mine.revealed.map((x, c) => (x === null ? -1 : c)).filter((c) => c >= 0);
    expect(shown).toHaveLength(1);
    expect(p().givens[shown[0]]).toBeNull();
    expect(mine.revealed[shown[0]]).toBe(sol[shown[0]]);
    // Ben sees nothing of it
    expect(puzzle(b).revealed.every((x) => x === null)).toBe(true);
    expect(puzzle(b).hints).toBe(0);
    expect(view(b).me!.penaltyMs).toBe(0);
    // a wrong number is fixed first
    const open = sol.findIndex((_, c) => p().givens[c] === null && mine.revealed[c] === null);
    // (not a given or an earlier hint: those are put back first, which would clear this cell)
    const wrongValue = sol.find((x) => x !== sol[open] && !p().givens.includes(x) && !mine.revealed.includes(x))!;
    const grid: Grid = p().givens.map((x, c) => (c === open ? wrongValue : x));
    act(a, { type: 'hint', grid });
    expect(puzzle(a).revealed[open]).toBe(sol[open]);
    // the time counts both hints
    vi.advanceTimersByTime(5000);
    act(a, { type: 'submit', grid: sol });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 10_000 + 2 * HINT_MS, detail: '2 hints' });
  });

  it('a hint that completes the square finishes it', () => {
    started();
    const sol = solution();
    const open = p().givens.findIndex((x) => x === null);
    vi.advanceTimersByTime(3000);
    act(a, { type: 'hint', grid: sol.map((x, c) => (c === open ? null : x)) });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 3000 + HINT_MS, detail: '1 hint' });
  });

  it('never sends any answer before its round ends', () => {
    started(1);
    const all = state().puzzles.map((q) => q.solution);
    const seen: ServerMessage[] = [];
    const read = new Map<number, number>();
    const take = () => {
      for (const u of [a, b]) {
        const box = inbox.get(u.id) ?? [];
        seen.push(...box.slice(read.get(u.id) ?? 0));
        read.set(u.id, box.length);
      }
    };
    const check = () => {
      for (const m of seen) {
        if (m.type === 'game') {
          const rv = m.view as RaceView;
          const pv = rv.puzzle as View;
          if (rv.stage === 'solve') {
            expect(pv.solution).toBeNull();
            const known = pv.givens.filter((x, c) => x !== null || pv.revealed[c] !== null).length;
            expect(known).toBeLessThan(pv.n * pv.n);
          }
          // later squares never show up, whatever the stage
          for (const arr of arrays(m)) {
            all.forEach((sol, i) => {
              if (i > rv.round || (i === rv.round && rv.stage === 'solve')) expect(arr).not.toEqual(sol);
            });
          }
        } else {
          for (const arr of arrays(m)) all.forEach((sol) => expect(arr).not.toEqual(sol));
        }
      }
      seen.length = 0;
    };
    for (let round = 0; round < 3; round++) {
      take();
      check();
      vi.advanceTimersByTime(4000);
      act(a, { type: 'hint', grid: p().givens });
      act(b, { type: 'hint', grid: p().givens });
      act(b, { type: 'hint', grid: puzzle(b).givens.map((x, c) => x ?? puzzle(b).revealed[c]) });
      act(a, { type: 'submit', grid: solution() }); // Ana is done; Ben still solving
      take();
      check();
      act(b, { type: 'submit', grid: solution() });
      vi.advanceTimersByTime(Object.values(state().botPlans)[0].at - 4000); // the bot finishes last
      take();
      check();
      // the round is over: the answer may show now
      const v = view(a);
      expect(v.stage).toBe('result');
      expect(puzzle(a).solution).toEqual(all[round]);
      vi.advanceTimersByTime(RESULT_MS);
    }
  });

  it('bots finish at the solo ghost times, inside every limit', () => {
    started(2);
    const bots = Object.values(state().botPlans);
    expect(bots).toHaveLength(2);
    for (const b of bots) {
      expect(b.at).toBeGreaterThanOrEqual(50_000 * 0.8 * 0.8);
      expect(b.at).toBeLessThan(LIMIT_MS[3]);
    }
    // the worst ghost (skill 1.25, worst luck) still beats every limit
    for (const [n, base] of [[3, 50_000], [4, 200_000], [5, 420_000]]) expect(base * 1.25 * 1.3).toBeLessThan(LIMIT_MS[n]);
    const first = Math.min(...bots.map((x) => x.at));
    vi.advanceTimersByTime(first + 1);
    expect(view(a).board.filter((r) => r.bot && r.round?.finished)).not.toHaveLength(0);
  });

  it('plays a whole race to the end, ranks it and records it', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      expect(puzzle(a).n).toBe(3 + round);
      vi.advanceTimersByTime(10_000);
      act(a, { type: 'submit', grid: solution() }); // Ana: 10 s each
      vi.advanceTimersByTime(10_000);
      act(b, { type: 'hint', grid: p().givens });
      act(b, { type: 'submit', grid: solution() }); // Ben: 20 s + 30 s each
      const bot = Object.values(state().botPlans)[0].at;
      vi.advanceTimersByTime(bot - 20_000);
      expect(view(a).stage).toBe('result');
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.name)).toEqual(['Ana', 'Ben', 'Hana']);
    expect(room(a).results![0].detail).toBe('3 points, 0:30');
    expect(room(a).results![1].detail).toBe('3 points, 2:30');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'magic-squares'").get()).toEqual({ n: 1 });
  });
});
