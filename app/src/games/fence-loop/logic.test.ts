import { describe, expect, it } from 'vitest';
import { SIZE, clueOf, countSolutions, finish, geometry, isSingleLoop, makePuzzle, newGame, nextPuzzle, regionLoop, solved, standings, totalMs } from './logic';
import { seededRng } from '../shared/rng';

describe('loops', () => {
  it('the outline of a blob is one loop; two separate blobs are not', () => {
    const one = [true, true, false, true, false, false, false, false, false]; // 3x3, L shape
    expect(isSingleLoop(3, 3, regionLoop(3, 3, one))).toBe(true);
    const two = [true, false, true, false, false, false, false, false, false];
    expect(isSingleLoop(3, 3, regionLoop(3, 3, two))).toBe(false);
    const diagonal = [true, false, false, false, true, false, false, false, false]; // touching corners
    expect(isSingleLoop(3, 3, regionLoop(3, 3, diagonal))).toBe(false);
  });

  it('numbers count the fenced sides of each square', () => {
    const loop = regionLoop(2, 2, [true, false, false, false]);
    const g = geometry(2, 2);
    expect([0, 1, 2, 3].map((c) => clueOf(g, loop, c))).toEqual([4, 1, 1, 0]);
  });
});

describe('solver', () => {
  it('agrees with brute force (every loop is the outline of one region) on small grids', () => {
    const rng = seededRng(21);
    for (const n of [3, 4]) {
      const g = geometry(n, n);
      const loops: boolean[][] = [];
      for (let mask = 1; mask < 1 << (n * n); mask++) {
        const loop = regionLoop(n, n, [...Array(n * n).keys()].map((i) => !!(mask & (1 << i))));
        if (isSingleLoop(n, n, loop)) loops.push(loop);
      }
      for (let t = 0; t < 40; t++) {
        const base = loops[Math.floor(rng() * loops.length)];
        const clues = g.cellEdges.map((_, c) => (rng() < 0.45 ? clueOf(g, base, c) : null));
        const brute = loops.filter((l) => clues.every((k, c) => k === null || clueOf(g, l, c) === k)).length;
        expect(countSolutions(n, n, clues, 1000)).toBe(brute);
      }
    }
  });

  it('a fully numbered grid has one answer; an empty one has many', () => {
    const g = geometry(3, 3);
    const loop = regionLoop(3, 3, [true, true, false, true, true, false, false, false, false]);
    expect(countSolutions(3, 3, g.cellEdges.map((_, c) => clueOf(g, loop, c)))).toBe(1);
    expect(countSolutions(3, 3, Array(9).fill(null))).toBe(2);
  });
});

describe('puzzles', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: unique answer that matches its numbers, with blanks`, () => {
      const rng = seededRng(d.length * 11);
      for (let i = 0; i < 2; i++) {
        const t = performance.now();
        const p = makePuzzle(rng, d);
        const n = SIZE[d];
        expect(countSolutions(n, n, p.clues, 3)).toBe(1);
        const g = geometry(n, n);
        p.clues.forEach((k, c) => k !== null && expect(k).toBe(clueOf(g, p.answer, c)));
        expect(p.clues.filter((k) => k === null).length).toBeGreaterThan(n);
        expect(isSingleLoop(n, n, p.answer)).toBe(true);
        expect(performance.now() - t).toBeLessThan(4000);
      }
    }, 20_000);
  }
});

describe('match', () => {
  it('a puzzle only opens when the fences match; 3 puzzles; ranked by time', () => {
    let s = newGame(seededRng(5), 'easy', ['Hana', 'Jun']);
    const wrong = s.puzzle.answer.map((x, i) => (i === 0 ? !x : x));
    expect(solved(s.puzzle, wrong)).toBe(false);
    expect(finish(s, wrong, 1000).phase).toBe('solve');
    for (const ms of [40_000, 50_000, 60_000]) {
      s = finish(s, s.puzzle.answer, ms);
      expect(s.phase).toBe('solved');
      s = nextPuzzle(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(150_000);
    expect(standings(s)).toHaveLength(3);
  });
});
