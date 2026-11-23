import type { Rng } from '../shared/rng';
import { CELLS, DIRS, GameState, MAX_STRIKES, Move, N, Side, at, fives, xy } from './logic';

export type Level = 'easy' | 'normal' | 'hard';

/**
 * The bot plays from MEMORY, never from the real board. Each time a stone
 * goes down it may remember the owner (its own stones more easily), may
 * remember it wrong (a slip), and every turn a few memories fade.
 */
export const MEMORY: Record<Level, { own: number; theirs: number; slip: number; fade: number; noise: number }> = {
  easy: { own: 0.85, theirs: 0.55, slip: 0.07, fade: 0.035, noise: 0.5 },
  normal: { own: 0.94, theirs: 0.78, slip: 0.035, fade: 0.015, noise: 0.2 },
  hard: { own: 0.99, theirs: 0.93, slip: 0.01, fade: 0.004, noise: 0.05 },
};

/** Cell -> who the bot believes owns it. Missing = doesn't remember. */
export type Memory = Map<number, Side>;

export function observe(mem: Memory, cell: number, owner: Side, me: Side, level: Level, rng: Rng) {
  const m = MEMORY[level];
  if (rng() >= (owner === me ? m.own : m.theirs)) return;
  mem.set(cell, rng() < m.slip ? ((1 - owner) as Side) : owner);
}

export function fade(mem: Memory, level: Level, rng: Rng) {
  for (const c of [...mem.keys()]) if (rng() < MEMORY[level].fade) mem.delete(c);
}

/** After a wrong call the bot stops trusting what it thought about those stones. */
export function wrongCall(mem: Memory, cells: number[]) {
  for (const c of cells) mem.delete(c);
}

const VALUE = (run: number, open: number) => {
  if (run >= 5) return 100_000;
  if (open === 0) return 0;
  if (run === 4) return open === 2 ? 20_000 : 2_000;
  if (run === 3) return open === 2 ? 1_500 : 150;
  if (run === 2) return open === 2 ? 120 : 15;
  return open === 2 ? 8 : 2;
};

/** How good a stone at `c` would be for `side`, judged on the remembered board. */
function potential(view: (Side | 'x' | null)[], c: number, side: Side): number {
  const [x, y] = xy(c);
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let run = 1;
    let open = 0;
    for (const sgn of [1, -1]) {
      let k = 1;
      while (view[at(x + sgn * k * dx, y + sgn * k * dy)] === side && at(x + sgn * k * dx, y + sgn * k * dy) >= 0) k++;
      run += k - 1;
      const end = at(x + sgn * k * dx, y + sgn * k * dy);
      if (end >= 0 && view[end] === null) open++;
    }
    total += VALUE(run, open);
  }
  return total;
}

export function botMove(s: GameState, me: Side, mem: Memory, level: Level, rng: Rng): Move {
  // what the bot believes: its memory, plus "a stone I can't place" for the rest
  const view: (Side | 'x' | null)[] = s.board.map((b, c) => (b === null ? null : mem.get(c) ?? 'x'));
  const believed = view.map((v) => (v === me ? me : null));
  // a line it believes is all its own: call it (Easy sometimes hesitates; a last strike makes everyone careful)
  const lines = fives(believed, me);
  if (lines.length && (s.strikes[me] < MAX_STRIKES - 1 || level !== 'easy' || rng() < 0.7)) return { kind: 'call', cells: lines[0] };

  const them = (1 - me) as Side;
  const mid = (N - 1) / 2;
  let best = -1;
  let bestScore = -Infinity;
  for (let c = 0; c < CELLS; c++) {
    if (s.board[c] !== null) continue;
    const [x, y] = xy(c);
    const attack = potential(view, c, me);
    const defend = potential(view, c, them);
    const centre = 4 - Math.hypot(x - mid, y - mid) * 0.5;
    const score = (attack * 1.1 + defend) * (1 + (rng() - 0.5) * MEMORY[level].noise) + centre;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { kind: 'place', cell: best };
}
