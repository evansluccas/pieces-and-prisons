import type { Rng } from '../shared/rng';
import { Call, GameState, candidates } from './logic';

export type Level = 'easy' | 'normal' | 'hard';

/** Count the dealer's remaining cards above and below the shown one. */
export function odds(s: GameState): { higher: number; lower: number } {
  const c = candidates(s);
  const shown = s.shown!;
  return { higher: c.filter((x) => x > shown).length, lower: c.filter((x) => x < shown).length };
}

const flipCall = (c: Call): Call => (c === 'higher' ? 'lower' : 'higher');

/**
 * How often the given dealer hid a card AGAINST the count so far
 * (starts from a prior of 1 in 2, so a few rounds don't swing it wildly).
 */
function againstCountRate(s: GameState, dealer: number): number {
  const seen = s.history.filter((r) => r.dealer === dealer && r.majority);
  const against = seen.filter((r) => (r.hidden > r.shown ? 'higher' : 'lower') !== r.majority).length;
  return (against + 1) / (seen.length + 2);
}

/** How often the given guesser called WITH the count so far (assume 3 in 4 until we see otherwise). */
function withCountRate(s: GameState, guesser: number): number {
  const seen = s.history.filter((r) => r.dealer !== guesser && r.majority);
  const withIt = seen.filter((r) => r.call === r.majority).length;
  return (withIt + 3) / (seen.length + 4);
}

/**
 * Easy: loose guesses. Normal: call with the count. Hard: read the dealer —
 * if they keep hiding against the count, call against it that often too.
 */
export function botCall(s: GameState, level: Level, rng: Rng): Call {
  const { higher, lower } = odds(s);
  if (level === 'easy' && rng() < 0.35) return rng() < 0.5 ? 'higher' : 'lower';
  if (higher === 0) return 'lower';
  if (lower === 0) return 'higher';
  if (higher === lower) return rng() < 0.5 ? 'higher' : 'lower';
  const majority: Call = higher > lower ? 'higher' : 'lower';
  if (level !== 'hard') return majority;
  // blend what the count says with how this dealer has actually been hiding
  const byCount = Math.max(higher, lower) / (higher + lower);
  const byHabit = 1 - againstCountRate(s, s.dealer);
  const pMajority = (byCount + byHabit) / 2 + (rng() - 0.5) * 0.04;
  return pMajority >= 0.5 ? majority : flipCall(majority);
}

/**
 * Pick a shown/hidden pair. A counting opponent calls the majority side, so
 * the dealer wins when the hidden card is in the MINORITY. Among pairs that
 * do that, prefer the most convincing (biggest majority) and keep a balanced
 * hand for later deals. Easy bots just pick at random.
 */
export function botDeal(s: GameState, level: Level, rng: Rng): { shown: number; hidden: number } {
  const hand = s.hands[s.dealer];
  const pairs: { shown: number; hidden: number }[] = [];
  for (const a of hand) for (const b of hand) if (a !== b) pairs.push({ shown: a, hidden: b });
  if (level === 'easy') return pairs[Math.floor(rng() * pairs.length)];
  let best = pairs[0];
  let bestV = -Infinity;
  for (const p of pairs) {
    const rest = hand.filter((x) => x !== p.shown);
    const higher = rest.filter((x) => x > p.shown).length;
    const lower = rest.filter((x) => x < p.shown).length;
    const hiddenHigher = p.hidden > p.shown;
    // a guesser who calls with the count gets it wrong when the hidden card is in the minority;
    // the hard bot weighs that by how often THIS guesser actually calls with the count
    const withCount = level === 'hard' ? withCountRate(s, 1 - s.dealer) : 1;
    const inMinority = higher === lower ? 0.5 : hiddenHigher === higher > lower ? 0 : 1;
    const fooled = higher === 0 || lower === 0 ? 0 : inMinority * withCount + (1 - inMinority) * (1 - withCount);
    // keep the leftover hand spread out (extremes are free points for the other side later)
    const left = hand.filter((x) => x !== p.shown && x !== p.hidden);
    const spread = left.length ? (Math.max(...left) - Math.min(...left)) / 10 : 0;
    const margin = Math.abs(higher - lower) / Math.max(1, rest.length);
    const v = fooled * 2 + (level === 'hard' ? spread * 0.4 + margin * 0.3 : 0) + rng() * (level === 'hard' ? 0.2 : 0.6);
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  return best;
}
