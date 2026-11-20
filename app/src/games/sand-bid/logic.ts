/**
 * SAND BID — rules (our own take on a blind time auction)
 *
 * - Every player starts with the same secret bank of time (default 3:00).
 * - Each round, everyone with time left presses and holds their button. When
 *   all of them are holding, a 3-second countdown starts. Letting go during the
 *   countdown means sitting the round out (it costs nothing). Players with an
 *   empty bank sit out automatically.
 * - When the countdown ends, the round clock runs. Each player lets go whenever
 *   they like; the time they held is their bid and is spent from their bank,
 *   win or lose. At 0:00 a player's button releases itself.
 * - The round lasts until the LAST player lets go, so everyone sees how long
 *   the round ran (= the winning hold). Who let go when stays secret.
 * - The longest hold wins the round and earns 1 star. Exact ties earn nothing.
 *   (Live round timing lives in round.ts.)
 * - After the last round, most stars wins. Ties go to whoever has more time
 *   left. The player in last place goes to prison.
 */

export type Phase = 'bidding' | 'result' | 'gameOver';

export interface Config {
  rounds: number;
  bankMs: number;
}

export const DEFAULT_CONFIG: Config = { rounds: 11, bankMs: 180_000 };

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  bankMs: number;
  tokens: number;
}

export interface RoundRecord {
  round: number;
  bids: Record<string, number>; // ms held (0 = sat out)
  winner: string | null;
}

export interface GameState {
  config: Config;
  players: PlayerState[];
  round: number;
  phase: Phase;
  history: RoundRecord[];
}

export function newGame(players: { id: string; name: string; isBot: boolean }[], config = DEFAULT_CONFIG): GameState {
  if (players.length < 2) throw new Error('need at least 2 players');
  return {
    config,
    players: players.map((p) => ({ ...p, bankMs: config.bankMs, tokens: 0 })),
    round: 1,
    phase: 'bidding',
    history: [],
  };
}

/** Strictly longest positive bid wins; ties or all-zero mean no winner. */
export function roundWinner(bids: Record<string, number>): string | null {
  let best = 0;
  let who: string[] = [];
  for (const [id, ms] of Object.entries(bids)) {
    if (ms > best) {
      best = ms;
      who = [id];
    } else if (ms === best && ms > 0) who.push(id);
  }
  return who.length === 1 ? who[0] : null;
}

export function resolveRound(s: GameState, rawBids: Record<string, number>): GameState {
  if (s.phase !== 'bidding') throw new Error('not in bidding phase');
  const bids: Record<string, number> = {};
  for (const p of s.players) {
    const raw = rawBids[p.id];
    if (raw === undefined) throw new Error(`missing bid for ${p.id}`);
    bids[p.id] = Math.round(Math.min(Math.max(0, raw), p.bankMs));
  }
  const winner = roundWinner(bids);
  const players = s.players.map((p) => ({
    ...p,
    bankMs: p.bankMs - bids[p.id],
    tokens: p.tokens + (winner === p.id ? 1 : 0),
  }));
  return { ...s, players, phase: 'result', history: [...s.history, { round: s.round, bids, winner }] };
}

export function nextRound(s: GameState): GameState {
  if (s.phase !== 'result') throw new Error('round not finished');
  if (s.round >= s.config.rounds) return { ...s, phase: 'gameOver' };
  return { ...s, round: s.round + 1, phase: 'bidding' };
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => b.p.tokens - a.p.tokens || b.p.bankMs - a.p.bankMs || a.seat - b.seat)
    .map((x) => x.p);
}

export function formatMs(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 10));
  const cs = t % 100;
  const s = Math.floor(t / 100) % 60;
  const m = Math.floor(t / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
