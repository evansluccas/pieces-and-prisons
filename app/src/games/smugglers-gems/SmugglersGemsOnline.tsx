import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { GemLog, PORTRAITS, drawScene, gemClick } from './SmugglersGems';
import { GameState, currentTurn } from './logic';

/** Smuggler's Gems at an online table: swap blind or pass on your turn, peek once per match. */
export function SmugglersGemsOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [peeking, setPeeking] = useState(false);
  const myTurn = currentTurn(s) === 'you';
  useEffect(() => {
    if (!myTurn) setPeeking(false);
  }, [myTurn]);

  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    const r = gemClick(id, s, peeking);
    setPeeking(r.peeking);
    if (r.action) send({ type: 'act', action: r.action });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'reveal' && game.pauseUntil
      ? `${s.round >= s.config.rounds ? 'final result' : 'next round'} in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, meta, peeking, { clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <GemLog state={s} />
    </div>
  );
}
