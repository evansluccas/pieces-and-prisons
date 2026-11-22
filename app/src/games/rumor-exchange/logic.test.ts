import { describe, expect, it } from 'vitest';
import { GameState, Rule, buyRumor, knows, newGame, orderCash, ruleText, standings, submit, worth } from './logic';
import { botTurn } from './bots';
import { seededRng } from '../shared/rng';

const three = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));
const RULES: Rule[] = [
  { kind: 'climber' }, { kind: 'zigzag' }, { kind: 'crowd' }, { kind: 'contrarian' }, { kind: 'echo', follows: 1 }, { kind: 'magnet' },
];
const fixed = (): GameState => ({ ...newGame(three, seededRng(1)), rules: RULES });

const passAll = (s: GameState, rng = seededRng(9)) => ['a', 'b', 'c'].reduce((st, id) => submit(st, id, {}, rng), s);

describe('setup', () => {
  it('six companies at 10,000, everyone with 100,000 and nothing known', () => {
    const s = newGame(three, seededRng(2));
    expect(s.prices).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
    expect(new Set(s.rules.map((r) => r.kind)).size).toBe(6);
    for (const p of s.players) expect(p.cash).toBe(100_000);
    expect(knows(s, 'a', 0)).toBe(false);
    for (const r of s.rules) if (r.kind === 'echo') expect(s.rules[r.follows!].kind).not.toBe('echo');
  });
});

describe('trading', () => {
  it('settles sales before purchases and moves prices by their rules', () => {
    let s = fixed();
    s = submit(s, 'a', { 0: 3, 2: 2 }, seededRng(3));
    expect(s.players[0].orders).toEqual({ 0: 3, 2: 2 });
    s = submit(s, 'b', { 2: 1, 3: 4 }, seededRng(3));
    s = submit(s, 'c', {}, seededRng(3));
    const a = s.players[0];
    expect(a.shares[0]).toBe(3);
    expect(a.cash).toBe(100_000 - 50_000);
    // round 1 (odd): climber +800, zigzag +2000, crowd +200×3, contrarian −200×4, echo copies nothing yet, magnet +1000
    expect(s.prices).toEqual([10_800, 12_000, 10_600, 9_200, 10_000, 11_000]);
    expect(s.round).toBe(2);
    s = passAll(s);
    // round 2 (even): zigzag −1500; echo repeats zigzag's +2000 from round 1
    expect(s.prices[1]).toBe(10_500);
    expect(s.prices[4]).toBe(12_000);
  });

  it('rejects orders you can’t pay for or shares you don’t own', () => {
    const s = fixed();
    expect(orderCash(s, 'a', { 0: 11 })).toBeNull();
    expect(orderCash(s, 'a', { 0: -1 })).toBeNull();
    expect(orderCash(s, 'a', { 0: 10 })).toBe(0);
    expect(() => submit(s, 'a', { 0: 11 }, seededRng(1))).toThrow();
  });
});

describe('rumors', () => {
  it('a private rumor costs 6,000 and only you learn the rule', () => {
    let s = fixed();
    s = buyRumor(s, 'a', 3);
    expect(knows(s, 'a', 3)).toBe(true);
    expect(knows(s, 'b', 3)).toBe(false);
    expect(s.players[0].cash).toBe(94_000);
    expect(() => buyRumor(s, 'a', 3)).toThrow();
    expect(ruleText(s, 3)).toContain('−200');
  });

  it('publishes two rules after rounds 4, 8 and 12', () => {
    let s = fixed();
    for (let r = 1; r <= 4; r++) s = passAll(s);
    expect(s.published).toHaveLength(2);
    for (let r = 5; r <= 12; r++) s = passAll(s);
    expect(s.published).toHaveLength(6);
    expect(knows(s, 'b', 5)).toBe(true);
  });
});

describe('match', () => {
  it('plays 15 rounds with bots; prices stay above the floor; ranked by money', () => {
    const rng = seededRng(4);
    let s = newGame(three, rng);
    const personas = { a: 'analyst', b: 'trend', c: 'gambler' } as const;
    while (s.phase !== 'gameOver') {
      for (const id of ['a', 'b', 'c'] as const) {
        const t = botTurn(s, id, personas[id], rng);
        if (t.rumor !== null) s = buyRumor(s, id, t.rumor);
        s = submit(s, id, t.orders, rng);
      }
    }
    expect(s.records).toHaveLength(15);
    for (const h of s.history) for (const p of h) expect(p).toBeGreaterThanOrEqual(100);
    const order = standings(s);
    expect(order[0].worth).toBeGreaterThanOrEqual(order[2].worth);
    for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
    expect(order[0].worth).toBe(worth(s, s.players.find((p) => p.id === order[0].id)!));
  });

  it('a bot that knows a climber buys it', () => {
    let s = fixed();
    s = { ...s, published: [0] };
    const t = botTurn(s, 'b', 'analyst', seededRng(5));
    expect(t.orders[0]).toBeGreaterThan(0);
  });
});
