/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LOAD CHECK — many busy tables in one process, like the live server.
 *
 *   npx tsx server/loadcheck.ts [tables=150] [seconds=60]
 *
 * Every table has one scripted person who answers the moment it's their turn
 * (far quicker than real players) plus bots in the other seats; every message
 * is turned into JSON as if sent to a browser. It reports matches finished,
 * memory, CPU (as a share of one core), how long the server stalls between
 * tasks (players feel that as lag) and the slowest game functions.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { openDb } from './db';
import { guest } from './auth';
import { Rooms } from './rooms';
import { ONLINE_GAMES } from './games';
import { seededRng } from '../src/games/shared/rng';

const TABLES = Number(process.argv[2] ?? 150);
const SECONDS = Number(process.argv[3] ?? 60);

const db = openDb(':memory:');
// time every game function, per game
const slow: Record<string, { calls: number; total: number; max: number }> = {};
for (const [gid, g] of Object.entries<any>(ONLINE_GAMES)) {
  for (const fn of ['act', 'botAction', 'view', 'start']) {
    const orig = g[fn];
    if (!orig) continue;
    g[fn] = (...args: any[]) => {
      const t = performance.now();
      try { return orig(...args); } finally {
        const d = performance.now() - t;
        const k = `${gid}.${fn}`;
        const s = (slow[k] ??= { calls: 0, total: 0, max: 0 });
        s.calls++; s.total += d; s.max = Math.max(s.max, d);
      }
    };
  }
  if (g.realtime) {
    const rt = g.realtime; const orig = rt.tick;
    rt.tick = (...args: any[]) => { const t = performance.now(); try { return orig(...args); } finally { const d = performance.now() - t; const k = `${gid}.tick`; const s = (slow[k] ??= { calls: 0, total: 0, max: 0 }); s.calls++; s.total += d; s.max = Math.max(s.max, d); } };
  }
}
let messages = 0;
let bytes = 0;
const pending = new Map<number, boolean>();
const users: any[] = [];
// every message is serialised, as the socket layer would
const rooms: any = new Rooms((id: number, m: any) => {
  const text = JSON.stringify(m);
  messages++;
  bytes += text.length;
  if (m.type === 'game' && m.waiting && !pending.get(id)) {
    pending.set(id, true);
    setTimeout(() => answer(id), 50); // a quick human
  }
  if (m.type === 'room' && m.room.status === 'over' && m.room.host) {
    setTimeout(() => { rooms.handle(byId.get(id), { type: 'again' }); rooms.handle(byId.get(id), { type: 'start' }); }, 200);
  }
}, db);
const byId = new Map<number, any>();
const rng = seededRng(7);

function answer(id: number) {
  pending.set(id, false);
  const u = byId.get(id);
  const code = rooms.where.get(id);
  const room = code && rooms.rooms.get(code);
  if (!room || room.status !== 'playing') return;
  const seat = room.seats.find((s: any) => s.userId === id);
  try {
    const action = room.game.botAction(room.state, seat.id, rng);
    if (action) rooms.handle(u, { type: 'act', action });
  } catch { /* not our move any more */ }
}

const ids = Object.keys(ONLINE_GAMES);
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
const t0 = Date.now();
const cpu0 = process.cpuUsage();
for (let i = 0; i < TABLES; i++) {
  const u = guest(db, `Load ${i}`).user;
  users.push(u);
  byId.set(u.id, u);
  const id = ids[i % ids.length];
  const g = ONLINE_GAMES[id];
  rooms.handle(u, { type: 'create', gameId: id });
  const seatsWanted = Math.min(g.maxPlayers, Math.max(g.minPlayers, 4));
  for (let k = 1; k < seatsWanted; k++) rooms.handle(u, { type: 'addBot' });
  rooms.handle(u, { type: 'start' });
}
const setup = Date.now() - t0;
let peakRss = 0;
let peakHeap = 0;
const sample = setInterval(() => {
  const m = process.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
}, 500);
setTimeout(() => {
  clearInterval(sample);
  h.disable();
  const recorded = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as any).n;
  const ms = (n: number) => (n / 1e6).toFixed(1);
  console.log(JSON.stringify({
    tables: TABLES, seconds: SECONDS, setupMs: setup,
    cpuPercentOfOneCore: Math.round(((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1e6 / SECONDS) * 100),
    matchesFinished: recorded,
    messagesPerSecond: Math.round(messages / SECONDS),
    kbPerSecond: Math.round(bytes / 1024 / SECONDS),
    loopDelayMs: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) },
    peakRssMB: Math.round(peakRss / 1e6), peakHeapMB: Math.round(peakHeap / 1e6),
    slowest: Object.entries(slow).sort((a, b) => b[1].max - a[1].max).slice(0, 10).map(([k, s]) => `${k} max ${s.max.toFixed(0)}ms avg ${(s.total / s.calls).toFixed(1)}ms x${s.calls}`),
    busiest: Object.entries(slow).sort((a, b) => b[1].total - a[1].total).slice(0, 6).map(([k, s]) => `${k} ${(s.total / 1000).toFixed(1)}s total`),
    savedTablesKB: Math.round(rooms.snapshot().reduce((t: number, s: any) => t + s.data.length, 0) / 1024),
  }, null, 1));
  process.exit(0);
}, SECONDS * 1000);
