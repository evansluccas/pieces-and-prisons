import type { Rng } from '../shared/rng';
import { ADJ, GameState, Move, Role, legalMoves, play, tigerMoves, trapped } from './logic';

export type Level = 'easy' | 'normal' | 'hard';
/** Goats need to see further than tigers: one tiger move can threaten two goats at once. */
const DEPTH: Record<Level, Record<'T' | 'G', number>> = {
  easy: { T: 1, G: 2 },
  normal: { T: 2, G: 3 },
  hard: { T: 3, G: 4 },
};
const NOISE: Record<Level, number> = { easy: 8, normal: 1.5, hard: 0.3 };

/** Higher is better for the TIGERS. */
export function evaluate(s: GameState): number {
  if (s.winner === 'T') return 10_000;
  if (s.winner === 'G') return -10_000;
  if (s.winner === 'draw') return 0;
  const tm = tigerMoves(s.board);
  const threats = tm.filter((m) => m.jumped !== null).length; // goats in danger right now
  // goats standing next to the edge of the pack are safer when backed up
  const backed = s.board.reduce((t, b, p) => t + (b === 'G' ? ADJ[p].filter((q) => s.board[q] === 'G').length : 0), 0);
  return s.captured * 60 + threats * 8 + tm.length * 1.5 - trapped(s.board).length * 12 - backed * 0.4;
}

/**
 * At the end of the look-ahead, don't stop in the middle of a fight: if the
 * tigers can still jump, keep following jumps (a few deep) before scoring.
 */
function quiet(s: GameState, alpha: number, beta: number, left: number): number {
  const stand = evaluate(s);
  if (s.winner !== null || s.turn !== 'T' || left === 0) return stand;
  let best = stand;
  for (const m of tigerMoves(s.board)) {
    if (m.jumped === null) continue;
    best = Math.max(best, quiet(play(s, m), alpha, beta, left - 1));
    alpha = Math.max(alpha, best);
    if (beta <= alpha) break;
  }
  return best;
}

function search(s: GameState, depth: number, alpha: number, beta: number): number {
  if (s.winner !== null) return evaluate(s);
  if (depth === 0) return quiet(s, alpha, beta, 4);
  const moves = order(legalMoves(s));
  if (s.turn === 'T') {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, search(play(s, m), depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    best = Math.min(best, search(play(s, m), depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

const order = (moves: Move[]) => [...moves].sort((a, b) => Number(b.jumped !== null) - Number(a.jumped !== null));

/** Look ahead a few moves for whichever side the bot is playing. */
export function botMove(s: GameState, level: Level, rng: Rng): Move {
  const me: Role = s.turn;
  const moves = legalMoves(s);
  const sign = me === 'T' ? 1 : -1;
  // the widest positions (lots of empty points) get one move less on the hardest level, to stay quick
  const depth = Math.max(1, DEPTH[level][me] - (level === 'hard' && moves.length > 16 ? 1 : 0));
  let best = moves[0];
  let bestV = -Infinity;
  for (const m of order(moves)) {
    const v = sign * search(play(s, m), depth - 1, -Infinity, Infinity) + rng() * NOISE[level];
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return best;
}

