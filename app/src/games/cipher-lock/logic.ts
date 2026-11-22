/**
 * CIPHER LOCK — rules (our own code-breaking exile puzzle)
 *
 * - A lock has a secret 4-letter code: four DIFFERENT letters from a small
 *   alphabet (A–F, A–H or A–J depending on difficulty), in any order.
 * - You get a list of clues. Together they allow exactly ONE code.
 * - Enter a code and try it. A wrong try adds 30 seconds to your time.
 * - An exile match is 3 locks in a row. Your score is your total time
 *   (penalties included). Everyone races the same locks; the slowest is exiled.
 */
import { Rng } from '../shared/rng';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const LETTER_COUNT: Record<Difficulty, number> = { easy: 6, normal: 8, hard: 10 };
export const SLOTS = 4;
export const VOWELS = 'AEI';

export type Code = number[]; // letter indexes, 0 = A

export type Clue =
  | { kind: 'has'; letter: number }
  | { kind: 'not'; letter: number }
  | { kind: 'notAt'; slot: number; letter: number }
  | { kind: 'vowelAt'; slot: number; vowel: boolean }
  | { kind: 'before'; a: number; b: number }
  | { kind: 'gap'; slot: number; from: number; n: number }
  | { kind: 'later'; slot: number; than: number }
  | { kind: 'range'; lo: number; hi: number; count: number }
  | { kind: 'guess'; guess: Code; exact: number; moved: number };

export const L = (i: number) => String.fromCharCode(65 + i);
export const codeText = (c: Code) => c.map(L).join('');
const isVowel = (i: number) => VOWELS.includes(L(i));

export function feedback(code: Code, guess: Code): { exact: number; moved: number } {
  const exact = guess.filter((g, i) => code[i] === g).length;
  const common = guess.filter((g) => code.includes(g)).length;
  return { exact, moved: common - exact };
}

export function holds(clue: Clue, code: Code): boolean {
  switch (clue.kind) {
    case 'has': return code.includes(clue.letter);
    case 'not': return !code.includes(clue.letter);
    case 'notAt': return code[clue.slot] !== clue.letter;
    case 'vowelAt': return isVowel(code[clue.slot]) === clue.vowel;
    case 'before': {
      const i = code.indexOf(clue.a);
      const j = code.indexOf(clue.b);
      return i >= 0 && j >= 0 && i < j;
    }
    case 'gap': return code[clue.slot] - code[clue.from] === clue.n;
    case 'later': return code[clue.slot] > code[clue.than];
    case 'range': return code.filter((x) => x >= clue.lo && x <= clue.hi).length === clue.count;
    case 'guess': {
      const f = feedback(code, clue.guess);
      return f.exact === clue.exact && f.moved === clue.moved;
    }
  }
}

const slotName = (i: number) => `slot ${i + 1}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function clueText(clue: Clue): string {
  switch (clue.kind) {
    case 'has': return `${L(clue.letter)} is in the code.`;
    case 'not': return `${L(clue.letter)} is not in the code.`;
    case 'notAt': return `${cap(slotName(clue.slot))} is not ${L(clue.letter)}.`;
    case 'vowelAt': return `${cap(slotName(clue.slot))} is a ${clue.vowel ? 'vowel' : 'consonant'}.`;
    case 'before': return `${L(clue.a)} and ${L(clue.b)} are both in the code, ${L(clue.a)} somewhere before ${L(clue.b)}.`;
    case 'gap': {
      const n = Math.abs(clue.n);
      return `${cap(slotName(clue.slot))} is ${n} letter${n === 1 ? '' : 's'} ${clue.n > 0 ? 'after' : 'before'} ${slotName(clue.from)} in the alphabet.`;
    }
    case 'later': return `${cap(slotName(clue.slot))} comes later in the alphabet than ${slotName(clue.than)}.`;
    case 'range': {
      const n = clue.count;
      return `Exactly ${n === 0 ? 'none' : n} of the code's letters ${n === 1 ? 'is' : 'are'} in ${L(clue.lo)}–${L(clue.hi)}.`;
    }
    case 'guess': {
      const { exact, moved } = clue;
      return `Trying ${codeText(clue.guess)}: ${exact} right letter${exact === 1 ? '' : 's'} in the right slot, ${moved} right letter${moved === 1 ? '' : 's'} in the wrong slot.`;
    }
  }
}

/** Every code of 4 different letters from an alphabet of `n`. */
export function allCodes(n: number): Code[] {
  const out: Code[] = [];
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      for (let c = 0; c < n; c++)
        for (let d = 0; d < n; d++)
          if (new Set([a, b, c, d]).size === 4) out.push([a, b, c, d]);
  return out;
}

export const solutions = (clues: Clue[], n: number) => allCodes(n).filter((c) => clues.every((k) => holds(k, c)));

const pick = <T>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

/** A random clue that is TRUE for `code`. */
function randomClue(code: Code, n: number, d: Difficulty, rng: Rng): Clue {
  const kinds: Clue['kind'][] =
    d === 'easy'
      ? ['has', 'has', 'not', 'not', 'notAt', 'vowelAt', 'before', 'later', 'guess']
      : d === 'normal'
        ? ['has', 'not', 'notAt', 'vowelAt', 'before', 'gap', 'later', 'range', 'guess']
        : ['not', 'notAt', 'vowelAt', 'gap', 'later', 'later', 'range', 'range', 'guess', 'guess'];
  const letters = [...Array(n).keys()];
  const slots = [0, 1, 2, 3];
  switch (pick(kinds, rng)) {
    case 'has': return { kind: 'has', letter: pick(code, rng) };
    case 'not': return { kind: 'not', letter: pick(letters.filter((x) => !code.includes(x)), rng) };
    case 'notAt': {
      const slot = pick(slots, rng);
      return { kind: 'notAt', slot, letter: pick(letters.filter((x) => x !== code[slot]), rng) };
    }
    case 'vowelAt': {
      const slot = pick(slots, rng);
      return { kind: 'vowelAt', slot, vowel: isVowel(code[slot]) };
    }
    case 'before': {
      const [i, j] = [pick(slots, rng), pick(slots, rng)].sort((x, y) => x - y);
      if (i === j) return { kind: 'has', letter: code[i] };
      return { kind: 'before', a: code[i], b: code[j] };
    }
    case 'gap': {
      const slot = pick(slots, rng);
      const from = pick(slots.filter((x) => x !== slot), rng);
      return { kind: 'gap', slot, from, n: code[slot] - code[from] };
    }
    case 'later': {
      const slot = pick(slots, rng);
      const than = pick(slots.filter((x) => x !== slot), rng);
      return code[slot] > code[than] ? { kind: 'later', slot, than } : { kind: 'later', slot: than, than: slot };
    }
    case 'range': {
      const lo = Math.floor(rng() * (n - 2));
      const hi = Math.min(n - 1, lo + 1 + Math.floor(rng() * 3));
      return { kind: 'range', lo, hi, count: code.filter((x) => x >= lo && x <= hi).length };
    }
    case 'guess': {
      const guess = [...letters].sort(() => rng() - 0.5).slice(0, 4);
      return { kind: 'guess', guess, ...feedback(code, guess) };
    }
  }
}

export interface Puzzle { code: Code; clues: Clue[]; letters: number; difficulty: Difficulty }

/**
 * Build a lock: keep adding true clues that narrow things down until only one
 * code fits, then drop any clue the others make unnecessary.
 */
export function makePuzzle(rng: Rng, difficulty: Difficulty): Puzzle {
  const n = LETTER_COUNT[difficulty];
  const all = allCodes(n);
  for (;;) {
    const code = [...Array(n).keys()].sort(() => rng() - 0.5).slice(0, 4);
    let left = all;
    const clues: Clue[] = [];
    for (let tries = 0; tries < 200 && left.length > 1; tries++) {
      const c = randomClue(code, n, difficulty, rng);
      const next = left.filter((x) => holds(c, x));
      if (next.length < left.length) {
        clues.push(c);
        left = next;
      }
    }
    if (left.length !== 1) continue;
    // drop redundant clues (last added first)
    for (let i = clues.length - 1; i >= 0; i--) {
      const without = clues.filter((_, k) => k !== i);
      if (solutions(without, n).length === 1) clues.splice(i, 1);
    }
    if (clues.length > 9) continue; // too long to read comfortably
    return { code, clues: clues.sort(() => rng() - 0.5), letters: n, difficulty };
  }
}

// ------------------------------------------------------------- the match ----

export interface Config { locks: number; penaltyMs: number }
export const DEFAULT_CONFIG: Config = { locks: 3, penaltyMs: 30_000 };

export interface Ghost { name: string; times: number[] } // ms per lock

export interface LockResult { puzzle: Puzzle; timeMs: number; wrong: number }

export type Phase = 'solve' | 'solved' | 'gameOver';

export interface GameState {
  config: Config;
  difficulty: Difficulty;
  lock: number;              // 0-based
  phase: Phase;
  puzzle: Puzzle;
  wrong: Code[];             // wrong tries on this lock
  results: LockResult[];
  ghosts: Ghost[];
  queue: Puzzle[];           // the next locks, fixed so everyone races the same ones
}

/** How long a ghost takes: roughly proportional to how much there is to read and reason about. */
export function ghostTime(p: Puzzle, skill: number, rng: Rng): number {
  const perClue = { easy: 9_000, normal: 13_000, hard: 18_000 }[p.difficulty];
  const base = 12_000 + p.clues.length * perClue;
  const slip = rng() < 0.2 ? 30_000 : 0; // sometimes they try a wrong code
  return Math.round(base * skill * (0.8 + rng() * 0.5) + slip);
}

export function newGame(rng: Rng, difficulty: Difficulty, ghostNames: string[], config = DEFAULT_CONFIG): GameState {
  const puzzles = Array.from({ length: config.locks }, () => makePuzzle(rng, difficulty));
  const skills = [0.8, 1, 1.25];
  const ghosts = ghostNames.map((name, i) => ({ name, times: puzzles.map((p) => ghostTime(p, skills[i % skills.length], rng)) }));
  return { config, difficulty, lock: 0, phase: 'solve', puzzle: puzzles[0], wrong: [], results: [], ghosts, queue: puzzles.slice(1) };
}

/** Try a code. `timeMs` is how long you have been on this lock. */
export function tryCode(s: GameState, guess: Code, timeMs: number): GameState {
  if (s.phase !== 'solve') throw new Error('not solving');
  if (guess.length !== 4 || new Set(guess).size !== 4 || guess.some((g) => g < 0 || g >= s.puzzle.letters)) {
    throw new Error('enter four different letters');
  }
  if (guess.every((g, i) => g === s.puzzle.code[i])) {
    const total = timeMs + s.wrong.length * s.config.penaltyMs;
    return { ...s, phase: 'solved', results: [...s.results, { puzzle: s.puzzle, timeMs: total, wrong: s.wrong.length }] };
  }
  return { ...s, wrong: [...s.wrong, guess] };
}

export function nextLock(s: GameState): GameState {
  if (s.phase !== 'solved') throw new Error('lock not open');
  if (!s.queue.length) return { ...s, phase: 'gameOver' };
  return { ...s, lock: s.lock + 1, phase: 'solve', puzzle: s.queue[0], wrong: [], queue: s.queue.slice(1) };
}

export const totalMs = (s: GameState) => s.results.reduce((t, r) => t + r.timeMs, 0);

export function standings(s: GameState) {
  const rows = [
    { name: 'You', you: true, ms: totalMs(s) },
    ...s.ghosts.map((g) => ({ name: g.name, you: false, ms: g.times.slice(0, s.results.length).reduce((a, b) => a + b, 0) })),
  ];
  return rows.sort((a, b) => a.ms - b.ms || (a.you ? -1 : 1));
}

export const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
