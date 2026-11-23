/**
 * Live connections for online tables, at /ws on the same server.
 *
 * - Only signed-in players (account or guest) may connect: the session
 *   cookie is checked on connect and again on every message, so signing out
 *   cuts the connection.
 * - The Origin must match the Host, so another website can't open a socket
 *   with a player's cookie.
 * - Messages are small JSON objects; oversized or too-frequent ones are dropped.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { sessionUser } from './auth';
import { COOKIE } from './app';
import type { Db } from './db';
import { ClientMessage, Rooms, ServerMessage } from './rooms';

function cookie(req: IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function attachSockets(server: Server, db: Db) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const sockets = new Map<number, Set<WebSocket>>();
  const send = (userId: number, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of sockets.get(userId) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  const rooms = new Rooms(send, db);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    if (path !== '/ws') return socket.destroy();
    const token = cookie(req, COOKIE);
    const user = sessionUser(db, token);
    if (!sameOrigin(req) || !user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const set = sockets.get(user.id) ?? new Set();
      set.add(ws);
      sockets.set(user.id, set);
      let alive = true;
      let burst = 0;
      const pace = setInterval(() => (burst = 0), 1000);
      ws.on('pong', () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 30_000);

      ws.on('message', (raw) => {
        if (++burst > 20) return; // more than 20 a second: ignore
        const me = sessionUser(db, token);
        if (!me) return ws.close(4001, 'signed out');
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        rooms.handle(me, msg);
      });
      ws.on('close', () => {
        clearInterval(ping);
        clearInterval(pace);
        set.delete(ws);
        if (!set.size) {
          sockets.delete(user.id);
          rooms.disconnected(user.id);
        }
      });
    });
  });

  setInterval(() => rooms.sweep(), 60_000).unref();
  return rooms;
}
