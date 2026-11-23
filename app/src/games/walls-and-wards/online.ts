/**
 * Walls & Wards at an online table. Turn-based with nothing hidden: the view
 * only renames the viewer to 'you' (name "You") so the solo board is reused.
 * Counter ids are left as they are, so moves sent back name real counters.
 */
import type { Rng } from '../shared/rng';
import { Persona, botMove, botPlace } from './bots';
import { Cell, Dir, DIRS, GameState, move, newGame, place, standings } from './logic';

export type Action =
  | { type: 'place'; cell: Cell }
  | { type: 'move'; counter: string; to: Cell; wall: Dir | null; broke?: string | null };

const PERSONAS: Persona[] = ['builder', 'raider', 'wild'];

export const start = (seats: { id: string; name: string; isBot: boolean }[]) => newGame(seats);

const cell = (c: unknown): Cell => {
  const { x, y } = (c ?? {}) as Cell;
  return { x: Number(x), y: Number(y) };
};

export function act(s: GameState, seat: string, a: unknown): GameState {
  const action = a as Action;
  if (action?.type === 'place') return place(s, seat, cell(action.cell));
  if (action?.type === 'move') {
    const wall = action.wall === null ? null : DIRS.includes(action.wall) ? action.wall : undefined;
    if (wall === undefined) throw new Error('That isn’t a side of the cell.');
    return move(s, seat, String(action.counter), cell(action.to), wall, action.broke ? String(action.broke) : null);
  }
  throw new Error('That move isn’t part of this game.');
}

export const waitingOn = (s: GameState): string[] => (s.phase !== 'gameOver' && s.turn ? [s.turn] : []);

export function botAction(s: GameState, seat: string, rng: Rng): Action {
  if (s.phase === 'place') return { type: 'place', cell: botPlace(s, seat, rng) };
  const persona = PERSONAS[s.players.findIndex((p) => p.id === seat) % PERSONAS.length];
  const m = botMove(s, seat, persona, rng);
  return { type: 'move', counter: m.counter, to: m.to, wall: m.wall, broke: m.broke ?? null };
}

export const over = (s: GameState) => s.phase === 'gameOver';

export function results(s: GameState) {
  return standings(s).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.territory} cells, biggest area ${p.largest}` }));
}

/** Everything is public; only the viewer's id changes to 'you'. */
export function view(s: GameState, viewer: string | null): GameState {
  const r = (id: string) => (id === viewer ? 'you' : id);
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, id: r(p.id), name: p.id === viewer ? 'You' : p.name })),
    counters: s.counters.map((c) => ({ ...c, owner: r(c.owner) })),
    placeOrder: s.placeOrder.map(r),
    turn: s.turn && r(s.turn),
    history: s.history.map((m) => ({ ...m, player: r(m.player) })),
    breakersUsed: (s.breakersUsed ?? []).map(r),
  };
}
