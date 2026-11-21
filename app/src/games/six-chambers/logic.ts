/**
 * SIX CHAMBERS — rules (our own deduction-and-bluff game)
 *
 * - Six seats sit around a six-chamber cylinder; each chamber faces one seat.
 *   Two chambers are loaded at random and nobody knows which. With fewer than
 *   six players, the empty seats are safe places for a round to point at.
 * - Everyone starts the round with 16 credits. Players take turns clockwise;
 *   every turn you must take one action and pay for it:
 *     Peek (public)   1  look at the chambers facing two neighbouring seats — everyone sees
 *     Peek (private)  2  same, but only you see the result
 *     Spin 1          3  turn the cylinder one seat clockwise (everyone sees)
 *     Spin 2          4  turn it two seats clockwise (everyone sees)
 *     Secret swap     6  swap the chambers facing two neighbouring seats;
 *                        others only see that you made a 6-credit secret move
 *   Players with 0 credits are skipped.
 * - When half the table (rounded up) is out of credits, the cylinder FIRES:
 *   every player facing a loaded chamber is knocked out of the round.
 *   Survivors score 1 point.
 * - A match is 3 rounds (new cylinder, full credits, the start player moves on).
 *   Most points wins (ties: more credits saved overall). Last place goes to prison.
 */
import { Rng } from '../shared/rng';

export const SEATS = 6;

export type ActionKind = 'peekPublic' | 'peekPrivate' | 'spin1' | 'spin2' | 'swap';
export const COST: Record<ActionKind, number> = { peekPublic: 1, peekPrivate: 2, spin1: 3, spin2: 4, swap: 6 };
export const NEEDS_PAIR: Record<ActionKind, boolean> = { peekPublic: true, peekPrivate: true, spin1: false, spin2: false, swap: true };

export interface Action { kind: ActionKind; seat?: number } // pair = (seat, seat+1)

/** What happened on a turn. `result` is the pair of chambers seen by a peek. */
export interface TurnEvent { player: string; kind: ActionKind; cost: number; seat?: number; result?: [boolean, boolean] }

export interface Config { rounds: number; credits: number; bullets: number }
export const DEFAULT_CONFIG: Config = { rounds: 3, credits: 16, bullets: 2 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  seat: number;
  credits: number;
  points: number;
  hits: number;
  saved: number; // credits left over when the cylinder fired, summed over rounds
}

export interface RoundRecord { round: number; chambers: boolean[]; hit: string[]; events: TurnEvent[] }

export type Phase = 'turns' | 'fired' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  chambers: boolean[]; // indexed by the seat each chamber currently faces
  turn: string | null;
  startIdx: number;
  events: TurnEvent[]; // this round
  history: RoundRecord[];
}

export const pairOf = (seat: number): [number, number] => [seat % SEATS, (seat + 1) % SEATS];
export const fireThreshold = (players: number) => Math.ceil(players / 2);

/** Spread players around the six seats as evenly as possible. */
export function seatsFor(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round((i * SEATS) / n) % SEATS);
}

function load(rng: Rng, bullets: number): boolean[] {
  const chambers = Array<boolean>(SEATS).fill(false);
  let placed = 0;
  while (placed < bullets) {
    const k = Math.floor(rng() * SEATS);
    if (!chambers[k]) {
      chambers[k] = true;
      placed++;
    }
  }
  return chambers;
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], rng: Rng, config = DEFAULT_CONFIG): GameState {
  if (players.length < 3 || players.length > SEATS) throw new Error('3 to 6 players');
  const seats = seatsFor(players.length);
  return {
    config,
    players: players.map((p, i) => ({ ...p, seat: seats[i], credits: config.credits, points: 0, hits: 0, saved: 0 })),
    round: 1,
    phase: 'turns',
    chambers: load(rng, config.bullets),
    turn: players[0].id,
    startIdx: 0,
    events: [],
    history: [],
  };
}

export function rotate(chambers: boolean[], steps: number): boolean[] {
  return chambers.map((_, k) => chambers[(k - steps + SEATS * 4) % SEATS]);
}

export function swapPair(chambers: boolean[], seat: number): boolean[] {
  const [a, b] = pairOf(seat);
  const next = [...chambers];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

export function canAfford(p: PlayerState, kind: ActionKind) {
  return p.credits >= COST[kind];
}

export function act(s: GameState, id: string, action: Action): GameState {
  if (s.phase !== 'turns' || s.turn !== id) throw new Error('not your turn');
  const p = s.players.find((x) => x.id === id)!;
  const cost = COST[action.kind];
  if (p.credits < cost) throw new Error('not enough credits');
  if (NEEDS_PAIR[action.kind] && (action.seat === undefined || action.seat < 0 || action.seat >= SEATS)) {
    throw new Error('choose two neighbouring seats');
  }
  let chambers = s.chambers;
  const ev: TurnEvent = { player: id, kind: action.kind, cost };
  if (action.kind === 'peekPublic' || action.kind === 'peekPrivate') {
    const [a, b] = pairOf(action.seat!);
    ev.seat = action.seat;
    ev.result = [chambers[a], chambers[b]];
  } else if (action.kind === 'spin1') chambers = rotate(chambers, 1);
  else if (action.kind === 'spin2') chambers = rotate(chambers, 2);
  else if (action.kind === 'swap') {
    ev.seat = action.seat;
    chambers = swapPair(chambers, action.seat!);
  }
  const players = s.players.map((x) => (x.id === id ? { ...x, credits: x.credits - cost } : x));
  const next: GameState = { ...s, players, chambers, events: [...s.events, ev] };
  const broke = players.filter((x) => x.credits === 0).length;
  if (broke >= fireThreshold(players.length)) return fire(next);
  return { ...next, turn: nextTurn(next, id) };
}

function nextTurn(s: GameState, after: string): string | null {
  const n = s.players.length;
  const i = s.players.findIndex((p) => p.id === after);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(i + k) % n];
    if (p.credits > 0) return p.id;
  }
  return null;
}

function fire(s: GameState): GameState {
  const hit = s.players.filter((p) => s.chambers[p.seat]).map((p) => p.id);
  const players = s.players.map((p) => ({
    ...p,
    points: p.points + (hit.includes(p.id) ? 0 : 1),
    hits: p.hits + (hit.includes(p.id) ? 1 : 0),
    saved: p.saved + p.credits,
  }));
  const record: RoundRecord = { round: s.round, chambers: s.chambers, hit, events: s.events };
  return { ...s, players, phase: 'fired', turn: null, history: [...s.history, record] };
}

export function nextRound(s: GameState, rng: Rng): GameState {
  if (s.phase !== 'fired') throw new Error('round not over');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  const startIdx = (s.startIdx + 1) % s.players.length;
  return {
    ...s,
    round: s.round + 1,
    phase: 'turns',
    chambers: load(rng, s.config.bullets),
    players: s.players.map((p) => ({ ...p, credits: s.config.credits })),
    startIdx,
    turn: s.players[startIdx].id,
    events: [],
  };
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => b.p.points - a.p.points || b.p.saved - a.p.saved || a.seat - b.seat)
    .map((x) => x.p);
}

/** What a viewer is allowed to know about an event. */
export function eventVisibleTo(ev: TurnEvent, viewer: string): TurnEvent {
  if (ev.player === viewer || ev.kind === 'peekPublic' || ev.kind === 'spin1' || ev.kind === 'spin2') return ev;
  return { player: ev.player, kind: ev.kind, cost: ev.cost }; // private peek / swap: no seats, no result
}
