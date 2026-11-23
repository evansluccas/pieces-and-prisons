/**
 * Tipping Scales at an online table. Each round everyone secretly plays a
 * card and a chip at the same time; nobody sees a rival's play until all are
 * in. Hands and chips are public, exactly as in solo play.
 */
import type { Rng } from '../shared/rng';
import { Persona, botPlay } from './bots';
import { COLORS, Chip, Color, GameState, Play, nextRound, newGame, standings, submitPlay } from './logic';

export const RESULT_MS = 10_000;
const PERSONAS: Persona[] = ['careful', 'trapper', 'loose'];
const CHIPS: Chip[] = [...COLORS, 'rainbow'];

export type Action = { type: 'play'; card: number; chip: Chip; scale: Color };

/** What one seat sees: the game (rival plays hidden while choosing) and who has already chosen. */
export interface View { game: GameState; chosen: string[] }

export const start = (seats: { id: string; name: string; isBot: boolean }[]) => newGame(seats);

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type !== 'play' || !CHIPS.includes(action.chip) || !COLORS.includes(action.scale)) throw new Error('That move isn’t part of this game.');
  if (s.plays[seat]) throw new Error('You’ve already played this round.');
  return submitPlay(s, seat, { card: Number(action.card), chip: action.chip, scale: action.scale });
}

export const waitingOn = (s: GameState): string[] => (s.phase === 'choose' ? s.players.filter((p) => !s.plays[p.id]).map((p) => p.id) : []);

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  const persona = PERSONAS[s.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  return { type: 'play', ...botPlay(s, seat, persona, rng) };
}

export const pause = (s: GameState) => (s.phase === 'result' ? { ms: RESULT_MS, next: nextRound } : null);
export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.penalty} penalt${p.penalty === 1 ? 'y' : 'ies'}, ${p.tips} tip${p.tips === 1 ? '' : 's'}` }));
}

export function view(s: GameState, viewer: string | null): View {
  const r = (id: string) => (id === viewer ? 'you' : id);
  const keys = <T>(x: Record<string, T>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [r(k), v]));
  // while choosing, only your own play is shown
  const plays: Record<string, Play> = {};
  for (const [id, p] of Object.entries(s.plays)) if (s.phase !== 'choose' || id === viewer) plays[r(id)] = p;
  return {
    game: {
      ...s,
      players: s.players.map((p) => (p.id === viewer ? { ...p, id: 'you', name: 'You' } : p)),
      plays,
      history: s.history.map((h) => ({
        ...h, plays: keys(h.plays), order: h.order.map(r), events: h.events.map((e) => ({ ...e, player: r(e.player) })),
      })),
    },
    chosen: s.phase === 'choose' ? Object.keys(s.plays).map(r) : [],
  };
}
