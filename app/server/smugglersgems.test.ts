/** Smuggler's Gems online: blind swaps, one peek, secret partners — a memory game, so the view sends very little. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/games/smugglers-gems/logic';
import { RESULT_MS } from '../src/games/smugglers-gems/online';
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
const view = (u: User) => game(u).view as GameState;
const say = (u: User, m: ClientMessage) => rooms.handle(u, m);
const act = (u: User, action: unknown) => say(u, { type: 'act', action });
const error = (u: User) => last(u, 'error')?.message;
/** Everything the server sent this person, as text — to check nothing secret slipped through. */
const sent = (u: User) => JSON.stringify(inbox.get(u.id) ?? []);
/** Every game view this person was sent. */
const views = (u: User) => (inbox.get(u.id) ?? []).filter((m) => m.type === 'game').map((m) => (m as { view: GameState }).view);
const idOf = (v: GameState, name: string) => v.players.find((p) => p.name === name)!.id;

function started(bots = 1) {
  say(a, { type: 'create', gameId: 'smugglers-gems' });
  say(b, { type: 'join', code: room(a).code });
  for (let i = 0; i < bots; i++) say(a, { type: 'addBot' });
  say(a, { type: 'start' });
}

/** Nothing but your own card, your own partner and the latest move — at every moment of the exchanges. */
function onlyOwnSecrets(v: GameState) {
  if (v.phase !== 'exchange') return;
  for (const [loc, c] of Object.entries(v.hands)) if (loc !== 'you') expect(c).toBeNull();
  for (const p of v.players) if (p.id !== 'you') expect([p.partner, p.peeked]).toEqual(['', false]);
  expect(v.players.find((p) => p.id === 'you')!.partner).not.toBe('');
  expect(v.history).toEqual([]);
  expect(v.events.length).toBeLessThanOrEqual(1);
  for (const e of v.events) {
    if (e.player !== 'you' && e.target !== 'you') expect([e.gave, e.got, e.seen]).toEqual([undefined, undefined, undefined]);
    if (e.kind === 'peek' && e.player !== 'you') expect(e.target).toBeUndefined();
  }
}

describe("Smuggler's Gems online", () => {
  it('each seat sees only its own card and partner; other cards and partners are never sent', () => {
    started();
    const va = view(a);
    const vb = view(b);
    expect(va.order[0]).toBe('you'); // Ana sat first, so she starts
    expect(va.deck).toHaveLength(7); // the public card list
    expect(va.hands.you).not.toBeNull();
    expect(Object.keys(va.hands)).toHaveLength(7);
    onlyOwnSecrets(va);
    onlyOwnSecrets(vb);
    // Ben's card and the Buyer/Discard cards are nowhere in what Ana received
    const ben = idOf(va, 'Ben');
    expect(sent(a)).not.toContain(`"${ben}":${JSON.stringify(vb.hands.you)}`);
    expect(sent(a)).not.toContain(`"you":${JSON.stringify(vb.hands.you)}`);
    // Ben's partner only reaches Ben
    const benPartner = vb.players.find((p) => p.id === 'you')!.partner;
    expect(va.players.find((p) => p.id === ben)!.partner).toBe('');
    expect(sent(a)).not.toContain(`"partner":"${benPartner === idOf(vb, 'Ana') ? 'you' : benPartner}"`);
  });

  it('turns go in order; illegal moves are refused with friendly errors', () => {
    started();
    act(b, { type: 'pass' });
    expect(error(b)).toMatch(/Not your move/);
    act(a, { type: 'swap', target: 'you' });
    expect(error(a)).toMatch(/another card/);
    act(a, { type: 'swap', target: 'nowhere' });
    expect(error(a)).toMatch(/No such card/);
    act(a, { type: 'swap', target: 42 });
    expect(error(a)).toMatch(/Pick a card/);
    act(a, { type: 'peek', target: idOf(view(a), 'Ben') });
    expect(error(a)).toMatch(/Buyer or Discard/);
    act(a, { type: 'dance' });
    expect(error(a)).toMatch(/isn’t part/);
    if (view(a).hands.you.kind === 'bomb') {
      act(a, { type: 'swap', target: 'buyer0' });
      expect(error(a)).toMatch(/bomb/);
    }
    act(a, { type: 'pass' });
    expect(view(a).events).toEqual([{ player: 'you', kind: 'pass' }]);
    expect(view(b).events).toEqual([{ player: idOf(view(b), 'Ana'), kind: 'pass' }]);
    expect(game(b).waiting).toBe(true);
  });

  it('a peek shows one card to the peeker only, once per match, and is forgotten after the next move', () => {
    started();
    act(a, { type: 'peek', target: 'buyer1' });
    const seen = view(a).events[0].seen!;
    expect(view(a).events[0]).toMatchObject({ player: 'you', kind: 'peek', target: 'buyer1' });
    expect(view(a).hands.buyer1).toBeNull(); // the screen only announces it
    expect(view(b).events).toEqual([{ player: idOf(view(b), 'Ana'), kind: 'peek' }]);
    expect(sent(b)).not.toContain('"seen"');
    expect(game(a).waiting).toBe(true); // a peek doesn't use the turn
    act(a, { type: 'peek', target: 'buyer2' });
    expect(error(a)).toMatch(/already used/);
    act(a, { type: 'pass' });
    act(b, { type: 'pass' });
    // only Ben's pass is on Ana's screen now; the peeked card is not sent again
    expect(view(a).events).toEqual([{ player: idOf(view(a), 'Ben'), kind: 'pass' }]);
    expect(JSON.stringify(view(a))).not.toContain('"seen"');
    expect(JSON.stringify(view(a))).not.toContain(`"buyer1":${JSON.stringify(seen)}`);
  });

  it('a swap shows both cards to the two sides only; the next move wipes it', () => {
    started();
    const ben = idOf(view(a), 'Ben');
    const anaCard = view(a).hands.you;
    const benCard = view(b).hands.you;
    act(a, { type: 'swap', target: ben });
    expect(view(a).hands.you).toEqual(benCard);
    expect(view(a).events[0]).toMatchObject({ player: 'you', target: ben, gave: anaCard, got: benCard });
    expect(view(b).events[0]).toMatchObject({ target: 'you', gave: anaCard, got: benCard });
    expect(view(b).hands.you).toEqual(anaCard);
    act(b, { type: 'pass' });
    const v = view(a);
    expect(v.events).toEqual([{ player: ben, kind: 'pass' }]);
    expect(v.hands[ben]).toBeNull(); // Ana must remember what Ben holds
    expect(JSON.stringify(v)).not.toContain('"gave"');
    for (const x of [...views(a), ...views(b)]) onlyOwnSecrets(x);
  });

  it('a reveal shows the round, then the next round forgets it; the final log shows all', () => {
    started();
    let guard = 0;
    while (view(a).phase === 'exchange' && guard++ < 50) {
      for (const u of [a, b]) if (game(u).waiting) act(u, { type: 'pass' });
      vi.advanceTimersByTime(BOT_MAX_MS);
    }
    const r = view(a);
    expect(r.phase).toBe('reveal');
    expect(game(a).pauseUntil).not.toBeNull();
    expect(Object.values(r.hands).every((c) => c !== null)).toBe(true);
    expect(r.history).toHaveLength(1);
    expect(r.history[0].events).toEqual([]);
    expect(r.history[0].scores.you).toBeTypeOf('number');
    const round1 = r.hands;
    say(a, { type: 'ready' });
    say(b, { type: 'ready' });
    const v = view(a);
    expect(v.round).toBe(2);
    expect(v.history).toEqual([]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(round1));
    onlyOwnSecrets(v);
  });

  it('every view during the match keeps the secrets; a whole match plays out and is recorded', () => {
    started(2);
    let guard = 0;
    while (room(a).status === 'playing' && guard++ < 2000) {
      vi.advanceTimersByTime(game(a).pauseUntil ? RESULT_MS : game(a).waiting || game(b).waiting ? TURN_MS + 10 : BOT_MAX_MS);
    }
    expect(room(a).status).toBe('over');
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE game_id = ?').get('smugglers-gems')).toEqual({ n: 1 });
    expect(room(a).results!.map((x) => x.place)).toEqual([1, 2, 3, 4]);
    for (const x of [...views(a), ...views(b)]) onlyOwnSecrets(x);
    // the end: partners and every round, moves as each seat saw them
    const end = view(a);
    expect(end.phase).toBe('gameOver');
    expect(end.history).toHaveLength(3);
    expect(end.players.every((p) => p.partner !== '')).toBe(true);
    for (const h of end.history) for (const e of h.events) {
      if (e.player !== 'you' && e.target !== 'you') expect(e.gave).toBeUndefined();
    }
  });
});
