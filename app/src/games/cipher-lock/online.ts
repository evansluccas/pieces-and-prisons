/**
 * Cipher Lock as an online puzzle race: everyone gets the same three locks
 * (normal difficulty) and cracks them on their own. The server keeps each
 * code and checks every try; a wrong try adds 30 seconds. Players are sent
 * the clues and the letter count only — the code shows once the round ends.
 */
import { RacePuzzle, Stage, race } from '../shared/race';
import { Clue, Code, DEFAULT_CONFIG, Difficulty, Puzzle, SLOTS, codeText, ghostTime, makePuzzle } from './logic';

const DIFFICULTY: Difficulty = 'normal';
const SKILLS = [0.8, 1, 1.25]; // like the solo ghosts

/** Your own progress on a lock: the wrong codes you tried. Only you see it. */
export interface Mine { wrong: Code[] }

/** What a player is sent. */
export interface View {
  clues: Clue[];
  letters: number;
  difficulty: Difficulty;
  limitMs: number;
  penaltyMs: number;     // per wrong try
  wrong: Code[];         // your wrong tries (empty for a spectator)
  code: Code | null;     // only once the round is over
}

export type TryAction = { type: 'try'; code: Code };

/**
 * The time limit: three times what an average ghost needs for this lock
 * (12 s plus 13 s per clue), rounded to 30 s and kept between 2 and 6
 * minutes. Most locks get 3–5 minutes, enough for a slow solver with a
 * wrong try or two, and every ghost can finish inside it.
 */
export function limitFor(p: Puzzle): number {
  const typical = 12_000 + p.clues.length * 13_000;
  const ms = Math.round((3 * typical) / 30_000) * 30_000;
  return Math.min(360_000, Math.max(120_000, ms));
}

/** Check a try and turn it into a code, or say what's wrong with it. */
function parseTry(action: unknown, letters: number): Code {
  const a = action as { type?: unknown; code?: unknown } | null;
  if (!a || typeof a !== 'object' || a.type !== 'try') throw new Error('Unknown move.');
  const code = a.code;
  if (!Array.isArray(code) || code.length !== SLOTS) throw new Error('Enter four letters.');
  if (!code.every((x) => Number.isInteger(x) && x >= 0 && x < letters)) throw new Error('Use only the letters on the keypad.');
  if (new Set(code).size !== SLOTS) throw new Error('The four letters must all be different.');
  return code as Code;
}

const tries = (n: number) => `${n} wrong ${n === 1 ? 'try' : 'tries'}`;

export const puzzle: RacePuzzle<Puzzle, Mine> = {
  rounds: DEFAULT_CONFIG.locks,
  make(rng) {
    // a "guess" clue that is the code itself would give it away in the clue list
    for (;;) {
      const p = makePuzzle(rng, DIFFICULTY);
      if (!p.clues.some((c) => c.kind === 'guess' && codeText(c.guess) === codeText(p.code))) return p;
    }
  },
  limitMs: limitFor,
  init: () => ({ wrong: [] }),
  act(p, mine, action) {
    const code = parseTry(action, p.letters);
    if (code.some((x, i) => x !== p.code[i])) return { mine: { wrong: [...mine.wrong, code] }, penaltyMs: DEFAULT_CONFIG.penaltyMs };
    return { mine, finish: { points: 1, detail: mine.wrong.length ? tries(mine.wrong.length) : '' } };
  },
  view(p, stage: Stage, mine): View {
    const settled = stage === 'result' || stage === 'over';
    return {
      clues: p.clues,
      letters: p.letters,
      difficulty: p.difficulty,
      limitMs: limitFor(p),
      penaltyMs: DEFAULT_CONFIG.penaltyMs,
      wrong: mine?.wrong ?? [],
      code: settled ? p.code : null,
    };
  },
  // the solo ghost model; ghostTime already includes an occasional wrong try
  bot: (p, rng, seat) => ({ ms: ghostTime(p, SKILLS[seat % SKILLS.length], rng), points: 1 }),
  unfinished: (_p, mine) => ({ points: 0, detail: mine.wrong.length ? tries(mine.wrong.length) : '' }),
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
