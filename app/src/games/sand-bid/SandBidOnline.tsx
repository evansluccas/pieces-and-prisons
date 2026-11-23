import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { BidLog, PORTRAITS, drawScene } from './SandBid';
import type { View } from './online';
import { COUNTDOWN_MS, HoldStatus, LiveRound } from './round';
import { formatMs } from './logic';

/**
 * Sand Bid at an online table. The server owns the clock; this view rebuilds
 * the round locally from "ms ago / ms left" figures, so the board animates
 * smoothly without the two clocks needing to agree.
 */
export function SandBidOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as View;
  const s = v.game;
  const [, rerender] = useState(0);
  // when this message arrived, on this page's clock
  const arrived = useMemo(() => performance.now(), [game]);
  // what I just did, shown right away until the server confirms it
  const optimistic = useRef<HoldStatus | null>(null);
  useEffect(() => {
    optimistic.current = null;
  }, [game]);

  const live = useMemo((): LiveRound => {
    const me = v.me ?? { status: 'out' as HoldStatus, bid: 0 };
    const myBank = s.players.find((p) => p.id === 'you')?.bankMs ?? 0;
    const runAt = v.runElapsed !== null ? arrived - v.runElapsed : v.clockFinal !== null ? arrived - v.clockFinal : null;
    return {
      stage: v.stage,
      countdownAt: v.countdownLeft !== null ? arrived - (COUNTDOWN_MS - v.countdownLeft) : null,
      runAt,
      endAt: v.clockFinal !== null && runAt !== null ? runAt + v.clockFinal : null,
      banks: { you: Math.max(0, myBank) },
      holders: { you: me },
    };
  }, [v, arrived, s.players]);

  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = () => optimistic.current ?? live.holders.you.status;

  const pressNow = () => {
    if (s.phase !== 'bidding' || live.stage !== 'gathering' || status() !== 'waiting') return;
    optimistic.current = 'holding';
    send({ type: 'act', action: { type: 'press' } });
    rerender((n) => n + 1);
  };
  const releaseNow = () => {
    if (status() !== 'holding') return;
    const heldMs = live.stage === 'running' && live.runAt !== null ? Math.round(performance.now() - live.runAt) : undefined;
    optimistic.current = live.stage === 'gathering' ? 'waiting' : 'released';
    send({ type: 'act', action: { type: 'release', heldMs } });
    rerender((n) => n + 1);
  };

  // hold Space, like solo play
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) pressNow();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      releaseNow();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const onHit = (id: string) => {
    if (id === 'hold') pressNow();
    else if (id === 'next') send({ type: 'ready' });
    else if (id === 'again') onAgain();
  };

  const draw = (g: Gfx) => {
    const st = status();
    const round: LiveRound = st === live.holders.you.status ? live : { ...live, holders: { you: { ...live.holders.you, status: st } } };
    let sub: string | undefined;
    const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
    if (s.phase === 'bidding' && live.stage === 'gathering' && v.gatherLeft !== null) {
      const left = secs(v.gatherLeft - (performance.now() - arrived));
      sub = st === 'holding'
        ? `waiting for ${v.notReady} to press · anyone not holding in ${left} s sits out`
        : `press within ${left} s or sit this round out`;
    }
    if (s.phase === 'result' && game.pauseUntil) {
      const mine = s.history[s.history.length - 1]?.bids.you ?? 0;
      sub = `${mine > 0 ? `you held ${formatMs(mine)}` : 'you sat out'} · next round in ${secs(game.pauseUntil - Date.now())} s — Ready to go sooner`;
    }
    drawScene(g, s, round, meta, { clock: v.clocks[v.clocks.length - 1], sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} onRelease={releaseNow} />
      <BidLog state={s} clocks={v.clocks} />
    </div>
  );
}
