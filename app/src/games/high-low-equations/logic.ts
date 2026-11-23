/**
 * HIGH-LOW EQUATIONS — rules (our own betting game with arithmetic)
 *
 * - Everyone starts with 40 chips. 8 hands. Most chips wins; fewest goes to prison.
 * - Number cards run 0–10 in four metals (gold > silver > bronze > iron).
 *   Everyone always holds three operator cards: +, − and ÷.
 * - Each hand everyone antes 1 and gets one HIDDEN number card and one open
 *   one. Two more open cards follow, one at a time. A betting round comes
 *   after each deal (fixed limit: 2, 2, then 4; at most 3 raises a round).
 * - SPECIAL cards come face up, and you get another card straight away:
 *     ×  you must use it — it replaces one of your +, −, ÷ (your choice)
 *     √  you must use it — put it in front of one of your numbers
 *   Nobody holds more than two specials.
 * - When betting ends, everyone still in builds an equation using ALL their
 *   number cards (and specials) with three operators, and declares:
 *     HIGH  — nearest to 20     LOW — nearest to 1
 *     SWING — both: you must win both sides, or you get nothing.
 *   × and ÷ go before + and −. Dividing by zero is not allowed.
 * - High and low split the pot. If nobody went one way, the other side takes
 *   it all. Ties: on high, the highest card wins; on low, the lowest card.
 */
import { Rng } from '../shared/rng';

export type Metal = 0 | 1 | 2 | 3;
export const METALS = ['gold', 'silver', 'bronze', 'iron'] as const;
export type Card = { kind: 'num'; value: number; metal: Metal } | { kind: 'times' } | { kind: 'root' };
export type Op = '+' | '-' | '*' | '/';
export type Side = 'high' | 'low' | 'swing';
export const TARGET = { high: 20, low: 1 } as const;

/** One number in an equation, possibly under a root. */
export interface Term { value: number; metal: Metal; root: boolean }
export interface Equation { terms: Term[]; ops: Op[] }
export interface Declaration { side: Side; high: Equation | null; low: Equation | null }

export function fullDeck(): Card[] {
  const out: Card[] = [];
  for (let v = 0; v <= 10; v++) for (let m = 0; m < 4; m++) out.push({ kind: 'num', value: v, metal: m as Metal });
  for (let i = 0; i < 4; i++) out.push({ kind: 'times' }, { kind: 'root' });
  return out;
}

// --------------------------------------------------------------- equations ----

/** Value of an equation, or null if it divides by zero. × and ÷ first, then + and −. */
export function evaluate(e: Equation): number | null {
  const vals = e.terms.map((t) => (t.root ? Math.sqrt(t.value) : t.value));
  // first pass: × and ÷
  const sums: number[] = [vals[0]];
  const addOps: Op[] = [];
  for (let i = 0; i < e.ops.length; i++) {
    const op = e.ops[i];
    const v = vals[i + 1];
    if (op === '*') sums[sums.length - 1] *= v;
    else if (op === '/') {
      if (v === 0) return null;
      sums[sums.length - 1] /= v;
    } else {
      sums.push(v);
      addOps.push(op);
    }
  }
  let total = sums[0];
  addOps.forEach((op, i) => (total = op === '+' ? total + sums[i + 1] : total - sums[i + 1]));
  return total;
}

export const numbers = (cards: Card[]) => cards.filter((c): c is Extract<Card, { kind: 'num' }> => c.kind === 'num');
export const timesCount = (cards: Card[]) => cards.filter((c) => c.kind === 'times').length;
export const rootCount = (cards: Card[]) => cards.filter((c) => c.kind === 'root').length;

/** The operators an equation may use: every ×, plus a choice of distinct +, −, ÷ to make three. */
export function opsAllowed(ops: Op[], times: number): boolean {
  if (ops.length !== 3) return false;
  if (ops.filter((o) => o === '*').length !== times) return false;
  const basic = ops.filter((o) => o !== '*');
  return new Set(basic).size === basic.length;
}

/** Does this equation use exactly the player's cards? */
export function fitsHand(e: Equation, cards: Card[]): boolean {
  const nums = numbers(cards);
  if (e.terms.length !== nums.length || e.terms.length !== 4) return false;
  const key = (v: number, m: number) => `${v}:${m}`;
  const want = nums.map((c) => key(c.value, c.metal)).sort().join();
  const got = e.terms.map((t) => key(t.value, t.metal)).sort().join();
  if (want !== got) return false;
  if (e.terms.filter((t) => t.root).length !== rootCount(cards)) return false;
  return opsAllowed(e.ops, timesCount(cards));
}

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  const out: T[][] = [];
  a.forEach((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).forEach((p) => out.push([x, ...p])));
  return out;
}

function opChoices(times: number): Op[][] {
  const basics: Op[] = ['+', '-', '/'];
  const out = new Set<string>();
  const pick = (k: number): Op[][] => (k === 0 ? [[]] : basics.flatMap((b, i) => pick(k - 1).filter((r) => !r.includes(b)).map((r) => [b, ...r])).filter(() => true));
  for (const base of pick(3 - times)) {
    const all = [...base, ...Array(times).fill('*')] as Op[];
    for (const p of permutations(all)) out.add(p.join(''));
  }
  return [...out].map((s) => s.split('') as Op[]);
}

export interface Best { dist: number; value: number; eq: Equation }
const memo = new Map<string, { high: Best | null; low: Best | null }>();

/** The best high and low equations a hand can make (null when every arrangement divides by zero). */
export function bestFor(cards: Card[]): { high: Best | null; low: Best | null } {
  const nums = numbers(cards);
  const times = timesCount(cards);
  const roots = rootCount(cards);
  const key = `${nums.map((c) => c.value).sort((a, b) => a - b).join(',')}|${times}|${roots}`;
  const hit = memo.get(key);
  if (hit) return relabel(hit, nums);
  let high: Best | null = null;
  let low: Best | null = null;
  const terms0 = nums.map((c) => ({ value: c.value, metal: c.metal }));
  const rootSets: boolean[][] = [];
  for (let mask = 0; mask < 1 << terms0.length; mask++) {
    const bits = terms0.map((_, i) => !!(mask & (1 << i)));
    if (bits.filter(Boolean).length === roots) rootSets.push(bits);
  }
  const opsList = opChoices(times);
  const seen = new Set<string>();
  for (const order of permutations(terms0)) {
    for (const rootBits of rootSets) {
      const terms = order.map((t, i) => ({ ...t, root: rootBits[i] }));
      const tk = terms.map((t) => `${t.root ? 'r' : ''}${t.value}`).join();
      if (seen.has(tk)) continue;
      seen.add(tk);
      for (const ops of opsList) {
        const eq = { terms, ops };
        const v = evaluate(eq);
        if (v === null) continue;
        const dh = Math.abs(v - TARGET.high);
        const dl = Math.abs(v - TARGET.low);
        if (!high || dh < high.dist - 1e-9) high = { dist: dh, value: v, eq };
        if (!low || dl < low.dist - 1e-9) low = { dist: dl, value: v, eq };
      }
    }
  }
  const res = { high, low };
  memo.set(key, res);
  return relabel(res, nums);
}

/** A memoised answer may name other metals for the same values: swap in this hand's cards. */
function relabel(r: { high: Best | null; low: Best | null }, nums: Extract<Card, { kind: 'num' }>[]) {
  const fix = (b: Best | null): Best | null => {
    if (!b) return null;
    const pool = [...nums];
    const terms = b.eq.terms.map((t) => {
      const i = pool.findIndex((c) => c.value === t.value);
      const c = pool.splice(i, 1)[0];
      return { ...t, metal: c.metal };
    });
    return { ...b, eq: { ...b.eq, terms } };
  };
  return { high: fix(r.high), low: fix(r.low) };
}

export function equationText(e: Equation): string {
  return e.terms.map((t, i) => `${t.root ? '√' : ''}${t.value}${i < e.ops.length ? ` ${{ '+': '+', '-': '−', '*': '×', '/': '÷' }[e.ops[i]]} ` : ''}`).join('');
}

export const fmt = (v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(2).replace(/0+$/, ''));

// ------------------------------------------------------------------ betting ----

export interface Config { hands: number; chips: number; ante: number; small: number; big: number; maxRaises: number }
export const DEFAULT_CONFIG: Config = { hands: 8, chips: 40, ante: 1, small: 2, big: 4, maxRaises: 3 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  chips: number;
  hidden: Card | null;
  open: Card[];
  folded: boolean;
  out: boolean;
  streetBet: number;
  total: number;
  declared: Declaration | null | undefined; // undefined = still to declare
}

export type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export interface ActionRecord { player: string; action: Action; amount: number; street: number }

export interface Showing { cards: Card[]; declared: Declaration; high: number | null; low: number | null }
export interface HandResult {
  hand: number;
  showings: Record<string, Showing>;
  highWinner: string | null;
  lowWinner: string | null;
  failedSwing: string[];
  winnings: Record<string, number>;
  foldWin: string | null;
  actions: ActionRecord[];
}

export type Phase = 'bet' | 'declare' | 'result' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  hand: number;
  phase: Phase;
  dealer: number;
  street: number;
  deck: Card[];
  currentBet: number;
  raises: number;
  toAct: string[];
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

export const cardsOf = (p: PlayerState): Card[] => (p.hidden ? [p.hidden, ...p.open] : [...p.open]);
export const MAX_SPECIALS = 2;

/** Deal one number card to a player; specials on the way are kept face up (up to two) and don't count. */
function dealNumber(p: PlayerState, deck: Card[]): PlayerState {
  const open = [...p.open];
  for (;;) {
    const c = deck.pop()!;
    if (c.kind === 'num') {
      open.push(c);
      return { ...p, open };
    }
    if (open.filter((x) => x.kind !== 'num').length < MAX_SPECIALS) open.push(c);
  }
}

export const pot = (s: GameState) => s.players.reduce((t, p) => t + p.total, 0);
export const live = (s: GameState) => s.players.filter((p) => !p.out && !p.folded);
const canAct = (p: PlayerState) => !p.out && !p.folded && p.chips > 0;
export const betSize = (s: GameState) => (s.street < 2 ? s.config.small : s.config.big);
export const currentTurn = (s: GameState) => (s.phase === 'bet' ? s.toAct[0] ?? null : null);

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
    if (out) return { ...p, out, hidden: null, open: [], folded: true, streetBet: 0, total: 0, declared: null };
    const ante = Math.min(s.config.ante, p.chips);
    // the hidden card is always a number
    let hidden: Card = deck.pop()!;
    while (hidden.kind !== 'num') {
      deck.unshift(hidden);
      hidden = deck.pop()!;
    }
    const q = { ...p, out, hidden, open: [], folded: false, streetBet: 0, total: ante, chips: p.chips - ante, declared: undefined };
    return dealNumber(q, deck);
  });
  return startStreet({ ...s, players, deck, street: 0, currentBet: 0, raises: 0, actions: [], phase: 'bet' });
}

function startStreet(s: GameState): GameState {
  const players = s.players.map((p) => ({ ...p, streetBet: 0 }));
  const next = { ...s, players, currentBet: 0, raises: 0 };
  const toAct = order(next, next.dealer, canAct);
  if (live(next).length > 1 && next.players.filter(canAct).length <= 1) return advanceStreet({ ...next, toAct: [] });
  return { ...next, toAct };
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('2 to 6 players');
  const base: GameState = {
    config,
    players: players.map((p) => ({ ...p, chips: config.chips, hidden: null, open: [], folded: false, out: false, streetBet: 0, total: 0, declared: undefined })),
    hand: 1, phase: 'bet', dealer: 0, street: 0, deck: [], currentBet: 0, raises: 0, toAct: [], actions: [], results: [],
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
    const seat = s.players.findIndex((p) => p.id === id);
    toAct = order({ ...s, players }, seat, (p) => canAct(p) && p.id !== id);
  }
  const next: GameState = { ...s, players, currentBet, raises, toAct, actions: [...s.actions, { player: id, action, amount, street: s.street }] };
  if (live(next).length === 1) return finishHand(next);
  if (!toAct.length) return advanceStreet(next);
  return next;
}

function advanceStreet(s: GameState): GameState {
  if (s.street >= 2) return { ...s, phase: 'declare', toAct: [] };
  const deck = [...s.deck];
  const players = s.players.map((p) => (p.out || p.folded ? p : dealNumber(p, deck)));
  return startStreet({ ...s, deck, players, street: s.street + 1 });
}

export const declarers = (s: GameState) => (s.phase === 'declare' ? live(s).filter((p) => p.declared === undefined).map((p) => p.id) : []);

export function validDeclaration(d: Declaration, cards: Card[]): boolean {
  const ok = (e: Equation | null) => !!e && fitsHand(e, cards) && evaluate(e) !== null;
  if (d.side === 'high') return ok(d.high);
  if (d.side === 'low') return ok(d.low);
  return ok(d.high) && ok(d.low);
}

export function declare(s: GameState, id: string, d: Declaration): GameState {
  if (!declarers(s).includes(id)) throw new Error('you cannot declare now');
  const p = s.players.find((x) => x.id === id)!;
  if (!validDeclaration(d, cardsOf(p))) throw new Error('that equation does not use exactly your cards');
  const clean: Declaration = { side: d.side, high: d.side === 'low' ? null : d.high, low: d.side === 'high' ? null : d.low };
  const next = { ...s, players: s.players.map((x) => (x.id === id ? { ...x, declared: clean } : x)) };
  return declarers(next).length ? next : finishHand(next);
}

// ---------------------------------------------------------------- showdown ----

const numCards = (p: PlayerState) => numbers(cardsOf(p));
/** Card order for ties: higher value first, then gold > silver > bronze > iron. */
const cardRank = (c: { value: number; metal: Metal }) => c.value * 4 + (3 - c.metal);
const topCard = (p: PlayerState) => Math.max(...numCards(p).map(cardRank));
/** For low ties the lowest value wins; at the same value the better metal wins. */
const bottomCard = (p: PlayerState) => Math.min(...numCards(p).map((c) => c.value * 4 + c.metal));

interface Entry { p: PlayerState; side: Side; high: number | null; low: number | null }

function bestOf(entries: Entry[], which: 'high' | 'low'): Entry | null {
  const t = TARGET[which];
  let best: Entry | null = null;
  for (const e of entries) {
    const v = e[which];
    if (v === null) continue;
    if (!best) { best = e; continue; }
    const d = Math.abs(v - t);
    const bd = Math.abs(best[which]! - t);
    if (d < bd - 1e-9) best = e;
    else if (Math.abs(d - bd) <= 1e-9) {
      if (which === 'high' ? topCard(e.p) > topCard(best.p) : bottomCard(e.p) < bottomCard(best.p)) best = e;
    }
  }
  return best;
}

/** Who wins high and low among these players; swingers who don't win both drop out. */
function decide(entries: Entry[]): { high: string | null; low: string | null; failed: string[] } {
  let pool = entries;
  const failed: string[] = [];
  for (;;) {
    const highs = pool.filter((e) => e.side !== 'low');
    const lows = pool.filter((e) => e.side !== 'high');
    const h = bestOf(highs, 'high');
    const l = bestOf(lows, 'low');
    const bad = pool.filter((e) => e.side === 'swing' && !(h?.p.id === e.p.id && l?.p.id === e.p.id));
    if (!bad.length) return { high: h?.p.id ?? null, low: l?.p.id ?? null, failed };
    failed.push(...bad.map((e) => e.p.id));
    pool = pool.filter((e) => !bad.includes(e));
  }
}

function finishHand(s: GameState): GameState {
  const contenders = live(s);
  const winnings: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const showings: Record<string, Showing> = {};
  let highWinner: string | null = null;
  let lowWinner: string | null = null;
  let failedSwing: string[] = [];
  let foldWin: string | null = null;

  if (contenders.length === 1) {
    foldWin = contenders[0].id;
    winnings[foldWin] = pot(s);
  } else {
    const entries: Entry[] = contenders.map((p) => {
      const d = p.declared!;
      const high = d.high ? evaluate(d.high) : null;
      const low = d.low ? evaluate(d.low) : null;
      showings[p.id] = { cards: cardsOf(p), declared: d, high, low };
      return { p, side: d.side, high, low };
    });
    // side pots by contribution level
    const levels = [...new Set(s.players.map((p) => p.total).filter((t) => t > 0))].sort((a, b) => a - b);
    let prev = 0;
    let first = true;
    for (const level of levels) {
      const layer = s.players.reduce((t, p) => t + Math.max(0, Math.min(p.total, level) - prev), 0);
      const eligible = entries.filter((e) => e.p.total >= level);
      prev = level;
      if (!eligible.length) {
        // only folded money above everyone still in: it goes back to the best high
        const top = bestOf(entries, 'high') ?? entries[0];
        winnings[top.p.id] += layer;
        continue;
      }
      const r = decide(eligible);
      if (first) {
        highWinner = r.high;
        lowWinner = r.low;
        failedSwing = r.failed;
        first = false;
      }
      const hw = r.high ?? r.low;
      const lw = r.low ?? r.high;
      if (!hw || !lw) {
        // everyone eligible was a failed swinger: closest to 20 takes it
        winnings[bestOf(eligible, 'high')!.p.id] += layer;
        continue;
      }
      const half = Math.floor(layer / 2);
      winnings[hw] += layer - half;
      winnings[lw] += half;
    }
  }

  const players = s.players.map((p) => ({ ...p, chips: p.chips + winnings[p.id], streetBet: 0, total: 0 }));
  const result: HandResult = { hand: s.hand, showings, highWinner, lowWinner, failedSwing, winnings, foldWin, actions: s.actions };
  return { ...s, players, phase: 'result', toAct: [], results: [...s.results, result] };
}

export function nextHand(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'result') throw new Error('hand not over');
  const alive = s.players.filter((p) => p.chips > 0);
  if (s.hand >= s.config.hands || alive.length <= 1) return { ...s, phase: 'gameOver' };
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
  return s.players.map((p, seat) => ({ ...p, seat })).sort((a, b) => b.chips - a.chips || a.seat - b.seat);
}
