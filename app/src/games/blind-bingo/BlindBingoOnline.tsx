import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { BingoLog, PORTRAITS, drawScene } from './BlindBingo';
import type { GameState } from './logic';

/** Blind Bingo at an online table: the same board, with choices and bids sent to the server. */
export function BlindBingoOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const [picked, setPicked] = useState<number[]>([]); // indexes into my coins
  const resultAt = useRef(0);
  const phaseKey = `${s.round}:${s.phase}`;
  useEffect(() => {
    setPicked([]);
    if (s.phase === 'result') resultAt.current = performance.now();
  }, [phaseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // portraits by seat, the same for everyone at the table
  const meta = useMemo(() => {
    const m: Record<string, string> = {};
    s.players.forEach((p, i) => (m[p.id] = PORTRAITS[i % PORTRAITS.length]));
    return m;
  }, [s.players.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = s.players.find((p) => p.id === 'you')!;
  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'next') return send({ type: 'ready' });
    if (!game.waiting) return;
    if (id.startsWith('shape:') && s.phase === 'choose') send({ type: 'act', action: { type: 'choose', shape: id.slice(6) } });
    else if (id.startsWith('coin:') && s.phase === 'bid') {
      const i = Number(id.slice(5));
      setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
    } else if (id === 'bid' && s.phase === 'bid') {
      send({ type: 'act', action: { type: 'bid', coins: picked.map((i) => me.coins[i]) } });
    }
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    let clock: string | undefined;
    if (game.waiting && game.deadline && secs(game.deadline) <= 20) clock = `${secs(game.deadline)}s left`;
    if (s.phase === 'result' && game.pauseUntil) clock = `next round in ${secs(game.pauseUntil)} s`;
    drawScene(g, s, meta, picked, performance.now() - resultAt.current, { clock, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <BingoLog state={s} />
    </div>
  );
}
