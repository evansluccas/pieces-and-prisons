import type { Rng } from '../shared/rng';
import { ADJ, GameState, MILLS, Side, Turn, count, legalTurns, placing, play, steps } from './logic';

export type Level = 'easy' | 'normal' | 'hard';
const DEPTH: Record<Level, number> = { easy: 1, normal: 2, hard: 3 };
const NOISE: Record<Level, number> = { easy: 6, normal: 1, hard: 0.2 };

/** How good the position looks for `me`. */
export function evaluate(s: GameState, me: Side): number {
  if (s.winner === me) return 10_000;
  if (s.winner === 1 - me) return -10_000;
  if (s.winner === 'draw') return 0;
  const them = (1 - me) as Side;
  const men = (side: Side) => count(s, side) + s.inHand[side];
  // two of mine and an empty third: a mill waiting to happen
  const threats = (side: Side) =>
    MILLS.filter((m) => m.filter((p) => s.board[p] === side).length === 2 && m.some((p) => s.board[p] === null)).length;
  const blocked = (side: Side) =>
    placing(s, side) ? 0 : s.board.filter((b, i) => b === side && ADJ[i].every((q) => s.board[q] !== null)).length;
  const mobility = (side: Side) => (placing(s, side) ? 0 : steps({ ...s, turn: side }, side).length);
  return (
    (men(me) - men(them)) * 30 +
    (threats(me) - threats(them)) * 6 +
    (blocked(them) - blocked(me)) * 2 +
    (mobility(me) - mobility(them)) * 0.6
  );
}

function search(s: GameState, depth: number, me: Side, alpha: number, beta: number): number {
  if (depth === 0 || s.winner !== null) return evaluate(s, me);
  const turns = legalTurns(s);
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  for (const t of order(s, turns)) {
    const v = search(play(s, t), depth - 1, me, alpha, beta);
    if (maxing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** Try captures first: alpha-beta prunes much more that way. */
const order = (_s: GameState, turns: Turn[]) => [...turns].sort((a, b) => Number(b.remove !== null) - Number(a.remove !== null));

/** Look ahead a few turns and pick the best (with a little randomness on easier levels). */
export function botTurn(s: GameState, level: Level, rng: Rng): Turn {
  const me = s.turn;
  const turns = legalTurns(s);
  // big flying positions branch a lot: look one turn less there
  const depth = Math.max(1, DEPTH[level] - (turns.length > 60 ? 1 : 0));
  let best = turns[0];
  let bestV = -Infinity;
  for (const t of order(s, turns)) {
    const v = search(play(s, t), depth - 1, me, -Infinity, Infinity) + rng() * NOISE[level];
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return best;
}
