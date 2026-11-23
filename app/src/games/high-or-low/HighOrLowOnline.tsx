import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RoundLog, drawScene, tableClick } from './HighOrLow';
import type { View } from './online';

/** High or Low at an online table: a duel against another player. Their face-down card never reaches you before the call. */
export function HighOrLowOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, reveal, opponent } = game.view as View;
  const [picks, setPicks] = useState<number[]>([]);
  useEffect(() => setPicks([]), [s.round, s.phase]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting || reveal) return;
    const r = tableClick(id, s, picks);
    setPicks(r.picks);
    if (r.deal) send({ type: 'act', action: { type: 'deal', ...r.deal } });
    if (r.call) send({ type: 'act', action: { type: 'call', call: r.call } });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const done = s.phase === 'gameOver';
    const note = game.pauseUntil ? `${done ? 'Result' : 'Next round'} in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, picks, null, reveal ? 0 : -1, { opponent, clock, note, nextLabel: reveal ? 'Ready' : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <RoundLog state={s} opponent={opponent} />
    </div>
  );
}
