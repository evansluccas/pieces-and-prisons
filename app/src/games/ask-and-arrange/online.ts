/**
 * Ask & Arrange at an online table: a duel. Both players arrange their own
 * secret row at the same time, then take turns asking about the other's row
 * (a random seat asks first). The solo screen draws "you" as side 0, so the
 * second seat gets a view with the two sides swapped.
 *
 * Hidden until both have guessed, as in solo play: the opponent's row and
 * the opponent's guess. Every question and its answer is shown to both —
 * answers to your opponent's questions are about your own row anyway.
 */
import type { Rng } from '../shared/rng';
import { botTurn, randomRow } from './bots';
import { DEFAULT_CONFIG, GameState, N, Question, Row, Side, arrange, ask, correct, guess, isRow, winner } from './logic';

/** Arranging a row or a final guess takes longer than the usual minute. */
export const TURN_MS = 90_000;

export interface OnlineState {
  game: GameState;
  /** rows locked in during setup (the game starts once both are in) */
  setup: [Row | null, Row | null];
  /** who asks first, drawn at the start */
  first: Side;
  seats: [string, string];
  names: [string, string];
}

export type Action =
  | { type: 'arrange'; row: Row }
  | { type: 'ask'; q: Question }
  | { type: 'guess'; row: Row };

/** What one seat sees: the solo state from their side, plus whether their own row is locked in. */
export interface View { game: GameState; opponent: string; locked: boolean }

export function start(seats: { id: string; name: string }[], rng: Rng): OnlineState {
  const game: GameState = {
    config: DEFAULT_CONFIG, rows: [[], []], phase: 'setup', turn: 0,
    tokens: [DEFAULT_CONFIG.tokens, DEFAULT_CONFIG.tokens], asked: [], guesses: [null, null],
  };
  return { game, setup: [null, null], first: rng() < 0.5 ? 0 : 1, seats: [seats[0].id, seats[1].id], names: [seats[0].name, seats[1].name] };
}

const sideOf = (s: OnlineState, seat: string): Side => {
  const i = s.seats.indexOf(seat);
  if (i < 0) throw new Error('You aren’t playing in this duel.');
  return i as Side;
};

function cleanRow(x: unknown, what: string): Row {
  if (!Array.isArray(x) || x.length !== N || !x.every((c) => Number.isInteger(c)) || !isRow(x as Row)) {
    throw new Error(`${what} uses each card 1–8 once.`);
  }
  return [...(x as Row)];
}

const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) ? x : NaN);

function cleanQuestion(x: unknown): Question {
  const q = (x ?? {}) as Record<string, unknown>;
  switch (q.kind) {
    case 'slot': return { kind: 'slot', a: int(q.a) };
    case 'sum': return { kind: 'sum', a: int(q.a), b: int(q.b) };
    case 'compare': return { kind: 'compare', a: int(q.a), b: int(q.b) };
    case 'before': return { kind: 'before', x: int(q.x), y: int(q.y) };
    default: throw new Error('Pick a question to ask.');
  }
}

/** The logic's own messages are short; make them friendlier here. */
function friendly<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === 'not your turn') throw new Error('Not your move right now.');
    if (m === 'not a valid question') throw new Error('That isn’t a valid question.');
    if (m === 'not enough tokens') throw new Error('You don’t have enough tokens for that question.');
    throw e;
  }
}

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  const side = sideOf(s, seat);
  if (action?.type === 'arrange') {
    if (s.game.phase !== 'setup') throw new Error('The rows are already arranged.');
    if (s.setup[side]) throw new Error('Your row is already locked in.');
    const setup: [Row | null, Row | null] = [...s.setup];
    setup[side] = cleanRow(action.row, 'Your row');
    if (!setup[0] || !setup[1]) return { ...s, setup };
    // both in: side 0's row goes in through the solo arrange, side 1's beside it
    const game = arrange({ ...s.game, rows: [[], setup[1]] }, setup[0]);
    return { ...s, setup, game: { ...game, turn: s.first } };
  }
  if (action?.type === 'ask') {
    if (s.game.phase !== 'ask') throw new Error('Not your move right now.');
    return { ...s, game: friendly(() => ask(s.game, side, cleanQuestion(action.q))) };
  }
  if (action?.type === 'guess') {
    if (s.game.phase !== 'ask') throw new Error('Not your move right now.');
    const row = cleanRow(action.row, 'A guess');
    return { ...s, game: friendly(() => guess(s.game, side, row)) };
  }
  throw new Error('That move isn’t part of this game.');
}

export function waitingOn(s: OnlineState): string[] {
  if (s.game.phase === 'setup') return s.seats.filter((_, i) => !s.setup[i]);
  if (s.game.phase === 'ask') return [s.seats[s.game.turn]];
  return [];
}

export const turnMs = () => TURN_MS;

/** Bots (and people out of time) play like the Normal bot; it only reads its own answers, never the other row. */
export function botAction(s: OnlineState, seat: string, rng: Rng): Action {
  const side = sideOf(s, seat);
  if (s.game.phase === 'setup') return { type: 'arrange', row: randomRow(rng) };
  const t = botTurn(s.game, side, 'normal', rng);
  return t.kind === 'ask' ? { type: 'ask', q: t.q } : { type: 'guess', row: t.row };
}

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  const w = winner(s.game);
  return ([0, 1] as Side[]).map((side) => ({
    seat: s.seats[side],
    place: w === 'draw' || w === side ? 1 : 2,
    detail: `${w === 'draw' ? 'draw' : w === side ? 'won' : 'lost'}, ${correct(s.game, side)}/8 right, ${s.game.config.tokens - s.game.tokens[side]} tokens used`,
  }));
}

const flip = (x: Side): Side => (1 - x) as Side;

/** What one seat sees: always side 0 on their own screen (a spectator sees seat 0's side, without any secrets). */
export function view(s: OnlineState, viewer: string | null): View {
  const second = viewer === s.seats[1];
  const me: Side = second ? 1 : 0;
  const you = s.seats.includes(viewer ?? '');
  const g = s.game;
  const done = g.phase === 'gameOver';
  const opp = flip(me);
  const myRow = you ? (g.phase === 'setup' ? s.setup[me] ?? [] : g.rows[me]) : [];
  const game: GameState = {
    ...g,
    rows: [done ? g.rows[me] : myRow, done ? g.rows[opp] : []],
    turn: second ? flip(g.turn) : g.turn,
    tokens: [g.tokens[me], g.tokens[opp]],
    // both sides' questions and answers, as in the solo log
    asked: g.asked.map((x) => ({ ...x, by: second ? flip(x.by) : x.by })),
    guesses: [you || done ? g.guesses[me] : null, done ? g.guesses[opp] : null],
  };
  return { game, opponent: s.names[opp], locked: you && !!s.setup[me] };
}
