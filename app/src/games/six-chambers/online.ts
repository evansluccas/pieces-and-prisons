/**
 * Six Chambers at an online table. Turns go round the table one player at a
 * time; when the cylinder fires, the result stays on screen for a moment.
 *
 * Hidden: the chambers until the cylinder fires; another player's private peek
 * result and which seats a secret swap touched (ever — only the mover sees
 * them). Like the solo game, nothing is written down: each seat is sent only
 * the move that just happened, and the full round log only once the match ends.
 */
import type { Rng } from '../shared/rng';
import { Persona, botAction as pickMove } from './bots';
import { ActionKind, COST, GameState, NEEDS_PAIR, SEATS, TurnEvent, act as play, eventVisibleTo, newGame, nextRound, standings } from './logic';

export const RESULT_MS = 10_000;
export const TURN_MS = 40_000;
// careful and pusher are the two steady personas (wild plays at random now and then)
const PERSONAS: Persona[] = ['careful', 'pusher'];

export interface OnlineState { game: GameState; rng: Rng }
export type Action = { type: 'move'; kind: ActionKind; seat?: number };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type !== 'move') throw new Error('That move isn’t part of this game.');
  if (typeof action.kind !== 'string' || !Object.prototype.hasOwnProperty.call(COST, action.kind)) throw new Error('No such action.');
  const g = s.game;
  if (g.phase !== 'turns' || g.turn !== seat) throw new Error('Not your move right now.');
  if (g.players.find((p) => p.id === seat)!.credits < COST[action.kind]) throw new Error('Not enough credits for that.');
  if (!NEEDS_PAIR[action.kind]) return { ...s, game: play(g, seat, { kind: action.kind }) };
  if (!Number.isInteger(action.seat) || action.seat! < 0 || action.seat! >= SEATS) throw new Error('Choose two neighbouring seats.');
  return { ...s, game: play(g, seat, { kind: action.kind, seat: action.seat }) };
}

export const waitingOn = ({ game }: OnlineState): string[] => (game.phase === 'turns' && game.turn ? [game.turn] : []);

export const turnMs = () => TURN_MS;

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  const persona = PERSONAS[game.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  // the bot reasons from the real round log, replayed as that seat saw it (knowledge.ts)
  const m = pickMove(game, seat, persona, rng);
  return NEEDS_PAIR[m.kind] ? { type: 'move', kind: m.kind, seat: m.seat } : { type: 'move', kind: m.kind };
}

export const pause = (s: OnlineState) =>
  s.game.phase === 'fired' ? { ms: RESULT_MS, next: (x: OnlineState) => ({ ...x, game: nextRound(x.game, x.rng) }) } : null;

export const over = (s: OnlineState) => s.game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.points} point${p.points === 1 ? '' : 's'}, ${p.saved} credits saved` }));
}

export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  // what this seat may know about a move, with ids renamed
  const shown = (ev: TurnEvent): TurnEvent => {
    const e = eventVisibleTo(ev, viewer ?? '');
    return { ...e, player: r(e.player) };
  };
  const done = s.phase === 'gameOver';
  const lastMove = s.phase === 'turns' ? s.events[s.events.length - 1] : undefined;
  return {
    ...s,
    players: s.players.map((p) => (p.id === viewer ? { ...p, id: 'you', name: 'You' } : p)),
    chambers: [], // never sent; fired rounds show their chambers through history
    turn: s.turn && r(s.turn),
    // only the move that just happened — the rest is for remembering
    events: lastMove ? [shown(lastMove)] : [],
    history: s.history.map((h) => ({
      ...h,
      hit: h.hit.map(r),
      // the round log opens once the match is over (still without others' secrets)
      events: done ? h.events.map(shown) : [],
    })),
  };
}
