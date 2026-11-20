import { Card, lowestUnique } from './logic';

export type Persona = 'cautious' | 'greedy' | 'wild';
export type Rng = () => number;

/** Small seeded PRNG (mulberry32) so games and tests are reproducible. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(items: Card[], weights: number[], rng: Rng): Card {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Choose two cards to show. Personas prefer different parts of the hand. */
export function botPickPair(hand: Card[], persona: Persona, rng: Rng): [Card, Card] {
  const weight = (c: Card) => {
    if (persona === 'cautious') return Math.pow(9 - c, 1.6);
    if (persona === 'greedy') return 1 + Math.pow(c, 1.2) * (c <= 2 ? 1.5 : 1);
    return 1;
  };
  const first = weightedPick(hand, hand.map(weight), rng);
  const rest = hand.filter((c) => c !== first);
  const second = weightedPick(rest, rest.map(weight), rng);
  return first < second ? [first, second] : [second, first];
}

/**
 * Probability that `mine` is the lowest unique card, assuming every opponent
 * keeps either of their two revealed cards with equal chance.
 */
export function winChance(mine: Card, others: [Card, Card][]): number {
  const n = others.length;
  let wins = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    const kept: Record<string, Card> = { me: mine };
    others.forEach((pair, i) => (kept[`o${i}`] = pair[(mask >> i) & 1]));
    if (lowestUnique(kept)?.winner === 'me') wins++;
  }
  return wins / (1 << n);
}

/** Pick which of the two shown cards to keep. */
export function botKeep(pair: [Card, Card], others: [Card, Card][], persona: Persona, rng: Rng): Card {
  if (persona === 'wild' && rng() < 0.35) return pair[rng() < 0.5 ? 0 : 1];
  const score = (c: Card) => {
    const p = winChance(c, others);
    // cautious players value certainty; greedy players value expected tokens.
    const base = persona === 'cautious' ? p * (2 + c * 0.5) : p * c;
    return base + rng() * 0.15;
  };
  return score(pair[0]) >= score(pair[1]) ? pair[0] : pair[1];
}
