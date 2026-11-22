import { describe, expect, it } from 'vitest';
import { Cell, canPlace, finish, isMirrored, makePuzzle, mirrorCell, newGame, nextPuzzle, standings, totalMs, turns } from './logic';
import { key, norm, placedCells } from '../piece-together/logic';
import { seededRng } from '../shared/rng';

describe('mirror', () => {
  it('reflects across the line between the halves', () => {
    expect(mirrorCell([0, 2], 5)).toEqual([9, 2]);
    expect(mirrorCell([4, 0], 5)).toEqual([5, 0]);
  });
  it('turns never include the mirror image of a lopsided piece', () => {
    const L: Cell[] = [[0, 0], [1, 0], [2, 0], [2, 1]];
    const mirrored = norm(L.map(([x, y]) => [-x, y] as Cell));
    expect(turns(L)).toHaveLength(4);
    expect(turns(L).some((t) => JSON.stringify(t) === JSON.stringify(mirrored))).toBe(false);
  });
});

describe('puzzles', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: the target is the exact reflection, and each tray piece can be TURNED into it`, () => {
      const rng = seededRng(d.length * 7);
      for (let i = 0; i < 15; i++) {
        const pz = makePuzzle(rng, d);
        expect(pz.left).toHaveLength({ easy: 4, normal: 5, hard: 6 }[d]);
        const left = new Set(pz.left.flatMap(placedCells).map(key));
        expect(left.size).toBe(pz.left.reduce((t, p) => t + p.cells.length, 0)); // no overlaps
        for (const c of pz.left.flatMap(placedCells)) expect(c[0]).toBeLessThan(pz.cols);
        pz.target.forEach((t) => {
          const reflected = placedCells(pz.left[t.piece]).map((c) => key(mirrorCell(c, pz.cols))).sort();
          expect(placedCells(t).map(key).sort()).toEqual(reflected);
          expect(turns(pz.tray[t.piece]).some((o) => JSON.stringify(o) === JSON.stringify(t.cells))).toBe(true);
          if (turns(t.cells).length > 1) expect(pz.tray[t.piece]).not.toEqual(t.cells); // the tray doesn't give it away
        });
        expect(isMirrored(pz, pz.target)).toBe(true);
      }
    });
  }
});

describe('placing', () => {
  it('only on the right half, no overlaps; a wrong spot is not a mirror', () => {
    const pz = makePuzzle(seededRng(9), 'easy');
    const t = pz.target[0];
    expect(canPlace(pz, [], t.cells, t.at)).toBe(true);
    expect(canPlace(pz, [], t.cells, [0, 0])).toBe(false); // left half
    expect(canPlace(pz, [t], pz.target[0].cells, t.at)).toBe(false);
    const shifted = pz.target.map((p, i) => (i === 0 ? { ...p, at: [p.at[0], p.at[1] + 1] as Cell } : p));
    expect(isMirrored(pz, shifted)).toBe(false);
  });
});

describe('match', () => {
  it('opens only on a perfect mirror; 3 puzzles; ranked by time', () => {
    let s = newGame(seededRng(3), 'normal', ['Hana', 'Jun']);
    expect(finish(s, s.puzzle.target.slice(1), 1000).phase).toBe('solve');
    for (const ms of [20_000, 30_000, 40_000]) {
      s = finish(s, s.puzzle.target, ms);
      expect(s.phase).toBe('solved');
      s = nextPuzzle(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(90_000);
    expect(standings(s)).toHaveLength(3);
  });
});
