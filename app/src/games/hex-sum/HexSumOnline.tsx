import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { FLASH_MS, HexLog, drawScene, tileClick } from './HexSum';
import type { View } from './online';

/**
 * Hex Sum at an online table: a duel against another player. You are always
 * side 0 on your own screen. The server times the study phase and only sends
 * numbers you are allowed to see.
 */
export function HexSumOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, opponent, studyMs, roundOver } = game.view as View;
  const [picked, setPicked] = useState<number[]>([]);
  const seen = useRef(s.attempts.length);
  const flashAt = useRef(0);

  // a new flip starts a flash (not one already made before this screen opened)
  useEffect(() => {
    if (s.attempts.length > seen.current) flashAt.current = performance.now();
    seen.current = s.attempts.length;
    setPicked([]);
  }, [s.attempts.length]);

  const flashing = () => performance.now() - flashAt.current < FLASH_MS;
  const secs = (at: number | null) => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'ready') return send({ type: 'ready' });
    if (!game.waiting || s.phase !== 'play' || flashing()) return;
    const r = tileClick(id, s, picked);
    setPicked(r.picked);
    if (r.line !== undefined) send({ type: 'act', action: { type: 'flip', tiles: picked } });
  };

  const draw = (g: Gfx) => {
    const left = secs(game.deadline);
    const pauseLeft = game.pauseUntil ? Math.max(0, game.pauseUntil - Date.now()) : 0;
    const study = { left: s.phase === 'memorize' ? pauseLeft : 0, total: studyMs };
    drawScene(g, s, picked, study, flashing() ? performance.now() - flashAt.current : -1, opponent, {
      opponent,
      clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined,
      nextIn: roundOver && game.pauseUntil ? secs(game.pauseUntil)! : undefined,
    });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <HexLog state={s} opponent={opponent} />
    </div>
  );
}
