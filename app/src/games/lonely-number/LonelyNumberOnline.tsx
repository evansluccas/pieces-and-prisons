import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { PORTRAITS, RoundLog, drawScene } from './LonelyNumber';
import type { Card, GameState } from './logic';

/** Lonely Number at an online table: the same board, with moves sent to the server. */
export function LonelyNumberOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [selected, setSelected] = useState<Card[]>([]);
  const phaseAt = useRef(performance.now());
  const phaseKey = `${s.round}:${s.phase}`;

  useEffect(() => {
    phaseAt.current = performance.now();
    if (s.phase === 'pick' && !s.pairs.you) setSelected([]);
  }, [phaseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // portraits by seat, the same for everyone at the table
  const meta = useMemo(() => {
    const m: Record<string, { portrait: string }> = {};
    s.players.forEach((p, i) => (m[p.id] = { portrait: PORTRAITS[i % PORTRAITS.length] }));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    if (id.startsWith('hand:') && s.phase === 'pick') {
      const c = Number(id.slice(5));
      setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : sel.length < 2 ? [...sel, c] : [sel[1], c]));
    } else if (id === 'confirm' && selected.length === 2) send({ type: 'act', action: { type: 'pair', pair: selected } });
    else if (id.startsWith('keep:')) send({ type: 'act', action: { type: 'keep', card: Number(id.slice(5)) } });
  };

  const draw = (g: Gfx) => {
    const now = Date.now();
    const secs = (t: number | null) => (t ? Math.max(0, Math.ceil((t - now) / 1000)) : null);
    const left = secs(game.deadline);
    const others = s.phase === 'pick' ? s.players.filter((p) => !s.pairs[p.id]).length
      : s.phase === 'keep' ? s.players.filter((p) => s.kept[p.id] === undefined).length : 0;
    let msg: string | undefined;
    let sub: string | undefined;
    if ((s.phase === 'pick' || s.phase === 'keep') && !game.waiting) {
      msg = 'Waiting for the others…';
      sub = `${others} still choosing`;
    }
    if (s.phase === 'result' && game.pauseUntil) sub = `Next round in ${secs(game.pauseUntil)} s — press Ready to go sooner`;
    const clock = game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined;
    drawScene(g, s, s.pairs.you && s.phase === 'pick' ? [...s.pairs.you] : selected, meta, g.time - phaseAt.current, {
      msg, sub, clock, canAct: game.waiting || s.phase === 'result',
    });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <RoundLog state={s} />
    </div>
  );
}
