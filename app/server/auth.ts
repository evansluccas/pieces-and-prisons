/**
 * Accounts, guests and sessions.
 *
 * - ACCOUNT: a username and a password. Nothing else — no email — so a
 *   forgotten password can't be recovered.
 * - GUEST: just a display name. A guest can later add a username and
 *   password ("upgrade") and keeps everything.
 * - Passwords are hashed with scrypt and a random salt. Session tokens are
 *   random; only their SHA-256 hash is stored.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

export interface User { id: number; username: string | null; name: string; guest: boolean }

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const DAY = 24 * 60 * 60 * 1000;
export const ACCOUNT_SESSION_MS = 30 * DAY;
export const GUEST_SESSION_MS = 7 * DAY;

// ------------------------------------------------------------- validation ----

/** 3–16 letters, digits, _ or -. Case is kept for display but ignored for uniqueness. */
export function checkUsername(u: unknown): string {
  if (typeof u !== 'string' || !/^[A-Za-z0-9_-]{3,16}$/.test(u)) {
    throw new AuthError(400, 'Usernames are 3–16 letters, numbers, _ or -.');
  }
  return u;
}

/** 2–16 characters: letters (any language), digits, spaces, _ or -. */
export function checkGuestName(n: unknown): string {
  const name = typeof n === 'string' ? n.trim().replace(/\s+/g, ' ') : '';
  if (!/^[\p{L}\p{N} _-]{2,16}$/u.test(name)) throw new AuthError(400, 'Guest names are 2–16 letters, numbers or spaces.');
  return name;
}

export function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 8) throw new AuthError(400, 'Passwords need at least 8 characters.');
  if (p.length > 128) throw new AuthError(400, 'Passwords can be at most 128 characters.');
  return p;
}

// ---------------------------------------------------------------- hashing ----

const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, N, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(got, want);
}

/** Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password. */
const DUMMY_HASH = hashPassword('not-a-real-password');

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// --------------------------------------------------------------- sessions ----

interface UserRow { id: number; username: string | null; display_name: string; password_hash: string | null }
const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, name: r.display_name, guest: r.password_hash === null });

function startSession(db: Db, userId: number, now: number, ms: number): { token: string; expires: number } {
  const token = randomBytes(32).toString('base64url');
  const expires = now + ms;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, expires);
  return { token, expires };
}

export interface Signed { user: User; token: string; expires: number }

export function sessionUser(db: Db, token: string | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get(sha256(token), now) as UserRow | undefined;
  if (!row) return null;
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, row.id);
  return toUser(row);
}

export function endSession(db: Db, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

// ---------------------------------------------------------------- actions ----

const taken = (db: Db, username: string) => !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);

export function signup(db: Db, username: unknown, password: unknown, now = Date.now()): Signed {
  const u = checkUsername(username);
  const p = checkPassword(password);
  if (taken(db, u)) throw new AuthError(409, 'That username is taken.');
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(u, u, hashPassword(p), now, now);
  const id = Number(lastInsertRowid);
  return { user: { id, username: u, name: u, guest: false }, ...startSession(db, id, now, ACCOUNT_SESSION_MS) };
}

export function login(db: Db, username: unknown, password: unknown, now = Date.now()): Signed {
  const u = typeof username === 'string' ? username : '';
  const p = typeof password === 'string' ? password : '';
  const row = db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ?').get(u) as UserRow | undefined;
  const ok = verifyPassword(p, row?.password_hash ?? DUMMY_HASH) && !!row?.password_hash;
  if (!ok || !row) throw new AuthError(401, 'Wrong username or password.');
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, row.id);
  return { user: toUser(row), ...startSession(db, row.id, now, ACCOUNT_SESSION_MS) };
}

export function guest(db: Db, name: unknown, now = Date.now()): Signed {
  const n = checkGuestName(name);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, created_at, last_seen_at) VALUES (NULL, ?, NULL, ?, ?)',
  ).run(n, now, now);
  const id = Number(lastInsertRowid);
  return { user: { id, username: null, name: n, guest: true }, ...startSession(db, id, now, GUEST_SESSION_MS) };
}

/** A guest picks a username and password; same user, so history carries over. Other sessions are signed out. */
export function upgrade(db: Db, me: User, username: unknown, password: unknown, now = Date.now()): Signed {
  if (!me.guest) throw new AuthError(400, 'You already have an account.');
  const u = checkUsername(username);
  const p = checkPassword(password);
  if (taken(db, u)) throw new AuthError(409, 'That username is taken.');
  db.prepare('UPDATE users SET username = ?, display_name = ?, password_hash = ?, last_seen_at = ? WHERE id = ?').run(u, u, hashPassword(p), now, me.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
  return { user: { id: me.id, username: u, name: u, guest: false }, ...startSession(db, me.id, now, ACCOUNT_SESSION_MS) };
}

/** Delete an account (or guest) and everything tied to it; past tables keep only the name that was shown. */
export function deleteUser(db: Db, me: User, password: unknown) {
  if (!me.guest) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as { password_hash: string };
    if (typeof password !== 'string' || !verifyPassword(password, row.password_hash)) throw new AuthError(401, 'Wrong password.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(me.id);
}

/** Housekeeping: expired sessions, and guests who never played and haven't been seen for 30 days. */
export function sweep(db: Db, now = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare(
    `DELETE FROM users WHERE password_hash IS NULL AND last_seen_at < ?
     AND id NOT IN (SELECT user_id FROM match_players WHERE user_id IS NOT NULL)`,
  ).run(now - 30 * DAY);
}
