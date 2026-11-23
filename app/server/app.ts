/**
 * The HTTP API for accounts. JSON in, JSON out, session in an HttpOnly cookie.
 *
 *   GET    /api/me        who am I, and am I seated at a table? ({ user: null } when signed out)
 *   GET    /api/matches   my finished matches, newest first (signed in)
 *   GET    /api/leaderboard?game=<id>   top players for a game (no game = all games)
 *   GET    /api/health    for the host's health check
 *   POST   /api/signup    { username, password }
 *   POST   /api/login     { username, password }
 *   POST   /api/guest     { name }
 *   POST   /api/upgrade   { username, password }   guest -> account
 *   POST   /api/logout
 *   POST   /api/delete    { password }             delete my account (guests: no password)
 *
 * POSTs must send Content-Type: application/json — together with SameSite
 * cookies, that stops other sites from submitting forms on a player's behalf.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db';
import { AuthError, Signed, User, deleteUser, endSession, guest, login, sessionUser, signup, upgrade } from './auth';
import type { TableInfo } from './rooms';
import { leaderboard, myMatches } from './stats';

export const COOKIE = 'pp_session';

export interface AppOptions {
  secureCookies: boolean;
  now?: () => number;
  /** The online table someone is seated at (from the room manager). */
  tableOf?: (userId: number) => TableInfo | null;
  /**
   * Header that carries the player's real address when the server sits
   * behind a proxy (on Fly.io: 'fly-client-ip'). Only set this when a proxy
   * you trust always sets it — otherwise anyone could fake their address.
   */
  clientIpHeader?: string;
}

/** The address a request came from (used for rate limits). */
export function clientIp(req: IncomingMessage, header?: string): string {
  const v = header ? req.headers[header.toLowerCase()] : undefined;
  const fromProxy = (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim();
  return fromProxy || req.socket.remoteAddress || '?';
}

/** Counts attempts per key in a sliding window; used to slow down password guessing. */
export class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  private recent(key: string, now: number) {
    const r = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (r.length) this.hits.set(key, r);
    else this.hits.delete(key);
    return r;
  }
  blocked(key: string, now: number): boolean {
    return this.recent(key, now).length >= this.max;
  }
  hit(key: string, now: number) {
    this.hits.set(key, [...this.recent(key, now), now]);
  }
  /** Check and count in one go. */
  allow(key: string, now: number): boolean {
    if (this.blocked(key, now)) return false;
    this.hit(key, now);
    return true;
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000) throw new AuthError(413, 'Request too large.');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new AuthError(400, 'Bad JSON.');
  }
}

const publicUser = (u: User | null) => (u ? { name: u.name, username: u.username, guest: u.guest } : null);

export function createApp(db: Db, opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const attempts = new RateLimit(20, 10 * 60 * 1000);   // sign-in style requests per IP
  const failures = new RateLimit(8, 15 * 60 * 1000);    // wrong passwords per username

  const setCookie = (res: ServerResponse, s: Signed | null) => {
    const base = `${COOKIE}=${s ? s.token : ''}; Path=/; HttpOnly; SameSite=Lax${opts.secureCookies ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', s ? `${base}; Max-Age=${Math.floor((s.expires - now()) / 1000)}` : `${base}; Max-Age=0`);
  };
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const ip = clientIp(req, opts.clientIpHeader);
    try {
      if (!path.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
      if (path === '/api/health') return send(res, 200, { ok: true });
      const token = cookies(req)[COOKIE];
      if (req.method === 'GET' && path === '/api/me') {
        const me = sessionUser(db, token, now());
        return send(res, 200, { user: me ? { ...publicUser(me), table: opts.tableOf?.(me.id) ?? null } : null });
      }
      if (req.method === 'GET' && path === '/api/matches') {
        const me = sessionUser(db, token, now());
        if (!me) throw new AuthError(401, 'Sign in or pick a guest name first.');
        return send(res, 200, { matches: myMatches(db, me.id) });
      }
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const game = url.searchParams.get('game');
        if (game !== null && !/^[a-z-]{2,40}$/.test(game)) throw new AuthError(400, 'No such game.');
        const me = sessionUser(db, token, now());
        return send(res, 200, { rows: leaderboard(db, game, me?.id ?? null) });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });
      const b = await body(req);

      if (path === '/api/signup' || path === '/api/login' || path === '/api/guest') {
        if (!attempts.allow(ip, now())) throw new AuthError(429, 'Too many attempts — try again in a few minutes.');
        let s: Signed;
        if (path === '/api/signup') s = signup(db, b.username, b.password, now());
        else if (path === '/api/guest') s = guest(db, b.name, now());
        else {
          const key = String(b.username ?? '').toLowerCase();
          if (failures.blocked(key, now())) throw new AuthError(429, 'Too many wrong passwords — try again in 15 minutes.');
          try {
            s = login(db, b.username, b.password, now());
          } catch (e) {
            failures.hit(key, now());
            throw e;
          }
        }
        endSession(db, token); // whoever was signed in on this browser is signed out
        setCookie(res, s);
        return send(res, 200, { user: publicUser(s.user) });
      }

      const me = sessionUser(db, token, now());
      if (path === '/api/logout') {
        endSession(db, token);
        setCookie(res, null);
        return send(res, 200, { user: null });
      }
      if (!me) throw new AuthError(401, 'Please sign in first.');
      if (path === '/api/upgrade') {
        const s = upgrade(db, me, b.username, b.password, now());
        setCookie(res, s);
        return send(res, 200, { user: publicUser(s.user) });
      }
      if (path === '/api/delete') {
        deleteUser(db, me, b.password);
        setCookie(res, null);
        return send(res, 200, { user: null });
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof AuthError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Something went wrong.' });
    }
  };
}
