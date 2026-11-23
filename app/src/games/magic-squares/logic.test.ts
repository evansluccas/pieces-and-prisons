import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import {
  GIVENS, HINT_MS, current, hintCell, isMagic, lineTotals, lines, magicSum, makePuzzle, newGame, nextBoard, randomMagic, solutions, standings, totalMs,
  useHint, write,
} from './logic';

describe('magic squares', () => {
  it('magic sums and lines', () => {
    expect([3, 4, 5].map(magicSum)).toEqual([15, 34, 65]);
    expect(lines(4)).toHaveLength(10);
    expect(isMagic(3, [2, 7, 6, 9, 5, 1, 4, 3, 8])).toBe(true);
    expect(isMagic(3, [2, 7, 6, 9, 5, 1, 4, 8, 3])).toBe(false);
  });
  it('random squares are magic and varied', () => {
    for (const n of [3, 4, 5]) {
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const g = randomMagic(n, seededRng(i * 7 + n));
        expect(isMagic(n, g)).toBe(true);
        seen.add(g.join());
      }
      expect(seen.size).toBeGreaterThan(n === 3 ? 2 : 4);
    }
  });
  it('the 3×3 has exactly 8 answers from scratch; a puzzle has exactly one', () => {
    expect(solutions(3, Array(9).fill(null), 20)).toHaveLength(8);
    for (const n of [3, 4, 5]) {
      const p = makePuzzle(n, seededRng(n));
      const g = p.givens.filter((v) => v !== null).length;
      expect(g).toBeLessThanOrEqual(GIVENS[n] + 2);
      expect(p.givens.every((v, c) => v === null || v === p.solution[c])).toBe(true);
      const sols = solutions(n, p.givens, 2, 5_000_000);
      expect(sols).toHaveLength(1);
      expect(sols![0]).toEqual(p.solution);
    }
  });
});

describe('a match', () => {
  it('writing numbers, moving a used number, hints, three boards', () => {
    const rng = seededRng(2);
    let s = newGame(rng, ['Hana', 'Jun']);
    const p = current(s);
    const blank = p.givens.findIndex((v) => v === null);
    const given = p.givens.findIndex((v) => v !== null);
    expect(write(s, given, 1, 0)).toBe(s); // givens are locked
    const free = [...Array(9).keys()].map((v) => v + 1).find((v) => !p.givens.includes(v))!;
    s = write(s, blank, free, 0);
    expect(s.grid[blank]).toBe(free);
    const other = p.givens.findIndex((v, c) => v === null && c !== blank);
    s = write(s, other, free, 0); // the number moves
    expect(s.grid[blank]).toBeNull();
    expect(s.grid[other]).toBe(free);
    // a hint fixes a wrong or empty cell with the right number
    const c = hintCell(s, rng);
    s = useHint(s, c, 0);
    expect(s.grid[c]).toBe(p.solution[c]);
    expect(s.hints).toBe(1);
    expect(lineTotals(3, s.grid)).toHaveLength(8);

    for (const [i, ms] of [[0, 20_000], [1, 100_000], [2, 200_000]] as const) {
      const sol = current(s).solution;
      sol.forEach((v, cell) => { s = write(s, cell, v, ms); });
      expect(s.phase).toBe('solved');
      expect(s.results[i].timeMs).toBe(ms + (i === 0 ? HINT_MS : 0));
      s = nextBoard(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(20_000 + HINT_MS + 100_000 + 200_000);
    expect(standings(s)).toHaveLength(3);
  });
});
