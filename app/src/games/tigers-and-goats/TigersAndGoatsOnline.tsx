import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { MoveLog, drawScene, pointClick } from './TigersAndGoats';
import type { View } from './online';

/** Tigers & Goats at an online table: two games against another player, swapping sides in between. */
export function TigersAndGoatsOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as View;
  const s = v.game;
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [s.history.length, v.number]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'game2') return send({ type: 'ready' });
    if (!game.waiting) return;
    const r = pointClick(id, s, v.mine, sel);
    setSel(r.sel);
    if (r.move) send({ type: 'act', action: { type: 'move', ...r.move } });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const note = game.pauseUntil ? `Game 2 starts in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, v.mine, sel, v.opponent, v.number, v.results, { clock, note, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <MoveLog state={s} mine={v.mine} results={v.results} opponent={v.opponent} />
    </div>
  );
}
