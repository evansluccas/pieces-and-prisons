import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import { Skill, botSow } from './bots';
import { Colour, GameState, SEG, counts, landing, newGame, orders, pitsOf, score, sow, standings, storeOf } from './logic';

const players = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
/** A 2-player board with chosen pit contents (stores empty). */
function board(pits: Colour[][]): GameState {
  const s = newGame(players(2), seededRng(1));
  const slots: Colour[][] = s.slots.map(() => []);
  [...pitsOf(0), ...pitsOf(1)].forEach((slot, i) => (slots[slot] = pits[i] ?? []));
  return { ...s, slots };
}

describe('setup', () => {
  it('4 pits of 3 stones each, four of every colour per player', () => {
    const s = newGame(players(3), seededRng(2));
    expect(s.slots).toHaveLength(3 * SEG);
    for (let p = 0; p < 3; p++) {
      const all = pitsOf(p).flatMap((slot) => s.slots[slot]);
      expect(counts(all)).toEqual([4, 4, 4]);
      expect(s.slots[storeOf(p)]).toEqual([]);
    }
  });
});

describe('sowing', () => {
  it('drops stones in your chosen order, skipping rival stores', () => {
    // P0 pit 3 has 4 stones: store(4), then P1 pits 5,6,7
    const s = board([[0], [1], [2], [2, 1, 0, 0]]);
    const t = sow(s, 0, 3, [1, 0, 2, 0]);
    expect(t.slots[storeOf(0)]).toEqual([1]);
    expect(t.history[0].path).toEqual([4, 5, 6, 7]);
    expect(() => sow(s, 0, 3, [0, 0, 0, 0])).toThrow(); // not the pit's stones
    expect(() => sow(s, 0, 5, [0])).toThrow(); // not your pit
    // P1 sowing past P0's store skips it
    const u = { ...board([[], [], [], [0], [], [], [], [0, 1, 2]]), turn: 1 };
    expect(landing(u, 1, 8)).toEqual([9, 0, 1]);
  });

  it('last stone in your store gives another turn', () => {
    const s = board([[0], [1], [2, 2], [0], [0, 1, 2], [0], [1], [2]]);
    const t = sow(s, 0, 2, [2, 2]);
    expect(t.turn).toBe(0);
    expect(t.history[0].extra).toBe(true);
  });

  it('capturing 2s and 3s in a rival’s pits, going backwards', () => {
    // P0 pit 3 has 3 stones → store, 5, 6. Pit 6 has 1 → 2 (capture), pit 5 had 2 → 3 (capture)
    const s = board([[1], [1], [1], [0, 1, 2], [2, 2], [0], [1, 1, 1, 1], []]); // P1 keeps stones so the game goes on
    const t = sow(s, 0, 3, [0, 1, 2]);
    expect(t.history[0].captured).toEqual([6, 5]);
    expect(t.slots[storeOf(0)]).toHaveLength(1 + 2 + 3);
    expect(t.slots[5]).toEqual([]);
    expect(t.slots[6]).toEqual([]);
  });

  it('every distinct order of a pit', () => {
    expect(orders([0, 0, 1])).toHaveLength(3);
    expect(orders([0, 1, 2])).toHaveLength(6);
  });

  it('the game ends when the player to move has nothing; leftovers go home; weakest colour scores', () => {
    const s = board([[], [], [], [2], [0, 1], [], [], []]);
    const t = sow(s, 0, 3, [2]); // into the store: extra turn, but P0 is now empty → game over
    expect(t.over).toBe(true);
    expect(t.slots[storeOf(1)]).toEqual([0, 1]);
    expect(score(t, 0)).toBe(0);
    const u: GameState = { ...s, slots: s.slots.map((x, i): Colour[] => (i === storeOf(0) ? [0, 1, 2, 2] : i === storeOf(1) ? [0, 0, 0, 0, 0] : x)) };
    expect(score(u, 0)).toBe(1);
    expect(standings(u)[0].seat).toBe(0); // 1 beats 0 even with fewer stones
  });
});

describe('bots', () => {
  it('3-player bot games finish with every stone accounted for', () => {
    for (let g = 0; g < 4; g++) {
      const rng = seededRng(30 + g);
      let s = newGame(players(3), rng);
      const skills: Skill[] = ['easy', 'normal', 'hard'];
      let guard = 0;
      while (!s.over && guard++ < 300) {
        const m = botSow(s, s.turn, skills[s.turn], rng);
        s = sow(s, s.turn, m.pit, m.order);
      }
      expect(s.over).toBe(true);
      expect(s.slots.flat()).toHaveLength(36);
    }
  });

  it('Hard beats Easy more often than not', () => {
    let hard = 0;
    for (let g = 0; g < 20; g++) {
      const rng = seededRng(500 + g);
      let s = newGame(players(2), rng);
      const hardSeat = g % 2;
      while (!s.over) {
        const m = botSow(s, s.turn, s.turn === hardSeat ? 'hard' : 'easy', rng);
        s = sow(s, s.turn, m.pit, m.order);
      }
      if (standings(s)[0].seat === hardSeat) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(12);
  });
});
