/** Hex Sum online: a memory duel — the board is only sent while both players study it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINES, lineSum } from '../src/games/hex-sum/logic';
import { RESULT_MS, STUDY_MS, View } from '../src/games/hex-sum/online';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { BOT_MAX_MS, ClientMessage, RoomView, Rooms, ServerMessage, TURN_MS } from './rooms';

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

const msgs = (u: User) => inbox.get(u.id) ?? [];
const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...msgs(u)].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const game = (u: User) => last(u, 'game')!;
const view = (u: User) => game(u).view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;

/** Ana and Ben at a table (or Ana and a bot). */
function started(withBot = false) {
  say(a, { type: 'create', gameId: 'hex-sum' });
  if (withBot) say(a, { type: 'addBot' });
  else say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'start' });
}

function playOut() {
  let guard = 0;
  while (room(a).status === 'playing' && guard++ < 2000) {
    vi.advanceTimersByTime(game(a).pauseUntil ? STUDY_MS : game(a).waiting || (inbox.has(b.id) && game(b).waiting) ? TURN_MS + 10 : BOT_MAX_MS);
  }
  expect(room(a).status).toBe('over');
  expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('hex-sum')).toEqual({ n: 1 });
  return room(a).results!;
}

/** The whole board, as sent while studying. */
function board(u: User): number[] {
  const v = view(u);
  expect(v.game.phase).toBe('memorize');
  return v.game.values as number[];
}

/** An open line that hits the current target. */
const hitting = (values: number[], v: View) =>
  LINES.findIndex((_, i) => !v.game.claimed.includes(i) && lineSum(values, i) === v.game.target);
/** An open line that misses (and wasn't tried this round). */
const missing = (values: number[], v: View) =>
  LINES.findIndex((_, i) => !v.game.claimed.includes(i) && lineSum(values, i) !== v.game.target
    && !v.game.attempts.some((t) => t.round === v.game.round && t.line === i));

/**
 * Every message sent after studying ended: in play, a tile's number is only
 * there if that tile has been flipped; nothing else carries the board.
 */
function checkHidden(messages: ServerMessage[], values: number[]) {
  let checked = 0;
  for (const m of messages) {
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/"memory"|"rng"/);
    // the end screen shows the whole board, as in solo play
    if (m.type === 'game' && (m.view as View).game.phase === 'gameOver') continue;
    if (m.type !== 'game') {
      expect(text).not.toContain(values.join(','));
      continue;
    }
    const g = (m.view as View).game;
    expect(g.phase).toBe('play');
    const up = new Set(g.attempts.flatMap((t) => LINES[t.line]));
    // the whole board may be in the message only once every tile has been flipped
    if (up.size < values.length) expect(text).not.toContain(values.join(','));
    g.values.forEach((v, i) => expect(v).toBe(up.has(i) ? values[i] : null));
    checked++;
  }
  return checked;
}

describe('Hex Sum online', () => {
  it('sends the board while studying, then only flipped tiles', () => {
    started();
    const values = board(a);
    expect(values.every((v) => v >= 1 && v <= 9)).toBe(true);
    expect(view(b).game.values).toEqual(values);
    expect(game(a).pauseUntil).not.toBeNull();
    expect(game(a).waiting).toBe(false);

    // the server times the study: nearly done, still studying
    vi.advanceTimersByTime(STUDY_MS - 100);
    expect(view(a).game.phase).toBe('memorize');
    const fromA = msgs(a).length;
    const fromB = msgs(b).length;
    vi.advanceTimersByTime(100);
    expect(view(a).game.phase).toBe('play');
    expect(view(a).game.values.every((v) => v === null)).toBe(true);
    expect(game(a).waiting).toBe(true);

    // a miss flips three tiles up for both players; the rest stay hidden
    const miss = missing(values, view(a));
    act(a, { type: 'flip', tiles: LINES[miss] });
    expect(view(b).game.values.filter((v) => v !== null)).toHaveLength(3);
    LINES[miss].forEach((i) => expect(view(b).game.values[i]).toBe(values[i]));

    // play on to the end (timeouts move for both); nothing leaks on the way
    playOut();
    expect(checkHidden(msgs(a).slice(fromA), values)).toBeGreaterThan(5);
    expect(checkHidden(msgs(b).slice(fromB), values)).toBeGreaterThan(5);
    // the whole board is shown at the end, as in solo play
    expect(view(a).game.phase).toBe('gameOver');
    expect(view(a).game.values).toEqual(values);
  });

  it('studying ends early only when both players are ready', () => {
    started();
    say(a, { type: 'ready' });
    expect(view(a).game.phase).toBe('memorize');
    say(b, { type: 'ready' });
    expect(view(a).game.phase).toBe('play');
    expect(view(b).game.values.every((v) => v === null)).toBe(true);
  });

  it('the second seat sees the sides swapped', () => {
    started();
    const values = board(a);
    expect(view(a).opponent).toBe('Ben');
    expect(view(b).opponent).toBe('Ana');
    vi.advanceTimersByTime(STUDY_MS);
    expect(view(a).game.turn).toBe(0);
    expect(view(b).game.turn).toBe(1);
    expect(game(b).waiting).toBe(false);

    act(a, { type: 'flip', tiles: LINES[missing(values, view(a))] });
    expect(view(a).game.attempts[0].side).toBe(0);
    expect(view(b).game.attempts[0].side).toBe(1);
    expect(view(b).game.turn).toBe(0);

    act(b, { type: 'flip', tiles: LINES[hitting(values, view(b))] });
    expect(view(b).game.scores).toEqual([1, 0]);
    expect(view(a).game.scores).toEqual([0, 1]);
  });

  it('refuses moves out of turn and illegal picks; a hit shows the result, then the next round', () => {
    started();
    const values = board(a);
    const line = LINES[hitting(values, view(a))];
    act(a, { type: 'flip', tiles: line });
    expect(error(a)).toMatch(/Not your move/);
    vi.advanceTimersByTime(STUDY_MS);

    act(b, { type: 'flip', tiles: line });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'pass' });
    expect(error(a)).toMatch(/isn’t part of this game/);
    for (const tiles of [undefined, [0, 1], [0, 0, 1], [0, 1, 99], [0, 1.5, 2], ['0', '1', '2']]) {
      act(a, { type: 'flip', tiles });
      expect(error(a)).toMatch(/three different tiles/);
    }
    act(a, { type: 'flip', tiles: [0, 1, 18] });
    expect(error(a)).toMatch(/straight line/);
    expect(view(a).game.attempts).toHaveLength(0);

    // a hit: Ana scores, the line is claimed, and the result stays up
    act(a, { type: 'flip', tiles: [...line].reverse() });
    expect(view(a).game.scores).toEqual([1, 0]);
    expect(view(a).roundOver).toBe(true);
    expect(view(a).game.round).toBe(2);
    expect(game(a).pauseUntil).not.toBeNull();
    expect(game(b).waiting).toBe(false);
    act(b, { type: 'flip', tiles: LINES[missing(values, view(b))] });
    expect(error(b)).toMatch(/Not your move/);

    // the next round starts after the pause, with Ben first
    vi.advanceTimersByTime(RESULT_MS);
    expect(view(a).roundOver).toBe(false);
    expect(game(b).waiting).toBe(true);
    act(b, { type: 'flip', tiles: line });
    expect(error(b)).toMatch(/already claimed/);
  });

  it('a whole match against a bot plays out and is recorded', () => {
    started(true);
    const values = board(a);
    vi.advanceTimersByTime(STUDY_MS);
    const from = msgs(a).length;
    const results = playOut();
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.place).sort()).toEqual(results.some((r) => r.detail.startsWith('draw')) ? [1, 1] : [1, 2]);
    expect(results[0].detail).toMatch(/rounds$/);
    checkHidden(msgs(a).slice(from), values);
    const rows = db.prepare('SELECT name FROM match_players ORDER BY seat').all() as { name: string }[];
    expect(rows[0].name).toBe('Ana');
  });
});
