import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { Calling, Flash, StoneLog, boardClick, drawScene } from './BlindFive';
import { View, toAction } from './online';

/** Blind Five at an online table: a duel. Every stone is face down on both screens until the end. */
export function BlindFiveOnline({ game, send, onAgain }: OnlineGameProps) {
  const { screen: s, opponent } = game.view as View;
  const [calling, setCalling] = useState<Calling | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  // a new move: drop any half-built call, and flash a call's five stones
  useEffect(() => {
    setCalling(null);
    if (s.call) setFlash({ cells: s.call.cells, at: performance.now() });
  }, [s.moves]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (!game.waiting || s.winner !== null) return;
    const r = boardClick(id, s, calling);
    setCalling(r.calling);
    if (r.move) send({ type: 'act', action: toAction(r.move) });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, null, calling, flash, { opponent, clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <StoneLog state={s} opponent={opponent} />
    </div>
  );
}
