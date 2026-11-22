import { describe, expect, it } from 'vitest';
import { ADJ, GameState, MILLS, Side, inMill, legalTurns, newGame, play, removable, steps } from './logic';
import { botTurn } from './bots';
import { seededRng } from '../shared/rng';

const board = (mine: number[], theirs: number[]) => {
  const b: (Side | null)[] = Array(24).fill(null);
  mine.forEach((p) => (b[p] = 0));
  theirs.forEach((p) => (b[p] = 1));
  return b;
};

describe('the board', () => {
  it('lines are symmetric and every mill is a straight line of neighbours', () => {
    ADJ.forEach((ns, p) => ns.forEach((q) => expect(ADJ[q]).toContain(p)));
    expect(ADJ.flat()).toHaveLength(64); // 32 lines, counted from both ends
    for (const [a, b, c] of MILLS) {
      expect(ADJ[a]).toContain(b);
      expect(ADJ[b]).toContain(c);
    }
    expect(MILLS).toHaveLength(16);
  });
});

describe('placing and mills', () => {
  it('placing a third in a row takes a man; men in mills are safe', () => {
    let s = newGame();
    s = play(s, { from: null, to: 0, remove: null });
    s = play(s, { from: null, to: 9, remove: null });
    s = play(s, { from: null, to: 1, remove: null });
    s = play(s, { from: null, to: 21, remove: null });
    // 0 completes 0-1-2 by placing on 2: must take one of theirs
    const mills = legalTurns(s).filter((t) => t.to === 2);
    expect(mills.every((t) => t.remove !== null)).toBe(true);
    s = play(s, { from: null, to: 2, remove: 9 });
    expect(s.board[9]).toBeNull();
    expect(s.inHand).toEqual([6, 7]);
  });

  it('protects men in a mill unless every man is in one', () => {
    const b = board([], [0, 1, 2, 5]);
    expect(inMill(b, 0)).toBe(true);
    expect(removable(b, 0)).toEqual([5]);
    expect(removable(board([], [0, 1, 2]), 0).sort()).toEqual([0, 1, 2]);
  });
});

describe('moving and flying', () => {
  function moving(mine: number[], theirs: number[]): GameState {
    return { ...newGame(), board: board(mine, theirs), inHand: [0, 0] };
  }
  it('slides to an empty neighbour; flies with 3 men', () => {
    const s = moving([0, 4, 10, 13], [1, 2, 14, 23]);
    expect(steps(s, 0).filter((m) => m.from === 0).map((m) => m.to)).toEqual([9]);
    const fly = moving([0, 4, 10], [1, 2, 14, 23, 22]);
    expect(steps(fly, 0).filter((m) => m.from === 0)).toHaveLength(24 - 8);
  });
  it('wins when the opponent drops to 2 men', () => {
    // 4→1 completes 0-1-2 and takes 9, leaving them with 2
    const s = play(moving([0, 2, 4, 20], [9, 14, 23]), { from: 4, to: 1, remove: 9 });
    expect(s.winner).toBe(0);
  });
  it('wins when the opponent has no legal move', () => {
    // their four men in the corner are boxed in once 23 slides to 14
    const s = play(moving([9, 4, 10, 23], [0, 1, 2, 3]), { from: 23, to: 14, remove: null });
    expect(s.winner).toBe(0);
  });
});

describe('bots', () => {
  it('take a mill when one is there to take, and block one that is coming', () => {
    const s = { ...newGame(), board: board([0, 1], [9, 21]), inHand: [7, 7] as [number, number], turn: 0 as Side };
    const t = botTurn(s, 'normal', seededRng(1));
    expect(t.to).toBe(2);
    expect(t.remove).not.toBeNull();
    const block = { ...newGame(), board: board([5], [0, 1]), inHand: [8, 7] as [number, number], turn: 0 as Side };
    expect(botTurn(block, 'normal', seededRng(2)).to).toBe(2);
  });
  it('play a whole game against each other to an end', () => {
    const rng = seededRng(3);
    let s = newGame();
    let guard = 0;
    while (s.winner === null && guard++ < 400) s = play(s, botTurn(s, s.turn === 0 ? 'normal' : 'easy', rng));
    expect(s.winner).not.toBeNull();
  }, 30_000);
});
