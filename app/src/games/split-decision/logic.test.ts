import { describe, expect, it } from 'vitest';
import {
  Cell, canTile, choose, countRects, cubeCount, makeBlocks, makeCubes, makeGrass, makeMemory, newGame, next, rotations, standings,
  startAnswering, timeUp,
} from './logic';
import { botAnswer } from './bots';
import { seededRng } from '../shared/rng';

describe('count the cubes', () => {
  it('answers match the stack, and every column is visible (no taller column in front)', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 40; i++) {
      const q = makeCubes(rng);
      if (q.data.kind !== 'cubes') throw new Error();
      const h = q.data.heights;
      expect(q.options[q.answer]).toBe(`${cubeCount(h)}`);
      expect(q.options[1 - q.answer]).not.toBe(q.options[q.answer]);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        if (y > 0) expect(h[y][x]).toBeLessThanOrEqual(h[y - 1][x]);
        if (x > 0) expect(h[y][x]).toBeLessThanOrEqual(h[y][x - 1]);
      }
    }
  });
});

describe('count the blocks', () => {
  it('counts every rectangle with the target sum', () => {
    expect(countRects([[1, 2], [3, 4]], 3)).toBe(2); // [1,2] and [3]
    expect(countRects([[1, 2], [3, 4]], 10)).toBe(1); // the whole grid
    const rng = seededRng(2);
    for (let i = 0; i < 20; i++) {
      const q = makeBlocks(rng);
      if (q.data.kind !== 'blocks') throw new Error();
      expect(q.options[q.answer]).toBe(`${countRects(q.data.grid, q.data.target)}`);
    }
  });
});

describe('lay the grass', () => {
  it('turns pieces but never flips them', () => {
    const L: Cell[] = [[0, 0], [1, 0], [2, 0], [2, 1]];
    expect(rotations(L)).toHaveLength(4);
    expect(rotations([[0, 0], [1, 0], [0, 1], [1, 1]])).toHaveLength(1);
    // a 2×3 block from two L3s
    expect(canTile([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], [[[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]]])).toBe(true);
    expect(canTile([[0, 0], [1, 0], [2, 0], [3, 0]], [[[0, 0], [1, 0], [0, 1], [1, 1]]])).toBe(false);
  });
  it('the stated answer matches the solver, with both yes and no puzzles', () => {
    const rng = seededRng(3);
    const answers = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const q = makeGrass(rng);
      if (q.data.kind !== 'grass') throw new Error();
      const yes = canTile(q.data.field, q.data.pieces);
      expect(q.options[q.answer]).toBe(yes ? 'Yes' : 'No');
      answers.add(q.options[q.answer]);
    }
    expect(answers.size).toBe(2);
  });
});

describe('card memory', () => {
  it('one of the two squares holds the card', () => {
    const q = makeMemory(seededRng(4));
    if (q.data.kind !== 'memory') throw new Error();
    expect(q.data.spots[q.answer]).toBe(q.data.ask);
    expect(new Set(q.data.cards.map((c) => `${c.suit}${c.rank}`)).size).toBe(16);
  });
});

describe('match', () => {
  it('10 questions; right answers score; ties go to the faster total', () => {
    const rng = seededRng(5);
    const people = [{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: true }];
    let s = newGame(people, rng);
    expect(s.questions.map((q) => q.data.kind)).toEqual(['cubes', 'cubes', 'cubes', 'blocks', 'blocks', 'blocks', 'grass', 'grass', 'memory', 'memory']);
    while (s.phase !== 'gameOver') {
      if (s.phase === 'memorize') s = startAnswering(s);
      if (s.phase === 'answer') {
        s = choose(s, 'a', s.questions[s.index].answer, 4000);
        const b = botAnswer(s, 'steady', rng);
        s = choose(s, 'b', b.choice, b.ms);
      }
      s = next(s);
    }
    expect(s.players[0].points).toBe(10);
    expect(standings(s)[0].id).toBe('a');
  });
  it('no answer when time runs out', () => {
    let s = newGame([{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: true }], seededRng(6));
    s = choose(s, 'b', s.questions[0].answer, 1000);
    s = timeUp(s);
    expect(s.phase).toBe('reveal');
    expect(s.results[0].picks.a.choice).toBeNull();
    expect(s.players[0].points).toBe(0);
  });
});
