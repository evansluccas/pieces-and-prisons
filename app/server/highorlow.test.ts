/** High or Low online: a duel where the dealer's face-down card stays secret until the call. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVEAL_MS, View } from '../src/games/high-or-low/online';
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
const view = (u: User) => game(u).view as View;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);

function started() {
  say(a, { type: 'create', gameId: 'high-or-low' });
  say(b, { type: 'join', code: room(a).code });
  say(a, { type: 'start' });
}

/** The two players: who deals this round and who calls. */
const roles = () => (view(a).game.dealer === 0 ? { dealer: a, guesser: b } : { dealer: b, guesser: a });

describe('High or Low online', () => {
  it('both see themselves as side 0: sides swapped for the second seat, with names', () => {
    started();
    const va = view(a);
    const vb = view(b);
    expect(va.opponent).toBe('Ben');
    expect(vb.opponent).toBe('Ana');
    expect(va.game.dealer).toBe(1 - vb.game.dealer); // the same dealer, seen from each side
    expect(va.game.phase).toBe('deal');
    expect(va.game.hands).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
    const { dealer, guesser } = roles();
    expect(game(dealer).waiting).toBe(true);
    expect(game(guesser).waiting).toBe(false);
  });

  it('the face-down card is the dealer’s secret until the call; then both see it', () => {
    started();
    const { dealer, guesser } = roles();
    act(dealer, { type: 'deal', shown: 3, hidden: 8 });
    expect(view(dealer).game.hidden).toBe(8);
    expect(view(guesser).game.hidden).toBeNull();
    expect(view(guesser).game.shown).toBe(3);
    expect(game(guesser).waiting).toBe(true);
    // the secret is nowhere in what the guesser was sent
    expect(sent(guesser)).not.toContain('"hidden":8');
    expect(sent(guesser)).not.toMatch(/"hidden":\d/);
    act(guesser, { type: 'call', call: 'higher' });
    // the reveal: both see the cards and the round result, and a pause
    for (const u of [dealer, guesser]) {
      const v = view(u);
      expect(v.reveal).toBe(true);
      expect(v.game.history[0]).toMatchObject({ shown: 3, hidden: 8, call: 'higher', right: true });
      expect(game(u).pauseUntil).not.toBeNull();
      expect(game(u).waiting).toBe(false);
    }
    // the guesser scored: each sees it on their own side
    expect(view(guesser).game.scores).toEqual([1, 0]);
    expect(view(dealer).game.scores).toEqual([0, 1]);
    expect(view(guesser).game.history[0].dealer).toBe(1);
    expect(view(dealer).game.history[0].dealer).toBe(0);
    expect(view(guesser).game.hands[1]).not.toContain(8);
  });

  it('Ready from both ends the pause; then the other player deals', () => {
    started();
    const { dealer, guesser } = roles();
    act(dealer, { type: 'deal', shown: 5, hidden: 1 });
    act(guesser, { type: 'call', call: 'higher' }); // wrong: the dealer scores
    expect(view(dealer).game.scores).toEqual([1, 0]);
    say(a, { type: 'ready' });
    expect(game(a).pauseUntil).not.toBeNull();
    say(b, { type: 'ready' });
    expect(game(a).pauseUntil).toBeNull();
    expect(view(a).reveal).toBe(false);
    expect(game(guesser).waiting).toBe(true); // the deal has passed over
    expect(view(guesser).game.dealer).toBe(0);
    // the new dealer's secret stays from the first dealer
    act(guesser, { type: 'deal', shown: 9, hidden: 10 });
    expect(view(dealer).game.hidden).toBeNull();
    expect(sent(dealer)).not.toContain('"hidden":10');
  });

  it('turn order and illegal moves are refused with a friendly message', () => {
    started();
    const { dealer, guesser } = roles();
    act(guesser, { type: 'deal', shown: 1, hidden: 2 });
    expect(error(guesser)).toMatch(/Not your move/);
    act(dealer, { type: 'call', call: 'higher' });
    expect(error(dealer)).toMatch(/Not your call/);
    act(dealer, { type: 'deal', shown: 4, hidden: 4 });
    expect(error(dealer)).toMatch(/two different cards/);
    act(dealer, { type: 'deal', shown: 4, hidden: 11 });
    expect(error(dealer)).toMatch(/two different cards/);
    act(dealer, { type: 'deal', shown: 'x', hidden: 2 });
    expect(error(dealer)).toMatch(/Pick two/);
    act(dealer, { type: 'peek' });
    expect(error(dealer)).toMatch(/isn’t part of this game/);
    act(dealer, { type: 'deal', shown: 4, hidden: 2 });
    act(guesser, { type: 'call', call: 'sideways' });
    expect(error(guesser)).toMatch(/HIGHER or LOWER/);
    act(guesser, { type: 'call', call: 'lower' });
    expect(view(a).reveal).toBe(true);
    act(dealer, { type: 'deal', shown: 6, hidden: 7 }); // during the reveal
    expect(error(dealer)).toMatch(/Not your move/);
    // a used card can't be dealt again
    vi.advanceTimersByTime(REVEAL_MS);
    act(guesser, { type: 'deal', shown: 1, hidden: 2 }); // fine: the guesser's own cards are untouched
    act(dealer, { type: 'call', call: 'higher' });
    vi.advanceTimersByTime(REVEAL_MS);
    act(dealer, { type: 'deal', shown: 4, hidden: 5 });
    expect(error(dealer)).toMatch(/two different cards/);
  });

  it('a whole duel plays out, 10 rounds, and is recorded; no secret ever leaked', () => {
    started();
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 200) {
      vi.advanceTimersByTime(game(a).pauseUntil ? REVEAL_MS : game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
    }
    expect(room(a).status).toBe('over');
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('high-or-low')).toEqual({ n: 1 });
    const results = room(a).results!;
    expect([[1, 2], [1, 1]]).toContainEqual(results.map((r) => r.place).sort());
    const final = view(a).game;
    expect(final.history).toHaveLength(10);
    expect(final.scores[0] + final.scores[1]).toBe(10);
    expect(final.hands).toEqual([[], []]);
    // no face-down card was ever sent to anyone but its dealer before the call
    for (const u of [a, b]) {
      const views = (inbox.get(u.id) ?? []).filter((m) => m.type === 'game').map((m) => (m as { view: View }).view);
      for (const v of views) if (v.game.phase === 'call' && v.game.dealer === 1) expect(v.game.hidden).toBeNull();
    }
  });
});
