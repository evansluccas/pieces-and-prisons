import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { Builder, HandLog, builderClick, drawScene, emptyBuilder } from './HighLowEquations';
import type { GameState } from './logic';

/** High-Low Equations at an online table: bet on your turn, then build and declare your equation with everyone else. */
export function HighLowEquationsOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [b, setB] = useState<Builder>(emptyBuilder);
  useEffect(() => {
    if (s.phase !== 'declare') setB(emptyBuilder());
  }, [s.phase, s.hand]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    if (id.startsWith('act:')) return send({ type: 'act', action: { type: 'bet', action: id.slice(4) } });
    const r = builderClick(id, s, b);
    setB(r.b);
    if (r.declaration) send({ type: 'act', action: { type: 'declare', declaration: r.declaration } });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'result' && game.pauseUntil ? `next hand in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, b, { clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <HandLog state={s} />
    </div>
  );
}
