/**
 * Second Glance as an online puzzle race.
 *
 * Everyone gets the same 3 scenes (normal difficulty, 5 changes each). The
 * server shows the original scene for the study time, then only the changed
 * scene; which squares changed is sent once the round is over. Players send
 * their marks as they place them, then Done; if time runs out first, the
 * marks they had sent still count. Points = changes found, ties on time.
 */
import { RacePuzzle, Stage, race } from '../shared/race';
import { Change, DEFAULT_CONFIG, Round, SLOTS, Scene, ghostFound, ghostSkill, ghostTime, makeRound, memorizeMs, score } from './logic';

const DIFFICULTY = 'normal';
export const MAX_MARKS = DEFAULT_CONFIG.maxMarks;

/** A player's marks so far this round. */
export interface Mine { marks: number[] }

/** What a player sees of the puzzle. */
export interface View {
  stage: Stage;
  /** The original during study, the changed scene from then on. */
  scene: Scene;
  marks: number[];
  maxMarks: number;
  /** Only once the round is over. */
  answer: { before: Scene; changes: Change[]; found: number } | null;
}

/** Check a list of marks: at most 5 distinct squares on the board. */
function readMarks(action: unknown): number[] {
  const marks = (action as { marks?: unknown })?.marks;
  if (!Array.isArray(marks)) throw new Error('Send the squares you marked.');
  if (marks.length > MAX_MARKS) throw new Error(`At most ${MAX_MARKS} marks.`);
  for (const m of marks) if (!Number.isInteger(m) || m < 0 || m >= SLOTS) throw new Error('That square isn’t on the board.');
  if (new Set(marks).size !== marks.length) throw new Error('Each square can only be marked once.');
  return marks as number[];
}

const found = (p: Round, marks: number[]) => score(p, marks).found;

export const puzzle: RacePuzzle<Round, Mine> = {
  rounds: DEFAULT_CONFIG.rounds,
  make: (rng) => makeRound(rng, DIFFICULTY),
  // the solo spotting time
  limitMs: () => DEFAULT_CONFIG.spotMs,
  studyMs: () => memorizeMs(DIFFICULTY),
  init: () => ({ marks: [] }),
  act(p, _mine, action) {
    const type = (action as { type?: unknown })?.type;
    if (type !== 'mark' && type !== 'done') throw new Error('Unknown move.');
    const marks = readMarks(action);
    if (type === 'mark') return { mine: { marks } };
    if (!marks.length) throw new Error('Mark at least one square first.');
    const n = found(p, marks);
    return { mine: { marks }, finish: { points: n, detail: `${n}/5 found` } };
  },
  view(p, stage, mine): View {
    const marks = mine?.marks ?? [];
    if (stage === 'study') return { stage, scene: p.before, marks: [], maxMarks: MAX_MARKS, answer: null };
    if (stage === 'solve') return { stage, scene: p.after, marks, maxMarks: MAX_MARKS, answer: null };
    return { stage, scene: p.after, marks, maxMarks: MAX_MARKS, answer: { before: p.before, changes: p.changes, found: found(p, marks) } };
  },
  // the solo ghost rivals: a skill per seat, a found count and a time per round
  bot(_p, rng, seatIndex) {
    const n = ghostFound(rng, ghostSkill(DIFFICULTY, seatIndex));
    return { ms: ghostTime(rng), points: n, detail: `${n}/5 found` };
  },
  // time's up: the marks sent so far still count
  unfinished(p, mine) {
    const n = found(p, mine.marks);
    return { points: n, detail: `${n}/5 found · time’s up` };
  },
};

const r = race(puzzle);
export const { start, act, view, waitingOn, botAction, pause, over, results, realtime } = r;
