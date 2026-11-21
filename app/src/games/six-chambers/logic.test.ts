import { describe, expect, it } from 'vitest';
import { act, eventVisibleTo, fireThreshold, newGame, nextRound, rotate, seatsFor, standings, swapPair } from './logic';
import { beliefFor, seatOdds } from './knowledge';
import { botAction } from './bots';
import { seededRng } from '../shared/rng';

const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));

describe('cylinder moves', () => {
  it('spins clockwise and swaps neighbouring chambers', () => {
    const c = [true, false, false, false, false, true];
    expect(rotate(c, 1)).toEqual([true, true, false, false, false, false]);
    expect(rotate(c, 2)).toEqual([false, true, true, false, false, false]);
    expect(swapPair(c, 0)).toEqual([false, true, false, false, false, true]);
    expect(swapPair(c, 5)).toEqual([true, false, false, false, false, true]); // pair (5,0) both loaded
  });
  it('spreads players over the six seats', () => {
    expect(seatsFor(3)).toEqual([0, 2, 4]);
    expect(seatsFor(6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(seatsFor(4)).size).toBe(4);
  });
});

describe('turns and firing', () => {
  it('charges credits, rotates turns and fires when half the table is broke', () => {
    let s = newGame(four, seededRng(1), { rounds: 1, credits: 2, bullets: 2 });
    s = { ...s, chambers: [true, false, false, true, false, false] };
    expect(fireThreshold(4)).toBe(2);
    expect(() => act(s, 'b', { kind: 'peekPublic', seat: 0 })).toThrow();
    s = act(s, 'a', { kind: 'peekPrivate', seat: 0 }); // a: 0 credits
    expect(s.turn).toBe('b');
    s = act(s, 'b', { kind: 'peekPublic', seat: 1 }); // b: 1 credit
    expect(s.turn).toBe('c');
    s = act(s, 'c', { kind: 'peekPrivate', seat: 2 }); // c: 0 → 2 broke → fire
    expect(s.phase).toBe('fired');
    const seatOf = Object.fromEntries(s.players.map((p) => [p.id, p.seat]));
    const loadedSeats = [0, 3];
    expect(s.history[0].hit.sort()).toEqual(s.players.filter((p) => loadedSeats.includes(seatOf[p.id])).map((p) => p.id).sort());
    for (const p of s.players) expect(p.points).toBe(s.history[0].hit.includes(p.id) ? 0 : 1);
  });

  it('skips players with no credits and plays the configured rounds', () => {
    const rng = seededRng(3);
    let s = newGame(four, rng, { rounds: 2, credits: 16, bullets: 2 });
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 500) {
      if (s.phase === 'fired') {
        s = nextRound(s, rng);
        continue;
      }
      const p = s.players.find((x) => x.id === s.turn)!;
      expect(p.credits).toBeGreaterThan(0);
      s = act(s, p.id, botAction(s, p.id, 'careful', rng));
    }
    expect(s.phase).toBe('gameOver');
    expect(s.history).toHaveLength(2);
    expect(standings(s)[0].points).toBeGreaterThanOrEqual(standings(s)[3].points);
  });

  it('rejects moves you cannot afford', () => {
    const s = newGame(four, seededRng(1), { rounds: 1, credits: 3, bullets: 2 });
    expect(() => act(s, 'a', { kind: 'swap', seat: 0 })).toThrow();
  });
});

describe('knowledge', () => {
  it('hides private peeks and swap targets from other players', () => {
    const ev = { player: 'a', kind: 'peekPrivate' as const, cost: 2, seat: 1, result: [true, false] as [boolean, boolean] };
    expect(eventVisibleTo(ev, 'b')).toEqual({ player: 'a', kind: 'peekPrivate', cost: 2 });
    expect(eventVisibleTo(ev, 'a')).toEqual(ev);
  });

  it('starts at 1/3 per seat and learns from peeks and spins', () => {
    expect(seatOdds(beliefFor([], 'a', 2)).map((o) => o.toFixed(3))).toEqual(Array(6).fill('0.333'));
    const events = [
      { player: 'b', kind: 'peekPublic' as const, cost: 1, seat: 0, result: [true, false] as [boolean, boolean] },
      { player: 'c', kind: 'spin1' as const, cost: 3 },
    ];
    const odds = seatOdds(beliefFor(events, 'a', 2));
    expect(odds[1]).toBeCloseTo(1); // the known round moved from seat 0 to seat 1
    expect(odds[2]).toBeCloseTo(0); // the known empty moved from seat 1 to seat 2
    expect(odds.reduce((x, y) => x + y, 0)).toBeCloseTo(2);
  });

  it('only the peeker learns from a private peek', () => {
    const events = [{ player: 'b', kind: 'peekPrivate' as const, cost: 2, seat: 2, result: [true, true] as [boolean, boolean] }];
    expect(seatOdds(beliefFor(events, 'b', 2))[2]).toBeCloseTo(1);
    expect(seatOdds(beliefFor(events, 'a', 2))[2]).toBeCloseTo(1 / 3);
  });

  it('an unseen swap blurs what you knew', () => {
    const events = [
      { player: 'a', kind: 'peekPrivate' as const, cost: 2, seat: 0, result: [true, false] as [boolean, boolean] },
      { player: 'b', kind: 'swap' as const, cost: 6, seat: 3 },
    ];
    const odds = seatOdds(beliefFor(events, 'a', 2));
    expect(odds[0]).toBeLessThan(1);
    expect(odds[0]).toBeGreaterThan(0.5);
  });
});

describe('bots', () => {
  it('get out of the way of a round they know is facing them', () => {
    let s = newGame(four, seededRng(2), { rounds: 1, credits: 16, bullets: 2 });
    const b = s.players.find((p) => p.id === 'b')!;
    expect(b.seat).toBe(2);
    // seat 2 (b) is loaded; the other round faces the empty seat 4
    s = { ...s, chambers: [false, false, true, false, true, false], turn: 'b' };
    s = act(s, 'b', { kind: 'peekPrivate', seat: 2 }); // b sees: own chamber loaded, seat 3 empty
    s = { ...s, turn: 'b' };
    const move = botAction(s, 'b', 'careful', seededRng(5));
    expect(['swap', 'spin1', 'spin2']).toContain(move.kind);
  });
});
