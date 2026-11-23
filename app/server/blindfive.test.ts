/** Blind Five online: a duel where every stone is face down — owners must never reach a browser before the end. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWN, Side, at, lineBetween } from '../src/games/blind-five/logic';
import * as blindFive from '../src/games/blind-five/online';
import type { View } from '../src/games/blind-five/online';
import { seededRng } from '../src/games/shared/rng';
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
/** Every game view the server sent this person. */
const views = (u: User) => (inbox.get(u.id) ?? []).filter((m) => m.type === 'game').map((m) => (m as { view: View }).view);

function started(bots = 0) {
  say(a, { type: 'create', gameId: 'blind-five' });
  if (!bots) say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/**
 * Nothing sent before the end may say whose a stone is: every stone is DOWN,
 * the move list is empty, and the only ring is on the opponent's newest stone.
 * `owner` is the real board, kept by the test (0 = Ana, 1 = Ben).
 */
function checkSealed(u: User, me: Side, owner: Map<number, Side>) {
  for (const v of views(u)) {
    const sc = v.screen;
    if (sc.winner !== null) continue;
    expect(sc.board.every((x) => x === null || x === DOWN)).toBe(true);
    expect(sc.history).toEqual([]);
    expect(Object.keys(sc).sort()).toEqual(['board', 'call', 'history', 'moves', 'ring', 'strikes', 'turn', 'winLine', 'winner']);
    expect(sc.winLine).toBeNull();
    if (sc.ring !== null) expect(owner.get(sc.ring)).toBe(1 - me); // never one of your own
  }
}

describe('Blind Five online', () => {
  it('shows the real opponent name; turns alternate; bad moves are refused', () => {
    started();
    expect(view(a).opponent).toBe('Ben');
    expect(view(b).opponent).toBe('Ana');
    expect(view(a).screen.turn).toBe(0);
    expect(view(b).screen.turn).toBe(1);
    expect(game(a).waiting).toBe(true);
    act(b, { type: 'place', cell: 0 });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'place', cell: 999 });
    expect(error(a)).toMatch(/square on the board/);
    act(a, { type: 'place', cell: '5' });
    expect(error(a)).toMatch(/square on the board/);
    act(a, { type: 'jump' });
    expect(error(a)).toMatch(/isn’t part of this game/);
    act(a, { type: 'call', cells: [1, 2, 3] });
    expect(error(a)).toMatch(/five stones/);
    act(a, { type: 'call', cells: lineBetween(0, 4) });
    expect(error(a)).toMatch(/straight line/); // empty squares
    act(a, { type: 'place', cell: 60 });
    expect(view(b).screen.turn).toBe(0);
    expect(game(b).waiting).toBe(true);
    act(b, { type: 'place', cell: 60 });
    expect(error(b)).toMatch(/already has a stone/);
    act(a, { type: 'place', cell: 61 });
    expect(error(a)).toMatch(/Not your move/);
  });

  it('never sends the owner of a face-down stone to either player — not even your own', () => {
    started();
    const owner = new Map<number, Side>();
    const place = (u: User, side: Side, cell: number) => {
      act(u, { type: 'place', cell });
      owner.set(cell, side);
      // the stone you just placed is face down on your own screen too, and not ringed
      expect(view(u).screen.board[cell]).toBe(DOWN);
      expect(view(u).screen.ring).toBeNull();
      // the opponent sees it ringed (as in solo), still face down
      const other = u === a ? b : a;
      expect(view(other).screen.board[cell]).toBe(DOWN);
      expect(view(other).screen.ring).toBe(cell);
    };
    // Ana builds a row (0,5)…(4,5); Ben builds a row (0,6)…(4,6)
    for (let x = 0; x < 5; x++) {
      place(a, 0, at(x, 5));
      place(b, 1, at(x, 6));
    }
    // Ben calls Ana's row: a strike, and nothing more is learned
    act(a, { type: 'place', cell: at(9, 9) });
    owner.set(at(9, 9), 0);
    act(b, { type: 'call', cells: lineBetween(at(0, 5), at(4, 5)) });
    expect(error(b)).toBeUndefined();
    const vb = view(b).screen;
    expect(vb.strikes).toEqual([1, 0]);
    expect(vb.call).toEqual({ side: 0, cells: lineBetween(at(0, 5), at(4, 5)), ok: false });
    expect(view(a).screen.call).toMatchObject({ side: 1, ok: false });
    expect(view(a).screen.ring).toBeNull();
    checkSealed(a, 0, owner);
    checkSealed(b, 1, owner);
    // the real board never appears in any message, in either seat's colours
    const real = (me: Side) => JSON.stringify([...Array(121).keys()].map((c) => (owner.has(c) ? (owner.get(c) === me ? 0 : 1) : null)));
    for (const [u, me] of [[a, 0], [b, 1]] as const) {
      const text = JSON.stringify(inbox.get(u.id));
      expect(text).not.toContain(real(me));
      expect(text).not.toContain(real((1 - me) as Side));
      expect(text).not.toMatch(/"history":\[\{/);
    }
    // Ana calls her own row and wins: now everything is turned over
    act(a, { type: 'call', cells: lineBetween(at(0, 5), at(4, 5)) });
    expect(room(a).status).toBe('over');
    const end = view(b).screen;
    expect(end.winner).toBe(1); // Ana, from Ben's side
    expect(end.board[at(0, 5)]).toBe(1);
    expect(end.board[at(0, 6)]).toBe(0);
    expect(end.history.length).toBe(13);
    expect(room(a).results!.find((r) => r.place === 1)!.detail).toMatch(/called five/);
  });

  it('bots remember like the solo bot: imperfectly, per seat', () => {
    const rng = seededRng(7);
    let s = blindFive.start([{ id: 'p0', name: 'Ana' }, { id: 'p1', name: 'Bot' }], rng);
    let guard = 0;
    while (!blindFive.over(s) && guard++ < 60) {
      const seat = blindFive.waitingOn(s)[0];
      s = blindFive.act(s, seat, blindFive.botAction(s, seat, rng));
    }
    // each seat remembers some stones, but not the whole board exactly
    const placed = s.game.board.filter((x) => x !== null).length;
    for (const side of [0, 1] as Side[]) {
      const mem = s.mems[side];
      expect(mem.size).toBeGreaterThan(0);
      const exact = [...mem].filter(([c, who]) => s.game.board[c] === who).length;
      expect(exact).toBeLessThan(placed);
    }
    expect(s.mems[0]).not.toBe(s.mems[1]);
  });

  it('a player vs a bot: the bot answers', () => {
    started(1);
    expect(view(a).opponent).not.toBe('Ana');
    act(a, { type: 'place', cell: 60 });
    vi.advanceTimersByTime(BOT_MAX_MS);
    expect(view(a).screen.moves).toBe(2);
    expect(view(a).screen.ring).not.toBeNull();
    expect(game(a).waiting).toBe(true);
  });

  it('a whole duel plays out and is recorded, with nothing leaked on the way', () => {
    started();
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 400) vi.advanceTimersByTime(TURN_MS + 10);
    expect(room(a).status).toBe('over');
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('blind-five')).toEqual({ n: 1 });
    const places = room(a).results!.map((r) => r.place).sort();
    expect([[1, 2], [1, 1]]).toContainEqual(places);
    for (const u of [a, b]) {
      for (const v of views(u)) if (v.screen.winner === null) {
        expect(v.screen.board.every((x) => x === null || x === DOWN)).toBe(true);
        expect(v.screen.history).toEqual([]);
      }
    }
    const end = view(a).screen;
    expect(end.board.every((x) => x !== DOWN)).toBe(true);
  });
});
