import type { Rng } from '../shared/rng';
import { GameState, N, Placement, ROCK, biggestSquare, canRock, neighbours, patchSpots, placements } from './logic';

export type Skill = 'easy' | 'normal' | 'hard';
const NOISE: Record<Skill, number> = { easy: 12, normal: 3, hard: 0.3 };

/**
 * How close a player is to a bigger square: for the next few sizes up, the
 * best window with nobody else's turf (or rock) in it, scored by how much of
 * it is already theirs.
 */
export function potential(owner: (number | null)[], me: number): number {
  const mine = biggestSquare((c) => owner[c] === me).size;
  // prefix sums of "mine" and "blocked"
  const P = N + 1;
  const own = new Array(P * P).fill(0);
  const blk = new Array(P * P).fill(0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = owner[y * N + x];
    const i = (y + 1) * P + x + 1;
    own[i] = (o === me ? 1 : 0) + own[i - 1] + own[i - P] - own[i - P - 1];
    blk[i] = (o !== null && o !== me ? 1 : 0) + blk[i - 1] + blk[i - P] - blk[i - P - 1];
  }
  const sum = (a: number[], x: number, y: number, k: number) => a[(y + k) * P + x + k] - a[y * P + x + k] - a[(y + k) * P + x] + a[y * P + x];
  let score = mine * 10;
  for (let k = mine + 1; k <= Math.min(N, mine + 3); k++) {
    let best = 0;
    for (let y = 0; y + k <= N; y++) for (let x = 0; x + k <= N; x++) {
      if (sum(blk, x, y, k) > 0) continue;
      best = Math.max(best, sum(own, x, y, k) / (k * k));
    }
    score += best * 10 * (k - mine === 1 ? 1 : 0.5);
  }
  return score;
}

/** Points for a move: the square it builds toward, bonuses it grabs, and turf. */
function value(s: GameState, me: number, cells: number[]): number {
  const owner = [...s.owner];
  for (const c of cells) owner[c] = me;
  let v = potential(owner, me) + cells.length * 0.3;
  for (const c of cells) if (s.bonus[c]) v += s.bonus[c] === 'patch' ? 2.5 : 2;
  return v;
}

export type BotMove = { kind: 'piece'; pick: number; cells: number[] } | { kind: 'patch'; cell: number } | { kind: 'pass' };

export function botMove(s: GameState, me: number, skill: Skill, rng: Rng): BotMove {
  const opts: (Placement & { v: number })[] = placements(s, me).map((p) => ({ ...p, v: value(s, me, p.cells) + rng() * NOISE[skill] }));
  const patches = patchSpots(s, me).map((c) => ({ cell: c, v: value(s, me, [c]) + rng() * NOISE[skill] - 1.5 }));
  const bestPiece = opts.sort((a, b) => b.v - a.v)[0];
  const bestPatch = patches.sort((a, b) => b.v - a.v)[0];
  if (bestPatch && (!bestPiece || bestPatch.v > bestPiece.v)) return { kind: 'patch', cell: bestPatch.cell };
  if (bestPiece) return { kind: 'piece', pick: bestPiece.pick, cells: bestPiece.cells };
  return { kind: 'pass' };
}

/** Drop the rock where it hurts the leading rival most. */
export function botRock(s: GameState, me: number, rng: Rng): number {
  const rivals = s.players.map((_, i) => i).filter((i) => i !== me);
  const target = rivals.sort((a, b) => potential(s.owner, b) - potential(s.owner, a))[0];
  const near = new Set<number>();
  s.owner.forEach((o, c) => {
    if (o !== target) return;
    for (const d of neighbours(c)) for (const e of [d, ...neighbours(d)]) if (canRock(s, e)) near.add(e);
  });
  const before = potential(s.owner, target);
  let best = -1;
  let bestDrop = -Infinity;
  for (const c of near) {
    const owner = [...s.owner];
    owner[c] = ROCK;
    const drop = before - potential(owner, target) + rng() * 0.01;
    // never block my own growth
    const mineNext = s.owner.some((o, d) => o === me && neighbours(d).includes(c));
    if (!mineNext && drop > bestDrop) {
      bestDrop = drop;
      best = c;
    }
  }
  if (best >= 0) return best;
  const free = s.owner.map((_, c) => c).filter((c) => canRock(s, c));
  return free[Math.floor(rng() * free.length)];
}
