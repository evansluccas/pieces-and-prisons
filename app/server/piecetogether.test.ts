/** Piece Together as an online puzzle race, played through the real server. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceState, RaceView } from '../src/games/shared/race';
import { Cell, Placement, Puzzle } from '../src/games/piece-together/logic';
import { LIMIT_MS, Mine, View, checkFill } from '../src/games/piece-together/online';
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
const puzzleOf = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const errors = (u: User) => (inbox.get(u.id) ?? []).filter((m) => m.type === 'error').length;
const error = (u: User) => last(u, 'error')?.message;
const submit = (u: User, placements: unknown) => act(u, { type: 'submit', placements });

/** The server's own state for the one room. */
const state = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: RaceState<Puzzle, Mine> }> }).rooms;
  return [...r.values()][0].state;
};
const current = () => state().puzzles[state().round];

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'piece-together' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

// a 4×4 square cut into four straight bars, laid across
const bar: Cell[] = [[0, 0], [1, 0], [2, 0], [3, 0]];
const SQUARE: Puzzle = {
  outline: [0, 1, 2, 3].flatMap((y) => [0, 1, 2, 3].map((x) => [x, y] as Cell)),
  pieces: [bar, bar, bar, bar],
  difficulty: 'normal',
  solution: [0, 1, 2, 3].map((y) => ({ piece: y, cells: bar, at: [0, y] as Cell })),
};
const upright: Cell[] = [[0, 0], [0, 1], [0, 2], [0, 3]];
// the same square filled the other way: every bar turned upright
const COLUMNS: Placement[] = [0, 1, 2, 3].map((x) => ({ piece: x, cells: upright, at: [x, 0] as Cell }));

describe('piece together race', () => {
  it('sends 3 normal puzzles with a 4-minute limit; the original fill is accepted and timed by the server', () => {
    started();
    const v = view(a);
    expect(v.rounds).toBe(3);
    expect(v.stage).toBe('solve');
    expect(v.leftMs).toBe(LIMIT_MS);
    expect(puzzleOf(a).pieces).toHaveLength(8);
    expect(puzzleOf(a).outline).toEqual(current().outline);
    vi.advanceTimersByTime(42_000);
    submit(a, current().solution);
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 42_000, points: 1 });
    expect(puzzleOf(a).placed).toHaveLength(8);
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(42_000);
    submit(a, current().solution);
    expect(error(a)).toMatch(/finished/);
  });

  it('a different valid fill counts too, with turned pieces and any way of writing the offsets', () => {
    started();
    state().puzzles[0] = SQUARE;
    vi.advanceTimersByTime(5000);
    submit(a, COLUMNS);
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 5000, points: 1 });
    // Ben writes his bars with the offset inside the cells, in a different order
    vi.advanceTimersByTime(2000);
    submit(b, [3, 1, 0, 2].map((y) => ({ piece: y, cells: bar.map(([x]) => [x + 1, y]), at: [-1, 0] })));
    expect(view(b).me!.result).toMatchObject({ finished: true, ms: 7000 });
    expect(view(b).stage).toBe('result');
  });

  it('refuses incomplete, overlapping, out-of-bounds and reshaped fills, with no penalty', () => {
    started();
    state().puzzles[0] = SQUARE;
    const tries: [unknown, RegExp][] = [
      [COLUMNS.slice(1), /Every piece/],
      [[...COLUMNS.slice(1), { piece: 1, cells: upright, at: [0, 0] }], /once/],
      [COLUMNS.map((p, i) => (i === 0 ? { ...p, at: [1, 0] } : p)), /overlaps|outline/], // two bars on top of each other
      [COLUMNS.map((p, i) => (i === 3 ? { ...p, at: [4, 0] } : p)), /outline/], // sticking out
      [COLUMNS.map((p, i) => (i === 0 ? { ...p, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] } : p)), /changed shape/],
    ];
    tries.forEach(([placements, msg], i) => {
      submit(a, placements);
      expect(errors(a)).toBe(i + 1);
      expect(error(a)).toMatch(msg);
    });
    expect(view(a).me).toMatchObject({ finished: false, penaltyMs: 0 });
    vi.advanceTimersByTime(3000);
    submit(a, COLUMNS);
    expect(view(a).me!.result!.ms).toBe(3000);
  });

  it('refuses malformed data from the network', () => {
    const ok = SQUARE.solution;
    const bad: unknown[] = [
      null, 7, 'submit', {}, { type: 'place' }, { type: 'submit' }, { type: 'submit', placements: 'all' },
      { type: 'submit', placements: [...ok, ...ok] },
      { type: 'submit', placements: [null, ...ok.slice(1)] },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, piece: 1.5 })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, piece: -1 })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, piece: 4 })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, piece: '0' })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: 'bar' })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [1, 0], [2, 0]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [1, 0], [2, 0], ['3', 0]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [1, 0], [2, 0], [3, NaN]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [1, 0], [2, 0], [3, 0, 0]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, cells: [[0, 0], [0, 0], [1, 0], [2, 0]] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, at: [1e9, 0] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, at: [0.5, 0] })) },
      { type: 'submit', placements: ok.map((p, i) => (i ? p : { ...p, at: null })) },
    ];
    for (const x of bad) expect(() => checkFill(SQUARE, x), JSON.stringify(x)).toThrow(/./);
    expect(checkFill(SQUARE, { type: 'submit', placements: ok })).toHaveLength(4);

    // and through the server: refused, still solving
    started();
    for (const x of bad) act(a, x);
    expect(errors(a)).toBe(bad.length);
    expect(view(a).me!.finished).toBe(false);
  });

  it('never sends the way the outline was cut before the round ends — not even another player’s fill', () => {
    started(1);
    const p = current();
    const secret = [JSON.stringify(p.solution), ...p.solution.map((s) => JSON.stringify(s))];
    const leaks = (u: User) => (inbox.get(u.id) ?? []).filter((m) => secret.some((x) => JSON.stringify(m).includes(x)));
    expect(puzzleOf(a).solution).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect([...leaks(a), ...leaks(b)]).toEqual([]);
    // Ana hands in exactly that fill: it comes back to her as her own, but Ben never sees it
    submit(a, p.solution);
    expect(leaks(a).length).toBeGreaterThan(0);
    vi.advanceTimersByTime(LIMIT_MS - 10_000 - 1);
    expect(view(b).stage).toBe('solve');
    expect(puzzleOf(b).placed).toBeNull();
    expect(leaks(b)).toEqual([]);
    vi.advanceTimersByTime(1);
    // the round is over: now it may be shown
    expect(view(b).stage).toBe('result');
    expect(puzzleOf(b).solution).toEqual(p.solution);
  });

  it('bots finish at a ghost time from the solo game', () => {
    started(3);
    const p = current();
    const plans = Object.values(state().botPlans);
    expect(plans).toHaveLength(3);
    const base = 12_000 + p.pieces.length * 8_500;
    plans.forEach((plan, i) => {
      const skill = [0.8, 1, 1.25][(i + 2) % 3]; // bots sit after Ana and Ben
      expect(plan.points).toBe(1);
      expect(plan.at).toBeGreaterThanOrEqual(Math.floor(base * skill * 0.8));
      expect(plan.at).toBeLessThanOrEqual(Math.ceil(base * skill * 1.3));
      expect(plan.at).toBeLessThan(LIMIT_MS);
    });
    vi.advanceTimersByTime(Math.max(...plans.map((x) => x.at)));
    const bots = view(a).board.filter((r) => r.bot);
    expect(bots).toHaveLength(3);
    bots.forEach((r) => expect(r.round).toMatchObject({ finished: true, points: 1 }));
  });

  it('a whole race: 3 puzzles, ranked by points then time, recorded in matches', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      expect(view(a).round).toBe(round);
      vi.advanceTimersByTime(5000);
      submit(a, current().solution);
      expect(view(a).me!.result!.ms).toBe(5000);
      vi.advanceTimersByTime(LIMIT_MS - 5000); // Ben runs out of time; the bot is done well before
      expect(view(a).stage).toBe('result');
      expect(view(b).me!.result).toMatchObject({ finished: false, points: 0, ms: LIMIT_MS });
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(view(a).stage).toBe('over');
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => [r.name, r.place])).toEqual([['Ana', 1], ['Hana', 2], ['Ben', 3]]);
    expect(room(a).results![0].detail).toBe('3 points, 0:15');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'piece-together'").get()).toEqual({ n: 1 });
  });
});
