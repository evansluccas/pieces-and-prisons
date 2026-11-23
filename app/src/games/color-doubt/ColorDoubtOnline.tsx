import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { BidLog, Draft, PORTRAITS, doubtClick, drawScene, startingDraft } from './ColorDoubt';
import type { GameState } from './logic';

/** Color Doubt at an online table: bid or doubt on your turn, back a side when a bid is doubted. */
export function ColorDoubtOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [draft, setDraft] = useState<Draft>({ color: 'ruby', count: 1 });
  useEffect(() => {
    if (s.phase === 'bid' && s.turn === 'you') setDraft(startingDraft(s));
  }, [s.phase, s.turn, s.bids.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    const r = doubtClick(id, s, draft);
    setDraft(r.draft);
    if (r.action) send({ type: 'act', action: r.action });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'reveal' && game.pauseUntil ? `next round in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, meta, draft, { clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <BidLog state={s} />
    </div>
  );
}
