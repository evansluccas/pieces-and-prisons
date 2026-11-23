/**
 * Starts the game server.
 *
 *   npm run server          (from app/) — listens on PORT (default 8787)
 *
 * DB_PATH sets where the SQLite file lives (default app/data/pieces.db).
 * In development Vite forwards /api to this server, so the page and the API
 * share one origin and the session cookie just works.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep } from './auth';
import { createApp } from './app';
import { openDb } from './db';
import { attachSockets } from './ws';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? resolve(here, '../data/pieces.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = openDb(dbPath);
const production = process.env.NODE_ENV === 'production';
// the room manager is created with the sockets below; /api/me asks it where each player is seated
let rooms: ReturnType<typeof attachSockets> | null = null;
const handle = createApp(db, { secureCookies: production, tableOf: (id) => rooms?.tableOf(id) ?? null });

sweep(db);
setInterval(() => sweep(db), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => void handle(req, res));
rooms = attachSockets(server, db);
server.listen(port, () => {
  console.log(`Pieces & Prisons server on http://localhost:${port} (db: ${dbPath})`);
});
