import type { Rng } from '../shared/rng';
import { GameState, Kind, question } from './logic';

export type Persona = 'sharp' | 'steady' | 'shaky';

const SKILL: Record<Persona, Record<Kind, number>> = {
  sharp: { cubes: 0.85, blocks: 0.75, grass: 0.8, memory: 0.75 },
  steady: { cubes: 0.75, blocks: 0.65, grass: 0.7, memory: 0.65 },
  shaky: { cubes: 0.65, blocks: 0.55, grass: 0.6, memory: 0.55 },
};
const SPEED: Record<Persona, number> = { sharp: 0.7, steady: 1, shaky: 0.85 };
const BASE_MS: Record<Kind, number> = { cubes: 11_000, blocks: 19_000, grass: 14_000, memory: 5_000 };

/** A bot's answer and how long it takes: right with a skill-based chance. */
export function botAnswer(s: GameState, persona: Persona, rng: Rng): { choice: 0 | 1; ms: number } {
  const q = question(s);
  const right = rng() < SKILL[persona][q.data.kind];
  const ms = Math.round(BASE_MS[q.data.kind] * SPEED[persona] * (0.6 + rng() * 0.8));
  return { choice: right ? q.answer : ((1 - q.answer) as 0 | 1), ms: Math.min(ms, s.config.answerMs - 500) };
}
