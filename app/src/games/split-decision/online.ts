/**
 * Split Decision at an online table — a REAL-TIME game: the server owns every clock.
 *
 * - Each question opens on the server. Card memory questions first show the
 *   grid for the study time (memorizeMs, as in solo); then the 30-second
 *   answer clock starts, for everyone at once.
 * - Answer times are measured by the server from when the question opened. A
 *   player may send their own measured time (from when THEY saw it open): it
 *   is accepted only between the server's time minus LATENCY_ALLOWANCE and
 *   the server's time, so lag isn't charged but nobody can claim to be faster.
 * - Whoever hasn't answered when the clock runs out gets no answer and no
 *   point, as in solo. Bots answer at their own pace (like solo), driven here.
 * - Each player sees only that they and others have answered; the picks and
 *   the right answer come out when the question closes. The card grid is only
 *   ever sent while it's being studied; afterwards just the two asked squares.
 */
import type { Card } from '../deadeye-holdem/cards';
import type { Rng } from '../shared/rng';
import { botAnswer } from './bots';
import { Data, GameState, MemoryQ, Pick, Question, choose, newGame, next, question, standings, startAnswering, timeUp } from './logic';

export const LATENCY_ALLOWANCE = 1500;
/** How long each question's result stays up (Ready skips it). */
export const REVEAL_MS = 7000;

interface BotPlan { choice: 0 | 1; ms: number }

export interface OnlineState {
  game: GameState;
  /** When the current phase (studying or answering) began, server ms. */
  phaseAt: number;
  /** Bots' secret answers for the open question. */
  plans: Record<string, BotPlan>;
  rng: Rng;
}

export type Action = { type: 'answer'; choice: 0 | 1; ms?: number };

/** Plan the bots' answers for a question that just opened (medium skill, solo-like think times). */
function planBots(game: GameState, rng: Rng, only?: string): Record<string, BotPlan> {
  const plans: Record<string, BotPlan> = {};
  for (const p of game.players) {
    if (!p.isBot || p.id in game.picks || (only && p.id !== only)) continue;
    plans[p.id] = botAnswer(game, 'steady', rng);
  }
  return plans;
}

/** A question (or its study time) begins at `at`. */
function open(game: GameState, rng: Rng, at: number): OnlineState {
  return { game, phaseAt: at, plans: game.phase === 'answer' ? planBots(game, rng) : {}, rng };
}

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng, now: number) => open(newGame(seats, rng), rng, now);

/** Advance time: study ends, bots answer when their time comes, the clock runs out. */
export function tick(s: OnlineState, now: number): OnlineState {
  const { config } = s.game;
  if (s.game.phase === 'memorize' && now >= s.phaseAt + config.memorizeMs) s = open(startAnswering(s.game), s.rng, s.phaseAt + config.memorizeMs);
  if (s.game.phase !== 'answer') return s;
  let game = s.game;
  const due = Object.entries(s.plans).filter(([, p]) => now >= s.phaseAt + p.ms).sort((x, y) => x[1].ms - y[1].ms);
  for (const [id, p] of due) {
    // bots are timed like everyone else: what the server measured
    if (game.phase === 'answer' && !(id in game.picks)) game = choose(game, id, p.choice, Math.max(p.ms, now - s.phaseAt));
  }
  if (game.phase === 'answer' && now >= s.phaseAt + config.answerMs) game = timeUp(game);
  return game === s.game ? s : { ...s, game };
}

export function act(s: OnlineState, seat: string, a: unknown, now: number): OnlineState {
  const action = a as Action;
  if (action?.type !== 'answer') throw new Error('That move isn’t part of this game.');
  if (action.choice !== 0 && action.choice !== 1) throw new Error('Pick one of the two answers.');
  if (!s.game.players.some((p) => p.id === seat)) throw new Error('You’re not playing this game.');
  s = tick(s, now); // catch up on time first
  if (s.game.phase === 'memorize') throw new Error('Study the cards — the question opens in a moment.');
  if (s.game.phase !== 'answer') throw new Error('This question is closed.');
  if (seat in s.game.picks) throw new Error('You’ve already answered.');
  const measured = now - s.phaseAt;
  let ms = measured;
  if (typeof action.ms === 'number' && Number.isFinite(action.ms)) ms = Math.max(measured - LATENCY_ALLOWANCE, Math.min(measured, action.ms));
  return { ...s, game: choose(s.game, seat, action.choice, Math.max(0, Math.round(ms))) };
}

/** The next moment something happens on its own (the room wakes the game then). */
export function wakeAt(s: OnlineState): number | null {
  const { config, phase, picks } = s.game;
  if (phase === 'memorize') return s.phaseAt + config.memorizeMs;
  if (phase !== 'answer') return null;
  const bots = Object.entries(s.plans).filter(([id]) => !(id in picks)).map(([, p]) => s.phaseAt + p.ms);
  return Math.min(s.phaseAt + config.answerMs, ...bots);
}

/** A lost connection changes nothing: the clock runs on, and a missed answer scores nothing. */
export const dropped = (s: OnlineState) => s;

/** A player left for good: a bot answers for the seat from now on (and the open question, if not yet answered). */
export function takeover(s: OnlineState, seat: string): OnlineState {
  const game = { ...s.game, players: s.game.players.map((p) => (p.id === seat ? { ...p, isBot: true } : p)) };
  const plans = game.phase === 'answer' ? { ...s.plans, ...planBots(game, s.rng, seat) } : s.plans;
  return { ...s, game, plans };
}

export const realtime = { wakeAt, tick, dropped, takeover };

/** Who still has to answer (the room shows this; bots are timed by the game). */
export const waitingOn = (s: OnlineState): string[] =>
  s.game.phase === 'answer' ? s.game.players.filter((p) => !p.isBot && !(p.id in s.game.picks)).map((p) => p.id) : [];

/** Never used: bots are driven inside the game, and a timed-out player gets no answer. */
export const botAction = () => null;

export const pause = (s: OnlineState) =>
  s.game.phase === 'reveal' ? { ms: REVEAL_MS, next: (x: OnlineState, now: number) => open(next(x.game), x.rng, now) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  return standings(s.game).map((p, i) => ({
    seat: p.id, place: i + 1, detail: `${p.points}/${s.game.questions.length} right, ${(p.timeMs / 1000).toFixed(1)} s`,
  }));
}

// ------------------------------------------------------------------ view ----

/** A card memory question as a player may see it: cards, the asked card and the squares can be hidden (null). */
export type SeenMemory = Omit<MemoryQ, 'cards' | 'ask' | 'spots'> & { cards: (Card | null)[]; ask: number | null; spots: [number, number] | null };
export type SeenData = Exclude<Data, MemoryQ> | SeenMemory;
/** A question as a player may see it: the right answer is null until it closes. */
export interface SeenQuestion { data: SeenData; prompt: string; options: [string, string]; answer: 0 | 1 | null }
export type ClosedQuestion = SeenQuestion & { answer: 0 | 1 };
/** The game as one seat sees it (solo passes the full GameState, which fits this too). */
export interface SeenState extends Omit<GameState, 'questions' | 'results'> {
  questions: (SeenQuestion | null)[]; // future questions are null
  results: { question: ClosedQuestion; picks: Record<string, Pick> }[];
}

/** What one seat sees. Times are "ms left", so no clock sync is needed. */
export interface View {
  game: SeenState;
  /** Ms left to study (memorize) or to answer (answer); null otherwise. */
  leftMs: number | null;
}

/** Hide what a question mustn't show yet: while studying, what will be asked; while open, the answer and the cards. */
export function seenQuestion(q: Question, stage: 'study' | 'open' | 'closed'): SeenQuestion {
  const d = q.data;
  if (d.kind !== 'memory') return stage === 'closed' ? q : { ...q, answer: null };
  if (stage === 'study') return { ...q, prompt: '', answer: null, data: { ...d, ask: null, spots: null } };
  // after the study time only the two asked squares are ever shown (face up once closed)
  const cards = d.cards.map((c, i) => (stage === 'closed' && d.spots.includes(i) ? c : null));
  return stage === 'closed' ? { ...q, data: { ...d, cards } } : { ...q, answer: null, data: { ...d, cards, ask: null } };
}

const closed = (q: Question): ClosedQuestion => ({ ...seenQuestion(q, 'closed'), answer: q.answer });

export function view(s: OnlineState, viewer: string | null, now: number): View {
  const g = s.game;
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  const stage = g.phase === 'memorize' ? 'study' : g.phase === 'answer' ? 'open' : 'closed';
  // while answering, others only show as "answered"
  const picks = g.phase === 'answer'
    ? Object.fromEntries(Object.entries(g.picks).map(([id, p]) => [r(id), id === viewer ? p : { choice: null, ms: 0 }]))
    : keys(g.picks);
  const game: SeenState = {
    ...g,
    players: g.players.map((p) => (p.id === viewer ? { ...p, id: 'you', name: 'You' } : p)),
    questions: g.questions.map((q, i) => (i < g.index ? closed(q) : i === g.index ? seenQuestion(question(g), stage) : null)),
    picks,
    results: g.results.map((x) => ({ question: closed(x.question), picks: keys(x.picks) })),
  };
  const left = g.phase === 'memorize' ? s.phaseAt + g.config.memorizeMs - now : g.phase === 'answer' ? s.phaseAt + g.config.answerMs - now : null;
  return { game, leftMs: left === null ? null : Math.max(0, left) };
}
