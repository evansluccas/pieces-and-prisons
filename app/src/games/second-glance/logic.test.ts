import { describe, expect, it } from 'vitest';
import { ALL_OBJECTS, FAMILIES, SLOTS, makeRound, newGame, nextRound, score, standings, startSpotting, submit } from './logic';
import { seededRng } from '../shared/rng';

describe('scenes', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: exactly 5 changes, each a real visible difference on its own square`, () => {
      const rng = seededRng(d.length);
      for (let i = 0; i < 30; i++) {
        const r = makeRound(rng, d);
        expect(r.changes).toHaveLength(5);
        expect(new Set(r.changes.map((c) => c.slot)).size).toBe(5);
        for (let s = 0; s < SLOTS; s++) {
          const changed = r.changes.find((c) => c.slot === s);
          const a = r.before[s];
          const b = r.after[s];
          const differs = (a?.name ?? null) !== (b?.name ?? null) || (a?.cat ?? null) !== (b?.cat ?? null);
          expect(differs).toBe(!!changed);
        }
        for (const c of r.changes) {
          if (c.kind === 'removed') expect(c.after).toBeNull();
          if (c.kind === 'added') expect(c.before).toBeNull();
          if (c.kind === 'recolored') expect(FAMILIES.some((f) => f.some((o) => o.name === c.before!.name) && f.some((o) => o.name === c.after!.name))).toBe(true);
        }
      }
    });
  }

  it('only uses objects that exist', () => {
    const r = makeRound(seededRng(9), 'hard');
    const names = new Set(ALL_OBJECTS.map((o) => `${o.cat}/${o.name}`));
    for (const o of [...r.before, ...r.after]) if (o) expect(names.has(`${o.cat}/${o.name}`)).toBe(true);
  });
});

describe('marking', () => {
  it('counts marks on changed squares, at most 5 marks', () => {
    const r = makeRound(seededRng(3), 'normal');
    const changed = r.changes.map((c) => c.slot);
    const empty = [...Array(SLOTS).keys()].find((s) => !changed.includes(s))!;
    expect(score(r, [changed[0], changed[1], empty]).found).toBe(2);
    let s = startSpotting(newGame(seededRng(4), 'easy', ['Hana', 'Jun']));
    expect(() => submit(s, [0, 1, 2, 3, 4, 5], 1000)).toThrow();
    s = submit(s, s.round.changes.map((c) => c.slot), 25_000);
    expect(s.results[0].found).toBe(5);
    s = nextRound(s);
    expect(s.phase).toBe('memorize');
  });

  it('three rounds; ranked by changes found, then time', () => {
    let s = newGame(seededRng(5), 'hard', ['Hana', 'Jun', 'Seo']);
    for (let i = 0; i < 3; i++) {
      s = startSpotting(s);
      s = submit(s, s.round.changes.slice(0, 3).map((c) => c.slot), 30_000);
      s = nextRound(s);
    }
    expect(s.phase).toBe('gameOver');
    const order = standings(s);
    expect(order.find((r) => r.name === 'You')!.found).toBe(9);
    for (let i = 0; i < order.length - 1; i++) {
      const [a, b] = [order[i], order[i + 1]];
      expect(a.found > b.found || (a.found === b.found && a.ms <= b.ms)).toBe(true);
    }
  });
});
