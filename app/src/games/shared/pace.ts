/**
 * Game speed. Every bot pause and step-by-step reveal goes through `pace()`,
 * so one setting slows the whole table down.
 *
 * Against bots the default is fast. Online tables should default to `slow`
 * (ONLINE_SPEED) so everyone can follow every move — especially in memory
 * games, where nothing is written down.
 */
export type Speed = 'fast' | 'normal' | 'slow';

export const SPEEDS: { id: Speed; label: string; factor: number }[] = [
  { id: 'fast', label: 'Fast', factor: 1 },
  { id: 'normal', label: 'Normal', factor: 1.8 },
  { id: 'slow', label: 'Slow', factor: 2.8 },
];

export const BOT_SPEED: Speed = 'fast';
export const ONLINE_SPEED: Speed = 'slow';

let factor = 1;

export function setSpeed(speed: Speed) {
  factor = SPEEDS.find((s) => s.id === speed)?.factor ?? 1;
}

/** Scale a pause (ms) by the current speed. */
export const pace = (ms: number) => Math.round(ms * factor);
