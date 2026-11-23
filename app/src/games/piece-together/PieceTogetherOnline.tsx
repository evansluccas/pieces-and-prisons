import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { topBar } from '../shared/draw';
import { RaceView, clock } from '../shared/race';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { isFilled } from './logic';
import type { View } from './online';
import { Board, H, TRAY_X, W, boardHit, drawPlay, freshBoard, keyHit } from './PieceTogether';

/**
 * Piece Together as a puzzle race: arrange the pieces here; the moment the
 * board is full it goes to the server, which checks it and stops your clock.
 */
export function PieceTogetherOnline({ game, send, onAgain, error }: OnlineGameProps) {
  const v = game.view as RaceView;
  const pz = v.puzzle as View;
  const [board, setBoard] = useState<Board>(() => freshBoard(pz));
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [rejected, setRejected] = useState(false);
  const arrived = useMemo(() => performance.now(), [game]);
  const finished = !!v.me?.finished;
  const solving = v.stage === 'solve' && !!v.me && !finished;

  // a new puzzle: an empty board
  useEffect(() => {
    setBoard(freshBoard(pz));
    setSentAt(null);
    setRejected(false);
  }, [v.round]); // eslint-disable-line react-hooks/exhaustive-deps

  // no answer from the referee yet? Then it turned the board down (its message shows above).
  useEffect(() => {
    if (sentAt === null || finished) return;
    const t = setTimeout(() => setRejected(true), 1500);
    return () => clearTimeout(t);
  }, [sentAt, finished]);

  const latest = useRef({ board, solving });
  latest.current = { board, solving };

  const play = (id: string) => {
    const { board: b, solving: live } = latest.current;
    if (!live) return;
    const next = boardHit(pz, b, id);
    if (!next) return;
    setBoard(next);
    if (next.placed === b.placed) return;
    setRejected(false);
    if (isFilled(pz, next.placed)) {
      send({ type: 'act', action: { type: 'submit', placements: next.placed } });
      setSentAt(Date.now());
    } else setSentAt(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.solving || e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      const id = keyHit(e.key);
      if (!id) return;
      play(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draw = (g: Gfx) => {
    const settled = v.stage === 'result' || v.stage === 'over';
    const left = v.leftMs === null ? null : Math.max(0, v.leftMs - (performance.now() - arrived));
    g.tile('board', 'tile_night', 0, 0, W, H);
    topBar(g, [
      { text: `ROUND ${Math.min(v.round + 1, v.rounds)}/${v.rounds}`, color: COLORS.gold },
      { text: left !== null && !finished ? `${clock(left)} left` : settled ? 'round over' : 'solved!', color: COLORS.ink },
      { text: 'NORMAL', color: COLORS.muted },
    ], 'PIECE TOGETHER');

    // yours once accepted; otherwise, after the round, the way the outline was cut
    const shown = solving ? board.placed : pz.placed ?? (settled ? pz.solution ?? [] : board.placed);
    drawPlay(g, pz, board, solving, shown);
    if (solving) {
      // the server's own reason, if it turned the board down
      const refused = sentAt !== null && error && error.at >= sentAt ? error.text : null;
      if (refused || rejected) g.text(refused ? `${refused} — move a piece to try again` : 'Not accepted — move a piece to try again', 8, 255, { size: 7, color: COLORS.ruby });
      return;
    }

    const tx = TRAY_X + 10;
    const mine = v.me?.result;
    if (!v.me) {
      g.text('WATCHING', tx, 38, { size: 12, color: COLORS.muted });
    } else if (mine?.finished) {
      g.text('SOLVED!', tx, 38, { size: 12, color: COLORS.emerald });
      g.text(`Your time ${clock(mine.ms)}`, tx, 56, { size: 9, color: COLORS.ink });
    } else if (settled) {
      g.text('TIME’S UP', tx, 38, { size: 12, color: COLORS.ruby });
      g.text('One way to fill it is shown.', tx, 56, { size: 8, color: COLORS.ink });
    }
    const line = v.stage === 'solve' ? 'Waiting for the others…' : v.stage === 'result' ? 'Next puzzle soon — press Ready' : v.stage === 'over' ? 'Race over' : '';
    g.text(line, tx, 78, { size: 8, color: COLORS.muted });
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={play} />
      <RaceBoard game={game} send={send} onAgain={onAgain} />
    </div>
  );
}
