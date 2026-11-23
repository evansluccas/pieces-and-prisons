/**
 * Sand Bid at an online table — a REAL-TIME game: the server owns the clock.
 *
 * - Each round opens with everyone "gathering": press and hold. Bots press at
 *   once. Anyone who hasn't pressed within GATHER_MS sits the round out, so
 *   one absent player can't hold up the table.
 * - Holds are timed by the server. A release carries the player's own
 *   measured hold (`heldMs`, from when THEY saw the clock start): the server
 *   accepts it if it's no more than the time it measured and at most
 *   LATENCY_ALLOWANCE less — so a slow connection isn't charged for its lag,
 *   and nobody can claim a hold they didn't make.
 * - Each player only sees their own bank and hold. Rival banks, holds and
 *   sit-outs stay secret until the match ends, exactly as in solo play.
 */
import type { Rng } from '../shared/rng';
import { Persona, botBid } from './bots';
import { GameState, newGame, nextRound, resolveRound, standings, formatMs } from './logic';
import { COUNTDOWN_MS, HoldStatus, LiveRound, bidsOf, openRound, press, release, tick as tickRound } from './round';

export const GATHER_MS = 20_000;
export const LATENCY_ALLOWANCE = 1500;
export const RESULT_MS = 6000;
const PERSONAS: Persona[] = ['steady', 'spiker', 'wild'];

interface BotPlan { bid: number; sitOutAt: number }

export interface OnlineState {
  game: GameState;
  live: LiveRound;
  plans: Record<string, BotPlan>;
  openedAt: number;
  rng: Rng;
}

export type Action = { type: 'press' } | { type: 'release'; heldMs?: number };

/** Open a round: bots plan in secret and press straight away. */
function open(game: GameState, rng: Rng, now: number): OnlineState {
  const banks = Object.fromEntries(game.players.map((p) => [p.id, p.bankMs]));
  const leader = Math.max(...game.players.map((p) => p.tokens));
  let live = openRound(banks);
  const plans: Record<string, BotPlan> = {};
  game.players.forEach((p, i) => {
    if (!p.isBot || p.bankMs <= 0) return;
    const bid = botBid({ bankMs: p.bankMs, roundsLeft: game.config.rounds - game.round + 1, myTokens: p.tokens, leaderTokens: leader }, PERSONAS[i % 3], rng);
    plans[p.id] = { bid, sitOutAt: 600 + rng() * 2000 };
    live = press(live, p.id, now);
  });
  return { game, live, plans, openedAt: now, rng };
}

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng, now: number) => open(newGame(seats), rng, now);

/** Close the round once nobody is holding any more. */
function settle(s: OnlineState): OnlineState {
  if (s.game.phase !== 'bidding' || s.live.stage !== 'over') return s;
  return { ...s, game: resolveRound(s.game, bidsOf(s.live)) };
}

export function act(s: OnlineState, seat: string, a: unknown, now: number): OnlineState {
  const action = a as Action;
  if (s.game.phase !== 'bidding') throw new Error('The round is over.');
  s = tick(s, now); // catch up on time first
  if (action?.type === 'press') return { ...s, live: press(s.live, seat, now) };
  if (action?.type === 'release') {
    let at = now;
    if (s.live.stage === 'running' && typeof action.heldMs === 'number' && Number.isFinite(action.heldMs)) {
      const measured = now - s.live.runAt!;
      const claimed = Math.max(measured - LATENCY_ALLOWANCE, Math.min(measured, action.heldMs));
      at = s.live.runAt! + Math.max(0, claimed);
    }
    return settle({ ...s, live: release(s.live, seat, at) });
  }
  throw new Error('That move isn’t part of this game.');
}

/** Advance time: gathering timeout, bot releases, countdown, auto-release at an empty bank. */
export function tick(s: OnlineState, now: number): OnlineState {
  if (s.game.phase !== 'bidding') return s;
  let live = s.live;
  // nobody can stall the start: whoever hasn't pressed by now sits out
  if (live.stage === 'gathering' && now - s.openedAt >= GATHER_MS) {
    const holders = { ...live.holders };
    for (const [id, h] of Object.entries(holders)) if (h.status === 'waiting') holders[id] = { status: 'out', bid: 0 };
    const allIn = Object.values(holders).every((h) => h.status === 'holding' || h.status === 'out');
    const anyone = Object.values(holders).some((h) => h.status === 'holding');
    live = { ...live, holders, ...(allIn && anyone ? { stage: 'countdown' as const, countdownAt: now } : {}), ...(!anyone ? { stage: 'over' as const } : {}) };
  }
  for (const [bot, plan] of Object.entries(s.plans)) {
    live = tickRound(live, now);
    if (live.holders[bot]?.status !== 'holding') continue;
    if (live.stage === 'countdown' && plan.bid === 0 && now - live.countdownAt! >= plan.sitOutAt) live = release(live, bot, live.countdownAt! + plan.sitOutAt);
    else if (live.stage === 'running' && now - live.runAt! >= plan.bid) live = release(live, bot, live.runAt! + plan.bid);
  }
  live = tickRound(live, now);
  return settle({ ...s, live });
}

/** The next moment something happens on its own (the room wakes the game then). */
export function wakeAt(s: OnlineState, now: number): number | null {
  if (s.game.phase !== 'bidding') return null;
  const { live } = s;
  const times: number[] = [];
  if (live.stage === 'gathering') times.push(s.openedAt + GATHER_MS);
  if (live.stage === 'countdown') {
    times.push(live.countdownAt! + COUNTDOWN_MS);
    for (const [bot, p] of Object.entries(s.plans)) if (live.holders[bot]?.status === 'holding' && p.bid === 0) times.push(live.countdownAt! + p.sitOutAt);
  }
  if (live.stage === 'running') {
    for (const [id, h] of Object.entries(live.holders)) {
      if (h.status !== 'holding') continue;
      times.push(live.runAt! + live.banks[id]);
      if (s.plans[id]) times.push(live.runAt! + s.plans[id].bid);
    }
  }
  const future = times.filter((t) => t >= now - 1);
  return future.length ? Math.min(...future) : null;
}

export function dropped(s: OnlineState, seat: string, now: number): OnlineState {
  if (s.game.phase !== 'bidding') return s;
  s = tick(s, now);
  const h = s.live.holders[seat];
  if (h?.status === 'holding') return settle({ ...s, live: release(s.live, seat, now) });
  if (h?.status === 'waiting') {
    const live = { ...s.live, holders: { ...s.live.holders, [seat]: { status: 'out' as const, bid: 0 } } };
    const allIn = Object.values(live.holders).every((x) => x.status === 'holding' || x.status === 'out');
    const anyone = Object.values(live.holders).some((x) => x.status === 'holding');
    return settle({ ...s, live: allIn ? (anyone ? { ...live, stage: 'countdown', countdownAt: now } : { ...live, stage: 'over' }) : live });
  }
  return s;
}

export function takeover(s: OnlineState, seat: string): OnlineState {
  return { ...s, game: { ...s.game, players: s.game.players.map((p) => (p.id === seat ? { ...p, isBot: true } : p)) } };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'result' ? { ms: RESULT_MS, next: (x: OnlineState, now: number) => {
    const game = nextRound(x.game);
    return game.phase === 'bidding' ? open(game, x.rng, now) : { ...x, game };
  } } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  return standings(s.game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.tokens}★ ${formatMs(p.bankMs)} left` }));
}

// ------------------------------------------------------------------ view ----

/** What one seat sees. Times are sent as "ms ago / ms left" so no clock sync is needed. */
export interface View {
  game: GameState;          // the viewer is 'you'; rival banks and holds hidden until the end
  stage: LiveRound['stage'];
  me: { status: HoldStatus; bid: number } | null;
  gatherLeft: number | null;    // ms until sitting out (gathering)
  notReady: number;             // how many still have to press (gathering)
  countdownLeft: number | null; // ms
  runElapsed: number | null;    // ms the round clock has run (running)
  clockFinal: number | null;    // the winning hold, once the round is over
  clocks: number[];             // where the clock stopped in each past round (public)
}

export function view(s: OnlineState, viewer: string | null, now: number): View {
  const over = s.game.phase === 'gameOver';
  const rename = (id: string) => (id === viewer ? 'you' : id);
  const game: GameState = {
    ...s.game,
    players: s.game.players.map((p) => ({
      ...p, id: rename(p.id), name: p.id === viewer ? 'You' : p.name,
      bankMs: over || p.id === viewer ? p.bankMs : -1, // -1 = secret
    })),
    history: s.game.history.map((r) => ({
      ...r,
      winner: r.winner === null ? null : rename(r.winner),
      // only your own hold and the winning hold (= the clock) are known before the end
      bids: Object.fromEntries(Object.entries(r.bids).map(([id, b]) => [rename(id), over || id === viewer || r.winner === id ? b : -1])),
      // (a tie shows the clock but not who tied)
    })),
  };
  const live = s.live;
  const mine = viewer ? live.holders[viewer] ?? null : null;
  const bidding = s.game.phase === 'bidding';
  return {
    game,
    stage: live.stage,
    me: mine,
    gatherLeft: bidding && live.stage === 'gathering' ? Math.max(0, s.openedAt + GATHER_MS - now) : null,
    notReady: Object.values(live.holders).filter((h) => h.status === 'waiting').length,
    countdownLeft: bidding && live.stage === 'countdown' ? Math.max(0, live.countdownAt! + COUNTDOWN_MS - now) : null,
    runElapsed: bidding && live.stage === 'running' ? now - live.runAt! : null,
    clockFinal: live.stage === 'over' && live.runAt !== null && live.endAt !== null ? live.endAt - live.runAt : null,
    clocks: s.game.history.map((r) => Math.max(0, ...Object.values(r.bids))),
  };
}
