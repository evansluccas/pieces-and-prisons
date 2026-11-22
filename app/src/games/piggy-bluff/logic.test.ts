import { describe, expect, it } from 'vitest';
import { MAX_CLAIM, add, claim, countOdds, knowledge, newGame, proceed, respond, standings } from './logic';
import { botAdd, botClaim, botRespond } from './bots';
import { seededRng } from '../shared/rng';

const three = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));

describe('adding and claiming', () => {
  it('adds 1–3 coins, passes to someone else, and alternates the asked colour', () => {
    let s = newGame(three);
    expect(() => add(s, 'a', { black: 2, white: 2 }, 'b')).toThrow();
    expect(() => add(s, 'a', { black: 1, white: 0 }, 'a')).toThrow();
    s = add(s, 'a', { black: 2, white: 1 }, 'b');
    expect(s.bank).toEqual({ black: 3, white: 2 });
    expect(s.phase).toBe('claim');
    expect(s.color).toBe('black');
    s = claim(s, 'b', 3);
    s = respond(respond(s, 'a', false), 'c', false);
    expect(s.history[0]).toMatchObject({ opened: false, correct: null });
    s = proceed(s);
    expect(s.color).toBe('white');
    expect(s.holder).toBe('b'); // nobody doubted: the receiver adds next
    expect(s.bank).toEqual({ black: 3, white: 2 }); // bank keeps its coins
  });

  it('accepts any count up to the cap — a miscount is just a wrong claim', () => {
    const s = add(newGame(three), 'a', { black: 1, white: 0 }, 'b'); // 3 coins inside
    expect(() => claim(s, 'b', -1)).toThrow();
    expect(() => claim(s, 'b', MAX_CLAIM + 1)).toThrow();
    expect(() => claim(s, 'c', 1)).toThrow(); // not c's claim
    let t = claim(s, 'b', 9); // more coins than the bank holds
    expect(t.phase).toBe('doubt');
    t = respond(respond(t, 'a', true), 'c', false);
    expect(t.history[0].correct).toBe(false);
  });
});

describe('doubting', () => {
  it('wrong claim: doubters +1, claimer −1, claimer starts the fresh bank', () => {
    let s = add(newGame(three), 'a', { black: 3, white: 0 }, 'b'); // 4 black inside
    s = claim(s, 'b', 2);
    s = respond(respond(s, 'a', true), 'c', true);
    const r = s.history[0];
    expect(r).toMatchObject({ opened: true, correct: false, actual: { black: 4, white: 1 } });
    expect(s.players.map((p) => p.points)).toEqual([1, -1, 1]);
    expect(s.holder).toBe('b');
    expect(s.bank).toEqual({ black: 1, white: 1 });
  });

  it('correct claim: claimer +1, doubters −1, first doubter starts the fresh bank', () => {
    let s = add(newGame(three), 'a', { black: 0, white: 2 }, 'b'); // 1 black
    s = claim(s, 'b', 1);
    s = respond(respond(s, 'a', true), 'c', false);
    expect(s.players.map((p) => p.points)).toEqual([-1, 1, 0]);
    expect(s.holder).toBe('a');
  });

  it('ends at the target score', () => {
    let s = newGame(three, { target: 1, maxClaims: 24, maxAdd: 3 });
    s = add(s, 'a', { black: 3, white: 0 }, 'b');
    s = claim(s, 'b', 0);
    s = respond(respond(s, 'a', true), 'c', false);
    s = proceed(s);
    expect(s.phase).toBe('gameOver');
    expect(standings(s)[0].id).toBe('a');
  });
});

describe('knowledge', () => {
  it('knows your own coins, not others’', () => {
    let s = add(newGame(three), 'a', { black: 2, white: 0 }, 'b');
    s = claim(s, 'b', 2);
    s = respond(respond(s, 'a', false), 'c', false);
    s = proceed(s); // white asked next, b adds
    s = add(s, 'b', { black: 0, white: 1 }, 'c');
    expect(knowledge(s, 'a')).toEqual({ known: { black: 3, white: 1 }, unknown: 1 });
    expect(knowledge(s, 'c')).toEqual({ known: { black: 1, white: 1 }, unknown: 3 });
    const odds = countOdds(s, 'c', 'white'); // 1 known + Binomial(3, ½)
    expect(odds.slice(1, 5)).toEqual([1 / 8, 3 / 8, 3 / 8, 1 / 8]);
    expect(odds.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });
});

describe('bots', () => {
  it('claim what they know for sure and doubt impossible claims', () => {
    const rng = seededRng(3);
    let s = add(newGame(three), 'a', { black: 2, white: 0 }, 'b');
    // b only knows the starting coins + 2 unknown → most likely 2 black
    expect(botClaim(s, 'b', rng)).toBe(2);
    s = claim(s, 'b', 0); // a knows there are at least 3 black
    expect(botRespond(s, 'a', 'steady', rng)).toBe(true);
  });

  it('play a full match without breaking the rules', () => {
    const rng = seededRng(8);
    let s = newGame(three);
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 500) {
      if (s.phase === 'add') {
        const m = botAdd(s, s.holder, 'trickster', rng);
        s = add(s, s.holder, m.coins, m.to);
      } else if (s.phase === 'claim') s = claim(s, s.receiver!, botClaim(s, s.receiver!, rng));
      else if (s.phase === 'doubt') {
        for (const id of ['a', 'b', 'c'].filter((x) => x !== s.receiver)) if (s.phase === 'doubt') s = respond(s, id, botRespond(s, id, 'steady', rng));
      } else if (s.phase === 'reveal') s = proceed(s);
    }
    expect(s.phase).toBe('gameOver');
    const pts = s.players.map((p) => p.points);
    expect(Math.max(...pts) >= 5 || s.claims >= 24).toBe(true);
  });
});
