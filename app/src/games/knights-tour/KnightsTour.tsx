import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import {
  BOARDS, GameState, HINT_MS, Hint, canStart, clock, hint, newGame, nextBoard, nextSquares, restart, size, square, standings, step, stuck,
  undo, useHint, xy,
} from './logic';

const W = 480;
const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];

export const RULES = [
  'HIDDEN STAGE — move a chess knight so it lands on EVERY square exactly once. A knight jumps in an L: two squares one way, one square to the side.',
  'Three boards in a row: 6×6, 7×7, then 8×8. Click a starting square, then click the gold squares to jump. On 7×7 you must start on a square coloured like the corners.',
  'Undo (or Backspace) is free. A hint shows a jump that can still finish the tour — or warns you the path is a dead end — and costs 30 seconds.',
  'Lowest total time wins; others race the same boards and their times appear as you go.',
];

// Dev-only: ?quick plays just the 6×6 board.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

export function KnightsTour({ botCount = 3 }: { botCount?: number }) {
  const [started, setStarted] = useState(false);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const [s, setS] = useState<GameState>(() => newGame(rng, GHOSTS.slice(0, Math.max(1, botCount)), QUICK ? [6] : BOARDS));
  const [tip, setTip] = useState<{ h: Hint; at: number; len: number } | null>(null);
  const start = useRef(performance.now());

  useEffect(() => {
    start.current = performance.now();
    setTip(null);
  }, [s.index, started]);

  const elapsed = () => performance.now() - start.current;
  const doUndo = () => setS((st) => undo(st));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started || s.phase !== 'play' || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        doUndo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id === 'start') return setStarted(true);
    if (id === 'again') {
      setS(newGame(rng, GHOSTS.slice(0, Math.max(1, botCount)), QUICK ? [6] : BOARDS));
      return setStarted(false);
    }
    if (id === 'next') return setS(nextBoard(s));
    if (s.phase !== 'play') return;
    if (id === 'undo') return doUndo();
    if (id === 'restart') return setS(restart(s));
    if (id === 'hint' && s.path.length) {
      setS(useHint(s));
      return setTip({ h: hint(size(s), s.path), at: performance.now(), len: s.path.length });
    }
    if (id.startsWith('sq:')) {
      const c = Number(id.slice(3));
      const n = size(s);
      const ok = s.path.length ? nextSquares(n, s.path).includes(c) : canStart(n, c);
      if (ok) setS(step(s, c, elapsed()));
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (started ? drawScene(g, s, tip, s.phase === 'play' ? elapsed() : 0) : drawIntro(g))} onHit={onHit} />
      <TourLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'HIDDEN STAGE', color: COLORS.amethyst }], "KNIGHT'S TOUR");
  g.panel('panel_parchment', 120, 54, 240, 160, 4);
  g.text('♞', 240, 64, { align: 'center', size: 28, color: '#3a2216', shadow: false });
  g.text('Every square. Exactly once.', 240, 104, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('6×6, then 7×7, then 8×8', 240, 122, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  g.text('free undo · hints cost 30 s', 240, 136, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  g.button('start', 'Start', 200, 170, 80, { color: 'red' });
}

function layout(n: number) {
  const cs = Math.floor(224 / n);
  return { cs, x0: Math.round(4 + (278 - n * cs) / 2), y0: Math.round(32 + (234 - n * cs) / 2) };
}

function drawScene(g: Gfx, s: GameState, tip: { h: Hint; at: number; len: number } | null, now: number) {
  const playing = s.phase === 'play';
  const n = playing || s.phase === 'solved' ? size(s) : s.boards[s.boards.length - 1];
  const { cs, x0, y0 } = layout(n);
  const path = s.path;
  const order = new Map(path.map((c, i) => [c, i + 1]));
  const head = path[path.length - 1];
  const next = playing ? nextSquares(n, path) : [];
  const isStuck = playing && stuck(n, path);
  const penalty = s.hints * HINT_MS;
  const freshTip = tip && tip.len === path.length && performance.now() - tip.at < 6000 ? tip.h : null;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `BOARD ${s.index + 1}/${s.boards.length} · ${n}×${n}`, color: COLORS.gold },
    { text: playing ? `${clock(now + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}` : 'toured!', color: COLORS.ink },
  ], "KNIGHT'S TOUR");

  g.panel('panel_night', 4, 30, 278, 236, 4);
  for (let c = 0; c < n * n; c++) {
    const [x, y] = xy(n, c);
    const px = x0 + x * cs;
    const py = y0 + y * cs;
    const dark = (x + y) % 2 === 1;
    const id = `sq:${c}`;
    const visited = order.has(c);
    g.rect(px, py, cs, cs, visited ? (dark ? '#3b6a4a' : '#4f8a5f') : dark ? '#2a2050' : '#4a3d82');
    const legal = playing && (path.length ? next.includes(c) : canStart(n, c));
    if (visited && c !== head) g.text(`${order.get(c)}`, px + cs / 2, py + cs / 2 - 4, { align: 'center', size: cs >= 30 ? 9 : 7, color: '#d8f0dc' });
    if (c === head) {
      g.rect(px + 2, py + 2, cs - 4, cs - 4, COLORS.gold, 0.35);
      g.text('♞', px + cs / 2, py + cs / 2 - Math.round(cs * 0.36), { align: 'center', size: Math.round(cs * 0.7), color: '#fff3b0' });
    }
    if (legal && path.length) g.rect(px + cs / 2 - 4, py + cs / 2 - 4, 8, 8, COLORS.gold, g.isHover(id) ? 1 : 0.7);
    if (legal && !path.length && g.isHover(id)) g.frame(px + 1, py + 1, cs - 2, cs - 2, COLORS.gold, 2);
    if (freshTip?.kind === 'move' && freshTip.to === c && Math.floor(g.time / 250) % 2) g.frame(px + 1, py + 1, cs - 2, cs - 2, COLORS.emerald, 2);
    if (legal) g.hit(id, px, py, cs, cs);
  }
  g.frame(x0 - 2, y0 - 2, n * cs + 4, n * cs + 4, '#5e3a24', 2);

  // side panel
  const sx = 286;
  g.panel('panel_night', sx, 30, W - sx - 4, 236, 4);
  if (playing) {
    let msg = '';
    let col: string = COLORS.gold;
    if (!path.length) msg = n % 2 ? 'Pick a start (corner colour)' : 'Pick any starting square';
    else if (isStuck) {
      msg = 'Stuck! Undo or restart';
      col = COLORS.ruby;
    } else msg = 'Jump to a gold square';
    g.text(msg, sx + 10, 38, { size: 9, color: col });
    g.text(`${path.length}/${n * n} squares`, sx + 10, 54, { size: 8, color: COLORS.ink });
    g.rect(sx + 10, 66, W - sx - 24, 5, '#2a1f4d');
    g.rect(sx + 10, 66, Math.round((W - sx - 24) * (path.length / (n * n))), 5, COLORS.emerald);
    g.button('undo', 'Undo (⌫)', sx + 10, 80, 84, { disabled: !path.length });
    g.button('restart', 'Restart', sx + 100, 80, 80, { color: 'red', disabled: !path.length });
    g.button('hint', 'Hint (+30 s)', sx + 10, 100, 170, { disabled: !path.length || isStuck });
    if (freshTip) {
      const text = freshTip.kind === 'move' ? `Try ${square(n, freshTip.to)} (flashing green)`
        : freshTip.kind === 'deadEnd' ? 'This path can’t finish — undo some moves'
          : 'Probably a dead end — try undoing a few moves';
      g.text(text, sx + 10, 122, { size: 7, color: freshTip.kind === 'move' ? COLORS.emerald : COLORS.ruby });
    }
    g.text('TIP: squares with few ways out', sx + 10, 150, { size: 7, color: COLORS.muted });
    g.text('(edges, corners) are best visited early.', sx + 10, 160, { size: 7, color: COLORS.muted });
  } else {
    const r = s.results[s.results.length - 1];
    g.text('TOUR COMPLETE!', sx + 10, 40, { size: 11, color: COLORS.emerald });
    g.text(`Your time ${clock(r.timeMs)}${r.hints ? ` (${r.hints} hint${r.hints > 1 ? 's' : ''})` : ''}`, sx + 10, 58, { size: 8, color: COLORS.ink });
    g.text(`${n}×${n} TIMES`, sx + 10, 78, { size: 7, color: COLORS.muted });
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    rows.slice(0, 6).forEach((row, i) => {
      g.text(`${i + 1}. ${row.name}`, sx + 10, 90 + i * 12, { size: 8, color: row.name === 'You' ? COLORS.gold : COLORS.ink });
      g.text(clock(row.ms), W - 14, 90 + i * 12, { align: 'right', size: 8, color: COLORS.ink });
    });
    if (s.phase === 'solved') g.button('next', s.index + 1 >= s.boards.length ? 'Final result' : 'Next board', sx + 10, 244, W - sx - 24);
  }

  if (s.phase === 'gameOver') {
    const order2 = standings(s);
    standingsPanel(
      g,
      order2.map((row) => ({ name: row.name, detail: clock(row.ms) })),
      order2[0].name === 'You' ? 'Fastest knight — you win!' : `${order2[0].name} toured fastest.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

function TourLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Tour log</h3>
      {!state.results.length && <p className="muted">Your time on each board, and everyone else’s, appears here.</p>}
      <ol>
        {state.results.map((r, i) => (
          <li key={i}>
            <b>{r.n}×{r.n}</b> · You {clock(r.timeMs)}{r.hints ? ` (${r.hints} hint${r.hints > 1 ? 's' : ''})` : ''}
            <em>{state.ghosts.map((gh) => `${gh.name} ${clock(gh.times[i])}`).join(' · ')}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
