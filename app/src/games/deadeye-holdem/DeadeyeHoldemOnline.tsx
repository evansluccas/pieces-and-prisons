import { useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { HandLog, drawScene } from './DeadeyeHoldem';
import type { GameState, Snipe } from './logic';

/** Deadeye Hold'em at an online table: bet on your turn, then aim your snipe with everyone else. */
export function DeadeyeHoldemOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [aim, setAim] = useState<Snipe>({ cat: 1, key: 14 });

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (id.startsWith('cat:')) return setAim((a) => ({ ...a, cat: Number(id.slice(4)) }));
    if (id.startsWith('key:')) return setAim((a) => ({ ...a, key: Number(id.slice(4)) }));
    if (!game.waiting) return;
    if (id.startsWith('act:')) send({ type: 'act', action: { type: 'bet', action: id.slice(4) } });
    if (id === 'snipe') send({ type: 'act', action: { type: 'snipe', target: aim } });
    if (id === 'pass') send({ type: 'act', action: { type: 'snipe', target: null } });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'result' && game.pauseUntil ? `next hand in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, aim, { clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <HandLog state={s} />
    </div>
  );
}
