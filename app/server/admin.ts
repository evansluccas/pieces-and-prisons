/**
 * Looking after the site from the command line.
 *
 *   npx tsx server/admin.ts reports            open reports, newest first
 *   npx tsx server/admin.ts resolve <id>       mark a report as dealt with
 *   npx tsx server/admin.ts rename <user> <n>  give a player a new name (e.g. "Player 42")
 *
 * On Fly.io, run it on the machine (it uses the same DB_PATH as the server):
 *   fly ssh console -C "node_modules/.bin/tsx server/admin.ts reports"
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db';

const here = dirname(fileURLToPath(import.meta.url));
const db = openDb(process.env.DB_PATH ?? resolve(here, '../data/pieces.db'));
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'reports') {
  const rows = db.prepare(`
    SELECT r.id, r.name, r.reported_id AS user, r.table_code AS tbl, r.created_at AS at,
           (SELECT COUNT(*) FROM reports x WHERE x.reported_id = r.reported_id AND x.resolved_at IS NULL) AS open,
           u.display_name AS now_named
    FROM reports r LEFT JOIN users u ON u.id = r.reported_id
    WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`).all() as Record<string, unknown>[];
  if (!rows.length) console.log('No open reports.');
  for (const r of rows) {
    console.log(`#${r.id}  ${new Date(Number(r.at)).toISOString().slice(0, 16)}  "${r.name}" (user ${r.user}, now "${r.now_named ?? 'deleted'}")  table ${r.tbl}  · ${r.open} open report(s) on this player`);
  }
} else if (cmd === 'resolve' && args[0]) {
  const res = db.prepare('UPDATE reports SET resolved_at = ? WHERE id = ?').run(Date.now(), Number(args[0]));
  console.log(res.changes ? `Report #${args[0]} resolved.` : 'No such report.');
} else if (cmd === 'rename' && args[0] && args[1]) {
  const name = args.slice(1).join(' ').slice(0, 16);
  const res = db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, Number(args[0]));
  if (res.changes) db.prepare('UPDATE reports SET resolved_at = ? WHERE reported_id = ? AND resolved_at IS NULL').run(Date.now(), Number(args[0]));
  console.log(res.changes ? `User ${args[0]} is now "${name}" (their open reports are resolved).` : 'No such user.');
} else {
  console.log('Usage: reports | resolve <report id> | rename <user id> <new name>');
}
db.close();
