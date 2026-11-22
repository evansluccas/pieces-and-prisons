import { describe, expect, it } from 'vitest';
import { call, candidates, deal, guesser, newGame, winner } from './logic';
import { botCall, botDeal, odds } from './bots';
import { seededRng } from '../shared/rng';

describe('a round', () => {
  it('right call scores for the guesser, wrong for the dealer; both cards leave the game', () => {
    let s = newGame();
    expect(guesser(s)).toBe(1);
    s = deal(s, 0, 3, 8);
    expect(candidates(s)).toHaveLength(9);
    s = call(s, 1, 'higher');
    expect(s.scores).toEqual([0, 1]);
    expect(s.hands[0]).not.toContain(3);
    expect(s.hands[0]).not.toContain(8);
    expect(s.dealer).toBe(1); // the deal alternates
    s = deal(s, 1, 5, 2);
    s = call(s, 0, 'higher'); // wrong: 2 < 5
    expect(s.scores).toEqual([0, 2]);
  });

  it('rejects dealing out of turn, the same card twice, or a used card', () => {
    let s = newGame();
    expect(() => deal(s, 1, 2, 3)).toThrow();
    expect(() => deal(s, 0, 4, 4)).toThrow();
    s = call(deal(s, 0, 3, 8), 1, 'lower');
    s = call(deal(s, 1, 1, 2), 0, 'higher');
    expect(() => deal(s, 0, 3, 5)).toThrow(); // 3 is gone
  });
});

describe('a match', () => {
  it('10 rounds, 5 deals each, every card used exactly once', () => {
    const rng = seededRng(1);
    let s = newGame();
    while (s.phase !== 'gameOver') {
      if (s.phase === 'deal') {
        const d = botDeal(s, 'normal', rng);
        s = deal(s, s.dealer, d.shown, d.hidden);
      } else s = call(s, guesser(s), botCall(s, 'normal', rng));
    }
    expect(s.history).toHaveLength(10);
    expect(s.history.filter((r) => r.dealer === 0)).toHaveLength(5);
    expect(s.hands).toEqual([[], []]);
    expect(s.scores[0] + s.scores[1]).toBe(10);
    expect(winner(s)).not.toBeNull();
  });
});

describe('bots', () => {
  it('a counting guesser calls the majority side', () => {
    let s = newGame();
    s = deal(s, 0, 9, 10); // 9 shown: only 10 is higher
    expect(odds(s)).toEqual({ higher: 1, lower: 8 });
    expect(botCall(s, 'hard', seededRng(1))).toBe('lower');
  });
  it('a smart dealer hides a card on the minority side', () => {
    const s = newGame();
    for (let i = 0; i < 20; i++) {
      const d = botDeal(s, 'hard', seededRng(i));
      const rest = s.hands[0].filter((x) => x !== d.shown);
      const higher = rest.filter((x) => x > d.shown).length;
      const lower = rest.filter((x) => x < d.shown).length;
      if (higher !== lower) expect(d.hidden > d.shown).toBe(higher < lower);
    }
  });
  it('the hard bot catches a dealer who keeps hiding against the count', () => {
    let s = newGame();
    const other = () => { s = call(deal(s, 1, s.hands[1][0], s.hands[1][1]), 0, 'higher'); };
    // dealer 0 hides AGAINST the count three times in a row:
    s = call(deal(s, 0, 2, 1), 1, 'higher'); other();  // most cards were higher; hid the 1
    s = call(deal(s, 0, 9, 10), 1, 'lower'); other();  // most were lower; hid the 10
    s = call(deal(s, 0, 4, 3), 1, 'higher'); other();  // most were higher; hid the 3
    s = deal(s, 0, 7, 8); // left: 5, 6, 8 → the count says "lower" (2 to 1)
    expect(odds(s)).toEqual({ higher: 1, lower: 2 });
    expect(botCall(s, 'normal', seededRng(2))).toBe('lower'); // goes with the count
    expect(botCall(s, 'hard', seededRng(2))).toBe('higher');  // reads the bluffer
  });
});
