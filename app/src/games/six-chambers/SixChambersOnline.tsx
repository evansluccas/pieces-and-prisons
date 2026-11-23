import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { ChamberLog, PORTRAITS, chambersClick, drawScene } from './SixChambers';
import type { ActionKind, GameState, TurnEvent } from './logic';

// how long your own move stays readable after the next player moves
const HOLD_MS = 2500;

/** Six Chambers at an online table: peek, spin or swap on your turn, then watch the cylinder fire. */
export function SixChambersOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [kind, setKind] = useState<ActionKind | null>(null);
  const firedAt = useRef(0);
  const phase = useRef(s.phase);
  const held = useRef<{ ev: TurnEvent; until: number } | null>(null);

  // the bang starts when the round fires (joining later shows the result at once)
  if (s.phase === 'fired' && phase.current === 'turns') firedAt.current = performance.now();
  phase.current = s.phase;

  // keep your own move on screen a moment, even if the next player is quick
  const lastMove = s.events[s.events.length - 1];
  if (lastMove?.player === 'you' && JSON.stringify(lastMove) !== JSON.stringify(held.current?.ev)) {
    held.current = { ev: lastMove, until: performance.now() + HOLD_MS };
  }
  if (s.phase !== 'turns') held.current = null;

  useEffect(() => {
    if (s.turn !== 'you') setKind(null);
  }, [s.turn, s.phase]);

  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    const r = chambersClick(id, s, kind);
    setKind(r.kind);
    if (r.action) send({ type: 'act', action: { type: 'move', ...r.action } });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'fired' && game.pauseUntil ? `next round in ${secs(game.pauseUntil)} s` : undefined;
    const h = held.current;
    const keep = h && lastMove?.player !== 'you' && performance.now() < h.until ? h.ev : undefined;
    drawScene(g, s, meta, kind, g.time - firedAt.current, { clock, sub, nextLabel: 'Ready', held: keep });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <ChamberLog state={s} />
    </div>
  );
}
