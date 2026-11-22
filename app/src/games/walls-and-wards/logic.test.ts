import { describe, expect, it } from 'vitest';
import { GameState, edgeKey, isSettled, move, newGame, place, reachable, regions, scores, standings } from './logic';
import { botMove, botPlace, influence } from './bots';
import { seededRng } from '../shared/rng';

const two = [{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: true }];
const key = (cells: { x: number; y: number }[]) => cells.map((c) => `${c.x},${c.y}`).sort();

function placed(): GameState {
  let s = newGame(two);
  s = place(s, 'a', { x: 0, y: 0 }); // a square
  s = place(s, 'b', { x: 6, y: 6 }); // b square
  s = place(s, 'b', { x: 6, y: 0 }); // b round
  s = place(s, 'a', { x: 0, y: 6 }); // a round
  return s;
}

describe('setup', () => {
  it('places in snake order, square first then round', () => {
    const s = placed();
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('a');
    expect(s.counters.map((c) => `${c.owner}:${c.kind}`)).toEqual(['a:square', 'b:square', 'b:round', 'a:round']);
  });
  it('rejects occupied cells and out-of-turn placements', () => {
    let s = newGame(two);
    expect(() => place(s, 'b', { x: 1, y: 1 })).toThrow();
    s = place(s, 'a', { x: 1, y: 1 });
    expect(() => place(s, 'b', { x: 1, y: 1 })).toThrow();
  });
});

describe('movement', () => {
  it('square moves 1–2 straight; round moves 1 then may turn', () => {
    const s = { ...placed(), counters: [
      { id: 'sq', owner: 'a', kind: 'square' as const, x: 3, y: 3 },
      { id: 'rd', owner: 'b', kind: 'round' as const, x: 0, y: 0 },
    ] };
    expect(key(reachable(s, 'sq'))).toEqual(key([
      { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 4 }, { x: 3, y: 5 },
      { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
    ]));
    expect(key(reachable(s, 'rd'))).toEqual(key([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]));
  });
  it('walls and counters block movement', () => {
    let s = { ...placed(), counters: [
      { id: 'sq', owner: 'a', kind: 'square' as const, x: 3, y: 3 },
      { id: 'x', owner: 'b', kind: 'square' as const, x: 3, y: 2 },
    ] };
    s = { ...s, walls: [edgeKey(3, 3, 'E')!] };
    const cells = key(reachable(s, 'sq'));
    expect(cells).not.toContain('3,2');
    expect(cells).not.toContain('3,1');
    expect(cells).not.toContain('4,3');
  });
  it('requires a wall on a free side after moving', () => {
    const s = placed();
    expect(() => move(s, 'a', 'a-0', { x: 1, y: 0 }, null)).toThrow();
    const next = move(s, 'a', 'a-0', { x: 1, y: 0 }, 'S');
    expect(next.walls).toEqual([edgeKey(1, 0, 'S')]);
    expect(next.turn).toBe('b');
  });
});

describe('territory', () => {
  it('scores areas that only one player occupies, and settles the match', () => {
    let s = placed();
    // wall off a's top-left 1x1 corner around (0,0)
    s = { ...s, walls: [edgeKey(0, 0, 'E')!, edgeKey(0, 0, 'S')!] };
    const corner = regions(s).find((r) => r.cells.length === 1)!;
    expect(corner.owners).toEqual(['a']);
    expect(scores(s).find((x) => x.id === 'a')!.territory).toBe(1);
    expect(isSettled(s)).toBe(false); // the big area still holds a and b
  });

  it('plays a full bot match to the end', () => {
    const rng = seededRng(7);
    let s = newGame([...two, { id: 'c', name: 'C', isBot: true }]);
    while (s.phase === 'place') s = place(s, s.turn!, botPlace(s, s.turn!, rng));
    let guard = 0;
    while (s.phase === 'play' && guard++ < 300) {
      const m = botMove(s, s.turn!, 'builder', rng);
      s = move(s, s.turn!, m.counter, m.to, m.wall);
    }
    expect(s.phase).toBe('gameOver');
    const order = standings(s);
    expect(order[0].territory).toBeGreaterThanOrEqual(order[2].territory);
    expect(order.reduce((t, p) => t + p.territory, 0)).toBeLessThanOrEqual(49);
  });
});

describe('bots', () => {
  it('estimate influence: nearer counters claim more cells', () => {
    const s = placed();
    const inf = influence(s);
    expect(inf.a + inf.b).toBeLessThanOrEqual(49);
    expect(inf.a).toBeGreaterThan(0);
  });
});
