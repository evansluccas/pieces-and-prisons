/**
 * PIGGY BLUFF — rules (our own coin-counting bluff game)
 *
 * - A piggy bank starts with 1 black and 1 white coin.
 * - ADD: whoever holds the bank secretly drops in 1–3 coins of any colours.
 *   Everyone sees HOW MANY coins went in, but only the adder knows the colours.
 *   They then pass the bank to any other player.
 * - CLAIM: the receiver must announce how many coins of the asked colour are
 *   inside. The asked colour alternates every claim: black, white, black…
 *   You can't look inside — you only know the coins you added yourself.
 * - DOUBT: everyone else secretly chooses Doubt or Believe.
 *     Nobody doubts → the claim stands, nothing is scored, the bank keeps its
 *       coins and the receiver adds next.
 *     Someone doubts → the bank is opened:
 *       claim wrong   → each doubter +1, claimer −1; the claimer starts the next bank
 *       claim correct → claimer +1, each doubter −1; the first doubter starts the next bank
 *     The bank then resets to 1 black + 1 white.
 * - First to 5 points wins (or most points after 24 claims). Ties: fewer
 *   wrong claims. Lowest score goes to prison.
 */

export type Color = 'black' | 'white';
export interface Coins { black: number; white: number }
export interface Addition extends Coins { player: string }

export interface Config { target: number; maxClaims: number; maxAdd: number }
export const DEFAULT_CONFIG: Config = { target: 5, maxClaims: 24, maxAdd: 3 };

export interface PlayerState { id: string; name: string; isBot: boolean; points: number; wrongClaims: number }

export interface ClaimRecord {
  n: number;
  claimer: string;
  color: Color;
  claim: number;
  opened: boolean;
  actual: Coins | null;
  doubters: string[];
  correct: boolean | null;
  delta: Record<string, number>;
}

export type Phase = 'add' | 'claim' | 'doubt' | 'reveal' | 'gameOver';

export interface GameState {
  config: Config;
  players: PlayerState[];
  phase: Phase;
  bank: Coins;
  additions: Addition[]; // since the bank was last opened
  holder: string;        // who adds next
  receiver: string | null;
  color: Color;          // colour asked in the next / current claim
  claim: number | null;
  responses: Record<string, boolean>; // true = doubt
  claims: number;
  history: ClaimRecord[];
}

export const START: Coins = { black: 1, white: 1 };
export const total = (c: Coins) => c.black + c.white;

export function newGame(players: { id: string; name: string; isBot: boolean }[], config = DEFAULT_CONFIG): GameState {
  if (players.length < 3) throw new Error('need at least 3 players');
  return {
    config,
    players: players.map((p) => ({ ...p, points: 0, wrongClaims: 0 })),
    phase: 'add',
    bank: { ...START },
    additions: [],
    holder: players[0].id,
    receiver: null,
    color: 'black',
    claim: null,
    responses: {},
    claims: 0,
    history: [],
  };
}

export function add(s: GameState, id: string, coins: Coins, to: string): GameState {
  if (s.phase !== 'add' || s.holder !== id) throw new Error('not your bank');
  const n = total(coins);
  if (coins.black < 0 || coins.white < 0 || n < 1 || n > s.config.maxAdd) throw new Error(`add 1 to ${s.config.maxAdd} coins`);
  if (to === id || !s.players.some((p) => p.id === to)) throw new Error('pass to another player');
  return {
    ...s,
    bank: { black: s.bank.black + coins.black, white: s.bank.white + coins.white },
    additions: [...s.additions, { player: id, ...coins }],
    receiver: to,
    phase: 'claim',
  };
}

export function claim(s: GameState, id: string, n: number): GameState {
  if (s.phase !== 'claim' || s.receiver !== id) throw new Error('not your claim');
  if (!Number.isInteger(n) || n < 0 || n > total(s.bank)) throw new Error('impossible count');
  return { ...s, claim: n, responses: {}, phase: 'doubt' };
}

export const responders = (s: GameState) => s.players.filter((p) => p.id !== s.receiver).map((p) => p.id);

export function respond(s: GameState, id: string, doubt: boolean): GameState {
  if (s.phase !== 'doubt' || id === s.receiver || !responders(s).includes(id)) throw new Error('not your call');
  const responses = { ...s.responses, [id]: doubt };
  const next = { ...s, responses };
  return responders(s).every((r) => r in responses) ? resolve(next) : next;
}

function resolve(s: GameState): GameState {
  const claimer = s.receiver!;
  const n = s.players.length;
  const seat = (id: string) => s.players.findIndex((p) => p.id === id);
  // doubters in clockwise order starting after the claimer
  const doubters = responders(s)
    .filter((id) => s.responses[id])
    .sort((a, b) => ((seat(a) - seat(claimer) + n) % n) - ((seat(b) - seat(claimer) + n) % n));
  const delta: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const record: ClaimRecord = {
    n: s.claims + 1, claimer, color: s.color, claim: s.claim!, opened: doubters.length > 0,
    actual: null, doubters, correct: null, delta,
  };
  let { bank, additions } = s;
  let holder = claimer;
  if (doubters.length) {
    const actual = s.bank[s.color];
    record.actual = { ...s.bank };
    record.correct = actual === s.claim;
    if (record.correct) {
      delta[claimer] += 1;
      for (const d of doubters) delta[d] -= 1;
      holder = doubters[0];
    } else {
      delta[claimer] -= 1;
      for (const d of doubters) delta[d] += 1;
    }
    bank = { ...START };
    additions = [];
  }
  const players = s.players.map((p) => ({
    ...p,
    points: p.points + delta[p.id],
    wrongClaims: p.wrongClaims + (p.id === claimer && record.correct === false ? 1 : 0),
  }));
  return {
    ...s, players, bank, additions, holder, phase: 'reveal', claims: s.claims + 1,
    history: [...s.history, record],
  };
}

/** After showing the result: next bank turn, or the end of the match. */
export function proceed(s: GameState): GameState {
  if (s.phase !== 'reveal') throw new Error('nothing to continue');
  const won = s.players.some((p) => p.points >= s.config.target);
  if (won || s.claims >= s.config.maxClaims) return { ...s, phase: 'gameOver' };
  return { ...s, phase: 'add', receiver: null, claim: null, responses: {}, color: s.color === 'black' ? 'white' : 'black' };
}

export function standings(s: GameState): PlayerState[] {
  return s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => b.p.points - a.p.points || a.p.wrongClaims - b.p.wrongClaims || a.seat - b.seat)
    .map((x) => x.p);
}

// ---------------------------------------------------------- knowledge ----

/** What `viewer` knows: the starting coins plus their own additions, and how many coins others added. */
export function knowledge(s: GameState, viewer: string): { known: Coins; unknown: number } {
  const known = { ...START };
  let unknown = 0;
  for (const a of s.additions) {
    if (a.player === viewer) {
      known.black += a.black;
      known.white += a.white;
    } else unknown += a.black + a.white;
  }
  return { known, unknown };
}

const choose = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Chance of each possible count of `color`, assuming unseen coins are 50/50. */
export function countOdds(s: GameState, viewer: string, color: Color): number[] {
  const { known, unknown } = knowledge(s, viewer);
  const out = Array<number>(total(s.bank) + 1).fill(0);
  for (let k = 0; k <= unknown; k++) out[known[color] + k] = choose(unknown, k) / 2 ** unknown;
  return out;
}
