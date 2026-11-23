import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { ClaimLog, Draft, PORTRAITS, drawScene, freshDraft, piggyClick } from './PiggyBluff';
import type { View } from './online';

/** Piggy Bluff at an online table: add and pass on your turn, count when handed the bank, doubt or believe. */
export function PiggyBluffOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, drop } = game.view as View;
  const [draft, setDraft] = useState<Draft>(freshDraft);
  // when it becomes my turn to count, start the picker at 1 (the starting coin)
  useEffect(() => {
    if (s.phase === 'claim' && s.receiver === 'you') setDraft((d) => ({ ...d, count: 1 }));
    // a fresh pick each time the bank comes to me (a timed-out turn may leave one behind)
    if (s.phase === 'add' && s.holder === 'you') setDraft(freshDraft());
  }, [s.phase, s.receiver, s.holder]);

  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    const r = piggyClick(id, s, draft);
    setDraft(r.draft);
    if (r.action) send({ type: 'act', action: r.action });
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'reveal' && game.pauseUntil ? `next turn in ${secs(game.pauseUntil)} s` : undefined;
    drawScene(g, s, meta, draft, { clock, sub, nextLabel: 'Ready', drop });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <ClaimLog state={s} />
    </div>
  );
}
