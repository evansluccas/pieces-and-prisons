import { describe, expect, it } from 'vitest';
import {
  compareCombos, currentPicker, draft, earnedPoints, evaluate, newGame, nextRound, placePoints, predict,
  scoreHands, scoringTable, standings, validPredictions,
} from './logic';
import { botDraft, botPredict } from './bots';
import { seededRng } from '../shared/rng';

const players = [
  { id: 'a', name: 'A', isBot: false },
  { id: 'b', name: 'B', isBot: true },
  { id: 'c', name: 'C', isBot: true },
];

describe('combos', () => {
  it('recognises each kind', () => {
    expect(evaluate([4, 4, 4]).kind).toBe('triple');
    expect(evaluate([3, 5, 4]).kind).toBe('straight');
    expect(evaluate([2, 6, 2]).kind).toBe('pair');
    expect(evaluate([1, 3, 6]).kind).toBe('high');
    expect(evaluate([1, 2, 4]).kind).toBe('high');
  });
  it('ranks triple > straight > pair > high, then by dice', () => {
    const order = [[1, 1, 1], [6, 5, 4], [1, 2, 3], [6, 6, 1], [5, 5, 6], [5, 5, 4], [6, 4, 1], [5, 4, 2]];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareCombos(evaluate(order[i]), evaluate(order[i + 1]))).toBeGreaterThan(0);
    }
    expect(compareCombos(evaluate([2, 3, 2]), evaluate([2, 2, 3]))).toBe(0);
  });
});

describe('scoring', () => {
  it('pays 6/3/1 and 0 for strictly last', () => {
    expect([0, 1, 2, 3].map((b) => placePoints(b, 4))).toEqual([6, 3, 1, 0]);
    expect([0, 1, 2].map((b) => placePoints(b, 3))).toEqual([6, 3, 0]);
  });
  it('lets tied hands share the better place', () => {
    expect(scoreHands({ a: [5, 5, 5], b: [5, 5, 5], c: [1, 2, 4] })).toEqual({ a: 6, b: 6, c: 0 });
  });
  it('builds a clear place → points table for each table size', () => {
    expect(scoringTable(3)).toEqual([{ place: '1st', points: 6 }, { place: '2nd', points: 3 }, { place: 'Last', points: 0 }]);
    expect(scoringTable(4).map((r) => `${r.place}:${r.points}`)).toEqual(['1st:6', '2nd:3', '3rd:1', 'Last:0']);
    expect(scoringTable(6).map((r) => `${r.place}:${r.points}`)).toEqual(['1st:6', '2nd:3', '3rd:1', '4th & below:0']);
    expect(validPredictions(3)).toEqual([6, 3, 0]);
  });
  it('rejects bets that cannot happen at this table size', () => {
    const rng = seededRng(4);
    let s = newGame(players, rng); // 3 players: a bet of 1 is impossible
    while (s.phase === 'draft') s = draft(s, currentPicker(s)!, s.pool.find((d) => !d.takenBy)!.id);
    expect(() => predict(s, 'a', 1)).toThrow();
  });
  it('records each player’s place', () => {
    const rng = seededRng(5);
    let s = newGame(players, rng);
    while (s.phase === 'draft') s = draft(s, currentPicker(s)!, s.pool.find((d) => !d.takenBy)!.id);
    for (const p of s.players) s = predict(s, p.id, 0);
    const places = Object.values(s.history[0].places);
    expect(places).toContain('Last');
    expect(places.every((pl) => ['1st', '2nd', 'Last'].includes(pl))).toBe(true);
  });
  it('doubles a correct prediction and pays 4 for a correct zero', () => {
    expect(earnedPoints(3, 3)).toBe(6);
    expect(earnedPoints(3, 6)).toBe(3);
    expect(earnedPoints(0, 0)).toBe(4);
  });
});

describe('round flow', () => {
  it('drafts in snake order, then predicts and resolves', () => {
    const rng = seededRng(5);
    let s = newGame(players, rng);
    expect(s.pool).toHaveLength(7);
    expect(s.order).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
    expect(() => draft(s, 'b', 0)).toThrow();
    while (s.phase === 'draft') {
      const id = currentPicker(s)!;
      const free = s.pool.find((d) => !d.takenBy)!;
      s = draft(s, id, free.id);
    }
    expect(s.phase).toBe('predict');
    expect(s.players.every((p) => p.picks.length === 2)).toBe(true);
    for (const p of s.players) s = predict(s, p.id, 3);
    expect(s.phase).toBe('result');
    const r = s.history[0];
    expect(Object.values(r.base).sort()).toContain(0);
    expect(s.players.reduce((t, p) => t + p.score, 0)).toBe(Object.values(r.earned).reduce((a, b) => a + b, 0));
  });

  it('rotates the start player and ends after the configured rounds', () => {
    const rng = seededRng(9);
    let s = newGame(players, rng, { rounds: 2 });
    const play = () => {
      while (s.phase === 'draft') s = draft(s, currentPicker(s)!, s.pool.find((d) => !d.takenBy)!.id);
      for (const p of s.players) s = predict(s, p.id, 0);
    };
    play();
    s = nextRound(s, rng);
    expect(s.order[0]).toBe('b');
    play();
    s = nextRound(s, rng);
    expect(s.phase).toBe('gameOver');
    expect(standings(s)[0].score).toBeGreaterThanOrEqual(standings(s)[2].score);
  });
});

describe('bots', () => {
  it('complete a triple when the tray allows it', () => {
    const pool = [{ id: 0, value: 2, takenBy: null }, { id: 1, value: 6, takenBy: null }, { id: 2, value: 4, takenBy: null }];
    expect(botDraft(6, [6], pool, 'sharp', seededRng(1))).toBe(1);
  });
  it('predict 6 with an unbeatable hand and avoid 6 with a hopeless one', () => {
    const rng = seededRng(2);
    expect(botPredict('me', { me: [6, 6, 6], x: [1, 2], y: [3, 5] }, 'sharp', rng)).toBe(6);
    expect(botPredict('me', { me: [1, 2, 4], x: [6, 6], y: [5, 5] }, 'cautious', rng)).toBe(0);
  });
});
