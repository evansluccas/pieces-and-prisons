/** Ask & Arrange online: a duel where each row stays secret until both have guessed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_MS as AA_TURN_MS, View } from '../src/games/ask-and-arrange/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { BOT_MAX_MS, ClientMessage, RoomView, Rooms, ServerMessage } from './rooms';

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
const view = (u: User) => game(u).view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);

const ANA_ROW = [3, 1, 4, 8, 5, 2, 7, 6];
const BEN_ROW = [6, 2, 8, 1, 7, 3, 5, 4];
const BEN_GUESS = [2, 6, 5, 8, 1, 4, 7, 3];

function started() {
  say(a, { type: 'create', gameId: 'ask-and-arrange' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'start' });
}

/** Both rows locked in; returns [who asks first, the other]. */
function arranged(): [User, User] {
  started();
  act(a, { type: 'arrange', row: ANA_ROW });
  act(b, { type: 'arrange', row: BEN_ROW });
  return view(a).game.turn === 0 ? [a, b] : [b, a];
}

describe('Ask & Arrange online', () => {
  it('both arrange at once; your row is yours alone, and bad rows are refused', () => {
    started();
    expect(game(a).waiting).toBe(true);
    expect(game(b).waiting).toBe(true);
    expect(view(a).game.phase).toBe('setup');
    act(a, { type: 'arrange', row: [1, 1, 2, 3, 4, 5, 6, 7] });
    expect(error(a)).toMatch(/each card/);
    act(a, { type: 'arrange', row: 'nope' });
    expect(error(a)).toMatch(/each card/);
    act(a, { type: 'arrange', row: ANA_ROW });
    const va = view(a);
    expect(va.locked).toBe(true);
    expect(va.game.rows[0]).toEqual(ANA_ROW);
    expect(game(a).waiting).toBe(false);
    expect(view(b).locked).toBe(false);
    expect(view(b).game.rows).toEqual([[], []]);
    expect(sent(b)).not.toContain(JSON.stringify(ANA_ROW));
    act(b, { type: 'arrange', row: BEN_ROW });
    expect(view(a).game.phase).toBe('ask');
    expect(view(b).game.rows).toEqual([BEN_ROW, []]);
    expect(view(a).opponent).toBe('Ben');
    expect(view(b).opponent).toBe('Ana');
  });

  it('turns alternate; illegal questions and moves out of turn are refused', () => {
    const [first, second] = arranged();
    expect(view(first).game.turn).toBe(0);
    expect(view(second).game.turn).toBe(1);
    act(second, { type: 'ask', q: { kind: 'compare', a: 0, b: 1 } });
    expect(error(second)).toMatch(/Not your move/);
    act(first, { type: 'ask', q: { kind: 'sum', a: 0, b: 6 } });
    expect(error(first)).toMatch(/valid question/);
    act(first, { type: 'ask', q: { kind: 'riddle' } });
    expect(error(first)).toMatch(/Pick a question/);
    act(first, { type: 'arrange', row: ANA_ROW });
    expect(error(first)).toMatch(/already arranged/);
    act(first, { type: 'ask', q: { kind: 'slot', a: 2 } });
    const theirs = first === a ? BEN_ROW : ANA_ROW;
    // the asker sees the true answer and pays for it
    const v = view(first).game;
    expect(v.asked).toEqual([{ by: 0, q: { kind: 'slot', a: 2 }, answer: theirs[2] }]);
    expect(v.tokens).toEqual([7, 10]);
    // the asked player sees the question about their own row, as in solo
    const w = view(second).game;
    expect(w.asked[0].by).toBe(1);
    expect(w.tokens).toEqual([10, 7]);
    expect(w.turn).toBe(0);
  });

  it('the rival row and guess are never sent before both have guessed', () => {
    const [first, second] = arranged();
    act(first, { type: 'guess', row: [1, 2, 3, 4, 5, 6, 7] });
    expect(error(first)).toMatch(/each card/);
    const guessRow = first === b ? BEN_GUESS : [8, 7, 6, 5, 4, 3, 2, 1];
    act(first, { type: 'guess', row: guessRow });
    // the one who guessed stops asking: the other keeps the turn
    expect(view(second).game.turn).toBe(0);
    expect(view(second).game.guesses).toEqual([null, null]);
    expect(view(first).game.guesses[0]).toEqual(guessRow);
    act(second, { type: 'ask', q: { kind: 'compare', a: 0, b: 1 } });
    expect(view(second).game.turn).toBe(0);
    expect(sent(a)).not.toContain(JSON.stringify(BEN_ROW));
    expect(sent(b)).not.toContain(JSON.stringify(ANA_ROW));
    expect(sent(second)).not.toContain(JSON.stringify(guessRow));
    act(second, { type: 'guess', row: [...(second === a ? BEN_ROW : ANA_ROW)] });
    // the reveal: both rows and guesses, from each side
    expect(room(a).status).toBe('over');
    const va = view(a).game;
    expect(va.phase).toBe('gameOver');
    expect(va.rows).toEqual([ANA_ROW, BEN_ROW]);
    expect(view(b).game.rows).toEqual([BEN_ROW, ANA_ROW]);
    const winnerSeat = room(a).results!.find((r) => r.place === 1)!;
    expect(winnerSeat.detail).toMatch(/won, 8\/8 right/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('ask-and-arrange')).toEqual({ n: 1 });
  });

  it('a whole match plays out with time-outs and a bot, and is recorded', () => {
    started();
    say(a, { type: 'leave' }); // Ana leaves: a bot takes her seat
    let guard = 0;
    while (room(b).status === 'playing' && guard++ < 200) {
      vi.advanceTimersByTime(game(b).waiting ? AA_TURN_MS + 10 : BOT_MAX_MS);
    }
    expect(room(b).status).toBe('over');
    expect([[1, 1], [1, 2]]).toContainEqual(room(b).results!.map((r) => r.place).sort());
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('ask-and-arrange')).toEqual({ n: 1 });
    const v = view(b).game;
    expect(v.guesses[0]).not.toBeNull();
    expect(v.guesses[1]).not.toBeNull();
  }, 60_000);
});
