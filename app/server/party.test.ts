/** The Party at an online table: the board, mini-games played inside it, bots and clocks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededRng } from '../src/games/shared/rng';
import type { PartyView } from './games/party';
import { INTRO_MS, MINIS } from './games/party';
import { User, guest } from './auth';
import { Db, openDb } from './db';
import { ONLINE_GAMES } from './games';
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
afterEach(() => vi.useRealTimers());

const last = <T extends ServerMessage['type']>(u: User, type: T) =>
  [...(inbox.get(u.id) ?? [])].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const room = (u: User) => last(u, 'room')!.room as RoomView;
const view = (u: User) => last(u, 'game')!.view as PartyView;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
const state = () => [...(rooms as unknown as { rooms: Map<string, { state: any }> }).rooms.values()][0].state;

function party(bots: number) {
  say(a, { type: 'create', gameId: 'party' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Play like a quick person: roll, pick a rival, and in turn-based mini-games make the bot's move. */
function playFor(u: User) {
  const v = view(u);
  if (v.stage === 'board' && v.board.order[v.board.turn] === v.me) {
    if (v.board.phase === 'roll') act(u, { type: 'roll' });
    else act(u, { type: 'duel', rival: v.board.order.find((x) => x !== v.me) });
  } else if (v.stage === 'mini' && v.mini?.playing && v.mini.waiting) {
    const s = state();
    const g = ONLINE_GAMES[s.mini.id];
    if (!g.realtime) act(u, { type: 'mini', action: g.botAction(s.mini.state, v.me!, seededRng(1)) });
  }
}

describe('party', () => {
  it('needs 2, 4, 6 or 8 players', () => {
    say(a, { type: 'create', gameId: 'party' });
    say(b, { type: 'join', code: room(a).code });
    say(a, { type: 'addBot' });
    say(a, { type: 'start' });
    expect(error(a)).toMatch(/2, 4, 6 or 8/);
    expect(room(a).status).toBe('lobby');
  });

  it('turns go in order; only the player whose turn it is may roll; a person who waits too long rolls automatically', () => {
    party(2);
    const v = view(a);
    expect(v.stage).toBe('board');
    const first = v.board.order[0];
    const other = [a, b].find((u) => view(u).me !== first && v.board.order.includes(view(u).me!));
    if (other && view(other).me !== first) {
      act(other, { type: 'roll' });
      expect(error(other)).toMatch(/your turn/);
    }
    // whoever is first, 30 s later the board moves on by itself
    vi.advanceTimersByTime(31_000);
    expect(state().board.notes.some((n: { text: string }) => /rolled/.test(n.text))).toBe(true);
  });

  it('after a round comes a mini-game: an intro card, then the game itself inside the party', () => {
    party(2);
    let guard = 0;
    while (state().stage !== 'intro' && guard++ < 200) {
      playFor(a);
      playFor(b);
      vi.advanceTimersByTime(2000);
    }
    const v = view(a);
    expect(v.stage).toBe('intro');
    expect(v.next!.kind === 'ffa' || v.next!.kind === 'teams' || v.next!.kind === 'duel').toBe(true);
    expect(MINIS.map((m) => m.id)).toContain(v.next!.id);
    vi.advanceTimersByTime(INTRO_MS);
    const m = view(a);
    expect(m.stage).toBe('mini');
    if (m.mini!.playing) expect(m.mini!.view).toBeTruthy();
  });

  it('a whole party plays out with every kind of mini-game, and is recorded', () => {
    party(6); // 8 seats
    let guard = 0;
    const seen = new Set<string>();
    while (room(a).status === 'playing' && guard++ < 20_000) {
      const s = state();
      if (s.mini) seen.add(s.mini.id);
      playFor(a);
      playFor(b);
      vi.advanceTimersByTime(1500);
    }
    expect(room(a).status).toBe('over');
    expect(room(a).results!.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const s = state();
    expect(s.board.phase).toBe('over');
    expect(s.board.round).toBe(8);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE game_id = 'party'").get()).toEqual({ n: 1 });
  });

  it('every mini-game can be started short with the table sizes it claims', () => {
    for (const m of MINIS) {
      for (const n of [m.min, m.max]) {
        const seats = Array.from({ length: Math.max(n, 1) }, (_, i) => ({ id: `s${i}`, name: `P${i}`, isBot: i > 0 }));
        const g = ONLINE_GAMES[m.id];
        expect(() => m.short(g.start(seats, seededRng(n), 1_000_000)), `${m.id} with ${n}`).not.toThrow();
      }
    }
  });

  it('a duel between two bots is played out at once, for every duel mini-game', () => {
    const party = ONLINE_GAMES.party;
    const seats = ['you', 'b1', 'b2', 'b3'].map((id, i) => ({ id, name: id, isBot: i > 0 }));
    for (const m of MINIS.filter((x) => x.duel)) {
      const s0 = party.start(seats, seededRng(7), 1_000_000);
      const match = { kind: 'duel' as const, seats: ['b1', 'b2'], teams: null };
      const s = { ...s0, stage: 'intro', next: { id: m.id, match }, board: { ...s0.board, phase: 'minigame', match } };
      const after = party.pause!(s as any)!.next(s as any, 1_000_000 + INTRO_MS);
      expect(after.stage, m.id).toBe('payout');
      expect(after.last.id).toBe(m.id);
    }
  });
});
