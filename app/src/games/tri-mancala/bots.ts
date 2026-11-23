import type { Rng } from '../shared/rng';
import { Colour, GameState, counts, orders, pitsOf, sow, storeOf } from './logic';

export type Skill = 'easy' | 'normal' | 'hard';
const NOISE: Record<Skill, number> = { easy: 8, normal: 2, hard: 0.2 };

/** Stones that end up in a player's store: what's there plus what's left in their pits. */
function projected(s: GameState, p: number): [number, number, number] {
  return counts([...s.slots[storeOf(p)], ...pitsOf(p).flatMap((slot) => s.slots[slot])]);
}

/** How good a position is for `me`: my weakest colour counts most, then balance and banked stones. */
export function worth(s: GameState, me: number): number {
  const banked = counts(s.slots[storeOf(me)]);
  const proj = s.over ? banked : projected(s, me);
  const weakest = Math.min(...proj);
  // stones in the store are safe; stones in pits can still be sown away or captured
  let v = weakest * 10 + Math.min(...banked) * 3 + banked.reduce((a, b) => a + b, 0) * 0.8 - (Math.max(...proj) - weakest) * 0.6;
  // hold back the best rival
  const rivals = s.players.map((_, i) => i).filter((i) => i !== me);
  const best = Math.max(...rivals.map((r) => {
    const c = s.over ? counts(s.slots[storeOf(r)]) : projected(s, r);
    return Math.min(...c) * 10 + c.reduce((a, b) => a + b, 0);
  }));
  return v - best * 0.6;
}

export interface BotChoice { pit: number; order: Colour[] }

function options(s: GameState, me: number, cap: number): { choice: BotChoice; next: GameState }[] {
  const out: { choice: BotChoice; next: GameState }[] = [];
  for (const pit of pitsOf(me)) {
    if (!s.slots[pit].length) continue;
    for (const order of orders(s.slots[pit], cap)) out.push({ choice: { pit, order }, next: sow(s, me, pit, order) });
  }
  return out;
}

/** Follow my own extra turns greedily, so a move that earns one is judged by where the chain ends. */
function settle(s: GameState, me: number, depth: number): GameState {
  if (s.over || s.turn !== me || depth <= 0) return s;
  let best = s;
  let bestV = -Infinity;
  for (const o of options(s, me, 60)) {
    const v = worth(o.next, me);
    if (v > bestV) {
      bestV = v;
      best = o.next;
    }
  }
  return settle(best, me, depth - 1);
}

export function botSow(s: GameState, me: number, skill: Skill, rng: Rng): BotChoice {
  // Easy often just grabs a pit and sows it as it comes
  if (skill === 'easy' && rng() < 0.6) {
    const pits = pitsOf(me).filter((p) => s.slots[p].length);
    const pit = pits[Math.floor(rng() * pits.length)];
    return { pit, order: [...s.slots[pit]] };
  }
  // Normal judges each move on its own; Hard also follows the extra turns a move earns
  const opts = options(s, me, skill === 'easy' ? 30 : 600).map((o) => {
    const end = skill === 'hard' ? settle(o.next, me, 3) : o.next;
    let v = worth(end, me) + rng() * NOISE[skill];
    if (skill !== 'hard' && !o.next.over && o.next.turn === me) v += 4; // another turn is worth something
    return { ...o, v };
  });
  return opts.sort((a, b) => b.v - a.v)[0].choice;
}
