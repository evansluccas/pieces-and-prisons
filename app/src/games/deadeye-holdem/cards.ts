/** Playing cards and poker hand ranking (best 5 of any number of cards). */

export const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
export type Suit = (typeof SUITS)[number];
export interface Card { rank: number; suit: Suit } // rank 2..14 (14 = ace)

export const RANK_NAME: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const rankName = (r: number) => RANK_NAME[r] ?? String(r === 1 ? 'A' : r);
export const cardSprite = (c: Card) => `${c.suit}_${rankName(c.rank)}`;
export const cardText = (c: Card) => `${rankName(c.rank)}${{ spade: '♠', heart: '♥', diamond: '♦', club: '♣' }[c.suit]}`;

export function fullDeck(): Card[] {
  return SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit })));
}

export const CATEGORIES = [
  'High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush',
] as const;

/** cat = category index; key = the rank that names the hand; tiebreak = full comparison list. */
export interface HandValue { cat: number; key: number; tiebreak: number[] }

function rank5(cards: Card[]): HandValue {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '14,5,4,3,2') straightHigh = 5; // wheel
  }
  const counts = uniq.map((r) => ({ r, n: ranks.filter((x) => x === r).length })).sort((a, b) => b.n - a.n || b.r - a.r);
  const byCount = counts.map((c) => c.r);
  if (straightHigh && flush) return { cat: 8, key: straightHigh, tiebreak: [straightHigh] };
  if (counts[0].n === 4) return { cat: 7, key: byCount[0], tiebreak: byCount };
  if (counts[0].n === 3 && counts[1]?.n === 2) return { cat: 6, key: byCount[0], tiebreak: byCount };
  if (flush) return { cat: 5, key: ranks[0], tiebreak: ranks };
  if (straightHigh) return { cat: 4, key: straightHigh, tiebreak: [straightHigh] };
  if (counts[0].n === 3) return { cat: 3, key: byCount[0], tiebreak: byCount };
  if (counts[0].n === 2 && counts[1]?.n === 2) return { cat: 2, key: byCount[0], tiebreak: byCount };
  if (counts[0].n === 2) return { cat: 1, key: byCount[0], tiebreak: byCount };
  return { cat: 0, key: ranks[0], tiebreak: ranks };
}

export function compare(a: HandValue, b: HandValue): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Best five-card hand from 5–7 cards. */
export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    // not enough cards yet: rank what's there (pairs etc.), padded as high cards
    const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
    const counts = [...new Set(ranks)].map((r) => ({ r, n: ranks.filter((x) => x === r).length })).sort((a, b) => b.n - a.n || b.r - a.r);
    const byCount = counts.map((c) => c.r);
    if (counts[0]?.n === 3) return { cat: 3, key: byCount[0], tiebreak: byCount };
    if (counts[0]?.n === 2 && counts[1]?.n === 2) return { cat: 2, key: byCount[0], tiebreak: byCount };
    if (counts[0]?.n === 2) return { cat: 1, key: byCount[0], tiebreak: byCount };
    return { cat: 0, key: ranks[0] ?? 0, tiebreak: ranks };
  }
  let best: HandValue | null = null;
  const n = cards.length;
  const combo = (start: number, depth: number, chosen: number[]) => {
    if (depth === 5) {
      const v = rank5(chosen.map((i) => cards[i]));
      if (!best || compare(v, best) > 0) best = v;
      return;
    }
    for (let i = start; i < n; i++) combo(i + 1, depth + 1, [...chosen, i]);
  };
  combo(0, 0, []);
  return best!;
}

export function handName(v: { cat: number; key: number; tiebreak?: number[] }): string {
  const r = rankName(v.key);
  const plural = `${r}s`;
  switch (v.cat) {
    case 0: return `High card ${r}`;
    case 1: return `Pair of ${plural}`;
    case 2: return `Two pair, ${plural} high`;
    case 3: return `Trips ${plural}`;
    case 4: return `Straight to ${r}`;
    case 5: return `Flush, ${r}-high`;
    case 6: return `Full house, ${plural} full`;
    case 7: return `Quads ${plural}`;
    default: return `Straight flush to ${r}`;
  }
}
