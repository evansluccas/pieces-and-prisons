import type { Rng } from '../lonely-number/bots';

export type Persona = 'steady' | 'spiker' | 'wild';

export interface BidContext {
  bankMs: number;
  roundsLeft: number; // including this one
  myTokens: number;
  leaderTokens: number;
}

const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/**
 * Secret hold time for this round, in ms (0 = sit out). Bots never bid more
 * than their bank, and spend everything in the final round.
 */
export function botBid(ctx: BidContext, persona: Persona, rng: Rng): number {
  const { bankMs, roundsLeft } = ctx;
  if (bankMs <= 0) return 0;
  if (roundsLeft <= 1) return persona === 'wild' && rng() < 0.2 ? bankMs * between(rng, 0.5, 0.9) : bankMs;

  const avg = bankMs / roundsLeft;
  let bid: number;
  if (persona === 'steady') {
    bid = rng() < 0.25 ? between(rng, 300, 1500) : avg * between(rng, 0.6, 1.35);
  } else if (persona === 'spiker') {
    bid = rng() < 0.3 ? avg * between(rng, 1.8, 3.2) : avg * between(rng, 0.2, 0.7);
  } else {
    bid = rng() < 0.15 ? 0 : avg * between(rng, 0, 2.6);
  }
  if (ctx.myTokens < ctx.leaderTokens - 1) bid *= 1.25; // falling behind: push harder
  return Math.round(Math.min(bankMs, Math.max(0, bid)));
}
