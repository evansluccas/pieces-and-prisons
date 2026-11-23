import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { RaceView, clock } from '../shared/race';
import { topBar } from '../shared/draw';
import { H, SIDE_X, W, drawBoard, drawPlayPanel, tourClick } from './KnightsTour';
import { complete } from './logic';
import type { View } from './online';

/** How long to wait for the server to accept a tour before saying it didn't. */
const CHECK_MS = 3000;

/**
 * Knight's Tour at an online table: a race over the same three boards. You
 * move on your own screen (undo is free); a finished tour is sent to the
 * server, which checks it and stops your clock. Hints are asked of the
 * server so their 30 s count.
 */
export function KnightsTourOnline({ game, send, onAgain, error }: OnlineGameProps) {
  const v = game.view as RaceView;
  const p = v.puzzle as View;
  const n = p.n;
  const [path, setPath] = useState<number[]>([]);
  const sent = useRef<{ at: number; key: string; wall: number } | null>(null);
  const finished = !!v.me?.finished;
  const playing = v.stage === 'solve' && !!v.me && !finished;

  // a new board: start afresh
  useEffect(() => {
    setPath([]);
    sent.current = null;
  }, [v.round]);

  // a complete tour goes to the server by itself
  useEffect(() => {
    if (!playing || !complete(n, path)) return;
    const key = path.join();
    if (sent.current?.key === key) return;
    sent.current = { at: performance.now(), key, wall: Date.now() };
    send({ type: 'act', action: { type: 'submit', path } });
  }, [path, playing, n, send]);

  const resend = () => {
    sent.current = { at: performance.now(), key: path.join(), wall: Date.now() };
    send({ type: 'act', action: { type: 'submit', path } });
  };

  const onHit = (id: string) => {
    if (id === 'resend') return resend();
    if (!playing) return;
    const m = tourClick(id, n, path);
    if (!m) return;
    if (m.kind === 'hint') return send({ type: 'act', action: { type: 'hint', path } });
    setPath(m.kind === 'jump' ? [...path, m.to] : m.kind === 'undo' ? path.slice(0, -1) : []);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!playing || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        setPath((x) => x.slice(0, -1));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  const draw = (g: Gfx) => {
    g.tile('board', 'tile_night', 0, 0, W, H);
    topBar(g, [
      { text: `BOARD ${v.round + 1}/${v.rounds} · ${n}×${n}`, color: COLORS.gold },
      { text: p.hints ? `${p.hints} hint${p.hints > 1 ? 's' : ''} (+${p.hints * 30}s)` : 'race', color: COLORS.ink },
    ], "KNIGHT'S TOUR");

    // the hint shows only while the path is still the one it was asked for
    const tip = p.hint && p.hint.path.join() === path.join() ? p.hint.h : null;
    drawBoard(g, n, finished && p.tour ? p.tour : path, playing, playing && tip?.kind === 'move' ? tip.to : null);

    if (playing) {
      const waiting = sent.current && complete(n, path) && sent.current.key === path.join();
      // the server's own reason, if it turned the tour down
      const refused = waiting && error && error.at >= sent.current!.wall ? error.text : null;
      const late = waiting && (!!refused || performance.now() - sent.current!.at > CHECK_MS);
      const note = late ? { text: refused ?? 'The server didn’t accept that tour.', color: COLORS.ruby }
        : waiting ? { text: 'Checking your tour…', color: COLORS.gold } : undefined;
      drawPlayPanel(g, n, path, tip, note);
      if (late) {
        g.text('Undo and finish again, or', SIDE_X + 10, 196, { size: 7, color: COLORS.muted });
        g.button('resend', 'Send again', SIDE_X + 10, 210, 170);
      }
      return;
    }

    const sx = SIDE_X;
    g.panel('panel_night', sx, 30, W - sx - 4, 236, 4);
    const r = v.me?.result;
    if (r?.finished) {
      g.text('TOUR COMPLETE!', sx + 10, 40, { size: 11, color: COLORS.emerald });
      g.text(`Your time ${clock(r.ms)}${r.detail ? ` (${r.detail})` : ''}`, sx + 10, 58, { size: 8, color: COLORS.ink });
    } else if (r) g.text('Time’s up on this board.', sx + 10, 40, { size: 10, color: COLORS.ruby });
    else if (!v.me) g.text('Watching the race.', sx + 10, 40, { size: 10, color: COLORS.muted });
    const line = v.stage === 'solve' ? 'Waiting for the others…' : v.stage === 'result' ? 'Next board soon.' : 'The race is over.';
    g.text(line, sx + 10, 78, { size: 8, color: COLORS.muted });
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RaceBoard game={game} send={send} onAgain={onAgain} unit="toured" />
    </div>
  );
}

