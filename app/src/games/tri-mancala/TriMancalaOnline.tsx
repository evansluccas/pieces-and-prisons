import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { Hand, SowLog, drawScene, handClick } from './TriMancala';
import type { GameState } from './logic';

/** Tri-Mancala at an online table: the ring turned so your pits are at the bottom; sowings go to the server. */
export function TriMancalaOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [hand, setHand] = useState<Hand | null>(null);
  useEffect(() => setHand(null), [s.history.length]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (!game.waiting) return;
    const r = handClick(id, s, hand);
    setHand(r.hand);
    if (r.sow) send({ type: 'act', action: { type: 'sow', pit: r.sow.pit, order: r.sow.order } });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, hand, { clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <SowLog state={s} />
    </div>
  );
}
