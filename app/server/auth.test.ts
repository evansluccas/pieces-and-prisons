import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GUEST_SESSION_MS, deleteUser, guest, hashPassword, login, sessionUser, signup, sweep, upgrade, verifyPassword } from './auth';
import { COOKIE, createApp } from './app';
import { Db, openDb } from './db';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('database', () => {
  it('creates the schema once and records its version', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'sessions', 'matches', 'match_players']));
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
  });
});

describe('passwords', () => {
  it('are salted scrypt hashes, never stored as typed', () => {
    const a = hashPassword('correct horse');
    expect(a).not.toContain('correct horse');
    expect(a).not.toBe(hashPassword('correct horse'));
    expect(verifyPassword('correct horse', a)).toBe(true);
    expect(verifyPassword('wrong horse', a)).toBe(false);
  });
});

describe('accounts and guests', () => {
  it('sign up, sign in, and the session finds the user', () => {
    const s = signup(db, 'Mina_7', 'hunter2hunter2');
    expect(s.user).toMatchObject({ username: 'Mina_7', guest: false });
    expect(sessionUser(db, s.token)?.id).toBe(s.user.id);
    // the token itself is never stored
    const stored = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored.some((r) => r.token_hash === s.token)).toBe(false);
    expect(login(db, 'mina_7', 'hunter2hunter2').user.id).toBe(s.user.id); // case-insensitive name
    expect(() => login(db, 'Mina_7', 'nope-nope-nope')).toThrow('Wrong username or password');
    expect(() => login(db, 'nobody', 'hunter2hunter2')).toThrow('Wrong username or password');
  });

  it('checks usernames, passwords and duplicates', () => {
    expect(() => signup(db, 'ab', 'longenough')).toThrow();
    expect(() => signup(db, 'has space', 'longenough')).toThrow();
    expect(() => signup(db, 'okname', 'short')).toThrow('8 characters');
    signup(db, 'Taken', 'longenough');
    expect(() => signup(db, 'taken', 'longenough')).toThrow('taken');
  });

  it('guests need only a name; names may repeat; they can upgrade and keep their id', () => {
    const g = guest(db, '  Seo   Yeon ');
    expect(g.user).toMatchObject({ name: 'Seo Yeon', guest: true, username: null });
    expect(guest(db, 'Seo Yeon').user.id).not.toBe(g.user.id);
    expect(() => guest(db, 'x')).toThrow();
    expect(() => guest(db, '<script>')).toThrow();
    const up = upgrade(db, g.user, 'seoyeon', 'password123');
    expect(up.user).toMatchObject({ id: g.user.id, username: 'seoyeon', guest: false });
    expect(sessionUser(db, g.token)).toBeNull(); // old guest session ended
    expect(sessionUser(db, up.token)?.guest).toBe(false);
    expect(() => upgrade(db, up.user, 'other', 'password123')).toThrow('already have an account');
  });

  it('deleting an account needs its password and removes its sessions', () => {
    const s = signup(db, 'leaver', 'password123');
    expect(() => deleteUser(db, s.user, 'wrong-password')).toThrow();
    deleteUser(db, s.user, 'password123');
    expect(sessionUser(db, s.token)).toBeNull();
    expect(() => login(db, 'leaver', 'password123')).toThrow();
  });

  it('sessions expire; idle guests who never played are swept', () => {
    const t0 = 1_000_000;
    const g = guest(db, 'Visitor', t0);
    expect(sessionUser(db, g.token, t0 + GUEST_SESSION_MS + 1)).toBeNull();
    sweep(db, t0 + 31 * 24 * 3600 * 1000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});

describe('HTTP API', () => {
  let server: Server;
  let base = '';
  beforeEach(async () => {
    server = createServer(createApp(db, { secureCookies: false }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, data: unknown, cookie = '') =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(data) });
  const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

  it('guest → me → upgrade → logout, with an HttpOnly cookie', async () => {
    let r = await post('/api/guest', { name: 'Hana' });
    expect(r.status).toBe(200);
    const set = r.headers.get('set-cookie')!;
    expect(set).toContain(`${COOKIE}=`);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    let cookie = cookieOf(r);
    r = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(await r.json()).toEqual({ user: { name: 'Hana', username: null, guest: true, table: null } });
    r = await post('/api/upgrade', { username: 'hana', password: 'password123' }, cookie);
    expect(((await r.json()) as { user: unknown }).user).toEqual({ name: 'hana', username: 'hana', guest: false });
    cookie = cookieOf(r);
    r = await post('/api/logout', {}, cookie);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    r = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(await r.json()).toEqual({ user: null });
  });

  it('/api/me says which table you are seated at', async () => {
    server.close();
    server = createServer(createApp(db, { secureCookies: false, tableOf: () => ({ code: 'TTHZ', gameId: 'lonely-number', status: 'playing' }) }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const cookie = cookieOf(await post('/api/guest', { name: 'Hana' }));
    const r = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(((await r.json()) as { user: { table: unknown } }).user.table).toEqual({ code: 'TTHZ', gameId: 'lonely-number', status: 'playing' });
  });

  it('refuses non-JSON posts, bad input, and too many wrong passwords', async () => {
    let r = await fetch(`${base}/api/guest`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Hana' });
    expect(r.status).toBe(415);
    r = await post('/api/signup', { username: 'x', password: 'password123' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/3–16/);
    await post('/api/signup', { username: 'target', password: 'password123' });
    for (let i = 0; i < 8; i++) expect((await post('/api/login', { username: 'target', password: 'wrong-guess' })).status).toBe(401);
    r = await post('/api/login', { username: 'target', password: 'password123' });
    expect(r.status).toBe(429);
  });
});
