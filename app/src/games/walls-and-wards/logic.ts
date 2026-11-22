/**
 * WALLS & WARDS — rules (our own move-then-wall territory game)
 *
 * - A 7×7 board. Each player has two counters: a SQUARE and a ROUND one.
 * - SETUP: in snake order (first → last, then back) everyone places a counter
 *   on an empty cell — square first, round second.
 * - TURN: pick one of your counters and move it (or leave it where it is):
 *     square: 1 or 2 cells in a straight line
 *     round:  1 cell, then optionally 1 more after turning left or right
 *   Counters can't pass through walls or other counters.
 *   Then you MUST build a wall on one free side of the cell that counter ends
 *   on (the board edge already counts as a wall).
 * - WALL BREAKER: once per match, at the start of your turn, you may knock
 *   down one wall that touches the cell of one of your counters. Then you
 *   move and build as usual.
 * - The match ends when no open area holds counters of more than one player
 *   (or after a long safety limit of turns).
 * - Your territory = every cell in areas that only your counters are in.
 *   Most cells wins; ties go to the larger single area. Last place goes to prison.
 */

export const SIZE = 7;
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const TURNS: Record<Dir, Dir[]> = { N: ['E', 'W'], S: ['E', 'W'], E: ['N', 'S'], W: ['N', 'S'] };

export type Kind = 'square' | 'round';
export interface Counter { id: string; owner: string; kind: Kind; x: number; y: number }
export interface Cell { x: number; y: number }

export interface PlayerState { id: string; name: string; isBot: boolean }

export interface Config { maxTurns: number }
export const DEFAULT_CONFIG: Config = { maxTurns: 140 };

export type Phase = 'place' | 'play' | 'gameOver';

export interface MoveRecord { player: string; counter: string; from: Cell; to: Cell; wall: Dir | null; broke?: string }

export interface GameState {
  config: Config;
  players: PlayerState[];
  phase: Phase;
  counters: Counter[];
  walls: string[]; // edge keys, see edgeKey
  placeOrder: string[]; // remaining placements (player ids)
  turn: string | null;
  turns: number;
  history: MoveRecord[];
  breakersUsed: string[]; // players who have used their wall breaker
}

// ------------------------------------------------------------ geometry ---

export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** Key of the edge on side `d` of cell (x,y), or null for the board edge. */
export function edgeKey(x: number, y: number, d: Dir): string | null {
  const [dx, dy] = DELTA[d];
  if (!inBounds(x + dx, y + dy)) return null;
  if (d === 'N') return `h:${x}:${y - 1}`;
  if (d === 'S') return `h:${x}:${y}`;
  if (d === 'W') return `v:${x - 1}:${y}`;
  return `v:${x}:${y}`;
}

export function isOpen(walls: string[], x: number, y: number, d: Dir): boolean {
  const k = edgeKey(x, y, d);
  return k !== null && !walls.includes(k);
}

export function freeSides(s: GameState, c: Cell): Dir[] {
  return DIRS.filter((d) => isOpen(s.walls, c.x, c.y, d));
}

const occupied = (s: GameState, x: number, y: number, except?: string) =>
  s.counters.some((c) => c.id !== except && c.x === x && c.y === y);

/** Cells a counter can end on (including staying put). */
export function reachable(s: GameState, counterId: string): Cell[] {
  const c = s.counters.find((k) => k.id === counterId)!;
  const out = new Map<string, Cell>([[`${c.x},${c.y}`, { x: c.x, y: c.y }]]);
  const step = (x: number, y: number, d: Dir): Cell | null => {
    if (!isOpen(s.walls, x, y, d)) return null;
    const [dx, dy] = DELTA[d];
    const nx = x + dx;
    const ny = y + dy;
    return occupied(s, nx, ny, c.id) ? null : { x: nx, y: ny };
  };
  for (const d of DIRS) {
    const one = step(c.x, c.y, d);
    if (!one) continue;
    out.set(`${one.x},${one.y}`, one);
    const follow = c.kind === 'square' ? [d] : TURNS[d];
    for (const d2 of follow) {
      const two = step(one.x, one.y, d2);
      if (two) out.set(`${two.x},${two.y}`, two);
    }
  }
  return [...out.values()];
}

// -------------------------------------------------------------- flow -----

export function newGame(players: PlayerState[], config = DEFAULT_CONFIG): GameState {
  if (players.length < 2 || players.length > 4) throw new Error('2 to 4 players');
  const ids = players.map((p) => p.id);
  return {
    config,
    players,
    phase: 'place',
    counters: [],
    walls: [],
    placeOrder: [...ids, ...[...ids].reverse()],
    turn: ids[0],
    turns: 0,
    history: [],
    breakersUsed: [],
  };
}

export function place(s: GameState, playerId: string, cell: Cell): GameState {
  if (s.phase !== 'place' || s.turn !== playerId) throw new Error('not your placement');
  if (!inBounds(cell.x, cell.y) || occupied(s, cell.x, cell.y)) throw new Error('cell not free');
  const mine = s.counters.filter((c) => c.owner === playerId).length;
  const counter: Counter = { id: `${playerId}-${mine}`, owner: playerId, kind: mine === 0 ? 'square' : 'round', ...cell };
  const placeOrder = s.placeOrder.slice(1);
  const counters = [...s.counters, counter];
  if (placeOrder.length) return { ...s, counters, placeOrder, turn: placeOrder[0] };
  return { ...s, counters, placeOrder, phase: 'play', turn: s.players[0].id };
}

/** The two cells a wall key sits between. */
export function wallCells(key: string): [Cell, Cell] {
  const [kind, xs, ys] = key.split(':');
  const x = Number(xs);
  const y = Number(ys);
  return kind === 'h' ? [{ x, y }, { x, y: y + 1 }] : [{ x, y }, { x: x + 1, y }];
}

export const hasBreaker = (s: GameState, playerId: string) => !(s.breakersUsed ?? []).includes(playerId);

/** Walls this player could knock down: ones touching a cell with one of their counters. */
export function breakableWalls(s: GameState, playerId: string): string[] {
  if (s.phase !== 'play' || !hasBreaker(s, playerId)) return [];
  const mine = s.counters.filter((c) => c.owner === playerId);
  return s.walls.filter((w) => wallCells(w).some((c) => mine.some((k) => k.x === c.x && k.y === c.y)));
}

export function move(s: GameState, playerId: string, counterId: string, to: Cell, wall: Dir | null, broke: string | null = null): GameState {
  if (s.phase !== 'play' || s.turn !== playerId) throw new Error('not your turn');
  if (broke) {
    if (!breakableWalls(s, playerId).includes(broke)) throw new Error('you can’t break that wall');
    s = { ...s, walls: s.walls.filter((w) => w !== broke), breakersUsed: [...(s.breakersUsed ?? []), playerId] };
  }
  const c = s.counters.find((k) => k.id === counterId);
  if (!c || c.owner !== playerId) throw new Error('not your counter');
  if (!reachable(s, counterId).some((r) => r.x === to.x && r.y === to.y)) throw new Error('cannot reach that cell');
  const counters = s.counters.map((k) => (k.id === counterId ? { ...k, x: to.x, y: to.y } : k));
  const moved = { ...s, counters };
  const sides = freeSides(moved, to);
  if (sides.length && (wall === null || !sides.includes(wall))) throw new Error('you must build a wall on a free side');
  if (!sides.length && wall !== null) throw new Error('no free side to wall');
  const walls = wall ? [...s.walls, edgeKey(to.x, to.y, wall)!] : s.walls;
  const record: MoveRecord = { player: playerId, counter: counterId, from: { x: c.x, y: c.y }, to, wall, ...(broke ? { broke } : {}) };
  const next: GameState = { ...moved, walls, turns: s.turns + 1, history: [...s.history, record] };
  if (isSettled(next) || next.turns >= s.config.maxTurns) return { ...next, phase: 'gameOver', turn: null };
  const i = s.players.findIndex((p) => p.id === playerId);
  return { ...next, turn: s.players[(i + 1) % s.players.length].id };
}

// ---------------------------------------------------------- territory ----

export interface Region { cells: Cell[]; owners: string[] }

export function regions(s: GameState): Region[] {
  const seen = new Set<string>();
  const out: Region[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (seen.has(`${x},${y}`)) continue;
      const cells: Cell[] = [];
      const stack: Cell[] = [{ x, y }];
      seen.add(`${x},${y}`);
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        for (const d of DIRS) {
          if (!isOpen(s.walls, c.x, c.y, d)) continue;
          const [dx, dy] = DELTA[d];
          const k = `${c.x + dx},${c.y + dy}`;
          if (!seen.has(k)) {
            seen.add(k);
            stack.push({ x: c.x + dx, y: c.y + dy });
          }
        }
      }
      const owners = [...new Set(s.counters.filter((k) => cells.some((c) => c.x === k.x && c.y === k.y)).map((k) => k.owner))];
      out.push({ cells, owners });
    }
  }
  return out;
}

/** True once no open area holds counters of two different players. */
export function isSettled(s: GameState): boolean {
  return s.counters.length > 0 && regions(s).every((r) => r.owners.length <= 1);
}

export interface Score { id: string; territory: number; largest: number }

export function scores(s: GameState): Score[] {
  const rs = regions(s);
  return s.players.map((p) => {
    const mine = rs.filter((r) => r.owners.length === 1 && r.owners[0] === p.id).map((r) => r.cells.length);
    return { id: p.id, territory: mine.reduce((a, b) => a + b, 0), largest: Math.max(0, ...mine) };
  });
}

export function standings(s: GameState): (PlayerState & Score)[] {
  const sc = scores(s);
  return s.players
    .map((p, seat) => ({ ...p, ...sc.find((x) => x.id === p.id)!, seat }))
    .sort((a, b) => b.territory - a.territory || b.largest - a.largest || a.seat - b.seat);
}
