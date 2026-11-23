import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { createServer, IncomingMessage, request, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientIp, createApp } from './app';
import { openDb } from './db';
import { staticFiles } from './static';

let server: Server;
let base: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-static-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'sprites'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Pieces</title>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sprites', 'x.png'), 'PNG');
  writeFileSync(join(dir, '..', 'secret.txt'), 'top secret'); // outside the folder
  const files = staticFiles(dir);
  const api = createApp(openDb(':memory:'), { secureCookies: true, clientIpHeader: 'fly-client-ip' });
  server = createServer((req, res) => void ((req.url ?? '').startsWith('/api/') ? api(req, res) : files(req, res)));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

/** A raw GET (so paths like /../ reach the server unchanged). */
function get(path: string, method = 'GET'): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serving the built app', () => {
  it('serves the page, hashed assets (cached for a year) and other files (checked each visit)', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    const js = await get('/assets/index-abc.js');
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toMatch(/immutable/);
    const png = await get('/sprites/x.png');
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['cache-control']).toBe('no-cache');
  });

  it('answers unknown paths with the page, never a file outside the folder', async () => {
    expect((await get('/some/where')).body).toMatch(/<title>Pieces/);
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt']) {
      const r = await get(p);
      expect(r.body).not.toContain('top secret');
    }
  });

  it('refuses anything but GET and HEAD', async () => {
    expect((await get('/', 'POST')).status).toBe(405);
    const head = await get('/', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('has a health check for the host', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });
});

describe('client address', () => {
  const req = (headers: Record<string, string>, remote = '10.0.0.1') => ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

  it('uses the proxy header only when told to', () => {
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.9' }))).toBe('10.0.0.1');
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.9' }), 'fly-client-ip')).toBe('203.0.113.9');
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.9, 10.0.0.2' }), 'Fly-Client-IP')).toBe('203.0.113.9');
    expect(clientIp(req({}), 'fly-client-ip')).toBe('10.0.0.1');
  });
});
