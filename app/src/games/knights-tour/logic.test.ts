import { describe, expect, it } from 'vitest';
import { canStart, complete, hint, moves, newGame, nextBoard, nextSquares, solve, standings, step, stuck, totalMs, undo } from './logic';
import { seededRng } from '../shared/rng';

describe('knight moves', () => {
  it('a corner has 2 moves, the middle of 8×8 has 8', () => {
    expect(moves(8, 0).sort()).toEqual([10, 17]);
    expect(moves(8, 27)).toHaveLength(8);
    expect(nextSquares(6, [0, 8])).not.toContain(0);
  });
  it('odd boards only start on corner-coloured squares', () => {
    expect(canStart(7, 0)).toBe(true);
    expect(canStart(7, 1)).toBe(false);
    expect(canStart(6, 1)).toBe(true);
  });
});

describe('solver', () => {
  for (const n of [6, 7, 8]) {
    it(`finds a full tour on ${n}×${n} from a corner, every jump legal`, () => {
      const t = solve(n, [0])!;
      expect(t).toHaveLength(n * n);
      expect(new Set(t).size).toBe(n * n);
      for (let i = 1; i < t.length; i++) expect(moves(n, t[i - 1])).toContain(t[i]);
    });
  }
  it('finds tours from every allowed start on 6×6 and 7×7', () => {
    for (const n of [6, 7]) for (let c = 0; c < n * n; c++) if (canStart(n, c)) expect(solve(n, [c])).toHaveLength(n * n);
  });
  it('hints point to a move that can still finish; a dead end is reported', () => {
    const h = hint(6, [0]);
    expect(h.kind).toBe('move');
    if (h.kind === 'move') expect(moves(6, 0)).toContain(h.to);
    // on 5×5, starting on a square of the wrong colour can never finish
    expect(hint(5, [1]).kind).toBe('deadEnd');
  });
});

describe('a match', () => {
  it('three boards; hints add 30 s; ranked by total time', () => {
    let s = newGame(seededRng(1), ['Hana', 'Jun']);
    expect(() => step({ ...s, index: 1 }, 1, 0)).toThrow(); // 7×7 wrong colour
    s = step(s, 0, 0);
    expect(() => step(s, 1, 0)).toThrow(); // not a knight move
    s = undo(s);
    expect(s.path).toEqual([]);
    for (const [i, ms] of [[0, 60_000], [1, 90_000], [2, 120_000]] as const) {
      const n = s.boards[i];
      const tour = solve(n, [0])!;
      if (i === 1) s = { ...s, hints: 1 };
      for (let k = 0; k < tour.length; k++) s = step(s, tour[k], ms);
      expect(complete(n, s.path)).toBe(true);
      expect(s.phase).toBe('solved');
      s = nextBoard(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(totalMs(s)).toBe(60_000 + 90_000 + 30_000 + 120_000);
    expect(standings(s)).toHaveLength(3);
  });
  it('knows when you are stuck', () => {
    // 6×6: a1→b3→... a short path that strands the knight in a corner region
    expect(stuck(6, [0])).toBe(false);
    expect(stuck(6, [0, 13, 0 + 2])).toBe(nextSquares(6, [0, 13, 2]).length === 0);
  });
});
