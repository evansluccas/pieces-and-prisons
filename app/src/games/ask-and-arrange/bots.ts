import type { Rng } from '../shared/rng';
import { Asked, COST, GameState, N, Question, Row, Side, answer, validQuestion } from './logic';

export type Level = 'easy' | 'normal' | 'hard';

/** All 40,320 rows. */
export const ALL_ROWS: Row[] = (() => {
  const out: Row[] = [];
  const walk = (row: number[], left: number[]) => {
    if (!left.length) return void out.push(row);
    for (let i = 0; i < left.length; i++) walk([...row, left[i]], [...left.slice(0, i), ...left.slice(i + 1)]);
  };
  walk([], Array.from({ length: N }, (_, i) => i + 1));
  return out;
})();

/** Rows the opponent could have, given what `side` has asked so far. */
export function candidates(asked: Asked[], side: Side): Row[] {
  const mine = asked.filter((a) => a.by === side);
  return ALL_ROWS.filter((r) => mine.every((a) => answer(r, a.q) === a.answer));
}

/** Every question one could ask. */
export const ALL_QUESTIONS: Question[] = (() => {
  const out: Question[] = [];
  for (let a = 0; a < N; a++) out.push({ kind: 'slot', a });
  for (let a = 0; a < N; a++) for (let b = a + 1; b <= Math.min(N - 1, a + 3); b++) out.push({ kind: 'sum', a, b });
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) out.push({ kind: 'compare', a, b });
  for (let x = 1; x <= N; x++) for (let y = x + 1; y <= N; y++) out.push({ kind: 'before', x, y });
  return out.filter(validQuestion);
})();

/** Expected information (bits) an answer would give over these rows. */
export function information(rows: Row[], q: Question): number {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = String(answer(r, q));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let h = 0;
  for (const c of counts.values()) {
    const p = c / rows.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** The row that gets the most slots right on average among the candidates. */
export function bestGuess(rows: Row[]): Row {
  const freq = Array.from({ length: N }, () => Array(N + 1).fill(0));
  for (const r of rows) r.forEach((c, i) => freq[i][c]++);
  let best = rows[0];
  let bestV = -1;
  // checking every candidate is exact; cap it for speed early in the game
  const pool = rows.length > 6000 ? rows.filter((_, i) => i % Math.ceil(rows.length / 6000) === 0) : rows;
  for (const r of pool) {
    const v = r.reduce((t, c, i) => t + freq[i][c], 0);
    if (v > bestV) {
      bestV = v;
      best = r;
    }
  }
  return best;
}

export type BotAction = { kind: 'ask'; q: Question } | { kind: 'guess'; row: Row };

/**
 * Easy: random questions. Normal: one of the more useful questions.
 * Hard: the most information per token. Guess when sure, or out of tokens.
 */
export function botTurn(s: GameState, side: Side, level: Level, rng: Rng): BotAction {
  const rows = candidates(s.asked, side);
  const affordable = ALL_QUESTIONS.filter((q) => COST[q.kind] <= s.tokens[side]);
  if (rows.length === 1 || !affordable.length) return { kind: 'guess', row: bestGuess(rows) };
  if (level === 'easy') return { kind: 'ask', q: affordable[Math.floor(rng() * affordable.length)] };
  const scored = affordable
    .map((q) => ({ q, v: information(rows, q) / (level === 'hard' ? COST[q.kind] : 1) + rng() * 0.01 }))
    .filter((x) => x.v > 0.001)
    .sort((a, b) => b.v - a.v);
  if (!scored.length) return { kind: 'guess', row: bestGuess(rows) };
  const pick = level === 'hard' ? scored[0] : scored[Math.floor(rng() * Math.min(6, scored.length))];
  return { kind: 'ask', q: pick.q };
}

export function randomRow(rng: Rng): Row {
  return ALL_ROWS[Math.floor(rng() * ALL_ROWS.length)];
}
