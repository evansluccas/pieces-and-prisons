import type { Rng } from '../shared/rng';
import {
  Action, Card, Declaration, GameState, MAX_SPECIALS, PlayerState, bestFor, cardsOf, fullDeck, legalActions, live, pot,
} from './logic';

export type Persona = 'rock' | 'shark' | 'maniac';

const same = (a: Card, b: Card) => a.kind === b.kind && (a.kind !== 'num' || (b.kind === 'num' && a.value === b.value && a.metal === b.metal));

/** Cards this bot hasn't seen: not in its hand, not face up anywhere. */
function unseen(s: GameState, me: PlayerState): Card[] {
  const seen = [...cardsOf(me), ...s.players.filter((p) => p.id !== me.id).flatMap((p) => p.open)];
  const pool = fullDeck();
  for (const c of seen) {
    const i = pool.findIndex((x) => same(x, c));
    if (i >= 0) pool.splice(i, 1);
  }
  return pool;
}

/** Complete a hand to four numbers from a random pool (specials as they come, like the deal). */
function complete(cards: Card[], pool: Card[], rng: Rng): Card[] {
  const out = [...cards];
  while (out.filter((c) => c.kind === 'num').length < 4) {
    const c = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (c.kind === 'num' || out.filter((x) => x.kind !== 'num').length < MAX_SPECIALS) out.push(c);
  }
  return out;
}

/** Chance my best high (and best low) beats every other live player's, from what I can see. */
export function chances(s: GameState, meId: string, rng: Rng, samples = 50): { high: number; low: number } {
  const me = s.players.find((p) => p.id === meId)!;
  const others = live(s).filter((p) => p.id !== meId);
  const base = unseen(s, me);
  let high = 0;
  let low = 0;
  for (let k = 0; k < samples; k++) {
    const pool = [...base];
    const mine = bestFor(complete(cardsOf(me), pool, rng));
    let winH = !!mine.high;
    let winL = !!mine.low;
    for (const o of others) {
      // their hidden card is a number I can't see
      const nums = pool.filter((c) => c.kind === 'num');
      const hidden = nums[Math.floor(rng() * nums.length)];
      pool.splice(pool.indexOf(hidden), 1);
      const theirs = bestFor(complete([hidden, ...o.open], pool, rng));
      if (theirs.high && mine.high && theirs.high.dist <= mine.high.dist) winH = false;
      if (theirs.low && mine.low && theirs.low.dist <= mine.low.dist) winL = false;
    }
    if (winH) high++;
    if (winL) low++;
  }
  return { high: high / samples, low: low / samples };
}

const STYLE: Record<Persona, { tight: number; aggro: number; bluff: number }> = {
  rock: { tight: 0.08, aggro: 1.5, bluff: 0.02 },
  shark: { tight: 0.02, aggro: 1.2, bluff: 0.08 },
  maniac: { tight: -0.06, aggro: 1.0, bluff: 0.2 },
};

export function botAct(s: GameState, me: string, persona: Persona, rng: Rng): Action {
  const legal = legalActions(s, me);
  const has = (a: Action) => legal.some((x) => x.action === a);
  const st = STYLE[persona];
  const n = live(s).length;
  const c = chances(s, me, rng);
  // winning one side takes half the pot, both takes it all
  const share = Math.max(c.high, c.low) * 0.5 + Math.min(c.high, c.low) * 0.5;
  const fair = 1 / n;
  const call = legal.find((x) => x.action === 'call');
  const strong = share > fair * st.aggro + 0.08 || rng() < st.bluff;
  if (call) {
    const odds = call.amount / (pot(s) + call.amount);
    if (strong && has('raise')) return 'raise';
    return share + 0.04 >= odds + st.tight ? 'call' : 'fold';
  }
  if (strong && has('bet')) return 'bet';
  return 'check';
}

/** Pick the side I'm most likely to win; swing only when both look very safe. */
export function botDeclare(s: GameState, me: string, rng: Rng): Declaration {
  const p = s.players.find((x) => x.id === me)!;
  const best = bestFor(cardsOf(p));
  const c = chances(s, me, rng, 80);
  const high = best.high?.eq ?? null;
  const low = best.low?.eq ?? null;
  if (c.high > 0.85 && c.low > 0.85 && high && low) return { side: 'swing', high, low };
  if (!low || (high && c.high >= c.low)) return { side: 'high', high, low: null };
  return { side: 'low', high: null, low };
}
