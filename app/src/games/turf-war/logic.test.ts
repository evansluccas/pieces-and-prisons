import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import { Skill, botMove, botRock } from './bots';
import {
  GameState, N, ROCK, at, biggestSquare, canLay, dropRock, mustPass, newGame, offered, pass, placements, standings, takePiece, usePatch,
} from './logic';

const players = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
const clear = (s: GameState): GameState => ({ ...s, bonus: s.bonus.map(() => null) });

describe('laying turf', () => {
  it('must touch your own turf, not overlap, and not touch anyone else', () => {
    const s = clear(newGame(players(2), seededRng(1)));
    expect(s.owner[at(3, 3)]).toBe(0);
    expect(canLay(s, 0, [at(4, 3), at(5, 3)])).toBe(true);
    expect(canLay(s, 0, [at(5, 3), at(6, 3)])).toBe(false); // not touching
    expect(canLay(s, 0, [at(3, 3), at(4, 3)])).toBe(false); // overlaps
    const t = { ...s, owner: s.owner.map((o, c) => (c === at(6, 3) ? 1 : o)) };
    expect(canLay(t, 0, [at(4, 3), at(5, 3)])).toBe(false); // touches player 1 along an edge
    const u = { ...s, owner: s.owner.map((o, c) => (c === at(6, 4) ? 1 : o)) };
    expect(canLay(u, 0, [at(4, 3), at(5, 3)])).toBe(true); // corners are fine
    const r = { ...s, owner: s.owner.map((o, c) => (c === at(6, 3) ? ROCK : o)) };
    expect(canLay(r, 0, [at(4, 3), at(5, 3)])).toBe(true); // rocks don't count as turf
  });

  it('taking a piece sends the skipped ones to the back', () => {
    const s = clear(newGame(players(2), seededRng(2)));
    const third = offered(s)[2];
    const p = placements(s, 0).find((x) => x.pick === 2)!;
    const t = takePiece(s, 0, 2, p.cells);
    expect(t.queue).toHaveLength(s.queue.length - 1);
    expect(t.queue.slice(-2)).toEqual(s.queue.slice(0, 2));
    expect(t.turn).toBe(1);
    expect(p.cells.every((c) => t.owner[c] === 0)).toBe(true);
    expect(third).toBe(s.queue[2]);
    // wrong shape is refused
    expect(() => takePiece(s, 0, 0, [at(4, 3)])).toThrow();
  });

  it('bonus spots: a patch to lay later, a rock to drop', () => {
    let s = clear(newGame(players(2), seededRng(3)));
    const bonus = [...s.bonus];
    bonus[at(4, 3)] = 'patch';
    bonus[at(3, 4)] = 'rock';
    s = { ...s, bonus, queue: [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0]], ...s.queue] };
    s = takePiece(s, 0, 0, [at(4, 3), at(5, 3)]);
    expect(s.players[0].patches).toBe(1);
    s = takePiece(s, 1, 0, placements(s, 1).find((p) => p.pick === 0)!.cells);
    s = takePiece(s, 0, 0, [at(3, 4), at(3, 5)]);
    expect(s.phase).toBe('rock');
    expect(() => dropRock(s, 0, at(3, 3))).toThrow();
    s = dropRock(s, 0, at(10, 10));
    expect(s.owner[at(10, 10)]).toBe(ROCK);
    expect(s.turn).toBe(1);
    s = takePiece(s, 1, 0, placements(s, 1).find((p) => p.pick === 0)!.cells);
    s = usePatch(s, 0, at(4, 4));
    expect(s.players[0].patches).toBe(0);
    expect(s.owner[at(4, 4)]).toBe(0);
  });

  it('you can only pass when nothing fits', () => {
    const s = clear(newGame(players(2), seededRng(4)));
    expect(mustPass(s, 0)).toBe(false);
    expect(() => pass(s, 0)).toThrow();
    // box player 0 in with rocks
    const owner = [...s.owner];
    for (const c of [at(2, 3), at(4, 3), at(3, 2), at(3, 4)]) owner[c] = ROCK;
    const boxed = { ...s, owner };
    expect(mustPass(boxed, 0)).toBe(true);
    expect(pass(boxed, 0).turn).toBe(1);
  });

  it('scores the biggest solid square', () => {
    const owner = Array(N * N).fill(null);
    for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) owner[at(x, y)] = 0;
    owner[at(8, 2)] = 0;
    expect(biggestSquare((c) => owner[c] === 0)).toEqual({ size: 3, x: 5, y: 2 });
  });
});

describe('bots', () => {
  it('full bot games finish; better bots build bigger squares', () => {
    const tally: Record<Skill, number> = { easy: 0, normal: 0, hard: 0 };
    const skills: Skill[] = ['easy', 'normal', 'hard'];
    for (let g = 0; g < 9; g++) {
      const rng = seededRng(20 + g);
      let s = newGame(players(3), rng);
      const seat = (i: number) => skills[(i + g) % 3];
      let guard = 0;
      while (s.phase !== 'gameOver' && guard++ < 200) {
        const me = s.turn;
        if (s.phase === 'rock') { s = dropRock(s, me, botRock(s, me, rng)); continue; }
        const m = botMove(s, me, seat(me), rng);
        s = m.kind === 'piece' ? takePiece(s, me, m.pick, m.cells) : m.kind === 'patch' ? usePatch(s, me, m.cell) : pass(s, me);
      }
      expect(s.phase).toBe('gameOver');
      for (const row of standings(s)) tally[seat(row.seat)] += row.square;
    }
    expect(tally.hard).toBeGreaterThan(tally.easy);
    expect(tally.hard / 9).toBeGreaterThanOrEqual(4);
  });
});
