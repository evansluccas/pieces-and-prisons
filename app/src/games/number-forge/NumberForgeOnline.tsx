import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { ForgeLog, drawScene, forgeClick, keyHit } from './NumberForge';
import { letters } from './logic';
import type { View } from './online';

const SHOW_MINE_MS = 3000; // how long your own result stays on the bench
const PENDING_MS = 3000;   // give up on "forging…" if no answer comes

/**
 * Number Forge at an online table. The server owns the round clock and the
 * order of forges; this view counts down from the "ms left" it was sent.
 */
export function NumberForgeOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as View;
  const s = v.game;
  const [pick, setPickState] = useState<number[]>([]);
  const pickRef = useRef<number[]>([]);
  const setPick = (p: number[]) => {
    pickRef.current = p;
    setPickState(p);
  };
  // when this message arrived, on this page's clock
  const arrived = useMemo(() => performance.now(), [game]);
  const myClaims = s.phase === 'play' ? s.claims.filter((c) => c.player === 'you') : [];
  // a move sent but not yet confirmed, and until when to show my own result
  const pending = useRef<{ text: string; mine: number; at: number } | null>(null);
  const mineUntil = useRef(0);

  // a fresh round: start with an empty bench
  useEffect(() => {
    setPick([]);
    pending.current = null;
    mineUntil.current = 0;
  }, [s.round, s.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // the server confirmed my move: show its result
  useEffect(() => {
    if (pending.current && myClaims.length > pending.current.mine) {
      pending.current = null;
      mineUntil.current = performance.now() + SHOW_MINE_MS;
    }
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = () => (v.left === null ? 0 : s.config.roundMs - v.left + (performance.now() - arrived));

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (s.phase !== 'play' || elapsed() >= s.config.roundMs) return;
    const r = forgeClick(id, s, pickRef.current);
    setPick(r.pick);
    if (!r.action) return;
    const text = r.action.type === 'forge' ? `Forging ${letters(r.action.order)}…` : 'Closing the forge…';
    pending.current = { text, mine: myClaims.length, at: performance.now() };
    send({ type: 'act', action: r.action });
  };

  // typing, like solo play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.phase !== 'play' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const id = keyHit(e.key);
      if (!id) return;
      onHit(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draw = (g: Gfx) => {
    const t = performance.now();
    const waiting = pending.current && t - pending.current.at < PENDING_MS ? pending.current.text : undefined;
    const latest = t < mineUntil.current ? myClaims[myClaims.length - 1] : undefined;
    const secs = Math.max(0, Math.ceil(((game.pauseUntil ?? 0) - Date.now()) / 1000));
    const sub = s.phase === 'result' && game.pauseUntil ? `next round in ${secs} s` : undefined;
    drawScene(g, s, pick, elapsed(), { latest, pending: waiting, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <ForgeLog state={s} />
    </div>
  );
}
