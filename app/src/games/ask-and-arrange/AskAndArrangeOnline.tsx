import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { seededRng } from '../shared/rng';
import { AskLog, Ui, drawScene, freshUi, stageClick } from './AskAndArrange';
import { mustGuess } from './logic';
import type { View } from './online';

/** Ask & Arrange at an online table: a duel against another player. You are always the bottom row on your own screen. */
export function AskAndArrangeOnline({ game, send, onAgain }: OnlineGameProps) {
  const { game: s, opponent, locked } = game.view as View;
  const [ui, setUi] = useState<Ui>(freshUi);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));

  // out of tokens: straight to guessing
  useEffect(() => {
    if (s.phase === 'ask' && s.turn === 0 && s.guesses[0] === null && mustGuess(s, 0)) setUi((u) => ({ ...u, guessing: true }));
  }, [s.phase, s.turn, s.tokens[0]]);

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    // notes are yours to scribble on any time
    if (!game.waiting && !id.startsWith('note:')) return;
    const r = stageClick(id, s, ui, rng);
    setUi(r.ui);
    if (r.move) send({ type: 'act', action: r.move });
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, null, ui, { opponent, locked, clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <AskLog state={s} opponent={opponent} />
    </div>
  );
}
