import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { MoveLog, Pick, drawScene, pointClick } from './NineMensMorris';
import type { View } from './online';

/** Nine Men's Morris at an online table: a duel against another player. You are always blue on your own screen. */
export function NineMensMorrisOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, opponent } = game.view as View;
  const [pick, setPick] = useState<Pick>({ from: null, to: null });
  useEffect(() => setPick({ from: null, to: null }), [s.history.length]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (!game.waiting) return;
    const r = pointClick(id, s, pick);
    setPick(r.pick);
    if (r.turn) send({ type: 'act', action: { type: 'turn', ...r.turn } });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, pick, null, { opponent, clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <MoveLog state={s} opponent={opponent} />
    </div>
  );
}
