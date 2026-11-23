import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { RaceView, clock } from '../shared/race';
import { topBar } from '../shared/draw';
import { Hand, TRAY_X, drawBoard, drawTray, emptyHand, mirrorClick, mirrorKey } from './MirrorPieces';
import { isMirrored, reflect } from './logic';
import type { View } from './online';

const W = 480;
const H = 270;
const REPLY_MS = 3000; // no word back by then: the server refused the build

/**
 * Mirror Pieces at a puzzle-race table. Pieces are placed here, as in solo;
 * the moment the reflection looks right the build is sent, and the server
 * checks it and stops the clock.
 */
export function MirrorPiecesOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as RaceView;
  const b = v.puzzle as View;
  const finished = !!v.me?.finished;
  const solving = v.stage === 'solve' && !finished && !!v.me;
  // my pieces, for this round only
  const [mine, setMine] = useState<{ round: number; hand: Hand }>(() => ({ round: v.round, hand: emptyHand(b) }));
  const hand = mine.round === v.round ? mine.hand : emptyHand(b);
  const [warn, setWarn] = useState(0);
  const sentAt = useRef<number | null>(null);
  const arrived = useMemo(() => performance.now(), [game]);

  useEffect(() => {
    sentAt.current = null;
  }, [v.round]);

  const play = (id: string) => {
    if (!solving) return;
    const next = mirrorClick(id, b, hand);
    if (next === hand) return;
    setMine({ round: v.round, hand: next });
    if (next.placed === hand.placed) return;
    sentAt.current = null;
    // looks like a perfect reflection: send it for the server to check
    if (isMirrored({ target: reflect(b.left, b.cols) }, next.placed)) {
      sentAt.current = performance.now();
      send({ type: 'act', action: { type: 'submit', placements: next.placed } });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!solving || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const id = mirrorKey(e.key);
      if (!id) return;
      if (id === 'warn') setWarn(performance.now()); // no flipping in this one
      else play(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draw = (g: Gfx) => {
    const now = performance.now();
    const settled = v.stage === 'result' || v.stage === 'over';
    const left = v.leftMs === null ? null : Math.max(0, v.leftMs - (now - arrived));
    g.tile('board', 'tile_night', 0, 0, W, H);
    topBar(g, [
      { text: `ROUND ${Math.min(v.round + 1, v.rounds)}/${v.rounds}`, color: COLORS.gold },
      { text: left === null ? (settled ? 'round over' : '') : `${clock(left)} left`, color: COLORS.ink },
      { text: 'NORMAL', color: COLORS.muted },
    ], 'MIRROR PIECES');

    // after the round, the right half shows the true reflection
    drawBoard(g, b, settled && b.target ? b.target : hand.placed, solving ? hand.held : null, solving);

    if (solving) {
      drawTray(g, b, hand, now - warn < 1800);
      const sent = sentAt.current;
      if (sent !== null && now - sent >= REPLY_MS) g.text('Not accepted — check each piece and try again.', TRAY_X + 8, 226, { size: 7, color: COLORS.ruby });
      else if (sent !== null) g.text('Checking your reflection…', TRAY_X + 8, 226, { size: 7, color: COLORS.gold });
      return;
    }
    const tx = TRAY_X;
    g.panel('panel_night', tx, 30, W - tx - 4, 236, 4);
    const r = v.me?.result;
    if (!v.me) g.text('Watching the race', tx + 10, 40, { size: 9, color: COLORS.ink });
    else if (r?.finished) {
      g.text('PERFECT!', tx + 10, 38, { size: 12, color: COLORS.emerald });
      g.text(`Your time ${clock(r.ms)}`, tx + 10, 56, { size: 9, color: COLORS.ink });
    } else if (r) g.text('Not finished', tx + 10, 40, { size: 10, color: COLORS.ruby });
    if (v.stage === 'solve') g.text('Waiting for the others…', tx + 10, 80, { size: 8, color: COLORS.muted });
    else if (settled) g.text('The true reflection is shown.', tx + 10, 80, { size: 8, color: COLORS.muted });
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={play} />
      <RaceBoard game={game} send={send} onAgain={onAgain} />
    </div>
  );
}
