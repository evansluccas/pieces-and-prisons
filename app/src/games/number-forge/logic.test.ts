import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, GameState, Tile, close, equationText, evaluate, forge, makeRound, newGame, nextRound, solve, standings, timeUp,
} from './logic';
import { botMove } from './bots';
import { seededRng } from '../shared/rng';

const two = [{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: true }];
const t = (n: number, op: Tile['op']): Tile => ({ n, op });
// A..J
const TILES: Tile[] = [t(7, '+'), t(3, '×'), t(2, '−'), t(5, '+'), t(4, '÷'), t(9, '−'), t(1, '+'), t(6, '×'), t(8, '÷'), t(2, '+')];

function fixed(target: number): GameState {
  const s = newGame(two, seededRng(1));
  return { ...s, tiles: TILES, target, answers: solve(TILES, target), found: [], claims: [] };
}

describe('equations', () => {
  it('works left to right and ignores the first operator', () => {
    expect(evaluate(TILES, [0, 1, 2])).toBe(19);      // 7 × 3 − 2
    expect(equationText(TILES, [0, 1, 2])).toBe('7 × 3 − 2');
    expect(evaluate(TILES, [3, 0, 1])).toBe(36);      // (5 + 7) × 3
    expect(evaluate(TILES, [7, 4, 2])).toBeNull();    // 6 ÷ 4 is not whole
    expect(evaluate(TILES, [8, 1, 4])).toBe(6);       // 8 × 3 ÷ 4
  });

  it('finds every winning set of tiles', () => {
    const sets = solve(TILES, 19);
    expect(sets.some((x) => x.join() === '0,1,2')).toBe(true);
    for (const set of sets) expect(set).toHaveLength(3);
  });

  it('makes rounds with a fair number of answers', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 20; i++) {
      const r = makeRound(rng, DEFAULT_CONFIG);
      expect(r.answers.length).toBeGreaterThanOrEqual(2);
      expect(r.answers.length).toBeLessThanOrEqual(6);
      expect(r.target).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('forging', () => {
  it('+1 for a new answer; −1 for a wrong one or the same tiles in another order', () => {
    let s = fixed(19);
    s = forge(s, 'a', [0, 1, 2], 1000);
    expect(s.players[0].points).toBe(1);
    expect(s.found).toEqual([[0, 1, 2]]);
    s = forge(s, 'b', [0, 2, 1], 2000); // same tiles: 7 − 2 × 3 = 15, wrong anyway
    s = forge(s, 'b', [0, 1, 2], 2500); // claimed already
    expect(s.players[1].points).toBe(-2);
    expect(s.claims[2].repeat).toBe(true);
    expect(() => forge(s, 'a', [1, 1, 2], 3000)).toThrow();
  });

  it('closing: right +3 and the round ends; wrong −1 and the race goes on', () => {
    let s = fixed(19);
    s = close(s, 'b', 500);
    expect(s.players[1].points).toBe(-1);
    expect(s.phase).toBe('play');
    s = { ...s, found: s.answers.map((x) => [...x]) }; // pretend every answer has been claimed
    s = close(s, 'a', 9000);
    expect(s.players[0].points).toBe(3);
    expect(s.phase).toBe('result');
    expect(s.history[0].end).toBe('closed');
  });
});

describe('match', () => {
  it('plays 6 rounds with bots racing until time or a close', () => {
    const rng = seededRng(5);
    let s = newGame(two, rng);
    while (s.phase !== 'gameOver') {
      if (s.phase === 'result') {
        s = nextRound(s, rng);
        continue;
      }
      let at = 0;
      for (let i = 0; i < 30 && s.phase === 'play'; i++) {
        at += 2000;
        const m = botMove(s, 'steady', rng);
        if (m.kind === 'forge') s = forge(s, 'b', m.order, at);
        else if (m.kind === 'close') s = close(s, 'b', at);
      }
      s = timeUp(s);
    }
    expect(s.history).toHaveLength(6);
    const order = standings(s);
    expect(order[0].points).toBeGreaterThanOrEqual(order[1].points);
  });

  it('bots only forge real answers unless they slip', () => {
    const s = fixed(19);
    let right = 0;
    for (let i = 0; i < 50; i++) {
      const m = botMove(s, 'steady', seededRng(i));
      if (m.kind === 'forge' && evaluate(s.tiles, m.order) === 19) right++;
    }
    expect(right).toBeGreaterThan(40);
  });
});
