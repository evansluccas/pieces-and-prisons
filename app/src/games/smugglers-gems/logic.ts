/**
 * SMUGGLER'S GEMS — rules (our own blind gem-trading game)
 *
 * - 3 rounds. Each round the cards in play are ANNOUNCED to everyone: two
 *   bombs (−6 and −4) plus gem cards (diamond, gold, silver, copper, each with
 *   a value). They are dealt face down: 1 to each player, 3 to the BUYER row,
 *   1 to the DISCARD. You only see your own card.
 * - EXCHANGES: in order (start player → last, then back), every player gets
 *   two turns. On a turn you either PASS or blindly SWAP your card with:
 *   another player, one Buyer card, or the Discard. A bomb can only be swapped
 *   with another player — never into the Buyer row or the Discard.
 *   Everyone sees who swapped with what, but not the cards.
 * - PEEK: once per match, on your turn, you may look at one Buyer or Discard
 *   card (it doesn't use your turn).
 * - SCORING: the Buyer row is revealed. A gem scores its value × the number of
 *   Buyer cards of the same kind (no match = 0). A bomb costs its value.
 *   The −6 bomb's holder starts the next round.
 * - SECRET PARTNER: everyone is secretly given another player; at the end
 *   your partner's total is ADDED to yours. Highest final score wins; last
 *   place goes to prison.
 */
import { Rng } from '../shared/rng';

export type Kind = 'diamond' | 'gold' | 'silver' | 'copper' | 'bomb';
export interface Card { id: number; kind: Kind; value: number }

export const GEM_POOL: [Kind, number][] = [
  ['diamond', 6], ['diamond', 5], ['gold', 5], ['gold', 4], ['silver', 4], ['silver', 3], ['silver', 2],
  ['copper', 2], ['copper', 2], ['copper', 1], ['copper', 1],
];
export const BUYER = ['buyer0', 'buyer1', 'buyer2'] as const;
export const DISCARD = 'discard';

export interface Config { rounds: number }
export const DEFAULT_CONFIG: Config = { rounds: 3 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  partner: string;
  total: number;
  peeked: boolean;
}

/** A turn. `gave`/`got` are only visible to the two sides of a swap. */
export interface TurnEvent {
  player: string;
  kind: 'swap' | 'pass' | 'peek';
  target?: string;
  gave?: Card;
  got?: Card;
  seen?: Card; // peek result
}

export interface RoundRecord { round: number; hands: Record<string, Card>; scores: Record<string, number> }

export type Phase = 'exchange' | 'reveal' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  deck: Card[];                 // this round's cards (public list)
  hands: Record<string, Card>;  // location -> card (players, buyers, discard)
  order: string[];
  turnIdx: number;
  startSeat: number;
  events: TurnEvent[];
  history: RoundRecord[];
}

export const isPlayer = (s: GameState, loc: string) => s.players.some((p) => p.id === loc);
export const locations = (s: GameState) => [...s.players.map((p) => p.id), ...BUYER, DISCARD];
export const currentTurn = (s: GameState) => (s.phase === 'exchange' ? s.order[s.turnIdx] : null);

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(s: GameState, rng: Rng): GameState {
  const n = s.players.length;
  const gems = shuffle(GEM_POOL, rng).slice(0, n + 2);
  const deck: Card[] = [['bomb', 6] as [Kind, number], ['bomb', 4] as [Kind, number], ...gems]
    .map(([kind, value], id) => ({ id, kind, value }))
    .sort((a, b) => (a.kind === b.kind ? b.value - a.value : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
  const cards = shuffle(deck, rng);
  const hands: Record<string, Card> = {};
  [...s.players.map((p) => p.id), ...BUYER, DISCARD].forEach((loc, i) => (hands[loc] = cards[i]));
  const seats = s.players.map((_, i) => s.players[(s.startSeat + i) % n].id);
  return { ...s, deck, hands, order: [...seats, ...[...seats].reverse()], turnIdx: 0, events: [], phase: 'exchange' };
}

export const KIND_ORDER: Kind[] = ['diamond', 'gold', 'silver', 'copper', 'bomb'];

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 3 || players.length > 6) throw new Error('3 to 6 players');
  // partners form one secret cycle, so nobody is their own partner
  const cycle = shuffle(players.map((p) => p.id), rng);
  const partnerOf = Object.fromEntries(cycle.map((id, i) => [id, cycle[(i + 1) % cycle.length]]));
  const base: GameState = {
    config,
    players: players.map((p) => ({ ...p, partner: partnerOf[p.id], total: 0, peeked: false })),
    round: 1, phase: 'exchange', deck: [], hands: {}, order: [], turnIdx: 0, startSeat: 0, events: [], history: [],
  };
  return deal(base, rng);
}

export function canSwapWith(s: GameState, id: string, target: string): boolean {
  if (target === id || !(target in s.hands)) return false;
  return s.hands[id].kind !== 'bomb' || isPlayer(s, target);
}

export function swap(s: GameState, id: string, target: string): GameState {
  if (currentTurn(s) !== id) throw new Error('not your turn');
  if (!canSwapWith(s, id, target)) throw new Error(s.hands[id].kind === 'bomb' ? 'a bomb can only go to a player' : 'invalid target');
  const gave = s.hands[id];
  const got = s.hands[target];
  const hands = { ...s.hands, [id]: got, [target]: gave };
  return advance({ ...s, hands, events: [...s.events, { player: id, kind: 'swap', target, gave, got }] });
}

export function pass(s: GameState, id: string): GameState {
  if (currentTurn(s) !== id) throw new Error('not your turn');
  return advance({ ...s, events: [...s.events, { player: id, kind: 'pass' }] });
}

export function peek(s: GameState, id: string, loc: string): GameState {
  if (currentTurn(s) !== id) throw new Error('not your turn');
  const p = s.players.find((x) => x.id === id)!;
  if (p.peeked) throw new Error('you already used your peek');
  if (![...BUYER, DISCARD].includes(loc as never)) throw new Error('peek at a Buyer or Discard card');
  return {
    ...s,
    players: s.players.map((x) => (x.id === id ? { ...x, peeked: true } : x)),
    events: [...s.events, { player: id, kind: 'peek', target: loc, seen: s.hands[loc] }],
  };
}

/** Points a hand scores against a Buyer row. */
export function cardScore(card: Card, buyer: Card[]): number {
  if (card.kind === 'bomb') return -card.value;
  return card.value * buyer.filter((b) => b.kind === card.kind).length;
}

function advance(s: GameState): GameState {
  const turnIdx = s.turnIdx + 1;
  if (turnIdx < s.order.length) return { ...s, turnIdx };
  const buyer = BUYER.map((b) => s.hands[b]);
  const scores = Object.fromEntries(s.players.map((p) => [p.id, cardScore(s.hands[p.id], buyer)]));
  const bomb6 = s.players.findIndex((p) => s.hands[p.id].kind === 'bomb' && s.hands[p.id].value === 6);
  return {
    ...s,
    turnIdx,
    phase: 'reveal',
    players: s.players.map((p) => ({ ...p, total: p.total + scores[p.id] })),
    startSeat: bomb6 >= 0 ? bomb6 : (s.startSeat + 1) % s.players.length,
    history: [...s.history, { round: s.round, hands: s.hands, scores }],
  };
}

export function nextRound(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'reveal') throw new Error('round not over');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  return deal({ ...s, round: s.round + 1 }, rng);
}

export function finalScore(s: GameState, id: string): number {
  const p = s.players.find((x) => x.id === id)!;
  return p.total + s.players.find((x) => x.id === p.partner)!.total;
}

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, final: finalScore(s, p.id), seat }))
    .sort((a, b) => b.final - a.final || b.total - a.total || a.seat - b.seat);
}

// ---------------------------------------------------------- knowledge ----

/**
 * Which card `viewer` knows is at each location. Knowledge moves with the
 * cards: when anyone swaps A↔B, what you knew about A is now true of B.
 */
export function knownCards(s: GameState, viewer: string): Record<string, Card | null> {
  const know: Record<string, Card | null> = Object.fromEntries(locations(s).map((l) => [l, null]));
  // your starting card: the card you held before your first swap involvement
  know[viewer] = startingCard(s, viewer);
  for (const e of s.events) {
    if (e.kind === 'peek') {
      if (e.player === viewer) know[e.target!] = e.seen!;
      continue;
    }
    if (e.kind !== 'swap') continue;
    const a = e.player;
    const b = e.target!;
    if (a === viewer) {
      know[b] = e.gave!;
      know[a] = e.got!;
    } else if (b === viewer) {
      know[a] = e.got!;
      know[b] = e.gave!;
    } else {
      [know[a], know[b]] = [know[b], know[a]];
    }
  }
  know[viewer] = s.hands[viewer]; // you can always look at your own card
  return know;
}

function startingCard(s: GameState, viewer: string): Card {
  // walk the events backwards from the current hands to recover the dealt card
  const hands = { ...s.hands };
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.kind !== 'swap') continue;
    [hands[e.player], hands[e.target!]] = [hands[e.target!], hands[e.player]];
  }
  return hands[viewer];
}

/** What a viewer may see of an event. */
export function visibleEvent(e: TurnEvent, viewer: string): TurnEvent {
  if (e.kind === 'peek') return e.player === viewer ? e : { player: e.player, kind: 'peek' };
  if (e.kind === 'swap' && e.player !== viewer && e.target !== viewer) return { player: e.player, kind: 'swap', target: e.target };
  return e;
}

export const cardName = (c: Card) => (c.kind === 'bomb' ? `Bomb −${c.value}` : `${c.kind[0].toUpperCase()}${c.kind.slice(1)} ${c.value}`);
export const cardSprite = (c: Card) => (c.kind === 'bomb' ? `gem_bomb_${c.value}` : `gem_${c.kind}_${c.value}`);
