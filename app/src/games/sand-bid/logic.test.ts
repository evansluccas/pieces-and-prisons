import { describe, expect, it } from 'vitest';
import { formatMs, newGame, nextRound, resolveRound, roundWinner, standings } from './logic';
import { botBid } from './bots';
import { seededRng } from '../shared/rng';

const players = [
  { id: 'a', name: 'A', isBot: false },
  { id: 'b', name: 'B', isBot: true },
  { id: 'c', name: 'C', isBot: true },
];

describe('roundWinner', () => {
  it('awards the strictly longest hold', () => {
    expect(roundWinner({ a: 1000, b: 4000, c: 3999 })).toBe('b');
  });
  it('gives nothing on a tie or when everyone sat out', () => {
    expect(roundWinner({ a: 5000, b: 5000, c: 10 })).toBeNull();
    expect(roundWinner({ a: 0, b: 0 })).toBeNull();
  });
});

describe('resolveRound', () => {
  it('spends every bid from the bank, win or lose, and scores the winner', () => {
    let s = newGame(players, { rounds: 3, bankMs: 10_000 });
    s = resolveRound(s, { a: 2_000, b: 3_000, c: 0 });
    expect(s.phase).toBe('result');
    expect(s.players.map((p) => p.bankMs)).toEqual([8_000, 7_000, 10_000]);
    expect(s.players.map((p) => p.tokens)).toEqual([0, 1, 0]);
    expect(s.history[0].winner).toBe('b');
  });

  it('caps a bid at the remaining bank', () => {
    let s = newGame(players, { rounds: 3, bankMs: 5_000 });
    s = resolveRound(s, { a: 99_000, b: 1, c: 2 });
    expect(s.players[0].bankMs).toBe(0);
    expect(s.history[0].bids.a).toBe(5_000);
  });

  it('requires a bid from everyone', () => {
    expect(() => resolveRound(newGame(players), { a: 1 })).toThrow();
  });
});

describe('match flow', () => {
  it('ends after the configured rounds and ranks by stars, then time left', () => {
    let s = newGame(players, { rounds: 2, bankMs: 10_000 });
    s = nextRound(resolveRound(s, { a: 3_000, b: 1_000, c: 0 }));
    s = resolveRound(s, { a: 0, b: 0, c: 4_000 });
    s = nextRound(s);
    expect(s.phase).toBe('gameOver');
    // a and c tie on 1 star; a has 7s left vs c's 6s, so a ranks first
    expect(standings(s).map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('bots', () => {
  it('never bid more than their bank and dump everything in the last round', () => {
    const rng = seededRng(3);
    for (const persona of ['steady', 'spiker', 'wild'] as const) {
      for (let i = 0; i < 300; i++) {
        const bank = Math.floor(rng() * 60_000);
        const bid = botBid({ bankMs: bank, roundsLeft: 1 + Math.floor(rng() * 10), myTokens: 0, leaderTokens: 3 }, persona, rng);
        expect(bid).toBeGreaterThanOrEqual(0);
        expect(bid).toBeLessThanOrEqual(bank);
      }
      if (persona !== 'wild') {
        expect(botBid({ bankMs: 7_000, roundsLeft: 1, myTokens: 0, leaderTokens: 0 }, persona, rng)).toBe(7_000);
      }
    }
  });
});

describe('formatMs', () => {
  it('formats as m:ss.cc', () => {
    expect(formatMs(180_000)).toBe('3:00.00');
    expect(formatMs(61_234)).toBe('1:01.23');
    expect(formatMs(-5)).toBe('0:00.00');
  });
});
