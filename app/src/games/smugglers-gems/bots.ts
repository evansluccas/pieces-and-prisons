import type { Rng } from '../shared/rng';
import { BUYER, Card, GameState, canSwapWith, cardScore, knownCards, locations } from './logic';

export type Persona = 'sharp' | 'greedy' | 'loose';

export type BotAction = { kind: 'pass' } | { kind: 'swap'; target: string } | { kind: 'peek'; target: string };

/** Fill the unknown locations with the unaccounted cards, at random. */
function sampleWorld(s: GameState, known: Record<string, Card | null>, rng: Rng): Record<string, Card> {
  const used = new Set(Object.values(known).filter(Boolean).map((c) => c!.id));
  const pool = s.deck.filter((c) => !used.has(c.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const world: Record<string, Card> = {};
  for (const loc of locations(s)) world[loc] = known[loc] ?? pool.pop()!;
  return world;
}

/** My card's score plus my partner's, in a given world. */
function value(world: Record<string, Card>, me: string, partner: string): number {
  const buyer = BUYER.map((b) => world[b]);
  return cardScore(world[me], buyer) + cardScore(world[partner], buyer);
}

/**
 * Evaluate passing and every legal swap over sampled worlds consistent with
 * what this bot knows, ignoring future swaps. Uses its peek early when the
 * Buyer row is a mystery.
 */
export function botTurn(s: GameState, me: string, persona: Persona, rng: Rng, samples = 40): BotAction {
  const p = s.players.find((x) => x.id === me)!;
  const known = knownCards(s, me);
  const unknownBuyers = [...BUYER].filter((b) => !known[b]);
  if (!p.peeked && unknownBuyers.length === 3 && persona !== 'loose' && rng() < 0.7) {
    return { kind: 'peek', target: unknownBuyers[Math.floor(rng() * 3)] };
  }
  const targets = locations(s).filter((l) => canSwapWith(s, me, l));
  if (persona === 'loose' && rng() < 0.25) {
    return rng() < 0.3 ? { kind: 'pass' } : { kind: 'swap', target: targets[Math.floor(rng() * targets.length)] };
  }
  const worlds = Array.from({ length: samples }, () => sampleWorld(s, known, rng));
  const score = (target: string | null) => {
    let t = 0;
    for (const w of worlds) {
      const world = target ? { ...w, [me]: w[target], [target]: w[me] } : w;
      t += value(world, me, p.partner);
    }
    return t / samples;
  };
  let best: BotAction = { kind: 'pass' };
  let bestV = score(null) + (persona === 'greedy' ? -0.3 : 0.2); // small bias to keep what you know
  for (const t of targets) {
    const v = score(t) + rng() * 0.2;
    if (v > bestV) {
      bestV = v;
      best = { kind: 'swap', target: t };
    }
  }
  return best;
}

