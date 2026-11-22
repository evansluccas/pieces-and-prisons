import type { Rng } from '../shared/rng';
import { Card, HandValue, bestHand, compare, fullDeck } from './cards';
import { Action, GameState, Snipe, legalActions, live, matches, pot } from './logic';

export type Persona = 'rock' | 'shark' | 'maniac';

const unseen = (s: GameState, mine: Card[]) =>
  fullDeck().filter((c) => !mine.some((m) => m.rank === c.rank && m.suit === c.suit) && !s.board.some((b) => b.rank === c.rank && b.suit === c.suit));

function draw(pool: Card[], n: number, rng: Rng): Card[] {
  const a = [...pool];
  const out: Card[] = [];
  for (let i = 0; i < n; i++) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
  return out;
}

/** Chance to win at showdown against the other live players, from my cards and the board only. */
export function equity(s: GameState, me: string, rng: Rng, samples = 160): number {
  const p = s.players.find((x) => x.id === me)!;
  const opp = live(s).filter((x) => x.id !== me).length;
  const pool = unseen(s, p.hole);
  let score = 0;
  for (let k = 0; k < samples; k++) {
    const cards = draw(pool, 4 - s.board.length + opp * 2, rng);
    const board = [...s.board, ...cards.slice(0, 4 - s.board.length)];
    const mine = bestHand([...p.hole, ...board]);
    let result = 1;
    for (let o = 0; o < opp; o++) {
      const off = 4 - s.board.length + o * 2;
      const c = compare(mine, bestHand([cards[off], cards[off + 1], ...board]));
      if (c < 0) { result = 0; break; }
      if (c === 0) result = Math.min(result, 0.5);
    }
    score += result;
  }
  return score / samples;
}

const STYLE: Record<Persona, { tight: number; aggro: number; bluff: number }> = {
  rock: { tight: 0.08, aggro: 1.5, bluff: 0.02 },
  shark: { tight: 0.02, aggro: 1.25, bluff: 0.08 },
  maniac: { tight: -0.06, aggro: 1.05, bluff: 0.2 },
};

export function botAct(s: GameState, me: string, persona: Persona, rng: Rng): Action {
  const legal = legalActions(s, me);
  const has = (a: Action) => legal.some((x) => x.action === a);
  const st = STYLE[persona];
  const n = live(s).length;
  const eq = equity(s, me, rng);
  const fair = 1 / n; // what a random hand would win
  const call = legal.find((x) => x.action === 'call');
  const strong = eq > fair * st.aggro + 0.1 || rng() < st.bluff;
  if (call) {
    const odds = call.amount / (pot(s) + call.amount);
    if (strong && has('raise')) return 'raise';
    return eq + 0.03 >= odds + st.tight ? 'call' : 'fold';
  }
  if (strong && has('bet')) return 'bet';
  return 'check';
}

/**
 * Snipe the exact hand an opponent most often holds when it beats mine (never
 * my own). Pass when I'm rarely beaten.
 */
export function botSnipe(s: GameState, me: string, rng: Rng, samples = 200): Snipe | null {
  const p = s.players.find((x) => x.id === me)!;
  const mine = bestHand([...p.hole, ...s.board]);
  const opp = live(s).filter((x) => x.id !== me).length;
  const pool = unseen(s, p.hole);
  const tally = new Map<string, { t: Snipe; n: number }>();
  let beaten = 0;
  for (let k = 0; k < samples; k++) {
    const cards = draw(pool, opp * 2, rng);
    let best: HandValue | null = null;
    for (let o = 0; o < opp; o++) {
      const v = bestHand([cards[o * 2], cards[o * 2 + 1], ...s.board]);
      if (!best || compare(v, best) > 0) best = v;
    }
    if (best && compare(best, mine) > 0) {
      beaten++;
      const key = `${best.cat}:${best.key}`;
      const e = tally.get(key) ?? { t: { cat: best.cat, key: best.key }, n: 0 };
      e.n++;
      tally.set(key, e);
    }
  }
  const top = [...tally.values()].filter((e) => !matches(mine, e.t)).sort((a, b) => b.n - a.n)[0];
  // only worth a shot if I'm actually in danger
  return top && beaten / samples >= 0.05 ? top.t : null;
}
