import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { RaceBoard } from '../../ui/RaceBoard';
import { RaceView, clock } from '../shared/race';
import { topBar } from '../shared/draw';
import { H, LockInput, W, drawClues, drawEntry, drawNotes, drawWrong, emptyNotes, keyHit, lockClick } from './CipherLock';
import { Code, codeText } from './logic';
import type { View } from './online';

const PENDING_MS = 3000; // give up on "trying…" if no answer comes

/**
 * Cipher Lock at an online table. The server holds the code and the clock;
 * this view types the code, keeps your notes, and sends each try.
 */
export function CipherLockOnline({ game, send, onAgain }: OnlineGameProps) {
  const v = game.view as RaceView;
  const p = v.puzzle as View;
  const solving = v.stage === 'solve' && !!v.me && !v.me.finished;
  const [input, setInputState] = useState<LockInput>({ entry: [], notes: emptyNotes(p.letters) });
  const inputRef = useRef(input);
  const setInput = (x: LockInput) => {
    inputRef.current = x;
    setInputState(x);
  };
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  // the try in flight, and the last code you tried (to show once you open the lock)
  const pending = useRef<{ code: Code; at: number } | null>(null);
  const lastTry = useRef<Code | null>(null);
  const arrived = useMemo(() => performance.now(), [game]);

  // a new lock: clear the entry and notes
  useEffect(() => {
    setInput({ entry: [], notes: emptyNotes(p.letters) });
    setFlash(null);
    pending.current = null;
    lastTry.current = null;
  }, [v.round, p.letters]); // eslint-disable-line react-hooks/exhaustive-deps

  // the server answered a try: a new wrong one flashes
  const wrongCount = p.wrong.length;
  const seen = useRef(wrongCount);
  useEffect(() => {
    if (wrongCount > seen.current) {
      const w = p.wrong[wrongCount - 1];
      setFlash({ text: `${codeText(w)} is wrong — +${p.penaltyMs / 1000}s`, at: performance.now() });
    }
    // a try was answered (wrong, or the lock opened)
    if (wrongCount !== seen.current || v.me?.finished || v.stage !== 'solve') pending.current = null;
    seen.current = wrongCount;
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = () => !!pending.current && performance.now() - pending.current.at < PENDING_MS;

  const onHit = (id: string) => {
    if (!solving) return;
    const r = lockClick(id, inputRef.current, p.letters);
    if (r.attempt && busy()) return;
    setInput({ entry: r.entry, notes: r.notes });
    if (!r.attempt) return;
    pending.current = { code: r.attempt, at: performance.now() };
    lastTry.current = r.attempt;
    send({ type: 'act', action: { type: 'try', code: r.attempt } });
  };

  // typing, like solo play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!solving || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const id = keyHit(e.key, p.letters);
      if (!id) return;
      onHit(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draw = (g: Gfx) => {
    // time on this lock, from what the server last said
    const used = v.stage === 'solve' && v.leftMs !== null ? p.limitMs - v.leftMs + (performance.now() - arrived) : 0;
    const penalty = v.me?.penaltyMs ?? 0;
    const mine = v.me?.result;
    g.tile('board', 'tile_night', 0, 0, W, H);
    topBar(g, [
      { text: `LOCK ${Math.min(v.round + 1, v.rounds)}/${v.rounds}`, color: COLORS.gold },
      {
        text: mine ? (mine.finished ? `open! ${clock(mine.ms)}` : 'not opened')
          : solving ? `${clock(Math.min(used, p.limitMs) + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}` : 'watching',
        color: COLORS.ink,
      },
      { text: p.difficulty.toUpperCase(), color: COLORS.muted },
    ], 'CIPHER LOCK');

    drawClues(g, p.clues, p.letters);
    drawNotes(g, input.notes, p.letters, solving);
    g.panel('panel_night', 298, 132, 178, 72, 4);
    if (v.me) drawWrong(g, p.wrong);
    else g.text('Watching — the players race these locks.', 306, 138, { size: 7, color: COLORS.muted });

    g.panel('panel_night', 4, 208, W - 8, 58, 4);
    if (solving) drawEntry(g, p.letters, input.entry, flash, busy());
    else if (p.code) {
      // the round is over: the code can be shown
      g.text(`${mine?.finished ? 'OPEN! ' : ''}The code was ${codeText(p.code)}`, 12, 216, { size: 11, color: mine?.finished ? COLORS.emerald : COLORS.gold });
      const line = !mine ? '' : mine.finished
        ? `Your time ${clock(mine.ms)}${mine.detail ? ` (${mine.detail}, +${clock(penalty)})` : ''}`
        : `Not opened in time — you score the full ${clock(mine.ms)}.`;
      g.text(line, 12, 234, { size: 8, color: COLORS.ink });
      g.text(v.stage === 'over' ? 'Race over — see the final order.' : 'Press Ready for the next lock.', 12, 248, { size: 7, color: COLORS.muted });
    } else if (mine?.finished) {
      g.text(`OPEN!${lastTry.current ? ` ${codeText(lastTry.current)} was right.` : ''}`, 12, 216, { size: 11, color: COLORS.emerald });
      g.text(`Your time ${clock(mine.ms)}${mine.detail ? ` (${mine.detail})` : ''} — waiting for the others.`, 12, 234, { size: 8, color: COLORS.ink });
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RaceBoard game={game} send={send} onAgain={onAgain} unit="opened" />
    </div>
  );
}
