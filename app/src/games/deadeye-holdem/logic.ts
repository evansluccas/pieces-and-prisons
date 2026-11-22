/**
 * DEADEYE HOLD'EM — rules (our own sniping poker variant)
 *
 * - Everyone starts with 60 chips; 75 is the SAFE line. 10 hands.
 * - Each hand everyone antes 1 and gets 2 private cards. Only FOUR shared
 *   cards come out: 3 after the first betting round, 1 after the second.
 *   Your hand is the best five of your six cards.
 * - BETTING (fixed limit): check, bet, call, raise or fold. Bets are 2 chips
 *   in the first two rounds and 4 in the last; at most 3 raises per round.
 *   If you can't cover a call you go all-in and can only win what you matched.
 * - SNIPE: after the last betting round, everyone still in secretly names one
 *   exact hand — e.g. "Flush, A-high" or "Pair of 9s" — or passes.
 *   Any hand matching a snipe can't win the showdown.
 * - SHOWDOWN: the best hand that wasn't sniped wins the pot. If every hand in
 *   contention was sniped, that pot carries over to the next hand.
 * - Most chips after 10 hands wins; fewest goes to prison. Out of chips = out.
 */
import { Rng } from '../shared/rng';
import { Card, HandValue, bestHand, compare, fullDeck, handName } from './cards';

export interface Config { hands: number; chips: number; safe: number; ante: number; small: number; big: number; maxRaises: number }
export const DEFAULT_CONFIG: Config = { hands: 10, chips: 60, safe: 75, ante: 1, small: 2, big: 4, maxRaises: 3 };

export interface Snipe { cat: number; key: number }

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  chips: number;
  hole: Card[];
  folded: boolean;
  out: boolean;          // no chips left: sits out
  streetBet: number;     // put in this betting round
  total: number;         // put in this hand (for side pots)
  snipe: Snipe | null | undefined; // undefined = not chosen yet, null = passed
}

export type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export interface ActionRecord { player: string; action: Action; amount: number; street: number }

export interface HandResult {
  hand: number;
  board: Card[];
  holes: Record<string, Card[]>;   // only players who reached showdown
  values: Record<string, HandValue>;
  snipes: Record<string, Snipe | null>;
  sniped: string[];                 // players whose hand matched a snipe
  winnings: Record<string, number>;
  carried: number;                  // chips carried to the next hand
  foldWin: string | null;           // everyone else folded
  actions: ActionRecord[];
}

export type Phase = 'bet' | 'snipe' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  hand: number;
  phase: Phase;
  dealer: number;
  street: number;          // 0 = before the shared cards, 1 = 3 cards out, 2 = 4 cards out
  board: Card[];
  deck: Card[];
  carry: number;           // pot carried from a fully sniped hand
  currentBet: number;
  raises: number;
  toAct: string[];         // players who still need to act this round (in order)
  actions: ActionRecord[];
  results: HandResult[];
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pot = (s: GameState) => s.carry + s.players.reduce((t, p) => t + p.total, 0);
export const live = (s: GameState) => s.players.filter((p) => !p.out && !p.folded);
const canAct = (p: PlayerState) => !p.out && !p.folded && p.chips > 0;
export const betSize = (s: GameState) => (s.street < 2 ? s.config.small : s.config.big);
export const currentTurn = (s: GameState) => (s.phase === 'bet' ? s.toAct[0] ?? null : null);

/** Seats after `from`, going around once, that pass `ok`. */
function order(s: GameState, from: number, ok: (p: PlayerState) => boolean): string[] {
  const n = s.players.length;
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const p = s.players[(from + k) % n];
    if (ok(p)) out.push(p.id);
  }
  return out;
}

function deal(s: GameState, rng: Rng): GameState {
  const deck = shuffle(fullDeck(), rng);
  const players = s.players.map((p) => {
    const out = p.chips <= 0;
    if (out) return { ...p, out, hole: [], folded: true, streetBet: 0, total: 0, snipe: null };
    const ante = Math.min(s.config.ante, p.chips);
    return { ...p, out, hole: [deck.pop()!, deck.pop()!], folded: false, streetBet: 0, total: ante, chips: p.chips - ante, snipe: undefined };
  });
  const next: GameState = { ...s, players, deck, board: [], street: 0, currentBet: 0, raises: 0, actions: [], phase: 'bet' };
  return startStreet(next);
}

function startStreet(s: GameState): GameState {
  const players = s.players.map((p) => ({ ...p, streetBet: 0 }));
  const next = { ...s, players, currentBet: 0, raises: 0 };
  const toAct = order(next, next.dealer, canAct);
  // nobody (or only one player) can still bet: run out the board
  if (live(next).length > 1 && toAct.length <= 1 && next.players.filter(canAct).length <= 1) {
    return advanceStreet({ ...next, toAct: [] });
  }
  return { ...next, toAct };
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('2 to 6 players');
  const base: GameState = {
    config,
    players: players.map((p) => ({ ...p, chips: config.chips, hole: [], folded: false, out: false, streetBet: 0, total: 0, snipe: undefined })),
    hand: 1, phase: 'bet', dealer: 0, street: 0, board: [], deck: [], carry: 0, currentBet: 0, raises: 0, toAct: [], actions: [], results: [],
  };
  return deal(base, rng);
}

export function legalActions(s: GameState, id: string): { action: Action; amount: number }[] {
  if (currentTurn(s) !== id) return [];
  const p = s.players.find((x) => x.id === id)!;
  const owe = s.currentBet - p.streetBet;
  const out: { action: Action; amount: number }[] = [];
  if (owe > 0) {
    out.push({ action: 'fold', amount: 0 });
    out.push({ action: 'call', amount: Math.min(owe, p.chips) });
    if (s.raises < s.config.maxRaises && p.chips > owe) out.push({ action: 'raise', amount: Math.min(owe + betSize(s), p.chips) });
  } else {
    out.push({ action: 'check', amount: 0 });
    if (s.raises < s.config.maxRaises) out.push({ action: 'bet', amount: Math.min(betSize(s), p.chips) });
  }
  return out;
}

export function act(s: GameState, id: string, action: Action): GameState {
  const legal = legalActions(s, id).find((a) => a.action === action);
  if (!legal) throw new Error('not a legal action');
  const amount = legal.amount;
  const players = s.players.map((p) =>
    p.id === id
      ? { ...p, chips: p.chips - amount, streetBet: p.streetBet + amount, total: p.total + amount, folded: action === 'fold' ? true : p.folded }
      : p,
  );
  const me = players.find((p) => p.id === id)!;
  let { currentBet, raises } = s;
  let toAct = s.toAct.slice(1);
  if (action === 'bet' || action === 'raise') {
    currentBet = Math.max(currentBet, me.streetBet);
    raises++;
    // everyone else still able to act must respond, in seat order after me
    const seat = s.players.findIndex((p) => p.id === id);
    toAct = order({ ...s, players }, seat, (p) => canAct(p) && p.id !== id);
  }
  const next: GameState = {
    ...s, players, currentBet, raises, toAct,
    actions: [...s.actions, { player: id, action, amount, street: s.street }],
  };
  if (live(next).length === 1) return finishHand(next);
  if (!toAct.length) return advanceStreet(next);
  return next;
}

function advanceStreet(s: GameState): GameState {
  if (s.street >= 2) {
    // snipes: everyone still in names a hand (players already all-in too)
    return { ...s, phase: 'snipe', toAct: [] };
  }
  const deck = [...s.deck];
  const add = s.street === 0 ? 3 : 1;
  const board = [...s.board, ...Array.from({ length: add }, () => deck.pop()!)];
  return startStreet({ ...s, deck, board, street: s.street + 1 });
}

export const snipers = (s: GameState) => (s.phase === 'snipe' ? live(s).filter((p) => p.snipe === undefined).map((p) => p.id) : []);

export function snipe(s: GameState, id: string, target: Snipe | null): GameState {
  if (!snipers(s).includes(id)) throw new Error('you cannot snipe now');
  if (target && (target.cat < 0 || target.cat > 8 || target.key < 2 || target.key > 14)) throw new Error('not a hand');
  const next = { ...s, players: s.players.map((p) => (p.id === id ? { ...p, snipe: target } : p)) };
  return snipers(next).length ? next : finishHand(next);
}

export const matches = (v: HandValue, t: Snipe) => v.cat === t.cat && v.key === t.key;

function finishHand(s: GameState): GameState {
  const contenders = live(s);
  const winnings: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const values: Record<string, HandValue> = {};
  const holes: Record<string, Card[]> = {};
  const snipes: Record<string, Snipe | null> = {};
  let sniped: string[] = [];
  let carried = 0;
  let foldWin: string | null = null;

  if (contenders.length === 1) {
    foldWin = contenders[0].id;
    winnings[foldWin] = pot(s);
  } else {
    for (const p of contenders) {
      values[p.id] = bestHand([...p.hole, ...s.board]);
      holes[p.id] = p.hole;
      snipes[p.id] = p.snipe ?? null;
    }
    const shots = Object.values(snipes).filter(Boolean) as Snipe[];
    sniped = contenders.filter((p) => shots.some((t) => matches(values[p.id], t))).map((p) => p.id);
    // side pots by contribution level
    const levels = [...new Set(s.players.map((p) => p.total).filter((t) => t > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const level of levels) {
      const layer = s.players.reduce((t, p) => t + Math.max(0, Math.min(p.total, level) - prev), 0) + (prev === 0 ? s.carry : 0);
      const eligible = contenders.filter((p) => p.total >= level && !sniped.includes(p.id));
      if (!eligible.length) carried += layer;
      else {
        const best = eligible.reduce((b, p) => (compare(values[p.id], values[b.id]) > 0 ? p : b));
        const winners = eligible.filter((p) => compare(values[p.id], values[best.id]) === 0);
        const share = Math.floor(layer / winners.length);
        winners.forEach((w) => (winnings[w.id] += share));
        winnings[winners[0].id] += layer - share * winners.length;
      }
      prev = level;
    }
    if (!levels.length) carried += s.carry;
  }

  const players = s.players.map((p) => ({ ...p, chips: p.chips + winnings[p.id], streetBet: 0, total: 0 }));
  const result: HandResult = {
    hand: s.hand, board: s.board, holes, values, snipes, sniped, winnings, carried, foldWin, actions: s.actions,
  };
  return { ...s, players, carry: carried, phase: 'result', toAct: [], results: [...s.results, result] };
}

export function nextHand(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'result') throw new Error('hand not over');
  const alive = s.players.filter((p) => p.chips > 0);
  if (s.hand >= s.config.hands || alive.length <= 1) return { ...s, phase: 'gameOver' };
  // the dealer button moves to the next player who still has chips
  let dealer = s.dealer;
  for (let k = 1; k <= s.players.length; k++) {
    const i = (s.dealer + k) % s.players.length;
    if (s.players[i].chips > 0) {
      dealer = i;
      break;
    }
  }
  return deal({ ...s, hand: s.hand + 1, dealer }, rng);
}

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, seat, safe: p.chips >= s.config.safe }))
    .sort((a, b) => b.chips - a.chips || a.seat - b.seat);
}

export const snipeName = (t: Snipe) => handName({ cat: t.cat, key: t.key });
