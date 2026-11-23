/**
 * Serves the built web app (app/dist) from the game server in production, so
 * the page, the API and the WebSocket all share one origin — the session
 * cookie and the WebSocket origin check work exactly as in development.
 *
 * - Files under /assets have hashed names, so browsers may keep them for a
 *   year; everything else is checked again on each visit.
 * - Any other path that isn't a file gets index.html (the app has no URL
 *   routes of its own, but this keeps a refresh from ever showing a 404).
 * - Paths can't climb out of the folder.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Safety headers sent with every page and file. */
const SAFETY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

export function staticFiles(dir: string) {
  const root = resolve(dir);

  async function file(path: string): Promise<string | null> {
    // decode, normalise, and make sure we stay inside the folder
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(path)).replace(/^([/\\\\])+/, '');
    } catch {
      return null;
    }
    const full = resolve(join(root, rel));
    if (full !== root && !full.startsWith(root + sep)) return null;
    try {
      const s = await stat(full);
      return s.isFile() ? full : null;
    } catch {
      return null;
    }
  }

  return async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SAFETY });
      return void res.end();
    }
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const found = (path !== '/' && (await file(path))) || (await file('index.html'));
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SAFETY });
      return void res.end('Not found.');
    }
    const hashed = path.startsWith('/assets/') && found !== join(root, 'index.html');
    const s = await stat(found);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(found).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SAFETY,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(found).pipe(res);
  };
}
