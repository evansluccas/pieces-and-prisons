/**
 * BLIND BINGO — rules (our own blind-auction bingo)
 *
 * - Each player has a 3×3 card holding 3 triangles, 3 circles and 3 stars in a
 *   random layout, and ten coins: 1, 1, 1, 2, 2, 2, 3, 3, 5, 10. Coins can't
 *   be broken or changed.
 * - 7 rounds. Each round:
 *     1. CHOOSE  everyone secretly picks a shape; then all choices are shown.
 *     2. BID     everyone secretly bids one or more of their coins on their
 *                shape (if you have no coins left, you bid nothing). Every
 *                coin bid is spent, win or lose.
 *     3. RESULT  on each shape the highest bid wins one stamp for every player
 *                who chose that shape. Tied top bids split the stamps (rounded
 *                down). Only the winning amounts are announced — never who won.
 * - Stamps fill empty cells of that shape on the winner's card, choosing the
 *   cells that help bingo lines most. Extra stamps are wasted.
 * - Cards and coins stay hidden until the end. Ranking: most bingo lines
 *   (rows, columns, diagonals), then cells filled, then coins left.
 *   Last place goes to prison.
 */
import { Rng } from '../shared/rng';

export const SHAPES = ['triangle', 'circle', 'star'] as const;
export type Shape = (typeof SHAPES)[number];
export const COINS = [1, 1, 1, 2, 2, 2, 3, 3, 5, 10];
export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

export interface Config { rounds: number }
export const DEFAULT_CONFIG: Config = { rounds: 7 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  card: Shape[];
  stamped: boolean[];
  coins: number[];
  choice: Shape | null;
  bid: number[] | null;
}

export interface ShapeResult { bidders: number; amount: number | null; winners: string[]; stamps: number }

export interface RoundRecord {
  round: number;
  choices: Record<string, Shape>;
  bids: Record<string, number>;              // hidden until the end
  results: Record<Shape, ShapeResult>;       // winners hidden until the end
  gained: Record<string, number[]>;          // cells stamped per player
}

export type Phase = 'choose' | 'bid' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  history: RoundRecord[];
}

export function shuffledCard(rng: Rng): Shape[] {
  const card: Shape[] = [...SHAPES, ...SHAPES, ...SHAPES];
  for (let i = card.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [card[i], card[j]] = [card[j], card[i]];
  }
  return card;
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 3) throw new Error('need at least 3 players');
  return {
    config,
    players: players.map((p) => ({
      ...p, card: shuffledCard(rng), stamped: Array(9).fill(false), coins: [...COINS], choice: null, bid: null,
    })),
    round: 1,
    phase: 'choose',
    history: [],
  };
}

export function choose(s: GameState, id: string, shape: Shape): GameState {
  if (s.phase !== 'choose') throw new Error('not choosing');
  const players = s.players.map((p) => (p.id === id ? { ...p, choice: shape } : p));
  return { ...s, players, phase: players.every((p) => p.choice) ? 'bid' : 'choose' };
}

/** Is `bid` a sub-multiset of `coins`? */
export function hasCoins(coins: number[], bid: number[]): boolean {
  const left = [...coins];
  for (const c of bid) {
    const i = left.indexOf(c);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

export function removeCoins(coins: number[], bid: number[]): number[] {
  const left = [...coins];
  for (const c of bid) left.splice(left.indexOf(c), 1);
  return left;
}

export function bid(s: GameState, id: string, coins: number[]): GameState {
  if (s.phase !== 'bid') throw new Error('not bidding');
  const p = s.players.find((x) => x.id === id)!;
  if (!hasCoins(p.coins, coins)) throw new Error('you do not have those coins');
  if (coins.length === 0 && p.coins.length > 0) throw new Error('bid at least one coin');
  const players = s.players.map((x) => (x.id === id ? { ...x, bid: coins } : x));
  const next = { ...s, players };
  return players.every((x) => x.bid !== null) ? resolve(next) : next;
}

export const bingos = (stamped: boolean[]) => LINES.filter((l) => l.every((i) => stamped[i])).length;
export const filled = (stamped: boolean[]) => stamped.filter(Boolean).length;

/** Pick `k` empty cells of `shape` that help lines most (completed lines first). */
export function bestCells(card: Shape[], stamped: boolean[], shape: Shape, k: number): number[] {
  const free = card.map((c, i) => i).filter((i) => card[i] === shape && !stamped[i]);
  if (k >= free.length) return free;
  const combos: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void combos.push(acc);
    for (let i = start; i < free.length; i++) rec(i + 1, [...acc, free[i]]);
  };
  rec(0, []);
  const score = (cells: number[]) => {
    const st = [...stamped];
    for (const c of cells) st[c] = true;
    const progress = LINES.reduce((t, l) => t + l.filter((i) => st[i]).length ** 2, 0);
    return bingos(st) * 100 + progress;
  };
  return combos.reduce((best, c) => (score(c) > score(best) ? c : best));
}

function resolve(s: GameState): GameState {
  const sum = (c: number[]) => c.reduce((a, b) => a + b, 0);
  const bids = Object.fromEntries(s.players.map((p) => [p.id, sum(p.bid!)]));
  const choices = Object.fromEntries(s.players.map((p) => [p.id, p.choice!])) as Record<string, Shape>;
  const results = {} as Record<Shape, ShapeResult>;
  const gained: Record<string, number[]> = Object.fromEntries(s.players.map((p) => [p.id, []]));
  let players = s.players;
  for (const shape of SHAPES) {
    const bidders = s.players.filter((p) => p.choice === shape);
    const amount = bidders.length ? Math.max(...bidders.map((p) => bids[p.id])) : null;
    const winners = amount ? bidders.filter((p) => bids[p.id] === amount).map((p) => p.id) : [];
    const stamps = winners.length ? Math.floor(bidders.length / winners.length) : 0;
    results[shape] = { bidders: bidders.length, amount: winners.length ? amount : null, winners, stamps };
    players = players.map((p) => {
      if (!winners.includes(p.id) || stamps === 0) return p;
      const cells = bestCells(p.card, p.stamped, shape, stamps);
      gained[p.id] = cells;
      const stamped = [...p.stamped];
      for (const c of cells) stamped[c] = true;
      return { ...p, stamped };
    });
  }
  players = players.map((p) => ({ ...p, coins: removeCoins(p.coins, p.bid!) }));
  const record: RoundRecord = { round: s.round, choices, bids, results, gained };
  return { ...s, players, phase: 'result', history: [...s.history, record] };
}

export function nextRound(s: GameState): GameState {
  if (s.phase !== 'result') throw new Error('round not finished');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  return { ...s, round: s.round + 1, phase: 'choose', players: s.players.map((p) => ({ ...p, choice: null, bid: null })) };
}

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, bingos: bingos(p.stamped), cells: filled(p.stamped), left: p.coins.reduce((a, b) => a + b, 0), seat }))
    .sort((a, b) => b.bingos - a.bingos || b.cells - a.cells || b.left - a.left || a.seat - b.seat);
}
