import { describe, expect, it } from 'vitest';
import { Card, bestHand, compare, handName } from './cards';
import { GameState, act, currentTurn, legalActions, newGame, nextHand, pot, snipe, snipers, standings } from './logic';
import { botAct, botSnipe, equity } from './bots';
import { seededRng } from '../shared/rng';

const c = (t: string): Card => {
  const suit = { s: 'spade', h: 'heart', d: 'diamond', c: 'club' }[t.slice(-1)] as Card['suit'];
  const r = t.slice(0, -1);
  return { suit, rank: ({ A: 14, K: 13, Q: 12, J: 11 } as Record<string, number>)[r] ?? Number(r) };
};
const cards = (t: string) => t.split(' ').map(c);
const three = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), isBot: id !== 'a' }));

describe('hand ranking', () => {
  it('names and orders hands from six cards', () => {
    expect(handName(bestHand(cards('9h 9s 2c 5d Kh 7s')))).toBe('Pair of 9s');
    expect(handName(bestHand(cards('Ah 2h 7h 9h Kh 3s')))).toBe('Flush, A-high');
    expect(handName(bestHand(cards('Ah 2s 3d 4c 5h 9s')))).toBe('Straight to 5');
    expect(handName(bestHand(cards('Qh Qs Qd 4c 4h 9s')))).toBe('Full house, Qs full');
    expect(handName(bestHand(cards('Kh Ks 4d 4c 9h 9s')))).toBe('Two pair, Ks high');
    const flush = bestHand(cards('Ah 2h 7h 9h Kh 3s'));
    const straight = bestHand(cards('9c Ts Jd Qc Kh 2s'));
    expect(compare(flush, straight)).toBeGreaterThan(0);
    expect(compare(bestHand(cards('9h 9s Ac 5d Kh 7s')), bestHand(cards('9d 9c Qc 5s Kd 7h')))).toBeGreaterThan(0); // kicker
  });
});

/** Fixed hand: a has a flush, b a pair of kings, c junk. */
function fixed(): GameState {
  const s = newGame(three, seededRng(1));
  const holes: Record<string, Card[]> = { a: cards('Ah 2h'), b: cards('Ks Kd'), c: cards('3c 8d') };
  const board = cards('7h 9h Kh 4s');
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hole: holes[p.id] })),
    deck: s.deck.filter((x) => ![...Object.values(holes).flat(), ...board].some((y) => y.rank === x.rank && y.suit === x.suit)),
  };
}
const runOut = (s: GameState, board: Card[]) => ({ ...s, deck: [...s.deck.filter((x) => !board.some((b) => b.rank === x.rank && b.suit === x.suit)), ...[...board].reverse()] });

describe('betting', () => {
  it('fixed-limit rounds: bet, raise, call; 3 shared cards then 1', () => {
    let s = runOut(fixed(), cards('7h 9h Kh 4s'));
    expect(pot(s)).toBe(3); // antes
    expect(currentTurn(s)).toBe('b'); // left of the dealer
    expect(legalActions(s, 'b').map((x) => x.action)).toEqual(['check', 'bet']);
    s = act(s, 'b', 'bet');
    s = act(s, 'c', 'fold');
    s = act(s, 'a', 'raise');
    expect(currentTurn(s)).toBe('b');
    s = act(s, 'b', 'call');
    expect(s.street).toBe(1);
    expect(s.board).toHaveLength(3);
    expect(pot(s)).toBe(3 + 4 + 4);
    s = act(s, 'b', 'check');
    s = act(s, 'a', 'check');
    expect(s.board).toHaveLength(4);
    s = act(s, 'b', 'check');
    s = act(s, 'a', 'bet');
    expect(legalActions(s, 'b').find((x) => x.action === 'call')!.amount).toBe(4);
    s = act(s, 'b', 'call');
    expect(s.phase).toBe('snipe');
    expect(snipers(s).sort()).toEqual(['a', 'b']);
  });

  it('everyone else folding wins the pot at once', () => {
    let s = fixed();
    s = act(s, 'b', 'bet');
    s = act(s, 'c', 'fold');
    s = act(s, 'a', 'fold');
    expect(s.phase).toBe('result');
    expect(s.results[0].foldWin).toBe('b');
    expect(s.players.find((p) => p.id === 'b')!.chips).toBe(60 - 1 - 2 + 3 + 2);
  });
});

describe('snipes and showdown', () => {
  function toSnipes() {
    let s = runOut(fixed(), cards('7h 9h Kh 4s'));
    for (let i = 0; i < 20 && s.phase === 'bet'; i++) s = act(s, currentTurn(s)!, legalActions(s, currentTurn(s)!).some((x) => x.action === 'check') ? 'check' : 'call');
    return s;
  }

  it('the best hand wins when nobody snipes it', () => {
    let s = toSnipes();
    s = snipe(s, 'a', null);
    s = snipe(s, 'b', null);
    s = snipe(s, 'c', null);
    const r = s.results[0];
    expect(handName(r.values.a)).toBe('Flush, A-high');
    expect(r.winnings.a).toBe(3);
  });

  it('a sniped hand cannot win: the next best takes the pot', () => {
    let s = toSnipes();
    s = snipe(s, 'b', { cat: 5, key: 14 }); // "Flush, A-high"
    s = snipe(s, 'a', { cat: 1, key: 2 });
    s = snipe(s, 'c', null);
    const r = s.results[0];
    expect(r.sniped).toEqual(['a']);
    expect(r.winnings.b).toBe(3);
  });

  it('if every hand is sniped, the pot carries over', () => {
    let s = toSnipes();
    s = snipe(s, 'b', { cat: 5, key: 14 });
    s = snipe(s, 'a', { cat: 3, key: 13 }); // b has trip kings
    s = snipe(s, 'c', { cat: 0, key: 13 }); // c: high card K
    expect(s.results[0].carried).toBe(3);
    expect(s.carry).toBe(3);
    s = nextHand(s, seededRng(2));
    expect(pot(s)).toBe(3 + 3);
  });

  it('an all-in player can only win what they matched', () => {
    let s = runOut(fixed(), cards('7h 9h Kh 4s'));
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, chips: 1 } : p)) };
    s = act(s, 'b', 'bet');
    s = act(s, 'c', 'call');
    s = act(s, 'a', 'call'); // all-in for 1
    for (let i = 0; i < 20 && s.phase === 'bet'; i++) s = act(s, currentTurn(s)!, 'check');
    for (const id of snipers(s)) s = snipe(s, id, null);
    const r = s.results[0];
    // a's flush wins the main pot: 3 antes + 1 from each = 6; b's kings take the side pot (1+1)
    expect(r.winnings.a).toBe(6);
    expect(r.winnings.b).toBe(2);
  });
});

describe('bots', () => {
  it('know a flush is strong and snipe the likely beater', () => {
    const s = runOut(fixed(), cards('7h 9h Kh 4s'));
    const withBoard = { ...s, board: cards('7h 9h Kh 4s') };
    expect(equity(withBoard, 'a', seededRng(1))).toBeGreaterThan(0.6);
    expect(equity(withBoard, 'c', seededRng(1))).toBeLessThan(0.2);
    const t = botSnipe({ ...withBoard, phase: 'snipe' }, 'b', seededRng(3));
    expect(t?.cat).toBe(5); // b fears a flush
  });

  it('play a full match without breaking the rules', () => {
    const rng = seededRng(7);
    let s = newGame(three, rng);
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 3000) {
      if (s.phase === 'result') s = nextHand(s, rng);
      else if (s.phase === 'snipe') for (const id of snipers(s)) s = snipe(s, id, botSnipe(s, id, rng, 40));
      else s = act(s, currentTurn(s)!, botAct(s, currentTurn(s)!, 'shark', rng));
    }
    expect(s.phase).toBe('gameOver');
    const total = s.players.reduce((t, p) => t + p.chips, 0) + s.carry;
    expect(total).toBe(180);
    expect(standings(s)[0].chips).toBeGreaterThanOrEqual(standings(s)[2].chips);
  });
});
