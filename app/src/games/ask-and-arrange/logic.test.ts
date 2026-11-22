import { describe, expect, it } from 'vitest';
import { answer, arrange, ask, correct, guess, isRow, newGame, winner } from './logic';
import { ALL_QUESTIONS, ALL_ROWS, bestGuess, botTurn, candidates, information } from './bots';
import { seededRng } from '../shared/rng';

const ROW = [3, 1, 4, 8, 5, 2, 7, 6];
const BOT = [6, 2, 8, 1, 7, 3, 5, 4];

describe('questions', () => {
  it('answer truthfully', () => {
    expect(answer(ROW, { kind: 'slot', a: 2 })).toBe(4);
    expect(answer(ROW, { kind: 'sum', a: 0, b: 2 })).toBe(8);
    expect(answer(ROW, { kind: 'compare', a: 3, b: 4 })).toBe(true);
    expect(answer(ROW, { kind: 'before', x: 7, y: 6 })).toBe(true);
    expect(answer(ROW, { kind: 'before', x: 6, y: 3 })).toBe(false);
  });
  it('there are 40,320 rows and a useful set of questions', () => {
    expect(ALL_ROWS).toHaveLength(40320);
    expect(ALL_ROWS.every(isRow)).toBe(true);
    // 8 single slots + 18 runs of 2–4 slots + 28 slot pairs + 28 card pairs
    expect(ALL_QUESTIONS).toHaveLength(82);
  });
});

describe('a match', () => {
  it('tokens pay for questions; guessing ends your asking; most slots right wins', () => {
    let s = arrange(newGame(BOT), ROW);
    s = ask(s, 0, { kind: 'slot', a: 0 });
    expect(s.tokens[0]).toBe(7);
    expect(s.asked[0].answer).toBe(6);
    expect(s.turn).toBe(1);
    expect(() => ask(s, 0, { kind: 'slot', a: 1 })).toThrow();
    s = ask(s, 1, { kind: 'compare', a: 0, b: 1 });
    expect(s.asked[1].answer).toBe(true); // 3 > 1 in MY row
    s = guess(s, 0, [6, 2, 8, 1, 7, 3, 4, 5]); // 6 of 8 right
    expect(s.turn).toBe(1);
    s = ask(s, 1, { kind: 'slot', a: 2 });
    expect(s.turn).toBe(1); // I'm done, so the bot keeps the turn
    s = guess(s, 1, ROW);
    expect(s.phase).toBe('gameOver');
    expect(correct(s, 0)).toBe(6);
    expect(correct(s, 1)).toBe(8);
    expect(winner(s)).toBe(1);
  });
  it('rejects bad questions and unaffordable ones', () => {
    let s = arrange(newGame(BOT), ROW);
    expect(() => ask(s, 0, { kind: 'sum', a: 0, b: 6 })).toThrow();
    s = { ...s, tokens: [2, 10] };
    expect(() => ask(s, 0, { kind: 'slot', a: 0 })).toThrow();
  });
});

describe('deduction', () => {
  it('candidates always contain the truth and shrink with every answer', () => {
    let s = arrange(newGame(BOT), ROW);
    let before = 40320;
    const rng = seededRng(1);
    for (let i = 0; i < 4; i++) {
      s = ask(s, 0, ALL_QUESTIONS[Math.floor(rng() * ALL_QUESTIONS.length)]);
      const c = candidates(s.asked, 0);
      expect(c.some((r) => r.join() === BOT.join())).toBe(true);
      expect(c.length).toBeLessThanOrEqual(before);
      before = c.length;
      s = { ...s, turn: 0 };
    }
  });
  it('a slot question is worth 3 bits on a fresh board; best guess hits the truth when only one row is left', () => {
    expect(information(ALL_ROWS, { kind: 'slot', a: 0 })).toBeCloseTo(3, 5);
    expect(information(ALL_ROWS, { kind: 'compare', a: 0, b: 1 })).toBeCloseTo(1, 5);
    expect(bestGuess([BOT])).toEqual(BOT);
  });
  it('the hard bot does far better than guessing blind (which averages 1 slot)', () => {
    let total = 0;
    for (let g = 0; g < 6; g++) {
      const rng = seededRng(40 + g);
      let s = arrange(newGame(BOT), ROW);
      s = { ...s, turn: 1 };
      let guard = 0;
      while (s.guesses[1] === null && guard++ < 30) {
        const t = botTurn(s, 1, 'hard', rng);
        s = t.kind === 'ask' ? ask(s, 1, t.q) : guess(s, 1, t.row);
        if (s.turn === 0 && s.guesses[0] === null) s = { ...s, turn: 1 };
      }
      expect(s.guesses[1]).not.toBeNull();
      total += correct(s, 1);
    }
    expect(total / 6).toBeGreaterThanOrEqual(2); // at least double blind guessing
  }, 120_000);
});
