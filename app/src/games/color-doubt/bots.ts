import type { Rng } from '../shared/rng';
import { COLOR_ORDER, Color, GameState, bidOdds, currentBid, minRaise } from './logic';

export type Persona = 'cautious' | 'bluffer' | 'doubter';

export type BotMove = { kind: 'raise'; count: number; color: Color } | { kind: 'doubt' };

const DOUBT_BELOW: Record<Persona, number> = { cautious: 0.4, bluffer: 0.3, doubter: 0.55 };

/**
 * Bots only use their own hand: they doubt a bid that looks unlikely, and
 * otherwise make the smallest raise that is most likely true. Bluffers
 * sometimes push a colour they don't hold.
 */
export function botMove(s: GameState, me: string, persona: Persona, rng: Rng): BotMove {
  const cur = currentBid(s);
  const options = COLOR_ORDER.map((color) => {
    const count = minRaise(s, color);
    return count === null ? null : { color, count, p: bidOdds(s, me, count, color) };
  }).filter(Boolean) as { color: Color; count: number; p: number }[];

  if (cur) {
    const pTrue = bidOdds(s, me, cur.count, cur.color);
    const best = Math.max(0, ...options.map((o) => o.p));
    if (!options.length || (pTrue < DOUBT_BELOW[persona] && best <= pTrue + 0.35) || pTrue < 0.12) return { kind: 'doubt' };
  }
  const hand = s.players.find((p) => p.id === me)!.hand;
  const score = (o: { color: Color; p: number }) =>
    o.p + (persona === 'bluffer' && !hand.includes(o.color) ? 0.25 * rng() : 0) + rng() * 0.08;
  const pick = [...options].sort((a, b) => score(b) - score(a))[0];
  // a confident opener sometimes bids one higher to put pressure on
  const bump = !cur && pick.p > 0.9 && rng() < 0.5 && bidOdds(s, me, pick.count + 1, pick.color) > 0.75 ? 1 : 0;
  return { kind: 'raise', count: pick.count + bump, color: pick.color };
}

/** Back whichever side your own hand says is more likely. */
export function botBack(s: GameState, me: string, rng: Rng): 'bid' | 'doubt' {
  const cur = currentBid(s)!;
  const p = bidOdds(s, me, cur.count, cur.color);
  return p + (rng() - 0.5) * 0.1 >= 0.5 ? 'bid' : 'doubt';
}
