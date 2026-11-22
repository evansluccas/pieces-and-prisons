/**
 * SECOND GLANCE — rules (our own memorise-and-spot exile puzzle)
 *
 * - A scene of objects is laid out on a grid. Study it for a few seconds.
 * - The scene disappears and comes back with exactly 5 CHANGES: something
 *   removed, something added, something swapped for a different object, or
 *   the same object in a different colour / number.
 * - Mark up to 5 squares with an X, then press Done (or run out of time).
 *   Every X on a changed square counts. Extra marks don't cost anything, but
 *   you only have 5.
 * - 3 rounds. Most changes found wins (ties: less time). The lowest is exiled.
 */
import { Rng } from '../shared/rng';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const COLS = 8;
export const ROWS = 5;
export const SLOTS = COLS * ROWS;

export interface Obj { cat: string; name: string }
export type Scene = (Obj | null)[];

/** Objects that come in variants: swapping within a family is a subtle change. */
const GEMS = ['ruby', 'emerald', 'sapphire', 'topaz', 'amethyst'];
export const FAMILIES: Obj[][] = [
  GEMS.map((g) => ({ cat: 'gems', name: `gem_${g}` })),
  GEMS.map((g) => ({ cat: 'coins', name: `chip_${g}` })),
  [...GEMS, 'ivory'].map((g) => ({ cat: 'board', name: `counter_square_${g}` })),
  [...GEMS, 'ivory'].map((g) => ({ cat: 'board', name: `counter_round_${g}` })),
  ['gold', 'silver', 'copper'].map((m) => ({ cat: 'gems', name: `${m}_ingot` })),
  ['triangle', 'circle', 'star', 'square'].map((sh) => ({ cat: 'board', name: `shape_${sh}` })),
  ['1', '2', '3', '5', '10'].map((v) => ({ cat: 'coins', name: `coin_${v}` })),
  ...['white', 'red', 'blue'].map((c) => [1, 2, 3, 4, 5, 6].map((n) => ({ cat: 'dice', name: `die_${c}_${n}` }))),
];
const SINGLES: Obj[] = [
  ...['crown', 'skull', 'house', 'eye', 'lock', 'hourglass', 'heart', 'star', 'scroll', 'bell', 'gear', 'sword', 'shield', 'trophy'].map(
    (name) => ({ cat: 'icons', name }),
  ),
  // (the Piece sprite is left out: it looks too much like the purple counters)
  ...['key', 'safe', 'treasure_chest', 'push_button', 'rock_large'].map((name) => ({ cat: 'items', name })),
  ...['diamond', 'bomb'].map((name) => ({ cat: 'gems', name })),
  ...['pumpkin', 'ghost', 'bat', 'slime'].map((name) => ({ cat: 'monsters', name })),
  ...['tree', 'manhole'].map((name) => ({ cat: 'board', name })),
];
export const ALL_OBJECTS: Obj[] = [...SINGLES, ...FAMILIES.flat()];

const same = (a: Obj | null, b: Obj | null) => (a === null || b === null ? a === b : a.cat === b.cat && a.name === b.name);
const familyOf = (o: Obj) => FAMILIES.find((f) => f.some((x) => same(x, o)));

export type ChangeKind = 'removed' | 'added' | 'swapped' | 'recolored';
export interface Change { slot: number; kind: ChangeKind; before: Obj | null; after: Obj | null }
export interface Round { before: Scene; after: Scene; changes: Change[] }

const PROFILE: Record<Difficulty, { objects: number; kinds: ChangeKind[]; memorizeMs: number }> = {
  easy: { objects: 14, kinds: ['removed', 'added', 'swapped', 'swapped'], memorizeMs: 15_000 },
  normal: { objects: 18, kinds: ['removed', 'added', 'swapped', 'recolored'], memorizeMs: 10_000 },
  hard: { objects: 23, kinds: ['removed', 'added', 'swapped', 'recolored', 'recolored'], memorizeMs: 7_000 },
};
export const memorizeMs = (d: Difficulty) => PROFILE[d].memorizeMs;

const pick = <T>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

export function makeRound(rng: Rng, difficulty: Difficulty, changes = 5): Round {
  const prof = PROFILE[difficulty];
  const before: Scene = Array(SLOTS).fill(null);
  const slots = [...Array(SLOTS).keys()].sort(() => rng() - 0.5);
  for (const slot of slots.slice(0, prof.objects)) before[slot] = pick(ALL_OBJECTS, rng);
  const after: Scene = [...before];
  const list: Change[] = [];
  const touched = new Set<number>();
  for (let guard = 0; list.length < changes && guard < 500; guard++) {
    const kind = pick(prof.kinds, rng);
    const filled = slots.filter((s) => before[s] && !touched.has(s));
    const empty = slots.filter((s) => !before[s] && !touched.has(s));
    let slot = -1;
    let next: Obj | null = null;
    if (kind === 'removed' && filled.length) {
      slot = pick(filled, rng);
      next = null;
    } else if (kind === 'added' && empty.length) {
      slot = pick(empty, rng);
      next = pick(ALL_OBJECTS, rng);
    } else if (kind === 'swapped' && filled.length) {
      slot = pick(filled, rng);
      const fam = familyOf(before[slot]!);
      next = pick(ALL_OBJECTS.filter((o) => !same(o, before[slot]) && (!fam || !fam.some((x) => same(x, o)))), rng);
    } else if (kind === 'recolored') {
      const inFamily = filled.filter((s) => familyOf(before[s]!));
      if (!inFamily.length) continue;
      slot = pick(inFamily, rng);
      next = pick(familyOf(before[slot]!)!.filter((o) => !same(o, before[slot])), rng);
    }
    if (slot < 0) continue;
    touched.add(slot);
    after[slot] = next;
    list.push({ slot, kind, before: before[slot], after: next });
  }
  return { before, after, changes: list.sort((a, b) => a.slot - b.slot) };
}

export function score(round: Round, marks: number[]) {
  const changed = new Set(round.changes.map((c) => c.slot));
  const hits = marks.filter((m) => changed.has(m));
  return { found: hits.length, hits, wrong: marks.filter((m) => !changed.has(m)), missed: [...changed].filter((s) => !marks.includes(s)) };
}

// ------------------------------------------------------------- the match ----

export interface Config { rounds: number; maxMarks: number; spotMs: number }
export const DEFAULT_CONFIG: Config = { rounds: 3, maxMarks: 5, spotMs: 60_000 };

export interface RoundResult { round: Round; marks: number[]; found: number; timeMs: number }
export interface Ghost { name: string; found: number[]; times: number[] }
export type Phase = 'memorize' | 'spot' | 'reveal' | 'gameOver';

export interface GameState {
  config: Config;
  difficulty: Difficulty;
  index: number;
  phase: Phase;
  round: Round;
  queue: Round[];
  results: RoundResult[];
  ghosts: Ghost[];
}

export function newGame(rng: Rng, difficulty: Difficulty, ghostNames: string[], config = DEFAULT_CONFIG): GameState {
  const rounds = Array.from({ length: config.rounds }, () => makeRound(rng, difficulty));
  const base = { easy: 0.8, normal: 0.65, hard: 0.5 }[difficulty];
  const skills = [0.15, 0, -0.15];
  const ghosts = ghostNames.map((name, i) => {
    const p = Math.max(0.15, Math.min(0.95, base + skills[i % 3]));
    const found = rounds.map(() => Array.from({ length: 5 }, () => (rng() < p ? 1 : 0)).reduce((a: number, b: number) => a + b, 0));
    return { name, found, times: rounds.map(() => Math.round(18_000 + rng() * 35_000)) };
  });
  return { config, difficulty, index: 0, phase: 'memorize', round: rounds[0], queue: rounds.slice(1), results: [], ghosts };
}

export function startSpotting(s: GameState): GameState {
  if (s.phase !== 'memorize') throw new Error('not memorising');
  return { ...s, phase: 'spot' };
}

export function submit(s: GameState, marks: number[], timeMs: number): GameState {
  if (s.phase !== 'spot') throw new Error('not spotting');
  const unique = [...new Set(marks)];
  if (unique.length > s.config.maxMarks) throw new Error(`at most ${s.config.maxMarks} marks`);
  const { found } = score(s.round, unique);
  const result = { round: s.round, marks: unique, found, timeMs: Math.min(timeMs, s.config.spotMs) };
  return { ...s, phase: 'reveal', results: [...s.results, result] };
}

export function nextRound(s: GameState): GameState {
  if (s.phase !== 'reveal') throw new Error('round not over');
  if (!s.queue.length) return { ...s, phase: 'gameOver' };
  return { ...s, index: s.index + 1, phase: 'memorize', round: s.queue[0], queue: s.queue.slice(1) };
}

export function standings(s: GameState) {
  const n = s.results.length;
  const rows = [
    { name: 'You', found: s.results.reduce((t, r) => t + r.found, 0), ms: s.results.reduce((t, r) => t + r.timeMs, 0) },
    ...s.ghosts.map((g) => ({
      name: g.name,
      found: g.found.slice(0, n).reduce((a, b) => a + b, 0),
      ms: g.times.slice(0, n).reduce((a, b) => a + b, 0),
    })),
  ];
  return rows.sort((a, b) => b.found - a.found || a.ms - b.ms || (a.name === 'You' ? -1 : 1));
}

export const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const objName = (o: Obj | null) => (o ? o.name.replace(/_/g, ' ') : 'nothing');
