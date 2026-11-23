import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { RaceView, clock } from '../shared/race';
import { topBar } from '../shared/draw';
import { H, Mark, Marking, W, drawField, drawTools, fenceClick } from './FenceLoop';
import { geometry, meetsNumbers } from './logic';
import type { View } from './online';

const empty = (p: View): Marking => ({ marks: Array<Mark>(geometry(p.R, p.C).edges).fill(0), undo: [] });

/**
 * Fence Loop at an online table. The screen only knows the numbers: when the
 * drawn loop fits them all it sends the fences, and the server checks them
 * and stops the clock.
 */
export function FenceLoopOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as RaceView;
  const p = v.puzzle as View;
  const [m, setM] = useState<Marking>(() => empty(p));
  const sent = useRef('');
  // when this message arrived, on this page's clock
  const arrived = useMemo(() => performance.now(), [game]);

  // a fresh round: a clean field
  useEffect(() => {
    setM(empty(p));
    sent.current = '';
  }, [v.round]); // eslint-disable-line react-hooks/exhaustive-deps

  const solving = v.stage === 'solve' && !!v.me && !v.me.finished;

  const onHit = (id: string) => {
    if (!solving) return;
    const next = fenceClick(id, m);
    if (!next) return;
    setM(next);
    const fences = next.marks.map((x) => x === 1);
    if (!meetsNumbers(p.R, p.C, p.clues, fences)) return;
    const edges = fences.flatMap((x, e) => (x ? [e] : []));
    const key = edges.join(',');
    if (key === sent.current) return;
    sent.current = key;
    send({ type: 'act', action: { type: 'submit', edges } });
  };

  const draw = (g: Gfx) => {
    const left = v.leftMs === null ? null : Math.max(0, v.leftMs - (performance.now() - arrived));
    const done = v.stage === 'result' || v.stage === 'over';
    const answer = p.answer ? new Set(p.answer) : null;
    const shown: Mark[] = answer ? m.marks.map((_, e) => (answer.has(e) ? 1 : 0)) : m.marks;
    g.tile('board', 'tile_grass', 0, 0, W, H);
    topBar(g, [
      { text: `PUZZLE ${Math.min(v.round + 1, v.rounds)}/${v.rounds}`, color: COLORS.gold },
      { text: done ? 'round over' : v.me?.finished ? 'fenced in!' : left !== null ? clock(left) : '', color: COLORS.ink },
      { text: 'NORMAL', color: COLORS.muted },
    ], 'FENCE LOOP');
    drawField(g, p, shown, solving);

    const px = 276;
    g.panel('panel_night', px, 30, W - px - 4, 236, 4);
    if (solving) {
      drawTools(g, px, m.marks, m.undo.length > 0);
      g.text('Your loop is sent the moment', px + 10, 150, { size: 7, color: COLORS.muted });
      g.text('it fits every number.', px + 10, 161, { size: 7, color: COLORS.muted });
    } else if (v.me?.finished && v.me.result?.finished && !done) {
      g.text('FENCED IN!', px + 10, 40, { size: 12, color: COLORS.emerald });
      g.text(`Your time ${clock(v.me.result.ms)}`, px + 10, 60, { size: 9, color: COLORS.ink });
      g.text('Waiting for the others…', px + 10, 80, { size: 8, color: COLORS.muted });
    } else if (done) {
      const mine = v.me?.result;
      g.text(mine?.finished ? 'FENCED IN!' : 'THE ANSWER', px + 10, 40, { size: 12, color: mine?.finished ? COLORS.emerald : COLORS.gold });
      if (mine) g.text(mine.finished ? `Your time ${clock(mine.ms)}` : 'Not finished this time.', px + 10, 60, { size: 9, color: COLORS.ink });
      g.text(v.stage === 'over' ? 'Race over — see the final order.' : 'Press Ready for the next puzzle.', px + 10, 80, { size: 8, color: COLORS.muted });
    } else {
      g.text('Watching the race.', px + 10, 40, { size: 9, color: COLORS.ink });
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RaceBoard game={game} send={send} onAgain={onAgain} />
    </div>
  );
}

