/**
 * TRI-MANCALA — rules (our own three-colour mancala for 2–4 players)
 *
 * - The board is one ring. Each player owns 4 pits followed by their STORE.
 *   Every pit starts with 3 stones; stones come in three colours: red, blue
 *   and gold (each player's pits hold four of each).
 * - On your turn, empty one of your pits into your hand and choose the ORDER
 *   of the stones. Sow them one by one into the following slots around the
 *   ring, skipping other players' stores. Stones in your store are yours.
 * - Last stone in your own store: take another turn.
 * - Last stone in a RIVAL's pit that now holds 2 or 3 stones: capture them,
 *   and keep going backwards through that rival's pits while they also hold
 *   2 or 3. Captured stones go to your store.
 * - The game ends when the player to move has no stones in their pits, or
 *   after 12 rounds. Stones left in pits go to the store of the pit's owner.
 * - SCORE: your WEAKEST colour — the smallest of your red, blue and gold
 *   counts. Ties go to the most stones, then to whoever sat earlier.
 */
import { Rng } from '../shared/rng';

export type Colour = 0 | 1 | 2;
export const COLOURS = ['red', 'blue', 'gold'] as const;
export const PITS = 4;
export const SEG = PITS + 1; // pits + store
export const ROUNDS = 12;

export interface PlayerState { id: string; name: string; isBot: boolean }

export interface Sow {
  player: number;
  pit: number;
  order: Colour[];
  path: number[];        // slots that got a stone, in order
  extra: boolean;
  captured: number[];    // slots captured from
  capturedStones: Colour[];
}

export interface GameState {
  players: PlayerState[];
  slots: Colour[][];     // stones in each slot of the ring (pits and stores)
  turn: number;
  round: number;
  rounds: number;
  over: boolean;
  history: Sow[];
}

export const storeOf = (p: number) => p * SEG + PITS;
export const pitsOf = (p: number) => Array.from({ length: PITS }, (_, i) => p * SEG + i);
export const ownerOf = (slot: number) => Math.floor(slot / SEG);
export const isStore = (slot: number) => slot % SEG === PITS;

export function newGame(players: PlayerState[], rng: Rng, rounds = ROUNDS): GameState {
  if (players.length < 2 || players.length > 4) throw new Error('2 to 4 players');
  const slots: Colour[][] = Array.from({ length: players.length * SEG }, () => []);
  players.forEach((_, p) => {
    const bag: Colour[] = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    pitsOf(p).forEach((slot, k) => (slots[slot] = bag.slice(k * 3, k * 3 + 3)));
  });
  return { players, slots, turn: 0, round: 1, rounds, over: false, history: [] };
}

/** Same colours, any order? */
export function sameStones(a: Colour[], b: Colour[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export const canPlay = (s: GameState, p: number) => pitsOf(p).some((slot) => s.slots[slot].length > 0);

/** Sow a pit with the stones in the given order. */
export function sow(s: GameState, player: number, pit: number, order: Colour[]): GameState {
  if (s.over || s.turn !== player) throw new Error('not your turn');
  if (ownerOf(pit) !== player || isStore(pit)) throw new Error('pick one of your own pits');
  if (!s.slots[pit].length) throw new Error('that pit is empty');
  if (!sameStones(order, s.slots[pit])) throw new Error('sow exactly the stones in that pit');
  const slots = s.slots.map((x) => [...x]);
  const n = slots.length;
  slots[pit] = [];
  const path: number[] = [];
  let at = pit;
  for (const stone of order) {
    do at = (at + 1) % n;
    while (isStore(at) && ownerOf(at) !== player);
    slots[at].push(stone);
    path.push(at);
  }
  const last = at;
  const extra = last === storeOf(player);
  // captures: backwards through the rival's pits holding 2 or 3
  const captured: number[] = [];
  const capturedStones: Colour[] = [];
  if (!isStore(last) && ownerOf(last) !== player) {
    const rival = ownerOf(last);
    let slot = last;
    while (ownerOf(slot) === rival && !isStore(slot) && (slots[slot].length === 2 || slots[slot].length === 3)) {
      captured.push(slot);
      capturedStones.push(...slots[slot]);
      slots[slot] = [];
      slot = (slot - 1 + n) % n;
    }
    slots[storeOf(player)].push(...capturedStones);
  }
  const record: Sow = { player, pit, order, path, extra, captured, capturedStones };
  const next = { ...s, slots, history: [...s.history, record] };
  return extra ? checkEnd({ ...next }) : advance(next);
}

function advance(s: GameState): GameState {
  const turn = (s.turn + 1) % s.players.length;
  const round = turn === 0 ? s.round + 1 : s.round;
  if (round > s.rounds) return finish({ ...s, turn });
  return checkEnd({ ...s, turn, round });
}

function checkEnd(s: GameState): GameState {
  return canPlay(s, s.turn) ? s : finish(s);
}

/** Stones left in pits go to their owners. */
function finish(s: GameState): GameState {
  const slots = s.slots.map((x) => [...x]);
  for (let slot = 0; slot < slots.length; slot++) {
    if (isStore(slot) || !slots[slot].length) continue;
    slots[storeOf(ownerOf(slot))].push(...slots[slot]);
    slots[slot] = [];
  }
  return { ...s, slots, over: true };
}

export const counts = (stones: Colour[]): [number, number, number] =>
  [0, 1, 2].map((c) => stones.filter((x) => x === c).length) as [number, number, number];

export const score = (s: GameState, p: number) => Math.min(...counts(s.slots[storeOf(p)]));
export const total = (s: GameState, p: number) => s.slots[storeOf(p)].length;

export function standings(s: GameState) {
  return s.players
    .map((p, seat) => ({ ...p, seat, score: score(s, seat), total: total(s, seat), counts: counts(s.slots[storeOf(seat)]) }))
    .sort((a, b) => b.score - a.score || b.total - a.total || a.seat - b.seat);
}

/** Every distinct order of a set of stones (capped, so a huge pit stays quick). */
export function orders(stones: Colour[], cap = 600): Colour[][] {
  const [r, b, g] = counts(stones);
  const out: Colour[][] = [];
  const go = (left: [number, number, number], acc: Colour[]) => {
    if (out.length >= cap) return;
    if (acc.length === stones.length) return void out.push([...acc]);
    for (const c of [0, 1, 2] as Colour[]) {
      if (!left[c]) continue;
      left[c]--;
      acc.push(c);
      go(left, acc);
      acc.pop();
      left[c]++;
    }
  };
  go([r, b, g], []);
  return out;
}

/** Where each stone of a pit would land (same skipping as sowing). */
export function landing(s: GameState, player: number, pit: number, count = s.slots[pit].length): number[] {
  const out: number[] = [];
  let at = pit;
  for (let i = 0; i < count; i++) {
    do at = (at + 1) % s.slots.length;
    while (isStore(at) && ownerOf(at) !== player);
    out.push(at);
  }
  return out;
}
