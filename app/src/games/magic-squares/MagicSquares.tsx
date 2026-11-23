import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import {
  BOARDS, GameState, HINT_MS, clock, current, hintCell, isGiven, lineTotals, magicSum, newGame, nextBoard, standings, useHint, write,
} from './logic';

const W = 480;
const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const CELL: Record<number, number> = { 3: 46, 4: 38, 5: 32 };

export const RULES = [
  'HIDDEN STAGE — fill the grid with the numbers 1 to n², each once, so every row, every column and both long diagonals add up to the same MAGIC SUM.',
  'Three squares in a row: 3×3 (sum 15), 4×4 (sum 34), then 5×5 (sum 65). Some numbers are given; every puzzle has exactly one answer.',
  'Click a square, then a number (or type it). Picking a number already on the board moves it. The totals beside each line turn green when the line is right.',
  'A hint fills in one correct number and costs 30 seconds. Lowest total time wins; others solve the same squares and their times appear as you go.',
];

// Dev-only: ?quick plays just the 3×3.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

export function MagicSquares({ botCount = 3 }: { botCount?: number }) {
  const [started, setStarted] = useState(false);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const make = () => newGame(rng, GHOSTS.slice(0, Math.max(1, botCount)), QUICK ? [3] : BOARDS);
  const [s, setS] = useState<GameState>(make);
  const [sel, setSel] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ cell: number; at: number } | null>(null);
  const start = useRef(performance.now());
  const typed = useRef<{ digit: number; cell: number; at: number } | null>(null);

  useEffect(() => {
    start.current = performance.now();
    setSel(null);
    setFlash(null);
  }, [s.index, started]);

  const elapsed = () => performance.now() - start.current;
  const n = current(s).n;
  const put = (c: number, v: number | null) => setS((st) => write(st, c, v, elapsed()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started || s.phase !== 'play' || sel === null || e.target instanceof HTMLSelectElement) return;
      const [x, y] = [sel % n, Math.floor(sel / n)];
      const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[e.key]) {
        const [dx, dy] = moves[e.key];
        const nx = Math.min(n - 1, Math.max(0, x + dx));
        const ny = Math.min(n - 1, Math.max(0, y + dy));
        setSel(ny * n + nx);
        typed.current = null;
        return e.preventDefault();
      }
      if (isGiven(s, sel)) return;
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0' && !typed.current) {
        put(sel, null);
        typed.current = null;
        return e.preventDefault();
      }
      if (!/^[0-9]$/.test(e.key)) return;
      const d = Number(e.key);
      const prev = typed.current;
      // a second digit soon after the first makes a two-digit number (4×4 and 5×5)
      if (prev && prev.cell === sel && performance.now() - prev.at < 1200 && prev.digit * 10 + d <= n * n) {
        put(sel, prev.digit * 10 + d);
        typed.current = null;
      } else if (d >= 1) {
        put(sel, d);
        typed.current = d * 10 <= n * n ? { digit: d, cell: sel, at: performance.now() } : null;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id === 'start') return setStarted(true);
    if (id === 'again') {
      setS(make());
      return setStarted(false);
    }
    if (id === 'next') return setS(nextBoard(s));
    if (s.phase !== 'play') return;
    typed.current = null;
    if (id.startsWith('cell:')) return setSel(Number(id.slice(5)));
    if (id.startsWith('num:') && sel !== null) return put(sel, Number(id.slice(4)));
    if (id === 'clear' && sel !== null) return put(sel, null);
    if (id === 'hint') {
      const c = hintCell(s, rng);
      if (c < 0) return;
      setFlash({ cell: c, at: performance.now() });
      setSel(c);
      return setS(useHint(s, c, elapsed()));
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (started ? drawScene(g, s, sel, flash, s.phase === 'play' ? elapsed() : 0) : drawIntro(g))} onHit={onHit} />
      <SquareLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'HIDDEN STAGE', color: COLORS.amethyst }], 'MAGIC SQUARES');
  g.panel('panel_parchment', 120, 50, 240, 170, 4);
  const lo = [2, 7, 6, 9, 5, 1, 4, 3, 8];
  lo.forEach((v, i) => {
    const x = 213 + (i % 3) * 18;
    const y = 58 + Math.floor(i / 3) * 14;
    g.rect(x, y, 16, 12, '#e8d3a8');
    g.text(`${v}`, x + 8, y + 2, { align: 'center', size: 8, color: '#3a2216', shadow: false });
  });
  g.text('Every line adds up the same.', 240, 106, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('3×3, then 4×4, then 5×5', 240, 124, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  g.text('hints cost 30 s', 240, 138, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  g.button('start', 'Start', 200, 176, 80, { color: 'red' });
}

function layout(n: number) {
  const cs = CELL[n];
  const size = n * cs;
  // leave room for row totals on the right and column totals below
  return { cs, x0: Math.round(4 + (278 - size - 26) / 2), y0: Math.round(32 + (234 - size - 18) / 2) };
}

function drawScene(g: Gfx, s: GameState, sel: number | null, flash: { cell: number; at: number } | null, now: number) {
  const playing = s.phase === 'play';
  const p = s.phase === 'gameOver' ? s.puzzles[s.puzzles.length - 1] : current(s);
  const n = p.n;
  const grid = s.phase === 'gameOver' ? p.solution : s.grid;
  const m = magicSum(n);
  const { cs, x0, y0 } = layout(n);
  const totals = lineTotals(n, grid);
  const penalty = s.hints * HINT_MS;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `SQUARE ${Math.min(s.index + 1, s.puzzles.length)}/${s.puzzles.length} · ${n}×${n}`, color: COLORS.gold },
    { text: `MAGIC SUM ${m}`, color: COLORS.emerald },
    { text: playing ? `${clock(now + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}` : 'solved!', color: COLORS.ink },
  ], 'MAGIC SQUARES');

  g.panel('panel_night', 4, 30, 278, 236, 4);
  const big = cs >= 38 ? 14 : 12;
  for (let c = 0; c < n * n; c++) {
    const px = x0 + (c % n) * cs;
    const py = y0 + Math.floor(c / n) * cs;
    const given = p.givens[c] !== null;
    const id = `cell:${c}`;
    g.rect(px + 1, py + 1, cs - 2, cs - 2, given ? '#c9b48a' : sel === c && playing ? '#fff1c4' : '#e8d3a8');
    if (playing && !given && g.isHover(id) && sel !== c) g.rect(px + 1, py + 1, cs - 2, cs - 2, '#ffffff', 0.25);
    const v = grid[c];
    if (v !== null) g.text(`${v}`, px + cs / 2, py + cs / 2 - big / 2 - 1, { align: 'center', size: big, color: given ? '#3a2216' : '#1f4d8a', shadow: false });
    if (flash?.cell === c && performance.now() - flash.at < 2500 && Math.floor(g.time / 250) % 2) g.frame(px + 1, py + 1, cs - 2, cs - 2, COLORS.emerald, 2);
    if (sel === c && playing) g.frame(px + 1, py + 1, cs - 2, cs - 2, COLORS.gold, 2);
    if (playing) g.hit(id, px, py, cs, cs);
  }

  // totals: rows on the right, columns below, diagonals in the corners
  const tone = (t: { sum: number; full: boolean }) => (t.full && t.sum === m ? COLORS.emerald : t.sum > m || t.full ? COLORS.ruby : COLORS.muted);
  for (let i = 0; i < n; i++) {
    const row = totals[2 * i];
    const col = totals[2 * i + 1];
    g.text(`${row.sum}`, x0 + n * cs + 4, y0 + i * cs + cs / 2 - 4, { size: 8, color: tone(row) });
    g.text(`${col.sum}`, x0 + i * cs + cs / 2, y0 + n * cs + 4, { align: 'center', size: 8, color: tone(col) });
  }
  const diag = totals[2 * n];
  const anti = totals[2 * n + 1];
  g.text(`↘${diag.sum}`, x0 + n * cs + 4, y0 + n * cs + 4, { size: 8, color: tone(diag) });
  g.text(`${anti.sum}↙`, x0 - 4, y0 + n * cs + 4, { align: 'right', size: 8, color: tone(anti) });

  // side panel
  const sx = 286;
  const pw = W - sx - 4;
  g.panel('panel_night', sx, 30, pw, 236, 4);
  if (playing) {
    const used = new Set(grid.filter((v) => v !== null));
    const filled = grid.filter((v) => v !== null).length;
    g.text(sel === null ? 'Pick an empty square' : isGiven(s, sel) ? 'That number is given' : 'Pick a number (or type it)', sx + 10, 38, { size: 9, color: COLORS.gold });
    g.text(`${filled}/${n * n} filled · each number once`, sx + 10, 52, { size: 7, color: COLORS.muted });
    const cols = 5;
    const bw = 32;
    const bh = 18;
    for (let v = 1; v <= n * n; v++) {
      const bx = sx + 10 + ((v - 1) % cols) * (bw + 2);
      const by = 64 + Math.floor((v - 1) / cols) * (bh + 2);
      const id = `num:${v}`;
      const canUse = sel !== null && !isGiven(s, sel);
      const taken = used.has(v);
      g.rect(bx, by, bw, bh, taken ? '#2a1f4d' : g.isHover(id) && canUse ? '#5a4a96' : '#3d3270');
      g.text(`${v}`, bx + bw / 2, by + 5, { align: 'center', size: 8, color: taken ? '#6b6390' : COLORS.ink });
      if (sel !== null && grid[sel] === v) g.frame(bx, by, bw, bh, COLORS.gold);
      if (canUse) g.hit(id, bx, by, bw, bh);
    }
    const by = 64 + Math.ceil((n * n) / cols) * (bh + 2) + 6;
    g.button('clear', 'Clear (⌫)', sx + 10, by, 80, { disabled: sel === null || isGiven(s, sel) || grid[sel] === null });
    g.button('hint', 'Hint (+30 s)', sx + 96, by, pw - 106);
    if (flash && performance.now() - flash.at < 2500) g.text('A correct number, flashing green', sx + 10, by + 22, { size: 7, color: COLORS.emerald });
    else g.text('Dimmed numbers are on the board —', sx + 10, by + 22, { size: 7, color: COLORS.muted });
    if (!(flash && performance.now() - flash.at < 2500)) g.text('picking one moves it here.', sx + 10, by + 32, { size: 7, color: COLORS.muted });
  } else {
    const r = s.results[s.results.length - 1];
    g.text('MAGIC!', sx + 10, 40, { size: 11, color: COLORS.emerald });
    g.text(`Your time ${clock(r.timeMs)}${r.hints ? ` (${r.hints} hint${r.hints > 1 ? 's' : ''})` : ''}`, sx + 10, 58, { size: 8, color: COLORS.ink });
    g.text(`${n}×${n} TIMES`, sx + 10, 78, { size: 7, color: COLORS.muted });
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    rows.slice(0, 6).forEach((row, i) => {
      g.text(`${i + 1}. ${row.name}`, sx + 10, 90 + i * 12, { size: 8, color: row.name === 'You' ? COLORS.gold : COLORS.ink });
      g.text(clock(row.ms), W - 14, 90 + i * 12, { align: 'right', size: 8, color: COLORS.ink });
    });
    if (s.phase === 'solved') g.button('next', s.index + 1 >= s.puzzles.length ? 'Final result' : 'Next square', sx + 10, 244, pw - 20);
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((row) => ({ name: row.name, detail: clock(row.ms) })),
      order[0].name === 'You' ? 'Fastest solver — you win!' : `${order[0].name} solved fastest.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

function SquareLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Square log</h3>
      {!state.results.length && <p className="muted">Your time on each square, and everyone else’s, appears here.</p>}
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
