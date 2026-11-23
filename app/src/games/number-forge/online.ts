/**
 * Number Forge at an online table — a REAL-TIME race: the server owns the clock.
 *
 * - A round opens when the server says so and ends after at most roundMs
 *   (60 s), or when someone closes the forge correctly.
 * - Forges are applied in the order they reach the server, so the first valid
 *   forge of a set of tiles claims it; later ones score −1 ("already claimed").
 * - Bots plan their next move with the same think-times as solo play and the
 *   room wakes the game when one is due.
 * - Players only see what solo shows: the claimed sets, scores and the log.
 *   How many answers exist stays hidden until the round ends.
 */
import type { Rng } from '../shared/rng';
import { Persona, botMove, botThinkMs } from './bots';
import { Claim, GameState, close, forge, newGame, nextRound, standings, timeUp } from './logic';

export const RESULT_MS = 9000;
const PERSONAS: Persona[] = ['steady', 'quick', 'sloppy'];

export interface OnlineState {
  game: GameState;
  openedAt: number;               // server ms when this round opened
  personas: Record<string, Persona>;
  plans: Record<string, number>;  // server ms of each bot's next move (missing = plan at the next tick)
  rng: Rng;
}

export type Action = { type: 'forge'; order: number[] } | { type: 'close' };

const bots = (s: OnlineState) => s.game.players.filter((p) => p.isBot).map((p) => p.id);

/** Open the round that's in `game`: every bot starts thinking. */
function open(game: GameState, personas: Record<string, Persona>, rng: Rng, now: number): OnlineState {
  const s: OnlineState = { game, openedAt: now, personas, plans: {}, rng };
  for (const id of bots(s)) s.plans[id] = now + botThinkMs(game, personas[id], rng);
  return s;
}

export function start(seats: { id: string; name: string; isBot: boolean }[], rng: Rng, now: number): OnlineState {
  const game = newGame(seats, rng);
  const personas = Object.fromEntries(seats.map((p, i) => [p.id, PERSONAS[i % PERSONAS.length]]));
  return open(game, personas, rng, now);
}

/** Run everything due up to `now` in time order: bot moves, then the 60 s cap. */
export function tick(s: OnlineState, now: number): OnlineState {
  if (s.game.phase !== 'play') return s;
  let game = s.game;
  const plans = { ...s.plans };
  // seats just handed to a bot start thinking now
  for (const id of bots(s)) if (plans[id] === undefined) plans[id] = now + botThinkMs(game, s.personas[id], s.rng);
  const endAt = s.openedAt + game.config.roundMs;
  for (;;) {
    const due = bots(s).filter((id) => plans[id] <= now && plans[id] < endAt).sort((x, y) => plans[x] - plans[y]);
    if (game.phase !== 'play' || !due.length) break;
    const id = due[0];
    const at = plans[id];
    const m = botMove(game, s.personas[id], s.rng);
    if (m.kind === 'forge') game = forge(game, id, m.order, at - s.openedAt);
    else if (m.kind === 'close') game = close(game, id, at - s.openedAt);
    plans[id] = at + botThinkMs(game, s.personas[id], s.rng);
  }
  if (game.phase === 'play' && now >= endAt) game = timeUp(game);
  return { ...s, game, plans };
}

export function wakeAt(s: OnlineState, now: number): number | null {
  if (s.game.phase !== 'play') return null;
  const times = [s.openedAt + s.game.config.roundMs];
  for (const id of bots(s)) times.push(s.plans[id] ?? now);
  return Math.min(...times);
}

function parse(a: unknown): Action {
  const action = a as Action | null;
  if (action?.type === 'close') return { type: 'close' };
  if (action?.type === 'forge') {
    const order = (action as { order?: unknown }).order;
    if (
      !Array.isArray(order) || order.length !== 3 || new Set(order).size !== 3 ||
      order.some((i) => !Number.isInteger(i) || i < 0 || i > 9)
    ) throw new Error('Pick three different tiles.');
    return { type: 'forge', order: [...order] };
  }
  throw new Error('That move isn’t part of this game.');
}

export function act(s: OnlineState, seat: string, a: unknown, now: number): OnlineState {
  const action = parse(a);
  s = tick(s, now); // catch up on time first: the round may have just ended
  if (s.game.phase !== 'play') throw new Error('The round is over.');
  if (!s.game.players.some((p) => p.id === seat)) throw new Error('You aren’t playing this game.');
  const at = now - s.openedAt;
  const game = action.type === 'forge' ? forge(s.game, seat, action.order, at) : close(s.game, seat, at);
  return { ...s, game };
}

/** Someone lost connection or left: they simply stop forging. */
export const dropped = (s: OnlineState) => s;

/** A bot plays the seat from now on (it gets a plan at the next tick). */
export function takeover(s: OnlineState, seat: string): OnlineState {
  const plans = { ...s.plans };
  delete plans[seat];
  return { ...s, plans, game: { ...s.game, players: s.game.players.map((p) => (p.id === seat ? { ...p, isBot: true } : p)) } };
}

export const realtime = { wakeAt, tick, dropped, takeover };

// real-time: nobody "has the turn", and bots are driven inside the game
export const waitingOn = () => [];
export const botAction = () => null;

export const pause = (s: OnlineState) =>
  s.game.phase === 'result'
    ? { ms: RESULT_MS, next: (x: OnlineState, now: number) => {
      const game = nextRound(x.game, x.rng);
      return game.phase === 'play' ? open(game, x.personas, x.rng, now) : { ...x, game };
    } }
    : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results(s: OnlineState) {
  return standings(s.game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.points} pts · ${p.correct} forged` }));
}

// ------------------------------------------------------------------ view ----

/** What one seat sees. The round clock is sent as "ms left" so no clock sync is needed. */
export interface View {
  game: GameState; // the viewer is 'you'; answers are hidden while the round runs
  left: number | null; // ms until the round ends (play only)
}

export function view(s: OnlineState, viewer: string | null, now: number): View {
  const rename = (id: string) => (id === viewer ? 'you' : id);
  const claims = (cs: Claim[]) => cs.map((c) => ({ ...c, player: rename(c.player) }));
  const playing = s.game.phase === 'play';
  const game: GameState = {
    ...s.game,
    players: s.game.players.map((p) => ({ ...p, id: rename(p.id), name: p.id === viewer ? 'You' : p.name })),
    answers: playing ? [] : s.game.answers,
    claims: claims(s.game.claims),
    history: s.game.history.map((r) => ({ ...r, claims: claims(r.claims) })),
  };
  return { game, left: playing ? Math.max(0, s.openedAt + s.game.config.roundMs - now) : null };
}
