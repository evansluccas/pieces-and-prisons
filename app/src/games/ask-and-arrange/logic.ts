/**
 * ASK & ARRANGE — rules (our own question-and-truth duel)
 *
 * - Each player secretly arranges the cards 1–8 in a row of 8 slots.
 * - Each player has 10 TOKENS. Taking turns, you ask ONE question about your
 *   opponent's row and get a TRUE answer:
 *     What card is in slot A?                     3 tokens
 *     What do slots A to B add up to? (2–4 slots) 3 tokens
 *     Is slot A higher than slot B?               1 token
 *     Is card X to the left of card Y?            1 token
 * - Whenever you like — and at the latest when your tokens run out — you
 *   GUESS the whole row. After that you stop asking.
 * - When both have guessed, the rows are revealed. Most slots right wins;
 *   ties go to whoever spent fewer tokens; still tied = draw.
 */

export type Side = 0 | 1;
export type Row = number[]; // slot -> card (1–8)
export const N = 8;

export type Question =
  | { kind: 'slot'; a: number }
  | { kind: 'sum'; a: number; b: number }
  | { kind: 'compare'; a: number; b: number }
  | { kind: 'before'; x: number; y: number };

/** Sums cost as much as a straight look: at 2 tokens they gave so much away that both sides got all 8 right. */
export const COST: Record<Question['kind'], number> = { slot: 3, sum: 3, compare: 1, before: 1 };

export type Answer = number | boolean;
export interface Asked { by: Side; q: Question; answer: Answer }

export interface Config { tokens: number }
export const DEFAULT_CONFIG: Config = { tokens: 10 };

export type Phase = 'setup' | 'ask' | 'gameOver';

export interface GameState {
  config: Config;
  rows: [Row, Row];
  phase: Phase;
  turn: Side;
  tokens: [number, number];
  asked: Asked[];
  guesses: [Row | null, Row | null];
}

/** The true answer to a question about a row. */
export function answer(row: Row, q: Question): Answer {
  switch (q.kind) {
    case 'slot': return row[q.a];
    case 'sum': return row.slice(q.a, q.b + 1).reduce((t, c) => t + c, 0);
    case 'compare': return row[q.a] > row[q.b];
    case 'before': return row.indexOf(q.x) < row.indexOf(q.y);
  }
}

export function validQuestion(q: Question): boolean {
  const slot = (i: number) => Number.isInteger(i) && i >= 0 && i < N;
  const card = (c: number) => Number.isInteger(c) && c >= 1 && c <= N;
  switch (q.kind) {
    case 'slot': return slot(q.a);
    case 'sum': return slot(q.a) && slot(q.b) && q.b - q.a >= 1 && q.b - q.a <= 3;
    case 'compare': return slot(q.a) && slot(q.b) && q.a !== q.b;
    case 'before': return card(q.x) && card(q.y) && q.x !== q.y;
  }
}

export const isRow = (r: Row) => r.length === N && [...r].sort((a, b) => a - b).every((c, i) => c === i + 1);

export function newGame(botRow: Row, config = DEFAULT_CONFIG): GameState {
  if (!isRow(botRow)) throw new Error('bad row');
  return { config, rows: [[], botRow], phase: 'setup', turn: 0, tokens: [config.tokens, config.tokens], asked: [], guesses: [null, null] };
}

export function arrange(s: GameState, row: Row): GameState {
  if (s.phase !== 'setup' || !isRow(row)) throw new Error('arrange the cards 1–8');
  return { ...s, rows: [row, s.rows[1]], phase: 'ask' };
}

const other = (side: Side) => (1 - side) as Side;
const done = (s: GameState, side: Side) => s.guesses[side] !== null;

/** After a move: hand the turn over, skipping anyone who has already guessed. */
function pass(s: GameState, from: Side): GameState {
  if (done(s, 0) && done(s, 1)) return { ...s, phase: 'gameOver' };
  return { ...s, turn: done(s, other(from)) ? from : other(from) };
}

export function ask(s: GameState, side: Side, q: Question): GameState {
  if (s.phase !== 'ask' || s.turn !== side || done(s, side)) throw new Error('not your turn');
  if (!validQuestion(q)) throw new Error('not a valid question');
  if (s.tokens[side] < COST[q.kind]) throw new Error('not enough tokens');
  const tokens: [number, number] = [...s.tokens];
  tokens[side] -= COST[q.kind];
  const asked = [...s.asked, { by: side, q, answer: answer(s.rows[other(side)], q) }];
  return pass({ ...s, tokens, asked }, side);
}

export function guess(s: GameState, side: Side, row: Row): GameState {
  if (s.phase !== 'ask' || s.turn !== side || done(s, side)) throw new Error('not your turn');
  if (!isRow(row)) throw new Error('a guess uses each card once');
  const guesses: [Row | null, Row | null] = [...s.guesses];
  guesses[side] = row;
  return pass({ ...s, guesses }, side);
}

/** Has to guess now: no question is affordable. */
export const mustGuess = (s: GameState, side: Side) => s.tokens[side] < 1;

export const correct = (s: GameState, side: Side) =>
  (s.guesses[side] ?? []).filter((c, i) => c === s.rows[other(side)][i]).length;

export function winner(s: GameState): Side | 'draw' | null {
  if (s.phase !== 'gameOver') return null;
  const [a, b] = [correct(s, 0), correct(s, 1)];
  if (a !== b) return a > b ? 0 : 1;
  if (s.tokens[0] !== s.tokens[1]) return s.tokens[0] > s.tokens[1] ? 0 : 1; // spent fewer
  return 'draw';
}

export function questionText(q: Question): string {
  switch (q.kind) {
    case 'slot': return `What is in slot ${q.a + 1}?`;
    case 'sum': return `Slots ${q.a + 1}–${q.b + 1} add up to?`;
    case 'compare': return `Is slot ${q.a + 1} higher than slot ${q.b + 1}?`;
    case 'before': return `Is card ${q.x} left of card ${q.y}?`;
  }
}

export const answerText = (a: Answer) => (typeof a === 'boolean' ? (a ? 'Yes' : 'No') : `${a}`);

/** A compact "question = answer" line for the side panel. */
export function shortText(q: Question, a: Answer): string {
  switch (q.kind) {
    case 'slot': return `slot ${q.a + 1} = ${a}`;
    case 'sum': return `slots ${q.a + 1}–${q.b + 1} sum = ${a}`;
    case 'compare': return `slot ${q.a + 1} > slot ${q.b + 1}? ${answerText(a)}`;
    case 'before': return `${q.x} left of ${q.y}? ${answerText(a)}`;
  }
}
