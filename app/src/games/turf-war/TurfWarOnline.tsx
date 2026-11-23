import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { flip, rotate } from '../piece-together/logic';
import { Held, TurfLog, drawScene, turfClick } from './TurfWar';
import type { GameState } from './logic';

/** Turf War at an online table: the same field, with pieces, patches and rocks sent to the server. */
export function TurfWarOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [held, setHeld] = useState<Held>(null);
  useEffect(() => setHeld(null), [s.turn, s.round, s.history.length]);

  // R turns, F flips, Esc lets go — as in solo play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!game.waiting) return;
      const k = e.key.toLowerCase();
      const turn = (fn: typeof rotate) => setHeld((h) => (h?.kind === 'piece' ? { ...h, shape: fn(h.shape) } : h));
      if (k === 'r') turn(rotate);
      else if (k === 'f') turn(flip);
      else if (e.key === 'Escape') setHeld(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (!game.waiting) return;
    const r = turfClick(id, s, held);
    setHeld(r.held);
    if (r.action) send({ type: 'act', action: r.action });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, held, { clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <TurfLog state={s} />
    </div>
  );
}
