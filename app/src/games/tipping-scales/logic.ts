/**
 * TIPPING SCALES — rules (our own "don't be the one who tips it" game)
 *
 * - Three scales: ruby, emerald, sapphire. A scale TIPS the moment its total
 *   weight reaches 13 (12 is the most a scale can safely hold).
 * - Every player holds stone cards 0–6 and 7 chips: 2 ruby, 2 emerald,
 *   2 sapphire and 1 rainbow. After 7 rounds everyone's hand refills (14 rounds).
 * - Each round everyone secretly plays 1 card + 1 chip. The chip's colour
 *   chooses the scale; a rainbow chip lets you choose ANY scale and you place
 *   first.
 * - Placing order: rainbow players first, then by card value, heaviest first.
 *   Ties go clockwise from the start player.
 * - Each player adds a stone of their card's weight to their scale. If that
 *   brings the scale to 13 or more, they take 1 penalty per stone on it (theirs
 *   included); the scale is emptied, and their stone stays as the new base.
 *   A 0 stone weighs nothing but still counts as a stone.
 * - The start player of the next round is the last player who tipped a scale
 *   (if nobody tipped, it moves one seat on).
 * - Fewest penalties after 14 rounds wins (ties: fewer scales tipped).
 *   Most penalties goes to prison. Cards and chips already played are public.
 */

export const COLORS = ['ruby', 'emerald', 'sapphire'] as const;
export type Color = (typeof COLORS)[number];
export type Chip = Color | 'rainbow';

export interface Config { rounds: number; handRounds: number; limit: number; maxCard: number }
export const DEFAULT_CONFIG: Config = { rounds: 14, handRounds: 7, limit: 13, maxCard: 6 };

export interface Play { card: number; chip: Chip; scale: Color }

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  cards: number[];
  chips: Record<Chip, number>;
  penalty: number;
  tips: number;
}

export interface PlaceEvent { player: string; scale: Color; card: number; tipped: boolean; penalty: number; weightAfter: number }

export interface RoundRecord {
  round: number;
  plays: Record<string, Play>;
  order: string[];
  events: PlaceEvent[];
  scalesBefore: Record<Color, number[]>;
}

export type Phase = 'choose' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  plays: Record<string, Play>;
  scales: Record<Color, number[]>; // stones (weights) on each scale
  startSeat: number;
  history: RoundRecord[];
}

export const fullHand = (c: Config) => Array.from({ length: c.maxCard + 1 }, (_, i) => i);
export const fullChips = (): Record<Chip, number> => ({ ruby: 2, emerald: 2, sapphire: 2, rainbow: 1 });
export const weight = (stones: number[]) => stones.reduce((a, b) => a + b, 0);
const emptyScales = (): Record<Color, number[]> => ({ ruby: [], emerald: [], sapphire: [] });

export function newGame(players: { id: string; name: string; isBot: boolean }[], config = DEFAULT_CONFIG): GameState {
  if (players.length < 2) throw new Error('need at least 2 players');
  return {
    config,
    players: players.map((p) => ({ ...p, cards: fullHand(config), chips: fullChips(), penalty: 0, tips: 0 })),
    round: 1,
    phase: 'choose',
    plays: {},
    scales: emptyScales(),
    startSeat: 0,
    history: [],
  };
}

export function legalPlay(p: PlayerState, play: Play): boolean {
  if (!p.cards.includes(play.card)) return false;
  if ((p.chips[play.chip] ?? 0) <= 0) return false;
  return play.chip === 'rainbow' || play.chip === play.scale;
}

/** Every legal (card, chip, scale) combination for a player. */
export function legalPlays(p: PlayerState): Play[] {
  const out: Play[] = [];
  for (const card of p.cards) {
    for (const c of COLORS) if (p.chips[c] > 0) out.push({ card, chip: c, scale: c });
    if (p.chips.rainbow > 0) for (const c of COLORS) out.push({ card, chip: 'rainbow', scale: c });
  }
  return out;
}

export function submitPlay(s: GameState, id: string, play: Play): GameState {
  if (s.phase !== 'choose') throw new Error('not choosing');
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error('unknown player');
  if (!legalPlay(p, play)) throw new Error('illegal play');
  const plays = { ...s.plays, [id]: play };
  const next = { ...s, plays };
  return s.players.every((x) => plays[x.id]) ? resolve(next) : next;
}

/** Placing order: rainbow first, then heavier cards, ties clockwise from the start seat. */
export function placingOrder(players: { id: string }[], plays: Record<string, Play>, startSeat: number): string[] {
  const n = players.length;
  const dist = (i: number) => (i - startSeat + n) % n;
  return players
    .map((p, i) => ({ id: p.id, seat: dist(i), play: plays[p.id] }))
    .sort((a, b) =>
      Number(b.play.chip === 'rainbow') - Number(a.play.chip === 'rainbow') || b.play.card - a.play.card || a.seat - b.seat)
    .map((x) => x.id);
}

/** Apply placements in order; pure so bots can simulate rounds. */
export function simulate(
  scales: Record<Color, number[]>, order: string[], plays: Record<string, Play>, limit: number,
): { scales: Record<Color, number[]>; events: PlaceEvent[] } {
  const next: Record<Color, number[]> = { ruby: [...scales.ruby], emerald: [...scales.emerald], sapphire: [...scales.sapphire] };
  const events: PlaceEvent[] = [];
  for (const id of order) {
    const { card, scale } = plays[id];
    const stones = [...next[scale], card];
    if (weight(stones) >= limit) {
      events.push({ player: id, scale, card, tipped: true, penalty: stones.length, weightAfter: card });
      next[scale] = [card];
    } else {
      events.push({ player: id, scale, card, tipped: false, penalty: 0, weightAfter: weight(stones) });
      next[scale] = stones;
    }
  }
  return { scales: next, events };
}

function resolve(s: GameState): GameState {
  const order = placingOrder(s.players, s.plays, s.startSeat);
  const { scales, events } = simulate(s.scales, order, s.plays, s.config.limit);
  const pen: Record<string, number> = {};
  const tips: Record<string, number> = {};
  for (const e of events) if (e.tipped) {
    pen[e.player] = (pen[e.player] ?? 0) + e.penalty;
    tips[e.player] = (tips[e.player] ?? 0) + 1;
  }
  const players = s.players.map((p) => {
    const play = s.plays[p.id];
    const chips = { ...p.chips, [play.chip]: p.chips[play.chip] - 1 };
    return {
      ...p,
      cards: p.cards.filter((c) => c !== play.card),
      chips,
      penalty: p.penalty + (pen[p.id] ?? 0),
      tips: p.tips + (tips[p.id] ?? 0),
    };
  });
  const lastTip = [...events].reverse().find((e) => e.tipped);
  const startSeat = lastTip ? s.players.findIndex((p) => p.id === lastTip.player) : (s.startSeat + 1) % s.players.length;
  const record: RoundRecord = { round: s.round, plays: s.plays, order, events, scalesBefore: s.scales };
  return { ...s, players, scales, startSeat, phase: 'result', history: [...s.history, record] };
}

export function nextRound(s: GameState): GameState {
  if (s.phase !== 'result') throw new Error('round not finished');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  const refill = s.round % s.config.handRounds === 0;
  const players = refill ? s.players.map((p) => ({ ...p, cards: fullHand(s.config), chips: fullChips() })) : s.players;
  return { ...s, round: s.round + 1, players, phase: 'choose', plays: {} };
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => a.p.penalty - b.p.penalty || a.p.tips - b.p.tips || a.seat - b.seat)
    .map((x) => x.p);
}
