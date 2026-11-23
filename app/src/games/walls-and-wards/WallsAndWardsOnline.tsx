import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { GEM, MoveLog, Sel, boardClick, drawScene, viewWithBreak } from './WallsAndWards';
import type { GameState } from './logic';

/** Walls & Wards at an online table: the same board, with placements and moves sent to the server. */
export function WallsAndWardsOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [sel, setSel] = useState<Sel>({ counter: null, to: null });
  // a new turn (or a time-out move made for you) clears any half-made choice
  useEffect(() => setSel({ counter: null, to: null }), [s.turns, s.counters.length, s.turn]);
  const color = useMemo(() => Object.fromEntries(s.players.map((p, i) => [p.id, GEM[i]])), [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (!game.waiting) return id === 'cancel' && setSel({ counter: null, to: null });
    const r = boardClick(id, s, sel);
    setSel(r.sel);
    if (r.place) send({ type: 'act', action: { type: 'place', cell: r.place } });
    if (r.move) send({ type: 'act', action: { type: 'move', ...r.move } });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    const clock = game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined;
    drawScene(g, viewWithBreak(s, sel), sel, color, s, { clock });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <MoveLog state={s} />
    </div>
  );
}
