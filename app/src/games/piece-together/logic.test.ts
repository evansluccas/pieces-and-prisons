import { describe, expect, it } from 'vitest';
import {
  Cell, Placement, canPlace, finish, flip, isComplete, key, makePuzzle, norm, newGame, nextPuzzle, orientations, placedCells, rotate,
  standings, totalMs,
} from './logic';
import { seededRng } from '../shared/rng';

/** Same piece, allowing turns and flips. */
const sameShape = (a: Cell[], b: Cell[]) => orientations(b).some((o) => JSON.stringify(o) === JSON.stringify(norm(a)));

describe('pieces', () => {
  it('turn and flip', () => {
    const L: Cell[] = [[0, 0], [1, 0], [2, 0], [2, 1]];
    expect(rotate(rotate(rotate(rotate(L))))).toEqual(L.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]));
    expect(orientations(L)).toHaveLength(8);
    expect(orientations([[0, 0], [1, 0], [0, 1], [1, 1]])).toHaveLength(1);
    expect(orientations([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]])).toHaveLength(1); // X
    expect(flip(flip(L))).toEqual(orientations(L)[0]);
  });
});

describe('puzzles', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: the hidden answer fills the outline exactly with the tray's pieces`, () => {
      const rng = seededRng(d.length * 3);
      for (let i = 0; i < 15; i++) {
        const p = makePuzzle(rng, d);
        expect(p.pieces).toHaveLength(d === 'easy' ? 6 : 8);
        const covered = p.solution.flatMap(placedCells).map(key);
        expect(new Set(covered).size).toBe(covered.length); // no overlaps
        expect(new Set(covered)).toEqual(new Set(p.outline.map(key)));
        p.solution.forEach((s) => expect(sameShape(s.cells, p.pieces[s.piece])).toBe(true));
        expect(Math.max(...p.outline.map((c) => c[0]))).toBeLessThan(12);
        expect(Math.max(...p.outline.map((c) => c[1]))).toBeLessThan(9);
        expect(isComplete(p, p.solution)).toBe(true);
      }
    });
  }
});

describe('placing', () => {
  it('pieces must sit inside the outline and not overlap', () => {
    const outline: Cell[] = [[0, 0], [1, 0], [2, 0], [0, 1]];
    const bar: Cell[] = [[0, 0], [1, 0]];
    expect(canPlace(outline, [], bar, [0, 0])).toBe(true);
    expect(canPlace(outline, [], bar, [2, 0])).toBe(false); // sticks out
    const placed: Placement[] = [{ piece: 0, cells: bar, at: [0, 0] }];
    expect(canPlace(outline, placed, bar, [1, 0])).toBe(false); // overlaps
    expect(canPlace(outline, placed, bar, [1, 0], 0)).toBe(true); // moving piece 0 itself
  });
});

describe('match', () => {
  it('a puzzle only opens when every piece is in; 3 puzzles; ranked by time', () => {
    let s = newGame(seededRng(5), 'normal', ['Hana', 'Jun']);
    expect(finish(s, s.puzzle.solution.slice(1), 1000).phase).toBe('solve');
    for (const ms of [30_000, 40_000, 50_000]) {
      s = finish(s, s.puzzle.solution, ms);
      expect(s.phase).toBe('solved');
      s = nextPuzzle(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(120_000);
    expect(standings(s)).toHaveLength(3);
  });
});
