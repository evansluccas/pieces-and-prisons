/**
 * DICE TOWER — rules (our own drafting-and-prediction dice game)
 *
 * Each round:
 *  1. ROLL    The tower rolls an open tray of white dice (2 per player + 1)
 *             that everyone can see. Every player also gets one SECRET die
 *             that only they can see.
 *  2. DRAFT   In snake order (1→N, then N→1) each player claims two white
 *             dice from the tray. Your hand = 2 white dice + your secret die.
 *             The start player rotates every round.
 *  3. PREDICT Everyone secretly predicts their points for the round: 6, 3, 1 or 0.
 *  4. REVEAL  Secret dice are shown and all hands are ranked against each
 *             other: Triple > Straight (3 in a row) > Pair > High die; inside
 *             a kind, higher dice win. Points by place:
 *               best hand 6 · 2nd best 3 · 3rd best 1 · everyone else 0,
 *             and the worst hand ALWAYS scores 0 (so with 3 players: 6/3/0).
 *             Tied hands share the better place.
 *             A correct prediction doubles your points; a correct 0 earns 4.
 * After the last round the highest score wins (ties: more correct predictions).
 * Last place goes to prison.
 */
import { Rng, rollDie } from '../shared/rng';

export type ComboKind = 'triple' | 'straight' | 'pair' | 'high';
export interface Combo { kind: ComboKind; label: string; key: number[] }

export const ZERO_BONUS = 4;

export interface Config { rounds: number }
export const DEFAULT_CONFIG: Config = { rounds: 5 };

export interface Die { id: number; value: number; takenBy: string | null }

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  correct: number;
  secret: number;
  picks: number[];          // values of claimed white dice
  prediction: number | null;
}

export interface RoundRecord {
  round: number;
  hands: Record<string, number[]>;
  combos: Record<string, string>;
  predictions: Record<string, number>;
  base: Record<string, number>;
  places: Record<string, string>; // '1st' | '2nd' | '3rd' | '4th' … | 'Last'
  earned: Record<string, number>;
}

export type Phase = 'draft' | 'predict' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  pool: Die[];
  order: string[];   // full pick sequence for this round
  pickIndex: number;
  history: RoundRecord[];
}

// ------------------------------------------------------------- combos ----

export function evaluate(dice: number[]): Combo {
  if (dice.length !== 3) throw new Error('a hand has three dice');
  const d = [...dice].sort((a, b) => b - a);
  if (d[0] === d[2]) return { kind: 'triple', label: `Triple ${d[0]}s`, key: [3, d[0]] };
  if (d[0] - 1 === d[1] && d[1] - 1 === d[2]) return { kind: 'straight', label: `Straight ${d[2]}-${d[0]}`, key: [2, d[0]] };
  if (d[0] === d[1] || d[1] === d[2]) {
    const pair = d[1];
    const kicker = d[0] === d[1] ? d[2] : d[0];
    return { kind: 'pair', label: `Pair of ${pair}s`, key: [1, pair, kicker] };
  }
  return { kind: 'high', label: `High ${d[0]}`, key: [0, ...d] };
}

export function compareCombos(a: Combo, b: Combo): number {
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const diff = (a.key[i] ?? 0) - (b.key[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Display name of a place, given how many players are strictly better. */
export function placeName(better: number, players: number): string {
  if (better === players - 1) return 'Last';
  return ['1st', '2nd', '3rd', '4th', '5th', '6th'][better];
}

/** The place → points table for a table of `players` (used for rules and bets). */
export function scoringTable(players: number): { place: string; points: number }[] {
  const rows: { place: string; points: number }[] = [];
  for (let b = 0; b < players; b++) {
    const points = placePoints(b, players);
    const prev = rows[rows.length - 1];
    if (prev && prev.points === points) continue; // merge "4th…Last = 0"
    rows.push({ place: points === 0 ? (b === players - 1 ? 'Last' : `${placeName(b, players)} & below`) : placeName(b, players), points });
  }
  return rows;
}

/** Bets that can actually happen at this table size. */
export const validPredictions = (players: number): number[] => scoringTable(players).map((r) => r.points);

/** Points for a place, given how many players are strictly better. */
export function placePoints(better: number, players: number): number {
  if (better === players - 1) return 0; // strictly last
  return [6, 3, 1][better] ?? 0;
}

export function earnedPoints(base: number, prediction: number): number {
  if (prediction !== base) return base;
  return base === 0 ? ZERO_BONUS : base * 2;
}

// --------------------------------------------------------------- flow ----

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 2) throw new Error('need at least 2 players');
  const base: GameState = {
    config,
    players: players.map((p) => ({ ...p, score: 0, correct: 0, secret: 0, picks: [], prediction: null })),
    round: 0,
    phase: 'draft',
    pool: [],
    order: [],
    pickIndex: 0,
    history: [],
  };
  return startRound(base, rng);
}

function startRound(s: GameState, rng: Rng): GameState {
  const round = s.round + 1;
  const n = s.players.length;
  const start = (round - 1) % n;
  const seats = s.players.map((_, i) => s.players[(start + i) % n].id);
  const order = [...seats, ...[...seats].reverse()];
  const pool = Array.from({ length: n * 2 + 1 }, (_, id) => ({ id, value: rollDie(rng), takenBy: null }));
  pool.sort((a, b) => a.value - b.value).forEach((d, i) => (d.id = i));
  const players = s.players.map((p) => ({ ...p, secret: rollDie(rng), picks: [], prediction: null }));
  return { ...s, round, players, pool, order, pickIndex: 0, phase: 'draft' };
}

export const currentPicker = (s: GameState): string | null => (s.phase === 'draft' ? s.order[s.pickIndex] : null);

export function draft(s: GameState, playerId: string, dieId: number): GameState {
  if (currentPicker(s) !== playerId) throw new Error('not your pick');
  const die = s.pool.find((d) => d.id === dieId);
  if (!die || die.takenBy) throw new Error('die not available');
  const pool = s.pool.map((d) => (d.id === dieId ? { ...d, takenBy: playerId } : d));
  const players = s.players.map((p) => (p.id === playerId ? { ...p, picks: [...p.picks, die.value] } : p));
  const pickIndex = s.pickIndex + 1;
  return { ...s, pool, players, pickIndex, phase: pickIndex >= s.order.length ? 'predict' : 'draft' };
}

export function predict(s: GameState, playerId: string, value: number): GameState {
  if (s.phase !== 'predict') throw new Error('not in predict phase');
  if (!validPredictions(s.players.length).includes(value)) throw new Error('invalid prediction');
  const players = s.players.map((p) => (p.id === playerId ? { ...p, prediction: value } : p));
  const next = { ...s, players };
  return players.every((p) => p.prediction !== null) ? resolve(next) : next;
}

export const handOf = (p: PlayerState) => [...p.picks, p.secret];

/** Base points for every player given full hands. */
export function scoreHands(hands: Record<string, number[]>): Record<string, number> {
  const better = betterCounts(hands);
  const n = Object.keys(hands).length;
  return Object.fromEntries(Object.entries(better).map(([id, b]) => [id, placePoints(b, n)]));
}

/** For each player: how many hands are strictly better than theirs. */
export function betterCounts(hands: Record<string, number[]>): Record<string, number> {
  const ids = Object.keys(hands);
  const combos = Object.fromEntries(ids.map((id) => [id, evaluate(hands[id])]));
  return Object.fromEntries(ids.map((id) => [id, ids.filter((o) => compareCombos(combos[o], combos[id]) > 0).length]));
}

function resolve(s: GameState): GameState {
  const hands = Object.fromEntries(s.players.map((p) => [p.id, handOf(p)]));
  const base = scoreHands(hands);
  const better = betterCounts(hands);
  const n = s.players.length;
  const record: RoundRecord = {
    round: s.round, hands, base,
    places: Object.fromEntries(Object.entries(better).map(([id, b]) => [id, placeName(b, n)])),
    combos: Object.fromEntries(s.players.map((p) => [p.id, evaluate(hands[p.id]).label])),
    predictions: Object.fromEntries(s.players.map((p) => [p.id, p.prediction!])),
    earned: {},
  };
  const players = s.players.map((p) => {
    const earned = earnedPoints(base[p.id], p.prediction!);
    record.earned[p.id] = earned;
    return { ...p, score: p.score + earned, correct: p.correct + (p.prediction === base[p.id] ? 1 : 0) };
  });
  return { ...s, players, phase: 'result', history: [...s.history, record] };
}

export function nextRound(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'result') throw new Error('round not finished');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  return startRound(s, rng);
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => b.p.score - a.p.score || b.p.correct - a.p.correct || a.seat - b.seat)
    .map((x) => x.p);
}
