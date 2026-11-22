import { describe, expect, it } from 'vitest';
import {
  Clue, LETTER_COUNT, allCodes, clueText, codeText, feedback, holds, makePuzzle, newGame, nextLock, solutions, standings,
  totalMs, tryCode,
} from './logic';
import { seededRng } from '../shared/rng';

describe('clues', () => {
  it('check codes correctly', () => {
    const code = [1, 0, 4, 2]; // BAEC
    expect(holds({ kind: 'has', letter: 4 }, code)).toBe(true);
    expect(holds({ kind: 'not', letter: 3 }, code)).toBe(true);
    expect(holds({ kind: 'vowelAt', slot: 1, vowel: true }, code)).toBe(true);
    expect(holds({ kind: 'before', a: 0, b: 2 }, code)).toBe(true);
    expect(holds({ kind: 'before', a: 2, b: 0 }, code)).toBe(false);
    expect(holds({ kind: 'gap', slot: 2, from: 1, n: 4 }, code)).toBe(true);
    expect(holds({ kind: 'later', slot: 0, than: 1 }, code)).toBe(true);
    expect(holds({ kind: 'range', lo: 0, hi: 2, count: 3 }, code)).toBe(true);
    expect(feedback(code, [1, 2, 0, 5])).toEqual({ exact: 1, moved: 2 });
  });

  it('reads well', () => {
    const c: Clue = { kind: 'guess', guess: [0, 1, 2, 3], exact: 1, moved: 0 };
    expect(clueText(c)).toBe('Trying ABCD: 1 right letter in the right slot, 0 right letters in the wrong slot.');
    expect(clueText({ kind: 'gap', slot: 2, from: 0, n: -2 })).toBe('Slot 3 is 2 letters before slot 1 in the alphabet.');
    expect(allCodes(6)).toHaveLength(360);
  });
});

describe('puzzles', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: exactly one code fits, no clue is redundant, the clues are all true`, () => {
      const rng = seededRng(d.length * 7);
      for (let i = 0; i < 6; i++) {
        const p = makePuzzle(rng, d);
        const n = LETTER_COUNT[d];
        expect(solutions(p.clues, n).map(codeText)).toEqual([codeText(p.code)]);
        for (const c of p.clues) expect(holds(c, p.code)).toBe(true);
        for (let k = 0; k < p.clues.length; k++) {
          expect(solutions(p.clues.filter((_, j) => j !== k), n).length).toBeGreaterThan(1);
        }
        expect(p.clues.length).toBeLessThanOrEqual(9);
      }
    });
  }
});

describe('match', () => {
  it('wrong tries add 30s; three locks; ranked by total time', () => {
    let s = newGame(seededRng(3), 'easy', ['Hana', 'Jun', 'Seo']);
    const wrong = [0, 1, 2, 3].some((x, i) => x !== s.puzzle.code[i]) ? [0, 1, 2, 3] : [1, 0, 2, 3];
    s = tryCode(s, wrong, 5_000);
    expect(s.phase).toBe('solve');
    s = tryCode(s, s.puzzle.code, 40_000);
    expect(s.results[0]).toMatchObject({ timeMs: 70_000, wrong: 1 });
    expect(() => tryCode(s, [0, 0, 1, 2], 1)).toThrow();
    s = nextLock(s);
    s = tryCode(s, s.puzzle.code, 20_000);
    s = nextLock(s);
    s = tryCode(s, s.puzzle.code, 30_000);
    s = nextLock(s);
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(120_000);
    const order = standings(s);
    expect(order).toHaveLength(4);
    for (let i = 0; i < 3; i++) expect(order[i].ms).toBeLessThanOrEqual(order[i + 1].ms);
  });
});
