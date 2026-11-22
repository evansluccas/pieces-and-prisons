import { describe, expect, it } from 'vitest';
import {
  Color, GameState, back, bidOdds, canDoubt, countColor, doubt, isRaise, minRaise, newGame, nextRound, raise, standings,
} from './logic';
import { botBack, botMove } from './bots';
import { seededRng } from '../shared/rng';

const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));

function withHands(s: GameState, hands: Record<string, Color[]>): GameState {
  return { ...s, players: s.players.map((p) => ({ ...p, hand: hands[p.id] })) };
}
const HANDS: Record<string, Color[]> = {
  a: ['ruby', 'ruby', 'topaz', 'emerald', 'amethyst'],
  b: ['ruby', 'topaz', 'topaz', 'sapphire', 'sapphire'],
  c: ['emerald', 'emerald', 'sapphire', 'amethyst', 'amethyst'],
  d: ['ruby', 'topaz', 'emerald', 'sapphire', 'amethyst'],
}; // ruby ×4 in play

describe('setup', () => {
  it('deals 5 cards each from a 7-per-colour deck', () => {
    const s = newGame(four, seededRng(1));
    for (const p of s.players) expect(p.hand).toHaveLength(5);
    for (const c of ['ruby', 'topaz', 'emerald', 'sapphire', 'amethyst'] as Color[]) expect(countColor(s, c)).toBeLessThanOrEqual(7);
    expect(s.turn).toBe('a');
  });
});

describe('bidding', () => {
  it('raises go up in count, or same count with a later colour', () => {
    let s = newGame(four, seededRng(2));
    expect(canDoubt(s, 'a')).toBe(false); // nothing to doubt yet
    s = raise(s, 'a', 3, 'emerald');
    expect(isRaise(s, 3, 'topaz')).toBe(false);
    expect(isRaise(s, 3, 'sapphire')).toBe(true);
    expect(isRaise(s, 4, 'ruby')).toBe(true);
    expect(minRaise(s, 'ruby')).toBe(4);
    expect(minRaise(s, 'amethyst')).toBe(3);
    expect(() => raise(s, 'b', 2, 'amethyst')).toThrow();
    expect(() => raise(s, 'c', 5, 'ruby')).toThrow(); // not c's turn
    s = raise(s, 'b', 3, 'amethyst');
    expect(s.turn).toBe('c');
  });
});

describe('doubt and bet', () => {
  it('a true bid: the doubter pays the bidder; right backers +1, wrong −1', () => {
    let s = withHands(newGame(four, seededRng(3)), HANDS);
    s = raise(s, 'a', 4, 'ruby');
    s = doubt(s, 'b');
    expect(s.phase).toBe('back');
    s = back(s, 'c', 'bid');
    s = back(s, 'd', 'doubt');
    const r = s.history[0];
    expect(r.actual).toBe(4);
    expect(r.holds).toBe(true);
    expect(r.delta).toEqual({ a: 2, b: -2, c: 1, d: -1 });
    expect(s.players.map((p) => p.chips)).toEqual([12, 8, 11, 9]);
    expect(s.startSeat).toBe(1); // the loser starts next
  });

  it('a false bid: the bidder pays the doubter', () => {
    let s = withHands(newGame(four, seededRng(4)), HANDS);
    s = raise(s, 'a', 5, 'ruby');
    s = doubt(s, 'b');
    s = back(back(s, 'c', 'doubt'), 'd', 'doubt');
    expect(s.history[0].delta).toEqual({ a: -2, b: 2, c: 1, d: 1 });
    expect(s.startSeat).toBe(0);
  });

  it('works out the chance of a bid from your own hand', () => {
    const s = withHands(newGame(four, seededRng(5)), HANDS);
    expect(bidOdds(s, 'a', 2, 'ruby')).toBe(1);   // I hold 2
    expect(bidOdds(s, 'a', 8, 'ruby')).toBe(0);   // only 7 rubies exist and I hold 2
    expect(bidOdds(s, 'a', 10, 'ruby')).toBe(0);
    const p3 = bidOdds(s, 'a', 3, 'ruby');
    expect(p3).toBeGreaterThan(0.85);
    expect(bidOdds(s, 'a', 5, 'ruby')).toBeLessThan(p3);
  });
});

describe('match', () => {
  it('plays to the end with bots and ranks by chips', () => {
    const rng = seededRng(6);
    let s = newGame(four, rng);
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 2000) {
      if (s.phase === 'reveal') s = nextRound(s, rng);
      else if (s.phase === 'back') for (const id of ['a', 'b', 'c', 'd']) {
        if (s.phase === 'back' && s.players.find((p) => p.id === id)!.back === null) {
          try { s = back(s, id, botBack(s, id, rng)); } catch { /* bidder or doubter */ }
        }
      }
      else {
        const m = botMove(s, s.turn!, 'cautious', rng);
        s = m.kind === 'doubt' ? doubt(s, s.turn!) : raise(s, s.turn!, m.count, m.color);
      }
    }
    expect(s.phase).toBe('gameOver');
    const order = standings(s);
    for (let i = 0; i < order.length - 1; i++) expect(order[i].chips).toBeGreaterThanOrEqual(order[i + 1].chips);
    expect(s.players.every((p) => p.chips >= 0)).toBe(true);
  });

  it('bots doubt an impossible bid and never make illegal raises', () => {
    let s = withHands(newGame(four, seededRng(7)), HANDS);
    s = raise(s, 'a', 9, 'ruby');
    expect(botMove(s, 'b', 'bluffer', seededRng(1))).toEqual({ kind: 'doubt' });
    for (let i = 0; i < 20; i++) {
      const t = raise(withHands(newGame(four, seededRng(i)), HANDS), 'a', 2, 'topaz');
      const m = botMove(t, 'b', 'bluffer', seededRng(i));
      if (m.kind === 'raise') expect(isRaise(t, m.count, m.color)).toBe(true);
    }
  });
});
