/** The shared puzzle-race engine, tested with a tiny "guess the number" puzzle. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT_MS, RacePuzzle, RaceView, race } from '../src/games/shared/race';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { ONLINE_GAMES } from './games';
import { ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

interface Toy { answer: number }
interface Mine { wrong: number }

const toy = (studyMs = 0): RacePuzzle<Toy, Mine> => ({
  rounds: 2,
  make: (rng) => ({ answer: 1 + Math.floor(rng() * 9) }),
  limitMs: () => 60_000,
  studyMs: studyMs ? () => studyMs : undefined,
  init: () => ({ wrong: 0 }),
  act(p, mine, a) {
    const n = Number((a as { n?: unknown })?.n);
    if (!Number.isInteger(n)) throw new Error('Guess a number.');
    if (n !== p.answer) return { mine: { wrong: mine.wrong + 1 }, penaltyMs: 30_000 };
    return { mine, finish: { points: 1, detail: mine.wrong ? `${mine.wrong} wrong` : '' } };
  },
  view: (p, stage, mine) => ({ answer: stage === 'result' || stage === 'over' ? p.answer : null, wrong: mine?.wrong ?? 0 }),
  bot: () => ({ ms: 20_000, points: 1 }),
});

let db: Db;
let inbox: Map<number, ServerMessage[]>;
let rooms: Rooms;
let a: User;
let b: User;

function register(id: string, p: RacePuzzle<Toy, Mine>) {
  const r = race(p);
  ONLINE_GAMES[id] = { id, minPlayers: 1, maxPlayers: 6, ...r };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  db = openDb(':memory:');
  inbox = new Map();
  rooms = new Rooms((id, m) => inbox.set(id, [...(inbox.get(id) ?? []), m]), db);
  a = guest(db, 'Ana').user;
  b = guest(db, 'Ben').user;
  register('toy-race', toy());
  register('toy-study', toy(5000));
});
afterEach(() => {
  delete ONLINE_GAMES['toy-race'];
  delete ONLINE_GAMES['toy-study'];
  vi.useRealTimers();
});

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const view = (u: User) => last(u, 'game')!.view as RaceView;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** The answer, read from the server's own state. */
const answer = () => {
  const r = (rooms as unknown as { rooms: Map<string, { state: { puzzles: Toy[]; round: number } }> }).rooms;
  const s = [...r.values()][0].state;
  return s.puzzles[s.round].answer;
};

function started(gameId = 'toy-race', bots = 0) {
  say(a, { type: 'create', gameId });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

describe('puzzle races', () => {
  it('times each player on the server, adds penalties, and hides the answer until the round ends', () => {
    started();
    expect(view(a).stage).toBe('solve');
    expect((view(a).puzzle as { answer: number | null }).answer).toBeNull();
    vi.advanceTimersByTime(4000);
    act(a, { n: answer() === 1 ? 2 : 1 }); // wrong: +30 s
    expect(view(a).me!.penaltyMs).toBe(30_000);
    act(a, { n: answer() });
    expect(view(a).me!.result).toMatchObject({ finished: true, ms: 34_000, points: 1, detail: '1 wrong' });
    // Ben sees that Ana finished, and her time — but not the answer
    expect(view(b).board.find((r) => r.name === 'Ana')!.round!.ms).toBe(34_000);
    expect((view(b).puzzle as { answer: number | null }).answer).toBeNull();
    act(a, { n: answer() });
    expect(error(a)).toMatch(/finished/);
    vi.advanceTimersByTime(6000);
    act(b, { n: answer() });
    // everyone done: the round closes and the answer shows
    expect(view(b).stage).toBe('result');
    expect((view(b).puzzle as { answer: number }).answer).toBe(answer());
    expect(view(b).board.map((r) => r.name)).toEqual(['You', 'Ana']); // Ben 10 s beats Ana 34 s
  });

  it('a time limit ends the round; whoever is still working scores "not finished"', () => {
    started();
    act(a, { n: answer() });
    vi.advanceTimersByTime(60_000);
    const v = view(b);
    expect(v.stage).toBe('result');
    expect(v.me!.result).toMatchObject({ finished: false, ms: 60_000, points: 0, detail: 'not finished' });
    act(b, { n: answer() });
    expect(error(b)).toMatch(/Not your move|round is over/); // the table is paused on the result
  });

  it('a study phase comes first, timed by the server; moves wait for it', () => {
    started('toy-study');
    expect(view(a).stage).toBe('study');
    act(a, { n: 1 });
    expect(error(a)).toMatch(/Study first/);
    vi.advanceTimersByTime(5000);
    expect(view(a).stage).toBe('solve');
    vi.advanceTimersByTime(2000);
    act(a, { n: answer() });
    expect(view(a).me!.result!.ms).toBe(2000); // counted from when solving opened
  });

  it('bots finish on their own; a whole race is played, ranked and recorded', () => {
    started('toy-race', 1);
    for (let round = 0; round < 2; round++) {
      vi.advanceTimersByTime(round === 0 ? 3000 : 1000);
      act(a, { n: answer() });
      act(b, { n: answer() === 1 ? 2 : 1 }); // Ben guesses wrong once, then gives up
      vi.advanceTimersByTime(25_000); // the bot finishes at 20 s
      expect(view(a).board.find((r) => r.name === 'Hana')!.round).toMatchObject({ finished: true, ms: 20_000 });
      vi.advanceTimersByTime(60_000 - 25_000 - (round === 0 ? 3000 : 1000)); // time's up for Ben
      expect(view(a).stage).toBe('result');
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => [r.name, r.place])).toEqual([['Ana', 1], ['Hana', 2], ['Ben', 3]]);
    expect(room(a).results![0].detail).toBe('2 points, 0:04');
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'toy-race'").get()).toEqual({ n: 1 });
  });

  it('someone leaving mid-round is finished by a bot', () => {
    started();
    say(b, { type: 'leave' });
    vi.advanceTimersByTime(3000);
    act(a, { n: answer() });
    vi.advanceTimersByTime(18_000); // the bot finishes at 20 s, which ends the round
    expect(view(a).stage).toBe('result');
    const ben = view(a).board.find((r) => r.name.startsWith('Ben'))!;
    expect(ben.round).toMatchObject({ finished: true, points: 1 });
  });
});
