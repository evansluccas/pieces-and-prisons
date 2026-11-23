/** Fence Loop as an online puzzle race: the server keeps the loop and checks what players send. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RaceView } from '../src/games/shared/race';
import { Puzzle, geometry, meetsNumbers, regionLoop } from '../src/games/fence-loop/logic';
import { View } from '../src/games/fence-loop/online';
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
const board = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** The current puzzle, read from the server's own state. */
const puzzle = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: Puzzle[]; round: number } }> }).rooms;
  const s = [...r.values()][0].state;
  return s.puzzles[s.round];
};
const answerEdges = () => puzzle().answer.flatMap((x, e) => (x ? [e] : []));
const submit = (u: User, edges: unknown) => act(u, { type: 'submit', edges });

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'fence-loop' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('fence loop race', () => {
  it('players get the numbers only; the right loop is accepted and timed by the server', () => {
    started();
    const v = view(a);
    expect(v.stage).toBe('solve');
    expect(v.leftMs).toBe(6 * 60_000);
    const p = puzzle();
    expect(board(a)).toEqual({ R: 6, C: 6, clues: p.clues, answer: null });
    vi.advanceTimersByTime(47_000);
    submit(a, answerEdges());
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 47_000, points: 1 });
    // Ben sees Ana's time, still not the loop
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(47_000);
    expect(board(b).answer).toBeNull();
    submit(a, answerEdges());
    expect(error(a)).toMatch(/finished/);
  }, 60_000);

  it('wrong loops and malformed data are refused, with no penalty', () => {
    started();
    const p = puzzle();
    const g = geometry(p.R, p.C);
    const right = answerEdges();
    const border = regionLoop(p.R, p.C, Array(p.R * p.C).fill(true)).flatMap((x, e) => (x ? [e] : []));
    const bad: [unknown, RegExp][] = [
      [null, /Unknown move/],
      ['submit', /Unknown move/],
      [{ type: 'draw', edges: right }, /Unknown move/],
      [{ type: 'submit' }, /fences of your loop/],
      [{ type: 'submit', edges: 'all' }, /fences of your loop/],
      [{ type: 'submit', edges: { length: 3 } }, /fences of your loop/],
      [{ type: 'submit', edges: Array(g.edges + 1).fill(0) }, /fences of your loop/],
      [{ type: 'submit', edges: [...right.slice(1), -1] }, /isn’t on the board/],
      [{ type: 'submit', edges: [...right.slice(1), g.edges] }, /isn’t on the board/],
      [{ type: 'submit', edges: [...right.slice(1), 1.5] }, /isn’t on the board/],
      [{ type: 'submit', edges: [...right.slice(1), String(right[0])] }, /isn’t on the board/],
      [{ type: 'submit', edges: [...right, right[0]] }, /twice/],
      [{ type: 'submit', edges: [] }, /every number/],
      [{ type: 'submit', edges: right.slice(1) }, /every number/],
      [{ type: 'submit', edges: border }, /every number/],
    ];
    vi.advanceTimersByTime(5000);
    for (const [action, msg] of bad) {
      inbox.set(a.id, []);
      act(a, action);
      expect(error(a)).toMatch(msg);
    }
    vi.advanceTimersByTime(5000);
    submit(a, right);
    expect(view(a).me).toMatchObject({ finished: true, penaltyMs: 0, result: { ms: 10_000 } });
  }, 60_000);

  it('the loop is never sent before the round ends', () => {
    started(1);
    const loop = answerEdges();
    const secrets = [JSON.stringify(loop), JSON.stringify(puzzle().answer)];
    const leaked = () => [a, b].some((u) => (inbox.get(u.id) ?? []).some((m) => secrets.some((x) => JSON.stringify(m).includes(x))));
    vi.advanceTimersByTime(30_000);
    submit(a, loop.slice(1)); // a wrong try must not reveal it either
    submit(a, loop);
    expect(leaked()).toBe(false);
    expect(board(b).answer).toBeNull();
    vi.advanceTimersByTime(6 * 60_000 - 30_000); // time's up for Ben
    expect(view(b).stage).toBe('result');
    expect(board(b).answer).toEqual(loop);
    expect(leaked()).toBe(true);
    // the screen's own check agrees with the answer
    const p = puzzle();
    expect(meetsNumbers(p.R, p.C, p.clues, p.answer)).toBe(true);
    expect(meetsNumbers(p.R, p.C, p.clues, p.answer.map((x, e) => (e === loop[0] ? !x : x)))).toBe(false);
  }, 60_000);

  it('bots finish at a ghost time and score a point', () => {
    started(3);
    // 6 × 6 normal ghosts: (15 s + 36 × 3.2 s) × skill 0.8–1.25 × 0.8–1.3
    const lo = 130_200 * 0.8 * 0.8;
    const hi = 130_200 * 1.25 * 1.3;
    vi.advanceTimersByTime(hi + 1000);
    const bots = view(a).board.filter((r) => r.bot);
    expect(bots).toHaveLength(3);
    for (const r of bots) {
      expect(r.round).toMatchObject({ finished: true, points: 1 });
      expect(r.round!.ms).toBeGreaterThanOrEqual(lo - 1);
      expect(r.round!.ms).toBeLessThanOrEqual(hi + 1);
    }
  }, 60_000);

  it('a whole race is played, ranked and recorded', () => {
    started(1);
    for (let round = 0; round < 3; round++) {
      vi.advanceTimersByTime(20_000);
      submit(a, answerEdges()); // Ana: 20 s each, before any bot can finish
      if (round < 2) {
        vi.advanceTimersByTime(30_000);
        submit(b, answerEdges()); // Ben: 50 s, but gives up on the last one
      }
      // the round closes when the bot is done (or, for Ben, when time runs out)
      for (let t = 0; t < 6 * 60 && view(a).stage === 'solve'; t++) vi.advanceTimersByTime(1000);
      expect(view(a).stage).toBe('result');
      expect(view(a).board.find((r) => r.name === 'Ben')!.round!.finished).toBe(round < 2);
      vi.advanceTimersByTime(last(a, 'game')!.pauseUntil! - Date.now()); // the next round opens
    }
    expect(room(a).status).toBe('over');
    const res = room(a).results!;
    expect(res[0]).toMatchObject({ name: 'Ana', place: 1, detail: '3 points, 1:00' });
    expect(res.map((r) => r.name)).toEqual(['Ana', 'Hana', 'Ben']);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'fence-loop'").get()).toEqual({ n: 1 });
  }, 120_000);
});
