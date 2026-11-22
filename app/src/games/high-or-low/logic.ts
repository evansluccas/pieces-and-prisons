/**
 * HIGH OR LOW — rules (our own card-counting duel)
 *
 * - Each player holds the cards 1–10.
 * - 10 rounds; the DEALER alternates, so each player deals 5 times.
 * - The dealer picks two of their own cards: one goes face UP, one face DOWN.
 * - The other player calls HIGHER or LOWER: is the hidden card higher or
 *   lower than the shown one?
 *     right call → the guesser scores 1;  wrong call → the dealer scores 1.
 * - Both cards are then revealed and out of the game, so everyone always
 *   knows which cards each player has left.
 * - Most points after 10 rounds wins (equal = draw).
 */

export type Side = 0 | 1;
export type Call = 'higher' | 'lower';

export interface Config { rounds: number; top: number }
export const DEFAULT_CONFIG: Config = { rounds: 10, top: 10 };

/** `majority` = the side most of the dealer's other cards were on when the call was made (null if even). */
export interface Round { dealer: Side; shown: number; hidden: number; call: Call; right: boolean; majority: Call | null }

export type Phase = 'deal' | 'call' | 'gameOver';

export interface GameState {
  config: Config;
  hands: [number[], number[]];
  round: number;
  phase: Phase;
  dealer: Side;
  shown: number | null;
  hidden: number | null;
  scores: [number, number];
  history: Round[];
}

export function newGame(config = DEFAULT_CONFIG, firstDealer: Side = 0): GameState {
  const hand = Array.from({ length: config.top }, (_, i) => i + 1);
  return {
    config, hands: [[...hand], [...hand]], round: 1, phase: 'deal', dealer: firstDealer,
    shown: null, hidden: null, scores: [0, 0], history: [],
  };
}

export const guesser = (s: GameState): Side => (1 - s.dealer) as Side;

export function deal(s: GameState, side: Side, shown: number, hidden: number): GameState {
  if (s.phase !== 'deal' || side !== s.dealer) throw new Error('not your deal');
  const hand = s.hands[side];
  if (shown === hidden || !hand.includes(shown) || !hand.includes(hidden)) throw new Error('pick two of your cards');
  return { ...s, phase: 'call', shown, hidden };
}

export function call(s: GameState, side: Side, c: Call): GameState {
  if (s.phase !== 'call' || side !== guesser(s)) throw new Error('not your call');
  const shown = s.shown!;
  const hidden = s.hidden!;
  const right = c === 'higher' ? hidden > shown : hidden < shown;
  const rest = candidates(s);
  const up = rest.filter((x) => x > shown).length;
  const down = rest.filter((x) => x < shown).length;
  const majority: Call | null = up === down ? null : up > down ? 'higher' : 'lower';
  const scores: [number, number] = [...s.scores];
  scores[right ? side : s.dealer]++;
  const hands: [number[], number[]] = [...s.hands] as [number[], number[]];
  hands[s.dealer] = hands[s.dealer].filter((x) => x !== shown && x !== hidden);
  const history = [...s.history, { dealer: s.dealer, shown, hidden, call: c, right, majority }];
  const over = s.round >= s.config.rounds;
  return {
    ...s, hands, scores, history, shown: null, hidden: null,
    phase: over ? 'gameOver' : 'deal',
    round: over ? s.round : s.round + 1,
    dealer: over ? s.dealer : guesser(s),
  };
}

/** From the guesser's side: the cards the hidden one could be. */
export const candidates = (s: GameState): number[] => (s.shown === null ? [] : s.hands[s.dealer].filter((x) => x !== s.shown));

export const winner = (s: GameState): Side | 'draw' | null =>
  s.phase !== 'gameOver' ? null : s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? 0 : 1;
