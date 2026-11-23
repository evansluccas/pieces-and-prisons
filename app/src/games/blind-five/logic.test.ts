import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import { Level, Memory, botMove, fade, observe, wrongCall } from './bots';
import { GameState, Side, at, fives, isLine, lineBetween, newGame, play } from './logic';

const place = (s: GameState, side: Side, cell: number) => play(s, side, { kind: 'place', cell });

describe('lines', () => {
  it('recognises straight lines of five in all four directions', () => {
    expect(lineBetween(at(0, 0), at(4, 0))).toEqual([0, 1, 2, 3, 4]);
    expect(lineBetween(at(2, 2), at(2, 6))).toHaveLength(5);
    expect(lineBetween(at(0, 0), at(4, 4))).toHaveLength(5);
    expect(lineBetween(at(0, 4), at(4, 0))).toHaveLength(5);
    expect(lineBetween(at(0, 0), at(4, 3))).toBeNull();
    expect(lineBetween(at(0, 0), at(5, 0))).toBeNull();
    expect(isLine([at(3, 1), at(1, 1), at(2, 1), at(5, 1), at(4, 1)])).toBe(true);
    expect(isLine([at(1, 1), at(2, 1), at(3, 1), at(4, 1), at(6, 1)])).toBe(false);
  });
});

describe('play', () => {
  it('only empty squares take stones; a call needs five placed stones in a line', () => {
    let s = place(newGame(), 0, at(0, 0));
    expect(() => place(s, 1, at(0, 0))).toThrow();
    expect(() => place(s, 0, at(1, 1))).toThrow(); // not blue's turn
    s = place(s, 1, at(1, 1));
    expect(() => play(s, 0, { kind: 'call', cells: lineBetween(at(0, 0), at(4, 4))! })).toThrow(); // empty squares
  });

  it('strikes and wins', () => {
    let s = newGame();
    for (let i = 0; i < 5; i++) {
      s = place(s, 0, at(i, 0));
      s = place(s, 1, at(i, 1));
    }
    const top = lineBetween(at(0, 0), at(4, 0))!;
    const second = lineBetween(at(0, 1), at(4, 1))!;
    let t = play(s, 0, { kind: 'call', cells: second });
    expect(t.strikes).toEqual([1, 0]);
    expect(t.winner).toBeNull();
    expect(t.turn).toBe(1);
    t = place(t, 1, at(6, 6));
    const lost = play(t, 0, { kind: 'call', cells: second });
    expect(lost.winner).toBe(1);
    const won = play(t, 0, { kind: 'call', cells: top });
    expect(won.winner).toBe(0);
    expect(won.winLine).toEqual(top);
    expect(fives(s.board, 1)).toHaveLength(1);
  });
});

describe('bot memory', () => {
  it('remembers its own stones better than yours, and fades', () => {
    const rng = seededRng(3);
    const mem: Memory = new Map();
    for (let c = 0; c < 100; c++) observe(mem, c, (c % 2) as Side, 0, 'easy', rng);
    const own = [...mem.keys()].filter((c) => c % 2 === 0).length;
    const theirs = [...mem.keys()].filter((c) => c % 2 === 1).length;
    expect(own).toBeGreaterThan(theirs);
    const before = mem.size;
    for (let i = 0; i < 20; i++) fade(mem, 'easy', rng);
    expect(mem.size).toBeLessThan(before);
    wrongCall(mem, [0, 2, 4]);
    expect(mem.has(0) || mem.has(2) || mem.has(4)).toBe(false);
  });

  it('blocks an open four it remembers, and calls a five it believes in', () => {
    const rng = seededRng(1);
    let s = newGame();
    const mem: Memory = new Map();
    // blue has four in a row (5,1)…(5,4); red scattered
    for (let i = 0; i < 4; i++) {
      s = place(s, 0, at(5, 1 + i));
      mem.set(at(5, 1 + i), 0);
      s = place(s, 1, at(i * 2, 9));
      mem.set(at(i * 2, 9), 1);
    }
    s = place(s, 0, at(9, 9));
    const m = botMove(s, 1, mem, 'hard', rng);
    expect(m.kind).toBe('place');
    if (m.kind === 'place') expect([at(5, 0), at(5, 5)]).toContain(m.cell);
    // a row red remembers as all its own gets called
    for (const x of [1, 3, 5]) {
      s = place(s, 1, x === 1 ? at(5, 5) : at(9, x));
      s = place(s, 0, at(10, x));
    }
    const row = lineBetween(at(0, 10), at(4, 10))!;
    for (const c of row) {
      s = { ...s, board: s.board.map((b, i) => (i === c ? 1 : b)) };
      mem.set(c, 1);
    }
    s = { ...s, turn: 1 };
    expect(botMove(s, 1, mem, 'hard', rng)).toEqual({ kind: 'call', cells: row });
  });
});

/** Play bot against bot; returns how games ended. */
function match(a: Level, b: Level, seed: number) {
  const rng = seededRng(seed);
  let s = newGame();
  const mems: [Memory, Memory] = [new Map(), new Map()];
  const levels = [a, b];
  for (let turn = 0; turn < 200 && s.winner === null; turn++) {
    const side = s.turn;
    fade(mems[side], levels[side], rng);
    const m = botMove(s, side, mems[side], levels[side], rng);
    s = play(s, side, m);
    if (m.kind === 'place') for (const k of [0, 1] as Side[]) observe(mems[k], m.cell, side, k, levels[k], rng);
    else if (!s.history[s.history.length - 1].ok) wrongCall(mems[side], m.cells);
  }
  return s;
}

describe('bot vs bot', () => {
  it('games finish, and harder bots win more', () => {
    let hardWins = 0;
    for (let i = 0; i < 20; i++) {
      const s = match(i % 2 ? 'hard' : 'easy', i % 2 ? 'easy' : 'hard', 100 + i);
      expect(s.winner).not.toBeNull();
      const hardSide = i % 2 ? 0 : 1;
      if (s.winner === hardSide) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(13);
  });
});
