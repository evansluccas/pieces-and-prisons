/**
 * COLOR DOUBT — rules (our own colour-bidding bluff game)
 *
 * - The deck has 7 cards of each of 5 colours (35 cards). Each round every
 *   player is dealt 5 cards face down; you only see your own hand.
 * - BIDDING: starting with the start player and going around, each player
 *   either RAISES the bid or DOUBTS it. A bid is "at least N cards of colour C
 *   across all hands". A raise must name a higher count, or the same count
 *   with a colour further along the colour order
 *   (ruby → topaz → emerald → sapphire → amethyst).
 *   The first player must bid; only the player after the bidder may doubt.
 * - BET: when a bid is doubted, everyone else secretly backs a side —
 *   the BID (it's true) or the DOUBT (it's false).
 * - REVEAL: all hands are shown and that colour is counted.
 *     Bid true  (count ≥ N) → the doubter pays the bidder 2 chips.
 *     Bid false (count < N) → the bidder pays the doubter 2 chips.
 *     Backers who picked the right side win 1 chip from the bank; the rest pay 1.
 *   The loser of the doubt starts the next round.
 * - Everyone starts with 10 chips. 8 rounds, or the match ends after a round
 *   where someone hits 0. Most chips wins; fewest chips goes to prison.
 */
import { Rng } from '../shared/rng';

export const COLOR_ORDER = ['ruby', 'topaz', 'emerald', 'sapphire', 'amethyst'] as const;
export type Color = (typeof COLOR_ORDER)[number];

export interface Config { rounds: number; chips: number; handSize: number; perColor: number; stake: number }
export const DEFAULT_CONFIG: Config = { rounds: 8, chips: 10, handSize: 5, perColor: 7, stake: 2 };

export interface Bid { player: string; count: number; color: Color }

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  chips: number;
  hand: Color[];
  back: 'bid' | 'doubt' | null; // side bet while a doubt is settled
}

export interface RoundRecord {
  round: number;
  bids: Bid[];
  doubter: string;
  hands: Record<string, Color[]>;
  actual: number;
  holds: boolean;
  backs: Record<string, 'bid' | 'doubt'>;
  delta: Record<string, number>;
}

export type Phase = 'bid' | 'back' | 'reveal' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  turn: string | null;
  startSeat: number;
  bids: Bid[];
  doubter: string | null;
  history: RoundRecord[];
}

const rank = (c: Color) => COLOR_ORDER.indexOf(c);

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const cardsInPlay = (s: GameState) => s.players.length * s.config.handSize;

function deal(s: GameState, rng: Rng): GameState {
  const deck = shuffle(COLOR_ORDER.flatMap((c) => Array<Color>(s.config.perColor).fill(c)), rng);
  const n = s.config.handSize;
  const players = s.players.map((p, i) => ({
    ...p,
    back: null,
    hand: deck.slice(i * n, (i + 1) * n).sort((a, b) => rank(a) - rank(b)),
  }));
  return { ...s, players, phase: 'bid', turn: players[s.startSeat].id, bids: [], doubter: null };
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 3 || players.length > 6) throw new Error('3 to 6 players');
  const base: GameState = {
    config,
    players: players.map((p) => ({ ...p, chips: config.chips, hand: [], back: null })),
    round: 1, phase: 'bid', turn: null, startSeat: 0, bids: [], doubter: null, history: [],
  };
  return deal(base, rng);
}

export const currentBid = (s: GameState): Bid | null => s.bids[s.bids.length - 1] ?? null;

/** Is (count, color) a legal raise over the current bid? */
export function isRaise(s: GameState, count: number, color: Color): boolean {
  if (!Number.isInteger(count) || count < 1 || count > cardsInPlay(s)) return false;
  const cur = currentBid(s);
  if (!cur) return true;
  return count > cur.count || (count === cur.count && rank(color) > rank(cur.color));
}

/** The smallest legal raise in a colour (or null if none is possible). */
export function minRaise(s: GameState, color: Color): number | null {
  const cur = currentBid(s);
  const n = !cur ? 1 : rank(color) > rank(cur.color) ? cur.count : cur.count + 1;
  return n <= cardsInPlay(s) ? n : null;
}

const nextSeat = (s: GameState, id: string) => {
  const i = s.players.findIndex((p) => p.id === id);
  return s.players[(i + 1) % s.players.length].id;
};

export function raise(s: GameState, id: string, count: number, color: Color): GameState {
  if (s.phase !== 'bid' || s.turn !== id) throw new Error('not your turn');
  if (!isRaise(s, count, color)) throw new Error('a raise must beat the current bid');
  return { ...s, bids: [...s.bids, { player: id, count, color }], turn: nextSeat(s, id) };
}

export function canDoubt(s: GameState, id: string): boolean {
  return s.phase === 'bid' && s.turn === id && s.bids.length > 0;
}

export function doubt(s: GameState, id: string): GameState {
  if (!canDoubt(s, id)) throw new Error('you cannot doubt now');
  const next: GameState = { ...s, phase: 'back', doubter: id, turn: null };
  return backers(next).length ? next : settle(next);
}

/** Players who still have to back a side. */
export function backers(s: GameState): string[] {
  if (s.phase !== 'back') return [];
  const bidder = currentBid(s)!.player;
  return s.players.filter((p) => p.id !== bidder && p.id !== s.doubter && p.back === null).map((p) => p.id);
}

export function back(s: GameState, id: string, side: 'bid' | 'doubt'): GameState {
  if (!backers(s).includes(id)) throw new Error('you cannot back a side now');
  const next = { ...s, players: s.players.map((p) => (p.id === id ? { ...p, back: side } : p)) };
  return backers(next).length ? next : settle(next);
}

export function countColor(s: GameState, color: Color): number {
  return s.players.reduce((n, p) => n + p.hand.filter((c) => c === color).length, 0);
}

function settle(s: GameState): GameState {
  const bid = currentBid(s)!;
  const doubter = s.doubter!;
  const actual = countColor(s, bid.color);
  const holds = actual >= bid.count;
  const [winner, loser] = holds ? [bid.player, doubter] : [doubter, bid.player];
  const delta: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const loserChips = s.players.find((p) => p.id === loser)!.chips;
  const paid = Math.min(s.config.stake, loserChips);
  delta[loser] -= paid;
  delta[winner] += paid;
  const backs: Record<string, 'bid' | 'doubt'> = {};
  for (const p of s.players) {
    if (!p.back) continue;
    backs[p.id] = p.back;
    delta[p.id] += (p.back === 'bid') === holds ? 1 : -Math.min(1, p.chips);
  }
  const players = s.players.map((p) => ({ ...p, chips: p.chips + delta[p.id] }));
  const record: RoundRecord = {
    round: s.round, bids: s.bids, doubter, hands: Object.fromEntries(s.players.map((p) => [p.id, p.hand])),
    actual, holds, backs, delta,
  };
  return {
    ...s,
    players,
    phase: 'reveal',
    startSeat: s.players.findIndex((p) => p.id === loser),
    history: [...s.history, record],
  };
}

export const isOver = (s: GameState) => s.round >= s.config.rounds || s.players.some((p) => p.chips <= 0);

export function nextRound(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'reveal') throw new Error('round not over');
  if (isOver(s)) return { ...s, phase: 'gameOver' };
  return deal({ ...s, round: s.round + 1 }, rng);
}

export function standings(s: GameState) {
  const wins = (id: string) =>
    s.history.filter((r) => (r.holds ? r.bids[r.bids.length - 1].player : r.doubter) === id).length;
  return s.players
    .map((p, seat) => ({ ...p, won: wins(p.id), seat }))
    .sort((a, b) => b.chips - a.chips || b.won - a.won || a.seat - b.seat);
}

// ---------------------------------------------------------------- odds ----

/**
 * Chance that at least `count` cards of `color` are in play, given only
 * `viewer`'s hand: the other hands are a random draw from the rest of the deck.
 */
export function bidOdds(s: GameState, viewer: string, count: number, color: Color): number {
  const me = s.players.find((p) => p.id === viewer)!;
  const mine = me.hand.filter((c) => c === color).length;
  const need = count - mine;
  if (need <= 0) return 1;
  const deckLeft = COLOR_ORDER.length * s.config.perColor - me.hand.length; // cards I can't see
  const goodLeft = s.config.perColor - mine;
  const drawn = cardsInPlay(s) - me.hand.length;
  if (need > Math.min(goodLeft, drawn)) return 0;
  let p = 0;
  for (let k = need; k <= Math.min(goodLeft, drawn); k++) p += hyper(deckLeft, goodLeft, drawn, k);
  return p;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

const hyper = (N: number, K: number, n: number, k: number) => (choose(K, k) * choose(N - K, n - k)) / choose(N, n);

export const COLOR_NAME: Record<Color, string> = { ruby: 'Ruby', topaz: 'Topaz', emerald: 'Emerald', sapphire: 'Sapphire', amethyst: 'Amethyst' };
