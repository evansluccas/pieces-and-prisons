import { Rng, rollDie } from '../shared/rng';
import { Die, ZERO_BONUS, evaluate, scoreHands, validPredictions } from './logic';

export type Persona = 'sharp' | 'gambler' | 'cautious';

/** A single number for "how good is this hand" (higher is better). */
export function strength(dice: number[]): number {
  const k = evaluate(dice).key;
  return k[0] * 1000 + (k[1] ?? 0) * 100 + (k[2] ?? 0) * 10 + (k[3] ?? 0);
}

/** Pick a white die: look one pick ahead for the best hand with the secret die. */
export function botDraft(secret: number, picks: number[], pool: Die[], persona: Persona, rng: Rng): number {
  const open = pool.filter((d) => !d.takenBy);
  if (persona === 'gambler' && rng() < 0.25) return open[Math.floor(rng() * open.length)].id;
  const score = (d: Die) => {
    if (picks.length === 1) return strength([secret, picks[0], d.value]);
    const rest = open.filter((x) => x.id !== d.id);
    // conservative lookahead: other players may take dice before our 2nd pick
    const options = rest.map((x) => strength([secret, d.value, x.value])).sort((a, b) => b - a);
    return (options[0] ?? 0) * 0.5 + (options[2] ?? options[0] ?? 0) * 0.5;
  };
  let best = open[0];
  for (const d of open) if (score(d) + rng() * 0.01 > score(best)) best = d;
  return best.id;
}

/**
 * Estimate the chance of each round result by sampling the opponents'
 * unknown secret dice, then predict the result with the best expected bonus.
 */
export function botPredict(
  me: string, hands: Record<string, number[]>, persona: Persona, rng: Rng, samples = 300,
): number {
  const counts: Record<number, number> = { 0: 0, 1: 0, 3: 0, 6: 0 };
  for (let i = 0; i < samples; i++) {
    const guess: Record<string, number[]> = {};
    for (const [id, h] of Object.entries(hands)) guess[id] = id === me ? h : [h[0], h[1], rollDie(rng)];
    counts[scoreHands(guess)[me]]++;
  }
  // a correct prediction adds `bonus` on top of the base points
  const bonus = (p: number) => (p === 0 ? ZERO_BONUS : p);
  const value = (p: number) => (counts[p] / samples) * bonus(p);
  const options = validPredictions(Object.keys(hands).length);
  if (persona === 'gambler' && rng() < 0.3) return options[Math.floor(rng() * options.length)];
  const ranked = [...options].sort((a, b) => value(b) - value(a));
  if (persona === 'cautious') {
    // prefers the most likely outcome over the highest payout
    return [...options].sort((a, b) => counts[b] - counts[a])[0];
  }
  return ranked[0];
}
