/**
 * What a single player can deduce about the cylinder, using only what they
 * are allowed to see. Used by bots to decide and by the screen to show your
 * own "notes" — nobody gets information they didn't earn.
 *
 * We keep a probability over every possible loading (which seats face a loaded
 * chamber) and replay the round's events from that player's point of view.
 */
import { SEATS, TurnEvent, pairOf, rotate, swapPair } from './logic';

export type Belief = Map<number, number>; // bitmask of loaded seats -> probability

const bits = (mask: number) => Array.from({ length: SEATS }, (_, k) => ((mask >> k) & 1) === 1);
const toMask = (chambers: boolean[]) => chambers.reduce((m, b, k) => m | (b ? 1 << k : 0), 0);
const popcount = (m: number) => bits(m).filter(Boolean).length;

export function initialBelief(bullets: number): Belief {
  const masks = Array.from({ length: 1 << SEATS }, (_, m) => m).filter((m) => popcount(m) === bullets);
  return new Map(masks.map((m) => [m, 1 / masks.length]));
}

function mapBelief(b: Belief, f: (chambers: boolean[]) => boolean[]): Belief {
  const out: Belief = new Map();
  for (const [m, p] of b) {
    const k = toMask(f(bits(m)));
    out.set(k, (out.get(k) ?? 0) + p);
  }
  return out;
}

function condition(b: Belief, seat: number, result: [boolean, boolean]): Belief {
  const [a, c] = pairOf(seat);
  const out: Belief = new Map();
  let total = 0;
  for (const [m, p] of b) {
    const ch = bits(m);
    if (ch[a] === result[0] && ch[c] === result[1]) {
      out.set(m, p);
      total += p;
    }
  }
  if (total === 0) return b; // contradictory info can't happen with exact replay; stay safe
  for (const [m, p] of out) out.set(m, p / total);
  return out;
}

export function applyEvent(b: Belief, ev: TurnEvent, viewer: string): Belief {
  const mine = ev.player === viewer;
  switch (ev.kind) {
    case 'peekPublic':
      return condition(b, ev.seat!, ev.result!);
    case 'peekPrivate':
      return mine ? condition(b, ev.seat!, ev.result!) : b;
    case 'spin1':
      return mapBelief(b, (c) => rotate(c, 1));
    case 'spin2':
      return mapBelief(b, (c) => rotate(c, 2));
    case 'swap': {
      if (mine) return mapBelief(b, (c) => swapPair(c, ev.seat!));
      // someone swapped one of the six neighbouring pairs — we don't know which
      const out: Belief = new Map();
      for (let s = 0; s < SEATS; s++) {
        for (const [m, p] of mapBelief(b, (c) => swapPair(c, s))) out.set(m, (out.get(m) ?? 0) + p / SEATS);
      }
      return out;
    }
  }
}

/** Replay a round's events as seen by `viewer`. Events must be the full log. */
export function beliefFor(events: TurnEvent[], viewer: string, bullets: number): Belief {
  return events.reduce((b, ev) => applyEvent(b, ev, viewer), initialBelief(bullets));
}

/** Chance that the chamber facing each seat is loaded. */
export function seatOdds(b: Belief): number[] {
  const odds = Array<number>(SEATS).fill(0);
  for (const [m, p] of b) bits(m).forEach((loaded, k) => loaded && (odds[k] += p));
  return odds;
}
