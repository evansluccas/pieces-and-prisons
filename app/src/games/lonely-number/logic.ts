/**
 * LONELY NUMBER — rules (our own adaptation of the "lowest unique number" idea)
 *
 * - Every player holds number cards 1..8.
 * - The match has 3 cycles of 6 rounds. Hands are refilled to 1..8 at the
 *   start of each cycle.
 * - Each round:
 *     1. PICK  — everyone secretly picks two different cards from hand.
 *     2. KEEP  — all pairs are revealed; everyone secretly keeps one of their
 *                two cards. The other card goes back to hand.
 *     3. RESULT — kept cards are revealed. The lowest number that exactly one
 *                player kept wins: that player earns tokens equal to the card.
 *                If every number is shared, nobody scores.
 *   The kept card is spent (removed from hand) whether it won or not.
 * - After 18 rounds the player with the most tokens wins (ties: more round
 *   wins, then lower seat). The last-placed player is "sent to prison".
 */

export type Card = number;
export type Phase = 'pick' | 'keep' | 'result' | 'gameOver';

export interface Config {
  cycles: number;
  roundsPerCycle: number;
  maxCard: number;
}

export const DEFAULT_CONFIG: Config = { cycles: 3, roundsPerCycle: 6, maxCard: 8 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  hand: Card[];
  tokens: number;
  wins: number;
}

export interface RoundRecord {
  round: number;
  pairs: Record<string, [Card, Card]>;
  kept: Record<string, Card>;
  winner: string | null;
  card: Card | null;
}

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number; // 1-based, across all cycles
  phase: Phase;
  pairs: Record<string, [Card, Card]>;
  kept: Record<string, Card>;
  history: RoundRecord[];
}

export const fullHand = (max: number): Card[] => Array.from({ length: max }, (_, i) => i + 1);

export function newGame(players: { id: string; name: string; isBot: boolean }[], config = DEFAULT_CONFIG): GameState {
  if (players.length < 2) throw new Error('need at least 2 players');
  return {
    config,
    players: players.map((p) => ({ ...p, hand: fullHand(config.maxCard), tokens: 0, wins: 0 })),
    round: 1,
    phase: 'pick',
    pairs: {},
    kept: {},
    history: [],
  };
}

export const totalRounds = (s: GameState) => s.config.cycles * s.config.roundsPerCycle;
export const cycleOf = (s: GameState) => Math.floor((s.round - 1) / s.config.roundsPerCycle) + 1;
export const roundInCycle = (s: GameState) => ((s.round - 1) % s.config.roundsPerCycle) + 1;

function player(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

export function submitPair(s: GameState, id: string, pair: [Card, Card]): GameState {
  if (s.phase !== 'pick') throw new Error('not in pick phase');
  const p = player(s, id);
  const [a, b] = pair;
  if (a === b) throw new Error('pick two different cards');
  if (!p.hand.includes(a) || !p.hand.includes(b)) throw new Error('card not in hand');
  const pairs = { ...s.pairs, [id]: (a < b ? [a, b] : [b, a]) as [Card, Card] };
  const allIn = s.players.every((x) => pairs[x.id]);
  return { ...s, pairs, phase: allIn ? 'keep' : 'pick' };
}

export function submitKeep(s: GameState, id: string, card: Card): GameState {
  if (s.phase !== 'keep') throw new Error('not in keep phase');
  if (!s.pairs[id]?.includes(card)) throw new Error('can only keep a card from your pair');
  const kept = { ...s.kept, [id]: card };
  const next = { ...s, kept };
  return s.players.every((x) => kept[x.id] !== undefined) ? resolve(next) : next;
}

/** Lowest card value held by exactly one player, or null. */
export function lowestUnique(kept: Record<string, Card>): { winner: string; card: Card } | null {
  const counts = new Map<Card, string[]>();
  for (const [id, c] of Object.entries(kept)) counts.set(c, [...(counts.get(c) ?? []), id]);
  const unique = [...counts.entries()].filter(([, ids]) => ids.length === 1).sort((a, b) => a[0] - b[0]);
  return unique.length ? { winner: unique[0][1][0], card: unique[0][0] } : null;
}

function resolve(s: GameState): GameState {
  const result = lowestUnique(s.kept);
  const players = s.players.map((p) => {
    const card = s.kept[p.id];
    const hand = p.hand.filter((c) => c !== card);
    const won = result?.winner === p.id;
    return { ...p, hand, tokens: p.tokens + (won ? result!.card : 0), wins: p.wins + (won ? 1 : 0) };
  });
  const record: RoundRecord = {
    round: s.round, pairs: s.pairs, kept: s.kept, winner: result?.winner ?? null, card: result?.card ?? null,
  };
  return { ...s, players, phase: 'result', history: [...s.history, record] };
}

export function nextRound(s: GameState): GameState {
  if (s.phase !== 'result') throw new Error('round not finished');
  if (s.round >= totalRounds(s)) return { ...s, phase: 'gameOver' };
  const round = s.round + 1;
  const newCycle = (round - 1) % s.config.roundsPerCycle === 0;
  const players = newCycle ? s.players.map((p) => ({ ...p, hand: fullHand(s.config.maxCard) })) : s.players;
  return { ...s, round, players, phase: 'pick', pairs: {}, kept: {} };
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => b.p.tokens - a.p.tokens || b.p.wins - a.p.wins || a.seat - b.seat)
    .map((x) => x.p);
}
