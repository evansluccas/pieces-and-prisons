/** Group B online games: Color Doubt, Deadeye Hold'em, High-Low Equations (turn-based with hidden hands). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState as DoubtState } from '../src/games/color-doubt/logic';
import { RESULT_MS as DOUBT_PAUSE } from '../src/games/color-doubt/online';
import type { GameState as DeadeyeState } from '../src/games/deadeye-holdem/logic';
import { RESULT_MS as DEADEYE_PAUSE } from '../src/games/deadeye-holdem/online';
import type { GameState as HiloState } from '../src/games/high-low-equations/logic';
import { bestFor, cardsOf } from '../src/games/high-low-equations/logic';
import { RESULT_MS as HILO_PAUSE } from '../src/games/high-low-equations/online';
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

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const game = (u: User) => last(u, 'game')!;
const view = <V>(u: User) => game(u).view as V;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);

function started(gameId: string, bots = 1) {
  say(a, { type: 'create', gameId });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

function playOut(gameId: string, pauseMs: number, turnMs = TURN_MS) {
  let guard = 0;
  while (room(a).status === 'playing' && guard++ < 2000) {
    vi.advanceTimersByTime(game(a).pauseUntil ? pauseMs : game(a).waiting || game(b).waiting ? turnMs + 10 : BOT_MAX_MS);
  }
  expect(room(a).status).toBe('over');
  expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get(gameId)).toEqual({ n: 1 });
  return room(a).results!;
}

describe('Color Doubt online', () => {
  it('rival hands are face down; bids go round; backing sides stay secret until the reveal', () => {
    started('color-doubt');
    const v = view<DoubtState>(a);
    expect(v.players.find((p) => p.id === 'you')!.hand).toHaveLength(5);
    expect(v.players.find((p) => p.name === 'Ben')!.hand).toEqual([null, null, null, null, null]);
    expect(v.turn).toBe('you');
    act(b, { type: 'doubt' });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'raise', count: 2, color: 'ruby' });
    expect(view<DoubtState>(b).turn).toBe('you');
    act(b, { type: 'doubt' });
    // the bot backs a side; then the bid is revealed
    vi.advanceTimersByTime(BOT_MAX_MS);
    const r = view<DoubtState>(a);
    expect(r.phase).toBe('reveal');
    expect(r.players.find((p) => p.name === 'Ben')!.hand.every((c) => c !== null)).toBe(true);
    expect(r.history[0].bids[0].player).toBe('you');
    expect(r.history[0].doubter).not.toBe('you');
  });

  it('a whole match plays out and is recorded', () => {
    started('color-doubt');
    expect(playOut('color-doubt', DOUBT_PAUSE).map((x) => x.place)).toEqual([1, 2, 3]);
  });
});

describe("Deadeye Hold'em online", () => {
  it('the deck and rival hole cards are never sent before a showdown', () => {
    started('deadeye-holdem');
    const va = view<DeadeyeState>(a);
    const vb = view<DeadeyeState>(b);
    expect(va.deck).toEqual([]);
    expect(va.players.find((p) => p.id === 'you')!.hole).toHaveLength(2);
    expect(va.players.find((p) => p.name === 'Ben')!.hole).toEqual([]);
    // Ben's hole cards appear nowhere in what Ana received
    const benHole = vb.players.find((p) => p.id === 'you')!.hole;
    for (const c of benHole) expect(sent(a)).not.toContain(JSON.stringify(c));
  });

  it('only the player to act may bet, and only legal bets', () => {
    started('deadeye-holdem');
    const turn = view<DeadeyeState>(a).toAct[0] === 'you' ? a : view<DeadeyeState>(b).toAct[0] === 'you' ? b : null;
    if (!turn) vi.advanceTimersByTime(BOT_MAX_MS);
    const who = view<DeadeyeState>(a).toAct[0] === 'you' ? a : b;
    const other = who === a ? b : a;
    act(other, { type: 'bet', action: 'check' });
    expect(error(other)).toMatch(/Not your move/);
    act(who, { type: 'bet', action: 'call' }); // nothing to call yet
    expect(error(who)).toMatch(/legal/);
    act(who, { type: 'bet', action: 'check' });
    expect(error(who)).toMatch(/legal/); // unchanged: the previous error
  });

  it('a whole match plays out and is recorded', () => {
    started('deadeye-holdem');
    const places = playOut('deadeye-holdem', DEADEYE_PAUSE).map((x) => x.place);
    expect(places).toEqual([1, 2, 3]);
  });
});

describe('High-Low Equations online', () => {
  it('the deck and rival hidden cards stay hidden; declarations are checked', () => {
    started('high-low-equations');
    const va = view<HiloState>(a);
    expect(va.deck).toEqual([]);
    expect(va.players.find((p) => p.id === 'you')!.hidden).not.toBeNull();
    expect(va.players.find((p) => p.name === 'Ben')!.hidden).toBeNull();
    // everyone checks/calls to the declaration
    let guard = 0;
    while (view<HiloState>(a).phase === 'bet' && guard++ < 50) {
      for (const u of [a, b]) if (game(u).waiting) act(u, { type: 'bet', action: view<HiloState>(u).currentBet > view<HiloState>(u).players.find((p) => p.id === 'you')!.streetBet ? 'call' : 'check' });
      vi.advanceTimersByTime(BOT_MAX_MS);
    }
    expect(view<HiloState>(a).phase).toBe('declare');
    expect(last(a, 'game')!.deadline! - Date.now()).toBeGreaterThan(TURN_MS); // building an equation gets longer
    act(a, { type: 'declare', declaration: { side: 'high', high: { terms: [{ value: 99, metal: 0, root: false }], ops: [] }, low: null } });
    expect(error(a)).toMatch(/exactly your cards/);
    const mine = bestFor(cardsOf(view<HiloState>(a).players.find((p) => p.id === 'you')!));
    act(a, { type: 'declare', declaration: { side: 'high', high: mine.high!.eq, low: null } });
    expect(view<HiloState>(b).players.find((p) => p.name === 'Ana')!.declared).toBeNull(); // "declared", contents hidden
  });

  it('a whole match plays out and is recorded', () => {
    started('high-low-equations');
    expect(playOut('high-low-equations', HILO_PAUSE, 90_000).map((x) => x.place)).toEqual([1, 2, 3]);
  });
});
