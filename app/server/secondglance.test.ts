/** Second Glance as an online puzzle race: the server times the study, hides the scenes and scores the marks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RaceView } from '../src/games/shared/race';
import type { Round } from '../src/games/second-glance/logic';
import { SLOTS } from '../src/games/second-glance/logic';
import type { View } from '../src/games/second-glance/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

const STUDY = 10_000;
const LIMIT = 60_000;

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
  seen = new Map();
});
afterEach(() => vi.useRealTimers());

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const view = (u: User) => last(u, 'game')!.view as RaceView;
const puzzleOf = (u: User) => view(u).puzzle as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** This round's scenes and changes, read from the server's own state. */
const round = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: Round[]; round: number } }> }).rooms;
  const s = [...r.values()][0].state;
  return s.puzzles[s.round];
};
const changed = () => round().changes.map((c) => c.slot);
const unchanged = () => [...Array(SLOTS).keys()].filter((s) => !changed().includes(s));
/** Everything a player has been sent since the last call, as text. */
let seen = new Map<number, number>();
const drain = (u: User) => {
  const all = inbox.get(u.id) ?? [];
  const text = all.slice(seen.get(u.id) ?? 0).map((m) => JSON.stringify(m));
  seen.set(u.id, all.length);
  return text;
};

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'second-glance' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('Second Glance race', () => {
  it('the server times the study; marks wait for it, and solving time counts from its end', () => {
    started();
    expect(view(a).stage).toBe('study');
    expect(view(a).leftMs).toBe(STUDY);
    expect(puzzleOf(a).scene).toEqual(round().before);
    act(a, { type: 'mark', marks: [0] });
    expect(error(a)).toMatch(/Study first/);
    vi.advanceTimersByTime(STUDY - 1);
    expect(view(a).stage).toBe('study');
    vi.advanceTimersByTime(1);
    expect(view(a).stage).toBe('solve');
    expect(view(a).leftMs).toBe(LIMIT);
    expect(puzzleOf(a).scene).toEqual(round().after);
    vi.advanceTimersByTime(7000);
    act(a, { type: 'done', marks: changed().slice(0, 3) });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 7000, points: 3, detail: '3/5 found' });
  });

  it('hides the original after the study, and the changes until the round is over', () => {
    started();
    const { before, after, changes } = round();
    const beforeText = JSON.stringify(before);
    const changesText = JSON.stringify(changes);
    // study: only the original; nothing about the changes
    for (const who of [a, b]) {
      const sent = drain(who);
      expect(sent.length).toBeGreaterThan(0);
      for (const m of sent) {
        expect(m).not.toContain(JSON.stringify(after));
        expect(m).not.toContain(changesText);
        expect(m).not.toMatch(/"changes"|"kind"|"before"/);
      }
    }
    // solve: only the changed scene, with marks coming and going
    vi.advanceTimersByTime(STUDY);
    vi.advanceTimersByTime(3000);
    act(a, { type: 'mark', marks: [changed()[0]] });
    act(a, { type: 'mark', marks: [changed()[0], unchanged()[0]] });
    act(b, { type: 'done', marks: changed() });
    expect(view(a).stage).toBe('solve');
    for (const who of [a, b]) {
      const sent = drain(who);
      expect(sent.length).toBeGreaterThan(0);
      for (const m of sent) {
        expect(m).not.toContain(beforeText);
        expect(m).not.toContain(changesText);
        expect(m).not.toMatch(/"changes"|"kind"|"before"/);
      }
    }
    expect(puzzleOf(a).scene).toEqual(after);
    expect(puzzleOf(a).marks).toEqual([changed()[0], unchanged()[0]]);
    expect(puzzleOf(b).marks).toEqual(changed());
    // Ana sees how many Ben found, not where
    expect(view(a).board.find((r) => r.name === 'Ben')!.round).toMatchObject({ points: 5 });
    // the round ends: now the answer and the marks show
    act(a, { type: 'done', marks: [changed()[0], unchanged()[0]] });
    expect(view(a).stage).toBe('result');
    expect(puzzleOf(a).answer).toEqual({ before, changes, found: 1 });
    expect(puzzleOf(a).marks).toEqual([changed()[0], unchanged()[0]]);
  });

  it('checks marks on the server', () => {
    started();
    vi.advanceTimersByTime(STUDY);
    const bad: [unknown, RegExp][] = [
      [{ type: 'mark', marks: [0, 1, 2, 3, 4, 5] }, /At most 5/],
      [{ type: 'mark', marks: [SLOTS] }, /isn’t on the board/],
      [{ type: 'mark', marks: [-1] }, /isn’t on the board/],
      [{ type: 'mark', marks: [1.5] }, /isn’t on the board/],
      [{ type: 'mark', marks: ['3'] }, /isn’t on the board/],
      [{ type: 'done', marks: [2, 2] }, /only be marked once/],
      [{ type: 'done', marks: [] }, /at least one/],
      [{ type: 'done' }, /Send the squares/],
      [{ type: 'peek' }, /Unknown move/],
    ];
    for (const [move, msg] of bad) {
      act(a, move);
      expect(error(a)).toMatch(msg);
    }
    expect(view(a).me!.finished).toBe(false);
    expect(puzzleOf(a).marks).toEqual([]);
    // every X on a changed square counts; others cost nothing
    act(a, { type: 'done', marks: [...changed().slice(0, 4), unchanged()[0]] });
    expect(view(a).me!.result).toMatchObject({ finished: true, points: 4 });
    act(a, { type: 'mark', marks: [changed()[4]] });
    expect(error(a)).toMatch(/finished/);
  });

  it('when time runs out, the marks sent so far still count', () => {
    started();
    vi.advanceTimersByTime(STUDY + 5000);
    act(a, { type: 'mark', marks: [changed()[0], changed()[1], unchanged()[0]] });
    act(a, { type: 'mark', marks: [changed()[0], changed()[1]] }); // took one back
    vi.advanceTimersByTime(LIMIT - 5000);
    expect(view(a).stage).toBe('result');
    expect(view(a).me!.result).toEqual({ finished: false, ms: LIMIT, points: 2, detail: '2/5 found · time’s up' });
    expect(view(b).me!.result).toEqual({ finished: false, ms: LIMIT, points: 0, detail: '0/5 found · time’s up' });
  });

  it('bots play like the solo ghost rivals', () => {
    started(2);
    vi.advanceTimersByTime(STUDY + 54_000); // ghosts take 18–53 s
    for (const r of view(a).board.filter((x) => x.bot)) {
      expect(r.round!.finished).toBe(true);
      expect(r.round!.ms).toBeGreaterThanOrEqual(18_000);
      expect(r.round!.ms).toBeLessThanOrEqual(53_000);
      expect(r.round!.points).toBeGreaterThanOrEqual(0);
      expect(r.round!.points).toBeLessThanOrEqual(5);
      expect(r.round!.detail).toBe(`${r.round!.points}/5 found`);
    }
  });

  it('a whole race: three rounds, ranked by changes found then time, and recorded', () => {
    started(1);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(STUDY);
      expect(view(a).stage).toBe('solve');
      vi.advanceTimersByTime(2000);
      act(a, { type: 'done', marks: changed() });
      act(b, { type: 'mark', marks: [changed()[0], changed()[1]] });
      vi.advanceTimersByTime(LIMIT - 2000); // time's up for Ben
      expect(view(a).stage).toBe('result');
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    const res = room(a).results!;
    expect(res[0]).toMatchObject({ name: 'Ana', place: 1, detail: '15 points, 0:06' });
    expect(res.find((r) => r.name === 'Ben')!.detail).toBe('6 points, 3:00');
    expect(view(a).stage).toBe('over');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'second-glance'").get()).toEqual({ n: 1 });
  });
});
