import type { Rng } from '../shared/rng';
import {
  Cell, DIRS, Dir, GameState, SIZE, freeSides, inBounds, isOpen, move, place, reachable, regions,
} from './logic';

export type Persona = 'builder' | 'raider' | 'wild';

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/**
 * Who would get to each cell first if everyone walked there through open
 * edges (walls block, counters don't). Cells reached first by exactly one
 * player count for them — a quick estimate of future territory.
 */
export function influence(s: GameState): Record<string, number> {
  const dist: Record<string, number[][]> = {};
  for (const p of s.players) {
    const d = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(Infinity));
    const q: Cell[] = [];
    for (const c of s.counters.filter((k) => k.owner === p.id)) {
      d[c.y][c.x] = 0;
      q.push({ x: c.x, y: c.y });
    }
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      for (const dir of DIRS) {
        if (!isOpen(s.walls, c.x, c.y, dir)) continue;
        const [dx, dy] = DELTA[dir];
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (d[ny][nx] > d[c.y][c.x] + 1) {
          d[ny][nx] = d[c.y][c.x] + 1;
          q.push({ x: nx, y: ny });
        }
      }
    }
    dist[p.id] = d;
  }
  const out: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const best = Math.min(...s.players.map((p) => dist[p.id][y][x]));
      if (best === Infinity) continue;
      const who = s.players.filter((p) => dist[p.id][y][x] === best);
      if (who.length === 1) out[who[0].id]++;
    }
  }
  return out;
}

function evaluate(s: GameState, me: string, persona: Persona): number {
  const inf = influence(s);
  let sealed = 0;
  let theirSealed = 0;
  for (const r of regions(s)) {
    if (r.owners.length === 1 && r.owners[0] === me) sealed += r.cells.length;
    else if (r.owners.length === 1 && r.owners[0]) theirSealed += r.cells.length;
  }
  const rivals = s.players.filter((p) => p.id !== me).map((p) => inf[p.id]);
  const bestRival = Math.max(0, ...rivals);
  const sealW = persona === 'builder' ? 0.8 : 0.4;
  const rivalW = persona === 'raider' ? 1.3 : 0.9;
  return inf[me] + sealed * sealW - bestRival * rivalW - theirSealed * 0.2;
}

export interface BotMove { counter: string; to: Cell; wall: Dir | null }

/** Try every counter × destination × wall and keep the best-scoring result. */
export function botMove(s: GameState, me: string, persona: Persona, rng: Rng): BotMove {
  const options: BotMove[] = [];
  for (const c of s.counters.filter((k) => k.owner === me)) {
    for (const to of reachable(s, c.id)) {
      const moved = { ...s, counters: s.counters.map((k) => (k.id === c.id ? { ...k, ...to } : k)) };
      const sides = freeSides(moved, to);
      if (!sides.length) options.push({ counter: c.id, to, wall: null });
      for (const w of sides) options.push({ counter: c.id, to, wall: w });
    }
  }
  if (persona === 'wild' && rng() < 0.25) return options[Math.floor(rng() * options.length)];
  let best = options[0];
  let bestScore = -Infinity;
  for (const o of options) {
    const next = move(s, me, o.counter, o.to, o.wall);
    const score = evaluate(next, me, persona) + rng() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** Place a counter where it claims the most of the board. */
export function botPlace(s: GameState, me: string, rng: Rng): Cell {
  let best: Cell = { x: 3, y: 3 };
  let bestScore = -Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inBounds(x, y) || s.counters.some((c) => c.x === x && c.y === y)) continue;
      const next = place(s, me, { x, y });
      const score = influence(next)[me] + rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}
