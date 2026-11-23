import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { RaceView, clock } from '../shared/race';
import { H, Intent, SIDE_X, Square, Typed, W, drawPad, drawSquare, squareClick, squareKey } from './MagicSquares';
import { Grid, place } from './logic';
import type { View } from './online';

/**
 * Magic Squares at an online table. The board lives here; the server only
 * hears about it when you ask for a hint or the square is full, and it
 * checks the square and stops your clock.
 */
export function MagicSquaresOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as RaceView;
  const p = v.puzzle as View;
  const n = p.n;
  // givens and my hints: numbers that can't change
  const fixed = useMemo(() => p.givens.map((x, c) => x ?? p.revealed[c]), [p]);
  const [grid, setGrid] = useState<Grid>(fixed);
  const [sel, setSel] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ cell: number; at: number } | null>(null);
  const typed = useRef<Typed | null>(null);
  const hintsSeen = useRef(p.hints);
  // when this message arrived, on this page's clock
  const arrived = useMemo(() => performance.now(), [game]);

  // a new square: a fresh board
  useEffect(() => {
    setGrid(fixed);
    setSel(null);
    setFlash(null);
    typed.current = null;
    hintsSeen.current = p.hints;
  }, [v.round]); // eslint-disable-line react-hooks/exhaustive-deps

  // a hint came back: put its number in place (moving it if it was elsewhere)
  useEffect(() => {
    if (p.hints <= hintsSeen.current) return;
    hintsSeen.current = p.hints;
    let g = grid;
    let fresh = -1;
    p.revealed.forEach((x, c) => {
      if (x === null || g[c] === x) return;
      g = place(g, c, x);
      fresh = c;
    });
    setGrid(g);
    if (fresh >= 0) {
      setFlash({ cell: fresh, at: performance.now() });
      setSel(fresh);
    }
  }, [p.hints]); // eslint-disable-line react-hooks/exhaustive-deps

  const playing = v.stage === 'solve' && !!v.me && !v.me.finished;
  const penalty = v.me?.penaltyMs ?? 0;
  const elapsed = () => (v.leftMs === null ? 0 : p.limitMs - v.leftMs + (performance.now() - arrived));

  const apply = (r: Intent) => {
    setSel(r.sel);
    typed.current = r.typed;
    if (r.put) {
      const g = place(grid, r.put.cell, r.put.v);
      setGrid(g);
      // a full square goes to the server to be checked
      if (g.every((x) => x !== null)) send({ type: 'act', action: { type: 'submit', grid: g } });
    }
    if (r.hint) send({ type: 'act', action: { type: 'hint', grid } });
  };

  const onHit = (id: string) => {
    if (!playing) return;
    apply(squareClick(id, n, fixed, { sel, typed: typed.current }));
  };

  // typing, like solo play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!playing || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const r = squareKey(e.key, performance.now(), n, fixed, { sel, typed: typed.current });
      if (!r.handled) return;
      apply(r);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draw = (g: Gfx) => {
    const answer = p.solution;
    const q: Square = {
      n,
      fixed: answer ? p.givens : fixed,
      hinted: p.revealed,
      grid: answer ?? grid,
      sel: playing ? sel : null,
      flash: playing ? flash : null,
      playing,
    };
    const result = v.me?.result;
    const time = playing ? `${clock(elapsed() + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}`
      : result ? (result.finished ? `solved in ${clock(result.ms)}` : 'not finished')
      : v.stage === 'solve' ? 'watching' : 'round over';
    drawSquare(g, q, `SQUARE ${Math.min(v.round + 1, v.rounds)}/${v.rounds} · ${n}×${n}`, time);
    if (playing) return drawPad(g, q);

    // side panel between squares
    const sx = SIDE_X;
    const pw = W - sx - 4;
    g.panel('panel_night', sx, 30, pw, 236, 4);
    if (result?.finished) {
      g.text('MAGIC!', sx + 10, 40, { size: 11, color: COLORS.emerald });
      g.text(`Your time ${clock(result.ms)}${result.detail ? ` (${result.detail})` : ''}`, sx + 10, 58, { size: 8, color: COLORS.ink });
    } else if (result) {
      g.text('Out of time', sx + 10, 40, { size: 11, color: COLORS.ruby });
    }
    const line = v.stage === 'solve' ? (v.me ? 'Waiting for the others…' : 'Watching the race')
      : v.stage === 'over' ? 'The race is over.' : 'The answer is on the board.';
    g.text(line, sx + 10, 80, { size: 8, color: COLORS.muted });
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RaceBoard game={game} send={send} onAgain={onAgain} />
    </div>
  );
}
