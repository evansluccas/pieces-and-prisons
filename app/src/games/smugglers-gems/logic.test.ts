import { describe, expect, it } from 'vitest';
import {
  BUYER, Card, GameState, canSwapWith, cardScore, currentTurn, finalScore, knownCards, newGame, nextRound, pass, peek,
  standings, swap, visibleEvent,
} from './logic';
import { botTurn } from './bots';
import { seededRng } from '../shared/rng';

const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));
const card = (id: number, kind: Card['kind'], value: number): Card => ({ id, kind, value });

function fixed(): GameState {
  const s = newGame(four, seededRng(1));
  const deck = [
    card(0, 'bomb', 6), card(1, 'bomb', 4), card(2, 'gold', 5), card(3, 'gold', 4),
    card(4, 'silver', 3), card(5, 'copper', 1), card(6, 'diamond', 6), card(7, 'copper', 2),
  ];
  const hands = { a: deck[2], b: deck[0], c: deck[4], d: deck[6], buyer0: deck[3], buyer1: deck[5], buyer2: deck[7], discard: deck[1] };
  return { ...s, deck, hands };
}

describe('setup', () => {
  it('deals one card per player, 3 buyers, 1 discard; partners are never yourself', () => {
    const s = newGame(four, seededRng(2));
    expect(s.deck).toHaveLength(8);
    expect(s.deck.filter((c) => c.kind === 'bomb')).toHaveLength(2);
    expect(Object.keys(s.hands)).toHaveLength(8);
    for (const p of s.players) expect(p.partner).not.toBe(p.id);
    expect(new Set(s.players.map((p) => p.partner)).size).toBe(4);
    expect(s.order).toEqual(['a', 'b', 'c', 'd', 'd', 'c', 'b', 'a']);
  });
});

describe('turns', () => {
  it('swaps blindly and keeps bombs out of the Buyer row and Discard', () => {
    let s = fixed();
    s = swap(s, 'a', 'buyer0'); // a: gold 5 -> gets gold 4
    expect(s.hands.a).toEqual(card(3, 'gold', 4));
    expect(s.hands.buyer0).toEqual(card(2, 'gold', 5));
    expect(currentTurn(s)).toBe('b');
    expect(canSwapWith(s, 'b', 'buyer1')).toBe(false); // b holds the −6 bomb
    expect(() => swap(s, 'b', 'discard')).toThrow();
    s = swap(s, 'b', 'c');
    expect(s.hands.c.kind).toBe('bomb');
  });

  it('allows one peek per match without using the turn', () => {
    let s = fixed();
    s = peek(s, 'a', 'buyer2');
    expect(currentTurn(s)).toBe('a');
    expect(knownCards(s, 'a').buyer2).toEqual(card(7, 'copper', 2));
    expect(() => peek(s, 'a', 'buyer1')).toThrow();
  });

  it('scores value × matching buyer cards; bombs cost their value', () => {
    const buyer = [card(1, 'gold', 4), card(2, 'gold', 5), card(3, 'copper', 1)];
    expect(cardScore(card(9, 'gold', 5), buyer)).toBe(10);
    expect(cardScore(card(9, 'silver', 4), buyer)).toBe(0);
    expect(cardScore(card(9, 'bomb', 6), buyer)).toBe(-6);
  });
});

describe('knowledge', () => {
  it('hides the cards in other people’s swaps, but not from the two sides', () => {
    let s = fixed();
    s = swap(s, 'a', 'buyer0');
    s = swap(s, 'b', 'c'); // b hands c the −6 bomb
    expect(visibleEvent(s.events[1], 'a')).toEqual({ player: 'b', kind: 'swap', target: 'c' });
    expect(visibleEvent(s.events[1], 'c').gave).toEqual(card(0, 'bomb', 6));
    // a knew nothing about b or c, so a still knows nothing about them
    expect(knownCards(s, 'a').c).toBeNull();
    // c knows b now holds c's old silver 3
    expect(knownCards(s, 'c').b).toEqual(card(4, 'silver', 3));
  });

  it('tracks a known card as it travels', () => {
    let s = fixed();
    s = swap(s, 'a', 'buyer0');   // a knows buyer0 = gold 5
    s = pass(s, 'b');
    s = swap(s, 'c', 'buyer0');   // c (silver 3) ↔ buyer0 (gold 5): a now knows c has gold 5
    const k = knownCards(s, 'a');
    expect(k.c).toEqual(card(2, 'gold', 5));
    expect(k.buyer0).toBeNull();
  });
});

describe('rounds', () => {
  it('plays 3 rounds with bots; the −6 holder starts the next round; partners add up', () => {
    const rng = seededRng(4);
    let s = newGame(four, rng);
    while (s.phase !== 'gameOver') {
      if (s.phase === 'reveal') {
        const holder6 = s.players.findIndex((p) => s.hands[p.id].kind === 'bomb' && s.hands[p.id].value === 6);
        expect(s.startSeat).toBe(holder6);
        s = nextRound(s, rng);
        continue;
      }
      const id = currentTurn(s)!;
      const a = botTurn(s, id, 'sharp', rng, 10);
      s = a.kind === 'pass' ? pass(s, id) : a.kind === 'peek' ? peek(s, id, a.target) : swap(s, id, a.target);
    }
    expect(s.history).toHaveLength(3);
    const order = standings(s);
    for (const p of s.players) expect(finalScore(s, p.id)).toBe(p.total + s.players.find((x) => x.id === p.partner)!.total);
    expect(order[0].final).toBeGreaterThanOrEqual(order[3].final);
  });
});

describe('bots', () => {
  it('get rid of a bomb by passing it to a player', () => {
    const s = { ...fixed(), turnIdx: 1 }; // b's turn, b holds the −6 bomb
    const a = botTurn(s, 'b', 'sharp', seededRng(3));
    expect(a.kind === 'swap' && ['a', 'c', 'd'].includes(a.target)).toBe(true);
  });
  it('never try to put a bomb in the Buyer row', () => {
    const s = { ...fixed(), turnIdx: 1 };
    for (let i = 0; i < 30; i++) {
      const a = botTurn(s, 'b', 'loose', seededRng(i));
      if (a.kind === 'swap') expect([...BUYER, 'discard']).not.toContain(a.target);
    }
  });
});
