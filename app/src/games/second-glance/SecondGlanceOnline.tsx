import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import type { RaceView } from '../shared/race';
import { topBar } from '../shared/draw';
import { H, PW, PX, W, drawAnswer, drawField, drawX } from './SecondGlance';
import { toggleMark } from './logic';
import type { View } from './online';

/** Second Glance at an online table: study, then mark the changes; the server keeps the clock and the answer. */
export function SecondGlanceOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as RaceView;
  const p = v.puzzle as View;
  const finished = !!v.me?.finished;
  const solving = p.stage === 'solve' && !!v.me && !finished;
  const [marks, setMarks] = useState<number[]>(p.marks);
  const [compare, setCompare] = useState(false);
  // a new stage starts from what the server has (after a reconnect, the marks already sent)
  const key = `${v.round}:${p.stage}`;
  useEffect(() => {
    setMarks(p.marks);
    setCompare(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const arrived = useMemo(() => performance.now(), [game]);
  const left = () => (v.leftMs === null ? 0 : Math.max(0, v.leftMs - (performance.now() - arrived)));

  const onHit = (id: string) => {
    if (id === 'compare') return setCompare((c) => !c);
    if (!solving) return;
    if (id.startsWith('cell:')) {
      const next = toggleMark(marks, Number(id.slice(5)), p.maxMarks);
      if (next === marks) return;
      setMarks(next);
      send({ type: 'act', action: { type: 'mark', marks: next } });
    }
    if (id === 'done' && marks.length) send({ type: 'act', action: { type: 'done', marks } });
  };

  const draw = (g: Gfx) => {
    g.tile('board', 'tile_night', 0, 0, W, H);
    const ms = left();
    const round = { text: `ROUND ${v.round + 1}/${v.rounds}`, color: COLORS.gold };
    g.panel('panel_night', PX, 30, PW, 236, 4);

    if (p.stage === 'study') {
      topBar(g, [round, { text: `MEMORISE — ${Math.ceil(ms / 1000)}s`, color: COLORS.emerald }], 'SECOND GLANCE');
      drawField(g, p.scene, false);
      g.text('MEMORISE', PX + 8, 38, { size: 10, color: COLORS.emerald });
      g.text('5 things will change', PX + 8, 56, { size: 7, color: COLORS.muted });
      g.text('solving starts for', PX + 8, 66, { size: 7, color: COLORS.muted });
      g.text('everyone together', PX + 8, 76, { size: 7, color: COLORS.muted });
      return;
    }

    if (p.stage === 'solve') {
      topBar(g, [round, { text: `SPOT THE CHANGES — ${Math.ceil(ms / 1000)}s`, color: ms < 10_000 ? COLORS.ruby : COLORS.ink }], 'SECOND GLANCE');
      drawField(g, p.scene, solving);
      for (const m of marks) drawX(g, m, COLORS.ruby);
      g.text('SPOT', PX + 8, 38, { size: 10, color: COLORS.gold });
      g.text(finished ? 'waiting for the others' : 'click squares to mark X', PX + 8, 54, { size: 7, color: COLORS.muted });
      g.text(`marks ${marks.length}/${p.maxMarks}`, PX + 8, 70, { size: 9, color: COLORS.ink });
      if (solving) g.button('done', 'Done', PX + 8, 104, PW - 16, { color: 'red', disabled: !marks.length });
      return;
    }

    // round over: the answer
    const a = p.answer!;
    topBar(g, [round, { text: p.stage === 'over' ? 'race over' : 'results', color: COLORS.muted }], 'SECOND GLANCE');
    drawField(g, compare ? a.before : p.scene, false);
    if (!compare) drawAnswer(g, a.changes.map((c) => c.slot), p.marks);
    if (v.me) {
      g.text(`FOUND ${a.found}/5`, PX + 8, 38, { size: 10, color: a.found >= 4 ? COLORS.emerald : a.found >= 2 ? COLORS.gold : COLORS.ruby });
      g.text('green found · gold missed', PX + 8, 54, { size: 7, color: COLORS.muted });
    } else {
      g.text('gold: the changes', PX + 8, 54, { size: 7, color: COLORS.muted });
    }
    g.button('compare', compare ? 'Show after' : 'Show before', PX + 8, 70, PW - 16);
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RaceBoard game={game} send={send} onAgain={onAgain} unit="found" />
    </div>
  );
}
