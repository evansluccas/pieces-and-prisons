import { useEffect, useMemo, useRef } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { DecisionLog, decisionClick, drawScene } from './SplitDecision';
import type { View } from './online';

/**
 * Split Decision at an online table. The server owns the clocks: each view
 * says how many ms are left, and this screen counts down from when it arrived.
 * An answer carries the time I measured, which the server checks against its own.
 */
export function SplitDecisionOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, leftMs } = game.view as View;
  // when this message arrived, on this page's clock
  const arrived = useMemo(() => performance.now(), [game]);
  const left = () => (leftMs === null ? undefined : Math.max(0, leftMs - (performance.now() - arrived)));
  // one answer per question, even on a double click
  const answered = useRef<number | null>(null);
  useEffect(() => {
    if (s.phase !== 'answer') answered.current = null;
  }, [s.index, s.phase]);

  const onHit = (id: string) => {
    const m = decisionClick(id, s);
    if (m?.type === 'again') return onAgain();
    if (m?.type === 'next') return send({ type: 'ready' });
    if (m?.type === 'answer' && answered.current !== s.index) {
      answered.current = s.index;
      const ms = Math.round(s.config.answerMs - (left() ?? 0));
      send({ type: 'act', action: { type: 'answer', choice: m.choice, ms } });
    }
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const last = s.index + 1 >= s.questions.length;
    const sub = s.phase === 'reveal' && game.pauseUntil ? `${last ? 'final result' : 'next question'} in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, 0, { left: left(), nextLabel: 'Ready', sub });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <DecisionLog state={s} />
    </div>
  );
}
