import type { Rng } from '../shared/rng';
import { Coins, GameState, countOdds, knowledge } from './logic';

export type Persona = 'steady' | 'trickster' | 'skeptic';

/**
 * Add coins and choose who must count them. More coins means more doubt for
 * the receiver; tricksters stack the colour that will be asked so the
 * receiver's guess is off. The target is the player who knows the least.
 */
export function botAdd(s: GameState, me: string, persona: Persona, rng: Rng): { coins: Coins; to: string } {
  const n = persona === 'steady' ? 1 + Math.floor(rng() * s.config.maxAdd) : s.config.maxAdd;
  let black = 0;
  for (let i = 0; i < n; i++) {
    if (persona === 'trickster') black += s.color === 'black' ? (rng() < 0.8 ? 1 : 0) : rng() < 0.2 ? 1 : 0;
    else black += rng() < 0.5 ? 1 : 0;
  }
  const coins = { black, white: n - black };
  const others = s.players.filter((p) => p.id !== me);
  const leader = Math.max(...others.map((p) => p.points));
  const score = (id: string) => {
    const k = knowledge(s, id);
    const pts = others.find((p) => p.id === id)!.points;
    return k.unknown + n + (pts === leader ? 1.5 : 0) + rng() * 0.5;
  };
  const to = others.reduce((best, p) => (score(p.id) > score(best.id) ? p : best)).id;
  return { coins, to };
}

/** Announce the most likely count (from this bot's own knowledge). */
export function botClaim(s: GameState, me: string, rng: Rng): number {
  const odds = countOdds(s, me, s.color);
  let best = 0;
  for (let k = 0; k < odds.length; k++) if (odds[k] + rng() * 0.01 > odds[best]) best = k;
  return best;
}

/** Doubt when, from what this bot knows, the claim is more likely wrong than right. */
export function botRespond(s: GameState, me: string, persona: Persona, rng: Rng): boolean {
  const p = countOdds(s, me, s.color)[s.claim!] ?? 0;
  // expected gain of doubting: (1 - p) * 1 - p * 1
  const bar = persona === 'skeptic' ? -0.1 : persona === 'trickster' ? 0.05 : 0.15;
  return 1 - 2 * p > bar + (rng() - 0.5) * 0.1;
}
