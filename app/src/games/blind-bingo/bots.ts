import type { Rng } from '../shared/rng';
import { GameState, LINES, SHAPES, Shape } from './logic';

export type Persona = 'saver' | 'shark' | 'wild';

/** How much a shape is worth to this card right now. */
export function shapeValue(card: Shape[], stamped: boolean[], shape: Shape): number {
  let v = 0;
  card.forEach((c, i) => {
    if (c !== shape || stamped[i]) return;
    for (const l of LINES) if (l.includes(i)) v += 1 + l.filter((j) => stamped[j]).length;
  });
  return v;
}

export function botChoose(s: GameState, me: string, persona: Persona, rng: Rng): Shape {
  const p = s.players.find((x) => x.id === me)!;
  if (persona === 'wild' && rng() < 0.3) return SHAPES[Math.floor(rng() * 3)];
  let best: Shape = SHAPES[0];
  let bestV = -1;
  for (const sh of SHAPES) {
    const v = shapeValue(p.card, p.stamped, sh) + rng() * 2;
    if (v > bestV) {
      bestV = v;
      best = sh;
    }
  }
  return best;
}

/** Coins whose sum is closest to `target` (ties: fewer coins). Never empty if any coins. */
export function pickCoins(coins: number[], target: number): number[] {
  if (!coins.length) return [];
  let best: number[] = [Math.min(...coins)];
  let bestErr = Infinity;
  const n = coins.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pick = coins.filter((_, i) => (mask >> i) & 1);
    const sum = pick.reduce((a, b) => a + b, 0);
    const err = Math.abs(sum - target) + pick.length * 0.01;
    if (err < bestErr) {
      bestErr = err;
      best = pick;
    }
  }
  return best;
}

/** Bid after seeing who chose what. Uncontested → spend the smallest coin. */
export function botBid(s: GameState, me: string, persona: Persona, rng: Rng): number[] {
  const p = s.players.find((x) => x.id === me)!;
  if (!p.coins.length) return [];
  const rivals = s.players.filter((x) => x.id !== me && x.choice === p.choice).length;
  const roundsLeft = s.config.rounds - s.round + 1;
  const budget = p.coins.reduce((a, b) => a + b, 0);
  if (roundsLeft === 1) return [...p.coins];
  if (rivals === 0) return [Math.min(...p.coins)];
  const useful = p.card.filter((c, i) => c === p.choice && !p.stamped[i]).length;
  const stampsIfWin = Math.min(rivals + 1, useful);
  const avg = budget / roundsLeft;
  const factor = persona === 'shark' ? 1.4 : persona === 'saver' ? 0.8 : 0.4 + rng() * 1.6;
  const target = avg * factor * (0.6 + 0.45 * stampsIfWin) + rng();
  // never go (nearly) all-in before the last round
  const cap = Math.max(1, budget * 0.5);
  return pickCoins(p.coins, Math.max(1, Math.min(target, cap)));
}
