import { useEffect, useMemo, useRef } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { DiceLog, PORTRAITS, drawScene } from './DiceTower';
import type { GameState } from './logic';

/** Dice Tower at an online table: the same board, with picks and bets sent to the server. */
export function DiceTowerOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const phaseAt = useRef(performance.now());
  const phaseKey = `${s.round}:${s.phase}`;
  useEffect(() => {
    phaseAt.current = performance.now();
  }, [phaseKey]);

  // portraits by seat, the same for everyone at the table
  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    if (id.startsWith('die:')) send({ type: 'act', action: { type: 'draft', die: Number(id.slice(4)) } });
    else if (id.startsWith('bet:')) send({ type: 'act', action: { type: 'bet', value: Number(id.slice(4)) } });
  };

  const draw = (g: Gfx) => {
    const now = Date.now();
    const secs = (t: number) => Math.max(0, Math.ceil((t - now) / 1000));
    const left = game.deadline ? secs(game.deadline) : null;
    let sub: string | undefined;
    if (s.phase === 'predict' && s.players.find((p) => p.id === 'you')?.prediction !== null) {
      const thinking = s.players.filter((p) => p.prediction === null).length;
      sub = `${thinking} still betting`;
    }
    if (s.phase === 'result' && game.pauseUntil) sub = `Next round in ${secs(game.pauseUntil)} s — press Ready to go sooner`;
    const clock = game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined;
    drawScene(g, s, meta, g.time - phaseAt.current, { clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <DiceLog state={s} />
    </div>
  );
}
