import { describe, expect, it } from 'vitest';
import { lowestUnique, newGame, nextRound, standings, submitKeep, submitPair, totalRounds } from './logic';
import { botKeep, botPickPair, seededRng, winChance } from './bots';

const players = [
  { id: 'a', name: 'A', isBot: false },
  { id: 'b', name: 'B', isBot: true },
  { id: 'c', name: 'C', isBot: true },
];

describe('lowestUnique', () => {
  it('picks the lowest number held by exactly one player', () => {
    expect(lowestUnique({ a: 1, b: 1, c: 3, d: 2 })).toEqual({ winner: 'd', card: 2 });
  });
  it('returns null when every number is shared', () => {
    expect(lowestUnique({ a: 4, b: 4, c: 6, d: 6 })).toBeNull();
  });
});

describe('round flow', () => {
  it('moves pick -> keep -> result and scores the winner', () => {
    let s = newGame(players);
    s = submitPair(s, 'a', [1, 5]);
    s = submitPair(s, 'b', [1, 2]);
    expect(s.phase).toBe('pick');
    s = submitPair(s, 'c', [3, 4]);
    expect(s.phase).toBe('keep');
    s = submitKeep(s, 'a', 1);
    s = submitKeep(s, 'b', 1);
    s = submitKeep(s, 'c', 3);
    expect(s.phase).toBe('result');
    expect(s.history[0]).toMatchObject({ winner: 'c', card: 3 });
    expect(s.players.find((p) => p.id === 'c')!.tokens).toBe(3);
    // kept card is spent, the other returns to hand
    expect(s.players.find((p) => p.id === 'a')!.hand).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects illegal moves', () => {
    const s = newGame(players);
    expect(() => submitPair(s, 'a', [2, 2])).toThrow();
    expect(() => submitPair(s, 'a', [0, 2])).toThrow();
    expect(() => submitKeep(s, 'a', 1)).toThrow();
  });

  it('refills hands each cycle and ends after 18 rounds', () => {
    let s = newGame(players);
    const rng = seededRng(7);
    let refills = 0;
    while (s.phase !== 'gameOver') {
      for (const p of s.players) s = submitPair(s, p.id, botPickPair(p.hand, 'wild', rng));
      for (const p of s.players) s = submitKeep(s, p.id, s.pairs[p.id][0]);
      const before = s.players[0].hand.length;
      s = nextRound(s);
      if (s.phase !== 'gameOver' && s.players[0].hand.length > before) refills++;
    }
    expect(s.history).toHaveLength(totalRounds(s));
    expect(refills).toBe(2);
    const total = s.history.reduce((t, r) => t + (r.card ?? 0), 0);
    expect(s.players.reduce((t, p) => t + p.tokens, 0)).toBe(total);
    expect(standings(s)[0].tokens).toBeGreaterThanOrEqual(standings(s)[2].tokens);
  });
});

describe('bots', () => {
  it('computes exact win chances', () => {
    expect(winChance(1, [[2, 3]])).toBe(1);
    expect(winChance(2, [[2, 2]])).toBe(0);
    expect(winChance(2, [[1, 2]])).toBe(0);
    expect(winChance(3, [[1, 5]])).toBe(0.5);
  });
  it('always keeps a card from its own pair and picks legal pairs', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const pair = botPickPair([1, 2, 3, 4, 5, 6, 7, 8], 'cautious', rng);
      expect(pair[0]).not.toBe(pair[1]);
      expect(pair).toContain(botKeep(pair, [[1, 2], [3, 6]], 'greedy', rng));
    }
  });
});
