import { describe, expect, it } from 'vitest';
import { GameState, Shape, bestCells, bid, bingos, choose, hasCoins, newGame, nextRound, standings } from './logic';
import { botBid, botChoose, pickCoins } from './bots';
import { seededRng } from '../shared/rng';

const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));
const T: Shape = 'triangle';
const C: Shape = 'circle';
const S: Shape = 'star';

function withCards(s: GameState): GameState {
  const card: Shape[] = [T, C, S, C, S, T, S, T, C];
  return { ...s, players: s.players.map((p) => ({ ...p, card })) };
}

describe('setup', () => {
  it('deals 3 of each shape and the same ten coins', () => {
    const s = newGame(four, seededRng(1));
    for (const p of s.players) {
      for (const sh of [T, C, S]) expect(p.card.filter((c) => c === sh)).toHaveLength(3);
      expect(p.coins.reduce((a, b) => a + b, 0)).toBe(30);
    }
  });
});

describe('auctions', () => {
  it('top bid wins one stamp per player on that shape; all bids are spent', () => {
    let s = withCards(newGame(four, seededRng(2)));
    for (const [id, sh] of [['a', S], ['b', S], ['c', S], ['d', T]] as const) s = choose(s, id, sh);
    expect(s.phase).toBe('bid');
    s = bid(s, 'a', [5]);
    s = bid(s, 'b', [3, 1]);
    s = bid(s, 'c', [2]);
    s = bid(s, 'd', [1]);
    const r = s.history[0];
    expect(r.results.star).toMatchObject({ bidders: 3, amount: 5, winners: ['a'], stamps: 3 });
    expect(r.results.triangle).toMatchObject({ bidders: 1, amount: 1, winners: ['d'], stamps: 1 });
    expect(r.results.circle).toMatchObject({ bidders: 0, amount: null, stamps: 0 });
    const a = s.players.find((p) => p.id === 'a')!;
    expect(a.stamped.filter(Boolean)).toHaveLength(3);
    expect(bingos(a.stamped)).toBe(1); // the 3 stars on this card form a diagonal (2,4,6)
    expect(a.coins.reduce((x, y) => x + y, 0)).toBe(25);
    expect(s.players.find((p) => p.id === 'b')!.coins.reduce((x, y) => x + y, 0)).toBe(26);
  });

  it('tied top bids split the stamps, rounded down', () => {
    let s = withCards(newGame(four, seededRng(3)));
    for (const id of ['a', 'b', 'c']) s = choose(s, id, C);
    s = choose(s, 'd', T);
    s = bid(bid(bid(bid(s, 'a', [3]), 'b', [3]), 'c', [1]), 'd', [1]);
    expect(s.history[0].results.circle).toMatchObject({ winners: ['a', 'b'], stamps: 1 });
  });

  it('rejects coins you do not have and empty bids', () => {
    let s = newGame(four, seededRng(4));
    for (const p of four) s = choose(s, p.id, T);
    expect(() => bid(s, 'a', [10, 10])).toThrow();
    expect(() => bid(s, 'a', [])).toThrow();
    expect(hasCoins([1, 2, 2], [2, 2])).toBe(true);
    expect(hasCoins([1, 2], [2, 2])).toBe(false);
  });
});

describe('placement and ranking', () => {
  it('places stamps where they complete lines', () => {
    const card: Shape[] = [T, T, C, S, C, S, T, S, C];
    const stamped = [true, false, true, false, false, false, false, false, false];
    expect(bestCells(card, stamped, T, 1)).toEqual([1]); // completes the top row
  });

  it('plays 7 rounds with bots and ranks by bingos, then cells, then coins', () => {
    const rng = seededRng(9);
    let s = newGame(four, rng);
    while (s.phase !== 'gameOver') {
      for (const p of s.players) s = choose(s, p.id, botChoose(s, p.id, 'saver', rng));
      for (const p of s.players) s = bid(s, p.id, botBid(s, p.id, 'shark', rng));
      s = nextRound(s);
    }
    expect(s.history).toHaveLength(7);
    const order = standings(s);
    for (let i = 0; i < order.length - 1; i++) {
      const [x, y] = [order[i], order[i + 1]];
      expect(x.bingos > y.bingos || (x.bingos === y.bingos && (x.cells > y.cells || (x.cells === y.cells && x.left >= y.left)))).toBe(true);
    }
  });
});

describe('bots', () => {
  it('pick coins close to a target and spend the minimum when uncontested', () => {
    expect(pickCoins([1, 2, 3, 5, 10], 7).reduce((a, b) => a + b, 0)).toBe(7);
    let s = withCards(newGame(four, seededRng(5)));
    for (const [id, sh] of [['a', T], ['b', C], ['c', S], ['d', S]] as const) s = choose(s, id, sh);
    expect(botBid(s, 'b', 'shark', seededRng(1))).toEqual([1]); // nobody else on circles
  });
  it('never bid more than about half their coins before the last round', () => {
    let s = withCards(newGame(four, seededRng(6), { rounds: 2 }));
    for (const id of ['a', 'b', 'c', 'd']) s = choose(s, id, S); // crowded: 4 stamps at stake
    for (const id of ['b', 'c', 'd']) {
      const sum = botBid(s, id, 'shark', seededRng(2)).reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(16);
    }
  });
});
