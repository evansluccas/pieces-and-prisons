import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import { Persona, botAct, botDeclare } from './bots';
import {
  Card, Declaration, Equation, GameState, Metal, Op, act, bestFor, cardsOf, currentTurn, declare, declarers, evaluate, fitsHand, newGame, nextHand,
  opsAllowed, pot, standings,
} from './logic';

const n = (value: number, metal: Metal = 0): Card => ({ kind: 'num', value, metal });
const eq = (vals: (number | string)[], ops: Op[]): Equation => ({
  terms: vals.map((v) => (typeof v === 'string' ? { value: Number(v.slice(1)), metal: 0 as Metal, root: true } : { value: v, metal: 0 as Metal, root: false })),
  ops,
});

describe('equations', () => {
  it('× and ÷ before + and −; √ on a number; no dividing by zero', () => {
    expect(evaluate(eq([2, 3, 4, 1], ['+', '*', '-']))).toBe(13);
    expect(evaluate(eq([8, 2, 3, 1], ['/', '+', '-']))).toBe(6);
    expect(evaluate(eq(['r9', 2, 1, 5], ['*', '-', '+']))).toBe(10);
    expect(evaluate(eq([5, 0, 1, 1], ['/', '+', '-']))).toBeNull();
    expect(evaluate(eq([7, 2, 1, 1], ['/', '-', '+']))).toBe(3.5);
  });
  it('operators: three, every × used, +−÷ at most once each', () => {
    expect(opsAllowed(['+', '-', '/'], 0)).toBe(true);
    expect(opsAllowed(['+', '+', '/'], 0)).toBe(false);
    expect(opsAllowed(['*', '-', '/'], 1)).toBe(true);
    expect(opsAllowed(['+', '-', '/'], 1)).toBe(false);
    expect(opsAllowed(['*', '*', '+'], 2)).toBe(true);
  });
  it('an equation must use exactly your cards', () => {
    const hand = [n(9), n(2), n(1), n(5), { kind: 'root' } as Card, { kind: 'times' } as Card];
    expect(fitsHand(eq(['r9', 2, 1, 5], ['*', '-', '+']), hand)).toBe(true);
    expect(fitsHand(eq([9, 2, 1, 5], ['*', '-', '+']), hand)).toBe(false); // root unused
    expect(fitsHand(eq(['r9', 2, 1, 6], ['*', '-', '+']), hand)).toBe(false); // wrong number
  });
  it('finds the best high and low', () => {
    const b = bestFor([n(10), n(10), n(1), n(1)]);
    expect(b.high!.dist).toBe(1); // + − ÷ must all be used: 19 at best
    expect(b.low!.dist).toBe(0); // 10 ÷ 10 + 1 − 1 = 1
    expect(bestFor([n(10), n(10), n(0), n(5)]).high!.dist).toBe(0); // 10 + 10 − 0 ÷ 5
    expect(bestFor([n(4), n(5), n(1), n(0), { kind: 'times' }]).high!.dist).toBe(0); // 4 × 5 + 1 ÷ ... or 4 × 5 − 0 ÷ 1
    const m = bestFor([n(3, 2), n(4, 1), n(5), n(6)]);
    expect(m.high!.eq.terms.map((t) => t.metal).sort()).toEqual([0, 0, 1, 2]);
    expect(fitsHand(m.high!.eq, [n(3, 2), n(4, 1), n(5), n(6)])).toBe(true);
  });
});

function setHands(s: GameState, hands: Card[][]): GameState {
  return { ...s, players: s.players.map((p, i) => ({ ...p, hidden: hands[i][0], open: hands[i].slice(1) })) };
}
const checkAround = (s: GameState) => {
  while (s.phase === 'bet') s = act(s, currentTurn(s)!, 'check');
  return s;
};
const decl = (side: Declaration['side'], cards: Card[]): Declaration => {
  const b = bestFor(cards);
  return { side, high: b.high!.eq, low: b.low!.eq };
};

describe('a hand', () => {
  const players = ['A', 'B', 'C'].map((id) => ({ id, name: id, isBot: false }));

  it('deals one hidden + three open number cards over three betting rounds', () => {
    let s = newGame(players, seededRng(4));
    expect(s.players.every((p) => p.hidden?.kind === 'num' && p.open.filter((c) => c.kind === 'num').length === 1)).toBe(true);
    s = act(s, currentTurn(s)!, 'bet');
    while (s.phase === 'bet' && s.street === 0) s = act(s, currentTurn(s)!, 'call');
    expect(s.street).toBe(1);
    s = checkAround(s);
    expect(s.phase).toBe('declare');
    for (const p of s.players) expect(cardsOf(p).filter((c) => c.kind === 'num')).toHaveLength(4);
    expect(pot(s)).toBe(3 + 2 * 3);
  });

  it('a swing that wins both sides takes the pot; equations must match your cards', () => {
    let s = checkAround(newGame(players, seededRng(1)));
    const hands = [
      [n(10), n(10), n(1), n(1)],      // A: hits 20 and 1 exactly
      [n(9, 1), n(9, 1), n(1, 1), n(2)], // B
      [n(0), n(0, 1), n(3), n(7)],     // C
    ];
    s = setHands(s, hands);
    // A swings and wins both → takes it all
    let t = declare(s, 'A', decl('swing', hands[0]));
    t = declare(t, 'B', decl('high', hands[1]));
    t = declare(t, 'C', decl('low', hands[2]));
    expect(t.phase).toBe('result');
    const r = t.results[0];
    expect([r.highWinner, r.lowWinner]).toEqual(['A', 'A']);
    expect(r.winnings.A).toBe(3);

    expect(() => declare(s, 'A', { side: 'high', high: eq([1, 2, 10, 10], ['+', '-', '/']), low: null })).toThrow();
  });

  it('a failed swing drops out and the others are re-judged', () => {
    let s = checkAround(newGame(players, seededRng(2)));
    const hands = [
      [n(10), n(10), n(1), n(1)],
      [n(10, 1), n(10, 1), n(1, 1), n(1, 1)], // same values, worse metal
      [n(5), n(5, 1), n(5, 2), n(0)],
    ];
    s = setHands(s, hands);
    let t = declare(s, 'B', decl('swing', hands[1]));
    t = declare(t, 'A', decl('high', hands[0]));
    t = declare(t, 'C', decl('low', hands[2]));
    const r = t.results[0];
    expect(r.failedSwing).toEqual(['B']); // ties on high go to A's gold 10
    expect(r.highWinner).toBe('A');
    expect(r.lowWinner).toBe('C');
    expect(r.winnings.B).toBe(0);
    expect(r.winnings.A + r.winnings.C).toBe(3);
    expect(declarers(t)).toEqual([]);
  });

  it('folding to one player ends the hand', () => {
    let s = newGame(players, seededRng(3));
    s = act(s, currentTurn(s)!, 'bet');
    s = act(s, currentTurn(s)!, 'fold');
    s = act(s, currentTurn(s)!, 'fold');
    expect(s.phase).toBe('result');
    expect(s.results[0].foldWin).not.toBeNull();
  });
});

describe('bots', () => {
  it('a bot-only match finishes; chips are conserved', () => {
    const rng = seededRng(9);
    const personas: Persona[] = ['rock', 'shark', 'maniac', 'shark'];
    let s = newGame(personas.map((p, i) => ({ id: `b${i}`, name: p, isBot: true })), rng);
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 2000) {
      if (s.phase === 'bet') {
        const id = currentTurn(s)!;
        s = act(s, id, botAct(s, id, personas[Number(id.slice(1))], rng));
      } else if (s.phase === 'declare') {
        const id = declarers(s)[0];
        s = declare(s, id, botDeclare(s, id, rng));
      } else s = nextHand(s, rng);
      const total = s.players.reduce((t, p) => t + p.chips + p.total, 0);
      expect(total).toBe(160);
    }
    expect(s.phase).toBe('gameOver');
    expect(standings(s)).toHaveLength(4);
    expect(s.results.some((r) => !r.foldWin)).toBe(true);
  });
});
