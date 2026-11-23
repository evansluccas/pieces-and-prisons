/** Split Decision online: server-timed questions, hidden answers, a server-timed card study. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededRng } from '../src/games/shared/rng';
import { DEFAULT_CONFIG } from '../src/games/split-decision/logic';
import { LATENCY_ALLOWANCE, OnlineState, REVEAL_MS, View, act as gameAct, over, pause, results, start, tick } from '../src/games/split-decision/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

const { answerMs: ANSWER_MS, memorizeMs: STUDY_MS } = DEFAULT_CONFIG;

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
/** Everything the server sent this person (messages `from` to `to`), as text. */
const sent = (u: User, from = 0, to?: number) => JSON.stringify((inbox.get(u.id) ?? []).slice(from, to));
const count = (u: User) => inbox.get(u.id)?.length ?? 0;

/** Ana, Ben and `bots` bots at a Split Decision table, game started. */
function started(bots = 1) {
  say(a, { type: 'create', gameId: 'split-decision' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Let time run until the open question closes (bots answer, or the clock runs out). */
function untilClosed() {
  for (let t = 0; t <= ANSWER_MS && view(a).game.phase !== 'reveal'; t += 100) vi.advanceTimersByTime(100);
  expect(view(a).game.phase).toBe('reveal');
}

/** Both people answer option 0 at once; wait for the bot; skip the result. Returns the message count before the next question. */
function playQuestion() {
  act(a, { type: 'answer', choice: 0 });
  act(b, { type: 'answer', choice: 0 });
  untilClosed();
  const before = count(a);
  say(a, { type: 'ready' });
  say(b, { type: 'ready' });
  return before;
}

describe('Split Decision online', () => {
  it('picks and the right answer stay hidden until the question closes', () => {
    started();
    const v = view(a);
    expect(v.game.phase).toBe('answer');
    expect(v.leftMs).toBe(ANSWER_MS);
    expect(v.game.questions[0]!.answer).toBeNull();
    expect(v.game.questions.slice(1).every((q) => q === null)).toBe(true); // nothing about later questions
    vi.advanceTimersByTime(1000);
    act(a, { type: 'answer', choice: 1 });
    expect(view(a).leftMs).toBe(ANSWER_MS - 1000); // "ms left" as of each message
    // Ben sees that Ana answered, not what
    expect(view(b).game.picks.s0).toEqual({ choice: null, ms: 0 });
    expect(view(a).game.picks.you.choice).toBe(1);
    // no right answer and no pick of Ana's in anything Ben got so far
    expect(sent(b)).not.toMatch(/"answer":[01]/);
    expect(sent(b)).not.toMatch(/"choice":1/);
    act(b, { type: 'answer', choice: 0 });
    untilClosed(); // the bot answers in time
    const r = view(b).game;
    expect(r.phase).toBe('reveal');
    expect(game(b).pauseUntil! - Date.now()).toBeLessThanOrEqual(REVEAL_MS);
    expect(r.questions[0]!.answer).not.toBeNull();
    expect(r.results[0].picks.s0.choice).toBe(1);
    expect(r.results[0].picks.you.choice).toBe(0);
    expect(r.results[0].picks.s2.choice).not.toBeNull();
  });

  it('answer times are measured by the server; a faster claim only gets the latency allowance', () => {
    started();
    vi.advanceTimersByTime(4000);
    act(a, { type: 'answer', choice: 0, ms: 100 }); // claims far less than the server saw
    act(b, { type: 'answer', choice: 1, ms: 99_999 }); // a claim longer than the real time is cut
    expect(view(a).game.picks.you.ms).toBe(4000 - LATENCY_ALLOWANCE);
    expect(view(b).game.picks.you.ms).toBe(4000);
    act(a, { type: 'answer', choice: 1 });
    expect(error(a)).toMatch(/already answered/);
  });

  it('nobody answers for a player who runs out of time: no point', () => {
    started();
    act(b, { type: 'answer', choice: 0 });
    untilClosed();
    const r = view(a).game;
    expect(r.phase).toBe('reveal');
    expect(r.results[0].picks.you).toEqual({ choice: null, ms: ANSWER_MS });
    expect(r.players.find((p) => p.id === 'you')!.points).toBe(0);
    act(a, { type: 'answer', choice: 0 });
    expect(error(a)).toMatch(/Not your move/); // the result is on screen
  });

  it('refuses bad answers with a friendly message', () => {
    started();
    act(a, { type: 'answer', choice: 2 });
    expect(error(a)).toMatch(/two answers/);
    act(a, { type: 'shout' });
    expect(error(a)).toMatch(/isn’t part of this game/);
  });

  it('the card grid is sent only while it is studied, on the server’s clock', () => {
    started();
    let before = 0;
    for (let i = 0; i < 8; i++) before = playQuestion(); // cubes, blocks and grass come first
    expect(sent(a, 0, before)).not.toContain('"suit"'); // no card was sent before the study
    const v = view(a);
    expect(v.game.phase).toBe('memorize');
    expect(v.leftMs).toBe(STUDY_MS);
    const q = v.game.questions[8]!;
    if (q.data.kind !== 'memory') throw new Error('expected card memory');
    const cards = q.data.cards;
    expect(cards.every((c) => c !== null)).toBe(true);
    // what will be asked stays secret while studying
    expect(q.prompt).toBe('');
    expect(q.data.spots).toBeNull();
    expect(q.data.ask).toBeNull();
    // studying can't be answered or skipped
    act(a, { type: 'answer', choice: 0 });
    expect(error(a)).toMatch(/Study the cards/);
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    vi.advanceTimersByTime(STUDY_MS - 1);
    expect(view(a).game.phase).toBe('memorize');
    const from = count(a);
    vi.advanceTimersByTime(1);
    const open = view(a);
    expect(open.game.phase).toBe('answer');
    expect(open.leftMs).toBe(ANSWER_MS);
    const oq = open.game.questions[8]!;
    if (oq.data.kind !== 'memory') throw new Error('expected card memory');
    expect(oq.data.cards.every((c) => c === null)).toBe(true);
    expect(oq.answer).toBeNull();
    expect(sent(a, from)).not.toContain('"suit"');
    // answer times count from the question opening, not from the study
    vi.advanceTimersByTime(2000);
    act(a, { type: 'answer', choice: 0 });
    expect(view(a).game.picks.you.ms).toBe(2000);
    act(b, { type: 'answer', choice: 0 });
    untilClosed();
    // once closed only the two asked squares come out, never the rest of the grid
    const shown = view(a).game.questions[8]!;
    if (shown.data.kind !== 'memory') throw new Error('expected card memory');
    const spots = shown.data.spots!;
    expect(shown.data.cards.filter((c) => c !== null)).toHaveLength(2);
    for (let i = 0; i < 16; i++) {
      const text = JSON.stringify(cards[i]);
      if (spots.includes(i)) expect(sent(a, from)).toContain(text);
      else expect(sent(a, from)).not.toContain(text);
    }
  });

  it('a player who leaves is answered for by a bot from then on', () => {
    started();
    act(a, { type: 'answer', choice: 0 });
    vi.advanceTimersByTime(3000);
    say(b, { type: 'leave' });
    untilClosed();
    expect(view(a).game.results[0].picks.s1.choice).not.toBeNull();
    expect(view(a).game.results[0].picks.s1.ms).toBeGreaterThanOrEqual(3000);
  });

  it('a full match plays to the end and is recorded', () => {
    started(2);
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 500) vi.advanceTimersByTime(1000);
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('split-decision')).toEqual({ n: 1 });
  });
});

describe('Split Decision scoring', () => {
  it('ties go to the faster total time on right answers (wrong answers don’t count)', () => {
    const seats = [{ id: 'p', name: 'P', isBot: false }, { id: 'q', name: 'Q', isBot: false }];
    let s: OnlineState = start(seats, seededRng(5), 0);
    let t = 0;
    /** Both answer the current question at these times (ms after it opens), right or wrong; then go on. */
    const both = (p: [number, boolean] | null, q: [number, boolean] | null) => {
      if (s.game.phase === 'memorize') s = tick(s, (t = s.phaseAt + STUDY_MS));
      const open = s.phaseAt;
      const right = s.game.questions[s.game.index].answer;
      for (const [id, x] of [['p', p], ['q', q]] as const) {
        if (x) s = gameAct(s, id, { type: 'answer', choice: x[1] ? right : 1 - right }, open + x[0]);
      }
      s = tick(s, (t = open + ANSWER_MS)); // anyone left out runs out of time
      expect(s.game.phase).toBe('reveal');
      s = pause(s)!.next(s, (t += 1000));
    };
    both([9000, true], [3000, true]);
    both([5000, false], [500, false]); // Q's very fast wrong answer doesn't help
    both([1000, true], [100, false]);
    both([4000, false], [6000, true]);
    while (!over(s)) both(null, null);
    const [p, q] = s.game.players;
    expect([p.points, p.timeMs]).toEqual([2, 10_000]);
    expect([q.points, q.timeMs]).toEqual([2, 9000]);
    expect(results(s).map((r) => r.seat)).toEqual(['q', 'p']);
  });
});
