import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { PORTRAITS, ScaleLog, drawScene } from './TippingScales';
import type { Chip, Color } from './logic';
import type { View } from './online';

/** Tipping Scales at an online table: pick a card and a chip; the round plays out once everyone has played. */
export function TippingScalesOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, chosen } = game.view as View;
  const [card, setCard] = useState<number | null>(null);
  const [chip, setChip] = useState<Chip | null>(null);
  const [rainbowScale, setRainbowScale] = useState<Color>('ruby');
  const resultAt = useRef(performance.now());
  const phaseKey = `${s.round}:${s.phase}`;
  useEffect(() => {
    resultAt.current = performance.now();
    setCard(null);
    setChip(null);
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
    if (id === 'skip') {
      resultAt.current = -1e9;
      return;
    }
    if (!game.waiting) return;
    if (id.startsWith('card:')) setCard(Number(id.slice(5)));
    else if (id.startsWith('chip:')) setChip(id.slice(5) as Chip);
    else if (id.startsWith('rs:')) setRainbowScale(id.slice(3) as Color);
    else if (id === 'place' && card !== null && chip !== null) {
      send({ type: 'act', action: { type: 'play', card, chip, scale: chip === 'rainbow' ? rainbowScale : chip } });
    }
  };

  const draw = (g: Gfx) => {
    const secs = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
    const clock = game.waiting && game.deadline && secs(game.deadline) <= 20 ? `${secs(game.deadline)}s left` : undefined;
    const sub = s.phase === 'result' && game.pauseUntil ? `next round in ${secs(game.pauseUntil)} s — press Ready to go sooner` : undefined;
    drawScene(g, s, meta, { card, chip, rainbowScale }, g.time - resultAt.current, { chosen, clock, sub, nextLabel: 'Ready' });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <ScaleLog state={s} />
    </div>
  );
}
