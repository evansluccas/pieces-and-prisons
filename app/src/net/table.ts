/**
 * The live connection to an online table. Reconnects by itself (with a
 * growing pause) and says hello on every connect, so a dropped player lands
 * back in their seat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SeatView { name: string; bot: boolean; connected: boolean; you: boolean; host: boolean }
export interface RoomView {
  code: string;
  gameId: string;
  status: 'lobby' | 'playing' | 'over';
  host: boolean;
  seats: SeatView[];
  minPlayers: number;
  maxPlayers: number;
  results: { name: string; place: number; detail: string; you: boolean }[] | null;
  /** Choices the host can make in the lobby (e.g. the Party's practice round). */
  options: { key: string; label: string; value: boolean }[];
}
/**
 * The latest game message. `deadline` and `pauseUntil` are already turned
 * into THIS page's clock (Date.now() terms), so a computer whose clock is off
 * still counts down correctly.
 */
export interface GameMessage<V = unknown> { view: V; waiting: boolean; deadline: number | null; pauseUntil: number | null }

type ServerMessage =
  | { type: 'room'; room: RoomView }
  | ({ type: 'game'; now?: number } & GameMessage)
  | { type: 'left' }
  | { type: 'error'; message: string };

export type Link = 'connecting' | 'open' | 'closed';

export function useTable() {
  const [link, setLink] = useState<Link>('connecting');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<GameMessage | null>(null);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stop = false;
    let wait = 500;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      setLink('connecting');
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        wait = 500;
        setLink('open');
        sock.send(JSON.stringify({ type: 'hello' }));
      };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'room') {
          setRoom(msg.room);
          if (msg.room.status === 'lobby') setGame(null);
        } else if (msg.type === 'game') {
          // the server's times, moved onto this page's clock
          const shift = msg.now === undefined ? 0 : Date.now() - msg.now;
          const local = (t: number | null) => (t === null ? null : t + shift);
          setGame({ view: msg.view, waiting: msg.waiting, deadline: local(msg.deadline), pauseUntil: local(msg.pauseUntil) });
        }
        else if (msg.type === 'left') {
          setRoom(null);
          setGame(null);
        } else if (msg.type === 'error') setError({ text: msg.message, at: Date.now() });
      };
      sock.onclose = () => {
        if (stop) return;
        setLink('closed');
        retry = setTimeout(connect, wait);
        wait = Math.min(wait * 2, 8000);
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else setError({ text: 'Not connected — trying again…', at: Date.now() });
  }, []);

  return { link, room, game, error, send, clearError: () => setError(null) };
}
