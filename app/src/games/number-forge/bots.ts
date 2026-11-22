import type { Rng } from '../shared/rng';
import { GameState, allFound, evaluate, winningOrder } from './logic';

export type Persona = 'quick' | 'steady' | 'sloppy';

interface Style { meanMs: number; mistake: number; closeMs: number; falseClose: number }
const STYLE: Record<Persona, Style> = {
  // tuned so a person doing the sums in their head can keep up
  quick: { meanMs: 26_000, mistake: 0.05, closeMs: 4_000, falseClose: 0.03 },
  steady: { meanMs: 36_000, mistake: 0.03, closeMs: 6_000, falseClose: 0.01 },
  sloppy: { meanMs: 30_000, mistake: 0.18, closeMs: 5_000, falseClose: 0.08 },
};

/** How long (ms) this bot takes to come up with its next move. */
export function botThinkMs(s: GameState, persona: Persona, rng: Rng): number {
  const st = STYLE[persona];
  // more answers left = easier to spot one
  const left = Math.max(1, s.answers.length - s.found.length);
  const base = allFound(s) ? st.closeMs : st.meanMs / Math.sqrt(left);
  return Math.round(base * (0.5 + rng()));
}

export type BotMove = { kind: 'forge'; order: number[] } | { kind: 'close' } | { kind: 'wait' };

/**
 * Bots "see" a real unclaimed answer when their thinking time is up — with a
 * chance of a slip (a wrong equation). Once everything is found they close the
 * forge; sloppy ones sometimes close too early.
 */
export function botMove(s: GameState, persona: Persona, rng: Rng): BotMove {
  const st = STYLE[persona];
  if (allFound(s)) return rng() < 0.85 ? { kind: 'close' } : { kind: 'wait' };
  if (s.found.length >= 1 && rng() < st.falseClose) return { kind: 'close' };
  if (rng() < st.mistake) return { kind: 'forge', order: wrongOrder(s, rng) };
  const open = s.answers.filter((a) => !s.found.some((f) => f.join() === a.join()));
  const set = open[Math.floor(rng() * open.length)];
  return { kind: 'forge', order: winningOrder(s.tiles, set, s.target) };
}

function wrongOrder(s: GameState, rng: Rng): number[] {
  for (;;) {
    const idx = [...Array(10).keys()].sort(() => rng() - 0.5).slice(0, 3);
    if (evaluate(s.tiles, idx) !== s.target) return idx;
  }
}
