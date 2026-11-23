/**
 * PUZZLE RACES — the shared online format for the solo puzzles.
 *
 * Everyone at the table gets the same puzzle each round and solves it on
 * their own; the server is the referee and the clock:
 *
 * - The server makes every puzzle and keeps the answer. Players see only what
 *   the puzzle's own `view` allows (never the answer), and send their moves or
 *   their finished solution; the puzzle's `act` checks them on the server.
 * - Time is measured by the server from the moment the round opens (after any
 *   study phase), plus the puzzle's own penalties (wrong tries, hints).
 * - A round ends when everyone has finished or its time limit runs out;
 *   anyone still working scores "not finished" for that round.
 * - Ranking: most points (a solved puzzle scores its points, usually 1), then
 *   the lowest total time. Bots finish at a time the puzzle picks for them,
 *   like the solo game's ghost rivals.
 *
 * A puzzle plugs in by describing itself as a `RacePuzzle`; `race()` turns
 * that into everything an online table needs (a real-time game).
 */
import type { Rng } from './rng';

export type Stage = 'study' | 'solve' | 'result' | 'over';

/** How one seat did in one round. */
export interface RoundResult {
  finished: boolean;
  ms: number;       // time used, penalties included (the time limit if not finished)
  points: number;   // what counts first in the ranking
  detail: string;   // a short line for the scoreboard, e.g. "2 wrong tries"
}

/** What a puzzle's `act` returns after checking a move. */
export interface Outcome<M> {
  mine: M;                 // the player's updated private progress
  penaltyMs?: number;      // time to add (a wrong try, a hint)
  finish?: { points: number; detail?: string }; // set when the player is done with this round
}

export interface RacePuzzle<P, M> {
  rounds: number;
  /** Make round `round` (0-based). */
  make(rng: Rng, round: number): P;
  /** Time limit for solving (ms), after any study phase. */
  limitMs(p: P): number;
  /** Optional study phase before solving starts (ms). Moves are refused during it. */
  studyMs?(p: P): number;
  /** A player's private progress at the start of a round (wrong tries, marks, hints used...). */
  init(p: P): M;
  /** Check a move. Throw an Error with a friendly message if it isn't allowed. */
  act(p: P, mine: M, action: unknown, elapsedMs: number): Outcome<M>;
  /**
   * What one player may see. `mine` is null for a spectator. During 'study'
   * and 'solve' this must never include the answer; at 'result' and 'over'
   * the puzzle may show it.
   */
  view(p: P, stage: Stage, mine: M | null): unknown;
  /** When a bot finishes this round (ms after solving opens) and how it scores. */
  bot(p: P, rng: Rng, seatIndex: number): { ms: number; points: number; penaltyMs?: number; detail?: string };
  /** Points for "not finished" (default 0) and a line describing it. */
  unfinished?(p: P, mine: M): { points: number; detail: string };
}

export const RESULT_MS = 8000;

interface Seat { id: string; name: string; isBot: boolean }

export interface RaceState<P, M> {
  seats: Seat[];
  puzzles: P[];
  round: number;
  stage: Stage;
  stageAt: number;                         // when the current stage began (server ms)
  mine: Record<string, M>;
  penalty: Record<string, number>;         // penalty ms this round
  results: Record<string, RoundResult>[];  // per round, per seat (filled in as players finish)
  botPlans: Record<string, { at: number; points: number; penaltyMs: number; detail: string }>;
  rng: Rng;
  /** A shorter time limit for every round (the Party plays quick races); otherwise the puzzle's own. */
  limitMs?: number;
}

/** What a seat is sent. */
export interface RaceView {
  round: number;            // 0-based
  rounds: number;
  stage: Stage;
  leftMs: number | null;    // until the study ends / the time limit (null outside those)
  puzzle: unknown;          // the puzzle's own view
  me: { finished: boolean; result: RoundResult | null; penaltyMs: number } | null;
  board: {
    name: string;
    you: boolean;
    bot: boolean;
    round: RoundResult | null; // this round, once that seat has finished (or the round is over)
    points: number;            // totals over finished rounds
    ms: number;
  }[];
  history: { name: string; you: boolean; results: (RoundResult | null)[] }[];
}

export function race<P, M>(puzzle: RacePuzzle<P, M>) {
  type S = RaceState<P, M>;

  function open(s: S, round: number, now: number): S {
    const p = s.puzzles[round];
    const study = puzzle.studyMs?.(p) ?? 0;
    const mine: Record<string, M> = {};
    const penalty: Record<string, number> = {};
    const botPlans: S['botPlans'] = {};
    s.seats.forEach((seat, i) => {
      mine[seat.id] = puzzle.init(p);
      penalty[seat.id] = 0;
      if (seat.isBot) botPlans[seat.id] = plan(s, p, i);
    });
    return { ...s, round, stage: study > 0 ? 'study' : 'solve', stageAt: now, mine, penalty, botPlans, results: [...s.results, {}] };
  }

  function plan(s: S, p: P, i: number) {
    const b = puzzle.bot(p, s.rng, i);
    return { at: Math.max(1000, Math.round(b.ms)), points: b.points, penaltyMs: b.penaltyMs ?? 0, detail: b.detail ?? '' };
  }

  const limit = (s: S) => s.limitMs ?? puzzle.limitMs(s.puzzles[s.round]);
  const current = (s: S) => s.results[s.round];

  function record(s: S, seat: string, r: RoundResult): S {
    const results = [...s.results];
    results[s.round] = { ...current(s), [seat]: r };
    return { ...s, results };
  }

  /** Everyone done, or time's up: close the round. */
  function maybeClose(s: S, now: number): S {
    if (s.stage !== 'solve') return s;
    const timeUp = now - s.stageAt >= limit(s);
    const everyone = s.seats.every((seat) => current(s)[seat.id]);
    if (!timeUp && !everyone) return s;
    let next = s;
    for (const seat of s.seats) {
      if (current(next)[seat.id]) continue;
      const p = s.puzzles[s.round];
      const u = puzzle.unfinished?.(p, s.mine[seat.id]) ?? { points: 0, detail: 'not finished' };
      next = record(next, seat.id, { finished: false, ms: limit(s), points: u.points, detail: u.detail });
    }
    return { ...next, stage: 'result', stageAt: now };
  }

  function tick(s: S, now: number): S {
    if (s.stage === 'study' && now - s.stageAt >= (puzzle.studyMs?.(s.puzzles[s.round]) ?? 0)) {
      s = { ...s, stage: 'solve', stageAt: s.stageAt + (puzzle.studyMs?.(s.puzzles[s.round]) ?? 0) };
    }
    if (s.stage !== 'solve') return s;
    for (const [id, b] of Object.entries(s.botPlans)) {
      if (current(s)[id] || now - s.stageAt < b.at || b.at >= limit(s)) continue;
      s = record(s, id, { finished: true, ms: b.at + b.penaltyMs, points: b.points, detail: b.detail });
    }
    return maybeClose(s, now);
  }

  function wakeAt(s: S, now: number): number | null {
    if (s.stage === 'study') return s.stageAt + (puzzle.studyMs?.(s.puzzles[s.round]) ?? 0);
    if (s.stage !== 'solve') return null;
    const times = [s.stageAt + limit(s)];
    for (const [id, b] of Object.entries(s.botPlans)) if (!current(s)[id]) times.push(s.stageAt + b.at);
    const future = times.filter((t) => t >= now - 1);
    return future.length ? Math.min(...future) : now;
  }

  function act(s: S, seat: string, action: unknown, now: number): S {
    s = tick(s, now);
    if (s.stage === 'study') throw new Error('Study first — solving starts in a moment.');
    if (s.stage !== 'solve') throw new Error('The round is over.');
    if (current(s)[seat]) throw new Error('You’ve finished this round.');
    const elapsed = now - s.stageAt;
    const out = puzzle.act(s.puzzles[s.round], s.mine[seat], action, elapsed);
    const penalty = (s.penalty[seat] ?? 0) + (out.penaltyMs ?? 0);
    s = { ...s, mine: { ...s.mine, [seat]: out.mine }, penalty: { ...s.penalty, [seat]: penalty } };
    if (out.finish) {
      s = record(s, seat, { finished: true, ms: elapsed + penalty, points: out.finish.points, detail: out.finish.detail ?? '' });
    }
    return maybeClose(s, now);
  }

  const totals = (s: S, seat: string) => {
    let points = 0;
    let ms = 0;
    s.results.forEach((round, i) => {
      const r = round[seat];
      // only rounds that are settled count towards the totals
      if (!r || (i === s.round && s.stage !== 'result' && s.stage !== 'over')) return;
      points += r.points;
      ms += r.ms;
    });
    return { points, ms };
  };

  function standings(s: S) {
    return s.seats
      .map((seat, i) => ({ seat, i, ...totals(s, seat.id) }))
      .sort((a, b) => b.points - a.points || a.ms - b.ms || a.i - b.i);
  }

  return {
    start(seats: Seat[], rng: Rng, now: number): S {
      const puzzles = Array.from({ length: puzzle.rounds }, (_, i) => puzzle.make(rng, i));
      const s: S = { seats, puzzles, round: 0, stage: 'solve', stageAt: now, mine: {}, penalty: {}, results: [], botPlans: {}, rng };
      return open(s, 0, now);
    },
    act,
    waitingOn: (s: S): string[] => (s.stage === 'solve' ? s.seats.filter((seat) => !current(s)[seat.id]).map((seat) => seat.id) : []),
    botAction: () => null,
    pause: (s: S) =>
      s.stage === 'result'
        ? {
          ms: RESULT_MS,
          next: (x: S, now: number): S => (x.round + 1 < x.puzzles.length ? open(x, x.round + 1, now) : { ...x, stage: 'over', stageAt: now }),
        }
        : null,
    over: (s: S) => s.stage === 'over',
    results: (s: S) =>
      standings(s).map((r, i) => ({
        seat: r.seat.id,
        place: i + 1,
        detail: `${r.points} point${r.points === 1 ? '' : 's'}, ${clock(r.ms)}`,
      })),
    view(s: S, viewer: string | null, now: number): RaceView {
      const p = s.puzzles[s.round];
      const mine = viewer ? s.mine[viewer] ?? null : null;
      const settled = s.stage === 'result' || s.stage === 'over';
      const leftMs = s.stage === 'study' ? s.stageAt + (puzzle.studyMs?.(p) ?? 0) - now
        : s.stage === 'solve' ? s.stageAt + limit(s) - now : null;
      return {
        round: s.round,
        rounds: s.puzzles.length,
        stage: s.stage,
        leftMs: leftMs === null ? null : Math.max(0, leftMs),
        puzzle: puzzle.view(p, s.stage, mine),
        me: viewer ? { finished: !!current(s)[viewer], result: current(s)[viewer] ?? null, penaltyMs: s.penalty[viewer] ?? 0 } : null,
        board: standings(s).map((r) => ({
          name: r.seat.id === viewer ? 'You' : r.seat.name,
          you: r.seat.id === viewer,
          bot: r.seat.isBot,
          round: current(s)[r.seat.id] ?? null,
          points: r.points,
          ms: r.ms,
        })),
        history: s.seats.map((seat) => ({
          name: seat.id === viewer ? 'You' : seat.name,
          you: seat.id === viewer,
          results: s.results.map((round, i) => (i < s.round || settled ? round[seat.id] ?? null : null)),
        })),
      };
    },
    realtime: {
      wakeAt,
      tick,
      dropped: (s: S) => s,
      /** Someone left for good: a bot finishes their round from here. */
      takeover(s: S, seat: string): S {
        const i = s.seats.findIndex((x) => x.id === seat);
        const seats = s.seats.map((x) => (x.id === seat ? { ...x, isBot: true } : x));
        const next = { ...s, seats };
        if (s.stage !== 'solve' && s.stage !== 'study') return next;
        if (current(s)[seat]) return next;
        const b = plan(next, s.puzzles[s.round], i);
        // it can't finish before now
        const elapsed = Math.max(0, Date.now() - s.stageAt);
        return { ...next, botPlans: { ...s.botPlans, [seat]: { ...b, at: Math.max(b.at, elapsed + 1000) } } };
      },
    },
  };
}

export const clock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
