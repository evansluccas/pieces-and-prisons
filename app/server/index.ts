/**
 * Starts the game server.
 *
 *   npm run server          (from app/) — listens on PORT (default 8787)
 *
 * DB_PATH sets where the SQLite file lives (default app/data/pieces.db).
 * In development Vite forwards /api to this server, so the page and the API
 * share one origin and the session cookie just works.
 *
 * Production (`npm start`, NODE_ENV=production): the session cookie is marked
 * Secure (HTTPS only), and the built app in app/dist (or STATIC_DIR) is served
 * from here too. CLIENT_IP_HEADER names the header a trusted proxy puts the
 * player's real address in (Fly.io: fly-client-ip), for the sign-in limits.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep } from './auth';
import { createApp } from './app';
import { openDb } from './db';
import { saveTables, takeTables } from './persist';
import { staticFiles } from './static';
import { attachSockets } from './ws';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? resolve(here, '../data/pieces.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = openDb(dbPath);
const production = process.env.NODE_ENV === 'production';
// the room manager is created with the sockets below; /api/me asks it where each player is seated
let rooms: ReturnType<typeof attachSockets> | null = null;
const handle = createApp(db, {
  secureCookies: production,
  tableOf: (id) => rooms?.tableOf(id) ?? null,
  clientIpHeader: process.env.CLIENT_IP_HEADER || undefined,
});

// in production the web app itself is served from here as well
const staticDir = process.env.STATIC_DIR ?? (production ? resolve(here, '../dist') : null);
if (staticDir && !existsSync(resolve(staticDir, 'index.html'))) {
  throw new Error(`No built app in ${staticDir} — run npm run build first.`);
}
const files = staticDir ? staticFiles(staticDir) : null;

sweep(db);
setInterval(() => sweep(db), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  const isApi = (req.url ?? '/').startsWith('/api/');
  void (isApi || !files ? handle(req, res) : files(req, res));
});
rooms = attachSockets(server, db);

// tables saved when the server last stopped carry on (players reconnect on their own)
const restored = rooms.restore(takeTables(db));
if (restored) console.log(`restored ${restored} table${restored === 1 ? '' : 's'}`);
// and they're saved now and then, in case the server stops without warning
const save = () => saveTables(db, rooms!.snapshot(), Date.now());
setInterval(save, 30_000).unref();
server.listen(port, () => {
  console.log(`Pieces & Prisons server on http://localhost:${port} (db: ${dbPath}${staticDir ? `, app: ${staticDir}` : ''})`);
});

// the host stops the machine (SIGINT or SIGTERM, e.g. on a deploy): tell the players,
// save every table, close the database cleanly
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    rooms!.notice('The server is restarting for an update — your table is saved and will be back in a moment.');
    rooms!.stop();
    save();
    server.close();
    // a moment for that message to leave before the connections drop
    setTimeout(() => {
      db.close();
      process.exit(0);
    }, 300);
  });
}
