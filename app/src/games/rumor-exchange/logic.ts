/**
 * RUMOR EXCHANGE — rules (our own hidden-rule stock market)
 *
 * - Six companies are listed, each at 10,000. Every company's price follows
 *   a secret RULE (e.g. "rises 800 every round", "copies another company's
 *   last move", "moves with what the table buys"). Prices never drop below 100.
 * - Everyone starts with 100,000 cash. 15 rounds. Each round everyone secretly
 *   places orders — buy or sell whole shares at the current price (no
 *   borrowing, no short selling). Sales settle before purchases.
 * - Then every price moves by its rule, and the new prices are public.
 * - RUMORS: after rounds 4, 8 and 12 the rules of two companies are published
 *   to everyone. On your turn you may also buy a PRIVATE rumor for 6,000:
 *   pick a company and learn its rule — only you.
 * - After round 15 all shares are sold at the final prices. Most money wins;
 *   least money goes to prison.
 */
import { Rng } from '../shared/rng';

export type RuleKind = 'climber' | 'zigzag' | 'crowd' | 'contrarian' | 'echo' | 'boom' | 'drifter' | 'magnet';
export const RULE_KINDS: RuleKind[] = ['climber', 'zigzag', 'crowd', 'contrarian', 'echo', 'boom', 'drifter', 'magnet'];

export interface Rule { kind: RuleKind; follows?: number } // follows: company index for 'echo'

export interface Company { id: number; name: string; icon: [string, string] }
export const COMPANIES: Company[] = [
  { id: 0, name: 'Ruby Forge', icon: ['gems', 'gem_ruby'] },
  { id: 1, name: 'Slime Farms', icon: ['monsters', 'slime'] },
  { id: 2, name: 'Bell Tower', icon: ['icons', 'bell'] },
  { id: 3, name: 'Gear Works', icon: ['icons', 'gear'] },
  { id: 4, name: 'Ghost Lamps', icon: ['monsters', 'ghost'] },
  { id: 5, name: 'Scroll Press', icon: ['icons', 'scroll'] },
];

export interface Config {
  rounds: number; cash: number; startPrice: number; floor: number; rumorCost: number; publishAfter: number[]; perPublish: number;
}
export const DEFAULT_CONFIG: Config = {
  rounds: 15, cash: 100_000, startPrice: 10_000, floor: 100, rumorCost: 6_000, publishAfter: [4, 8, 12], perPublish: 2,
};

export type Orders = Record<number, number>; // company -> shares (+ buy, − sell)

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  cash: number;
  shares: number[];
  rumors: number[];        // companies whose rule this player bought
  orders: Orders | null;   // this round, null until submitted
}

export interface RoundRecord {
  round: number;
  orders: Record<string, Orders>;
  rumors: Record<string, number[]>; // private rumors bought this round
  net: number[];                    // net shares bought per company
  before: number[];
  after: number[];
  published: number[];              // companies published after this round
}

export type Phase = 'trade' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  rules: Rule[];
  round: number;
  phase: Phase;
  prices: number[];
  history: number[][];   // price after each round, starting with the opening prices
  published: number[];   // companies whose rule is public
  publishOrder: number[]; // fixed at the start so it can't be gamed
  pendingRumors: Record<string, number[]>;
  records: RoundRecord[];
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 2 || players.length > 8) throw new Error('2 to 8 players');
  const kinds = shuffle(RULE_KINDS, rng).slice(0, COMPANIES.length);
  const rules: Rule[] = kinds.map((kind, i) => {
    if (kind !== 'echo') return { kind };
    const others = COMPANIES.map((c) => c.id).filter((id) => id !== i && kinds[id] !== 'echo');
    return { kind, follows: others[Math.floor(rng() * others.length)] };
  });
  const prices = COMPANIES.map(() => config.startPrice);
  return {
    config,
    players: players.map((p) => ({ ...p, cash: config.cash, shares: COMPANIES.map(() => 0), rumors: [], orders: null })),
    rules,
    round: 1,
    phase: 'trade',
    prices,
    history: [prices],
    published: [],
    pendingRumors: {},
    records: [],
    publishOrder: shuffle(COMPANIES.map((c) => c.id), rng),
  };
}

/** What one rule does to a price this round. */
export function ruleMove(s: GameState, i: number, net: number, lastChanges: number[], rng: Rng): number {
  const p = s.prices[i];
  const r = s.rules[i];
  switch (r.kind) {
    case 'climber': return 800;
    case 'zigzag': return s.round % 2 === 1 ? 2000 : -1500;
    case 'crowd': return 200 * net;
    case 'contrarian': return -200 * net;
    case 'echo': return lastChanges[r.follows!] ?? 0;
    case 'boom': return s.round % 4 === 0 ? -Math.round(p * 0.6) : Math.round(p * 0.12);
    case 'drifter': return Math.round((rng() * 3000 - 1500) / 100) * 100;
    case 'magnet': return p > 12_000 ? -2500 : p < 8_000 ? 2500 : 1000;
  }
}

export function ruleText(s: GameState, i: number): string {
  const r = s.rules[i];
  switch (r.kind) {
    case 'climber': return 'Rises 800 every round.';
    case 'zigzag': return 'Up 2,000 on odd rounds, down 1,500 on even rounds.';
    case 'crowd': return 'Moves +200 per share the whole table bought (net) this round.';
    case 'contrarian': return 'Moves −200 per share the whole table bought (net) this round.';
    case 'echo': return `Repeats ${COMPANIES[r.follows!].name}’s move from the round before.`;
    case 'boom': return 'Grows 12% a round, but loses 60% every 4th round.';
    case 'drifter': return 'Random: moves anywhere from −1,500 to +1,500.';
    case 'magnet': return 'Above 12,000 it drops 2,500; below 8,000 it gains 2,500; otherwise +1,000.';
  }
}

export const knows = (s: GameState, viewer: string, i: number) =>
  s.published.includes(i) || s.players.find((p) => p.id === viewer)!.rumors.includes(i);

/** Cash after selling and buying, or null if the orders aren't affordable / owned. */
export function orderCash(s: GameState, id: string, orders: Orders, rumorBuys = 0): number | null {
  const p = s.players.find((x) => x.id === id)!;
  let cash = p.cash - rumorBuys * s.config.rumorCost;
  for (const [k, q] of Object.entries(orders)) {
    const i = Number(k);
    if (!Number.isInteger(q)) return null;
    if (q < 0) {
      if (-q > p.shares[i]) return null;
      cash += -q * s.prices[i];
    }
  }
  for (const [k, q] of Object.entries(orders)) if (q > 0) cash -= q * s.prices[Number(k)];
  return cash >= 0 ? cash : null;
}

export function buyRumor(s: GameState, id: string, company: number): GameState {
  const p = s.players.find((x) => x.id === id)!;
  if (s.phase !== 'trade' || p.orders) throw new Error('not now');
  if (knows(s, id, company)) throw new Error('you already know that rule');
  if (p.cash < s.config.rumorCost) throw new Error('not enough cash');
  return {
    ...s,
    players: s.players.map((x) => (x.id === id ? { ...x, cash: x.cash - s.config.rumorCost, rumors: [...x.rumors, company] } : x)),
    pendingRumors: { ...s.pendingRumors, [id]: [...(s.pendingRumors[id] ?? []), company] },
  };
}

export function submit(s: GameState, id: string, orders: Orders, rng: Rng): GameState {
  if (s.phase !== 'trade') throw new Error('match over');
  const p = s.players.find((x) => x.id === id)!;
  if (p.orders) throw new Error('already submitted');
  const clean: Orders = Object.fromEntries(Object.entries(orders).filter(([, q]) => q !== 0));
  if (orderCash(s, id, clean) === null) throw new Error('you can’t afford that (or don’t own those shares)');
  const next = { ...s, players: s.players.map((x) => (x.id === id ? { ...x, orders: clean } : x)) };
  return next.players.every((x) => x.orders) ? settle(next, rng) : next;
}

function settle(s: GameState, rng: Rng): GameState {
  const net = COMPANIES.map(() => 0);
  const players = s.players.map((p) => {
    const shares = [...p.shares];
    let cash = p.cash;
    const entries = Object.entries(p.orders!).map(([k, q]) => [Number(k), q] as const);
    for (const [i, q] of entries) if (q < 0) { shares[i] += q; cash += -q * s.prices[i]; net[i] += q; }
    for (const [i, q] of entries) if (q > 0) { shares[i] += q; cash -= q * s.prices[i]; net[i] += q; }
    return { ...p, shares, cash, orders: null };
  });
  const prev = s.history[s.history.length - 2];
  const lastChanges = prev ? s.prices.map((x, i) => x - prev[i]) : COMPANIES.map(() => 0);
  const after = s.prices.map((x, i) => Math.max(s.config.floor, x + ruleMove(s, i, net[i], lastChanges, rng)));
  const toPublish = s.config.publishAfter.includes(s.round)
    ? s.publishOrder.filter((i) => !s.published.includes(i)).slice(0, s.config.perPublish)
    : [];
  const record: RoundRecord = {
    round: s.round,
    orders: Object.fromEntries(s.players.map((p) => [p.id, p.orders!])),
    rumors: s.pendingRumors,
    net,
    before: s.prices,
    after,
    published: toPublish,
  };
  const over = s.round >= s.config.rounds;
  return {
    ...s,
    players,
    prices: after,
    history: [...s.history, after],
    published: [...s.published, ...toPublish],
    pendingRumors: {},
    records: [...s.records, record],
    round: over ? s.round : s.round + 1,
    phase: over ? 'gameOver' : 'trade',
  };
}

export const worth = (s: GameState, p: PlayerState) => p.cash + p.shares.reduce((t, n, i) => t + n * s.prices[i], 0);

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, worth: worth(s, p), seat }))
    .sort((a, b) => b.worth - a.worth || a.seat - b.seat);
}

export const money = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
