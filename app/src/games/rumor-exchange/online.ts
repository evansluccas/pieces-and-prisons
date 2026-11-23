/**
 * Rumor Exchange at an online table. Everyone trades at the same time each
 * round. Before placing orders a player may buy private rumors; that doesn't
 * end their turn (so the move clock keeps running — see decisionKey).
 *
 * Hidden until the match ends, as in solo play: every company rule except
 * the published ones and your own rumors, which companies get published
 * next, and rivals' cash, shares, orders and rumors.
 */
import type { Rng } from '../shared/rng';
import { Persona, botTurn } from './bots';
import { COMPANIES, GameState, Orders, Rule, buyRumor, newGame, standings, money, submit } from './logic';

const PERSONAS: Persona[] = ['analyst', 'trend', 'gambler'];

export interface OnlineState { game: GameState; rng: Rng }

export type Action =
  | { type: 'rumor'; company: number }
  | { type: 'orders'; orders: Orders }
  /** a rumor (optional) and the orders in one go — what bots send */
  | { type: 'turn'; rumor: number | null; orders: Orders };

export const start = (seats: { id: string; name: string; isBot: boolean }[], rng: Rng): OnlineState => ({ game: newGame(seats, rng), rng });

const company = (x: unknown) => {
  const i = Number(x);
  if (!Number.isInteger(i) || i < 0 || i >= COMPANIES.length) throw new Error('No such company.');
  return i;
};

function cleanOrders(o: unknown): Orders {
  if (!o || typeof o !== 'object') throw new Error('Send your orders.');
  const out: Orders = {};
  for (const [k, q] of Object.entries(o as Record<string, unknown>)) {
    const n = Number(q);
    if (!Number.isInteger(n) || Math.abs(n) > 10_000) throw new Error('Orders must be whole numbers of shares.');
    out[company(k)] = n;
  }
  return out;
}

export function act(s: OnlineState, seat: string, a: unknown): OnlineState {
  const action = a as Action;
  if (action?.type === 'rumor') return { ...s, game: buyRumor(s.game, seat, company(action.company)) };
  if (action?.type === 'orders') return { ...s, game: submit(s.game, seat, cleanOrders(action.orders), s.rng) };
  if (action?.type === 'turn') {
    const game = action.rumor === null || action.rumor === undefined ? s.game : buyRumor(s.game, seat, company(action.rumor));
    return { ...s, game: submit(game, seat, cleanOrders(action.orders), s.rng) };
  }
  throw new Error('That move isn’t part of this game.');
}

export const waitingOn = ({ game }: OnlineState): string[] => (game.phase === 'trade' ? game.players.filter((p) => !p.orders).map((p) => p.id) : []);

/** One decision per round: buying a rumor doesn't restart the clock. */
export const decisionKey = ({ game }: OnlineState) => `${game.round}:${game.phase}`;

export function botAction({ game }: OnlineState, seat: string, rng: Rng): Action {
  const persona = PERSONAS[game.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  const t = botTurn(game, seat, persona, rng);
  return { type: 'turn', rumor: t.rumor, orders: t.orders };
}

export const over = ({ game }: OnlineState) => game.phase === 'gameOver';

export function results({ game }: OnlineState) {
  return standings(game).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${money(p.worth)} in all` }));
}

/** What one seat sees (the viewer is 'you'). */
export function view({ game: s }: OnlineState, viewer: string | null): GameState {
  const done = s.phase === 'gameOver';
  const me = s.players.find((p) => p.id === viewer);
  const known = (i: number) => done || s.published.includes(i) || !!me?.rumors.includes(i);
  const r = (id: string) => (id === viewer ? 'you' : id);
  const only = <T>(x: Record<string, T>, empty: T) =>
    Object.fromEntries(Object.entries(x).filter(([id]) => done || id === viewer).map(([id, v]) => [r(id), v ?? empty]));
  return {
    ...s,
    // an unknown rule is sent as null: the client only reads rules it knows
    rules: s.rules.map((rule, i) => (known(i) ? rule : (null as unknown as Rule))),
    publishOrder: done ? s.publishOrder : [],
    players: s.players.map((p) => {
      if (p.id === viewer) return { ...p, id: 'you', name: 'You' };
      if (done) return p;
      // a rival's orders show only as "placed" ({}), never their contents
      return { ...p, cash: 0, shares: COMPANIES.map(() => 0), rumors: [], orders: p.orders ? {} : null };
    }),
    pendingRumors: only(s.pendingRumors, []),
    records: s.records.map((rec) => ({
      ...rec,
      orders: only(rec.orders, {}),
      rumors: only(rec.rumors, []),
      net: done ? rec.net : rec.net.map(() => 0),
    })),
  };
}
