import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import {
  BOARDS, GameState, Grid, HINT_MS, clock, current, hintCell, lineTotals, magicSum, newGame, nextBoard, standings, useHint, write,
} from './logic';

export const W = 480;
export const H = 270;
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
      if (!started || s.phase !== 'play' || e.target instanceof HTMLSelectElement) return;
      const r = squareKey(e.key, performance.now(), n, current(s).givens, { sel, typed: typed.current });
      if (!r.handled) return;
      apply(r);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const apply = (r: Intent) => {
    setSel(r.sel);
    typed.current = r.typed;
    if (r.put) put(r.put.cell, r.put.v);
  };

  const onHit = (id: string) => {
    if (id === 'start') return setStarted(true);
    if (id === 'again') {
      setS(make());
      return setStarted(false);
    }
    if (id === 'next') return setS(nextBoard(s));
    if (s.phase !== 'play') return;
    const r = squareClick(id, n, current(s).givens, { sel, typed: typed.current });
    apply(r);
    if (r.hint) {
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

/** One square on screen, solo or online. */
export interface Square {
  n: number;
  fixed: Grid;           // numbers that can't change: the givens (online, hints too)
  hinted?: Grid;         // online: numbers a hint revealed, drawn in green
  grid: Grid;            // what's on the board
  sel: number | null;
  flash: { cell: number; at: number } | null;
  playing: boolean;
}

export const SIDE_X = 286;
const FLASH_MS = 2500;

/** The board: top bar, the grid and its line totals. */
export function drawSquare(g: Gfx, q: Square, title: string, time: string) {
  const { n, grid, sel, flash, playing } = q;
  const m = magicSum(n);
  const { cs, x0, y0 } = layout(n);
  const totals = lineTotals(n, grid);

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: title, color: COLORS.gold },
    { text: `MAGIC SUM ${m}`, color: COLORS.emerald },
    { text: time, color: COLORS.ink },
  ], 'MAGIC SQUARES');

  g.panel('panel_night', 4, 30, 278, 236, 4);
  const big = cs >= 38 ? 14 : 12;
  for (let c = 0; c < n * n; c++) {
    const px = x0 + (c % n) * cs;
    const py = y0 + Math.floor(c / n) * cs;
    const given = q.fixed[c] !== null;
    const hint = q.hinted?.[c] != null;
    const id = `cell:${c}`;
    g.rect(px + 1, py + 1, cs - 2, cs - 2, given ? '#c9b48a' : sel === c && playing ? '#fff1c4' : '#e8d3a8');
    if (playing && !given && g.isHover(id) && sel !== c) g.rect(px + 1, py + 1, cs - 2, cs - 2, '#ffffff', 0.25);
    const v = grid[c];
    if (v !== null) g.text(`${v}`, px + cs / 2, py + cs / 2 - big / 2 - 1, { align: 'center', size: big, color: hint ? '#1d6b3a' : given ? '#3a2216' : '#1f4d8a', shadow: false });
    if (flash?.cell === c && performance.now() - flash.at < FLASH_MS && Math.floor(g.time / 250) % 2) g.frame(px + 1, py + 1, cs - 2, cs - 2, COLORS.emerald, 2);
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
}

/** The side panel while solving: the number pad, Clear and Hint. */
export function drawPad(g: Gfx, q: Square, hintLabel = 'Hint (+30 s)') {
  const { n, grid, sel, flash } = q;
  const sx = SIDE_X;
  const pw = W - sx - 4;
  const locked = sel !== null && q.fixed[sel] !== null;
  g.panel('panel_night', sx, 30, pw, 236, 4);
  const used = new Set(grid.filter((v) => v !== null));
  const filled = grid.filter((v) => v !== null).length;
  g.text(sel === null ? 'Pick an empty square' : locked ? (q.hinted?.[sel] != null ? 'That number is a hint' : 'That number is given') : 'Pick a number (or type it)', sx + 10, 38, { size: 9, color: COLORS.gold });
  g.text(`${filled}/${n * n} filled · each number once`, sx + 10, 52, { size: 7, color: COLORS.muted });
  const cols = 5;
  const bw = 32;
  const bh = 18;
  for (let v = 1; v <= n * n; v++) {
    const bx = sx + 10 + ((v - 1) % cols) * (bw + 2);
    const by = 64 + Math.floor((v - 1) / cols) * (bh + 2);
    const id = `num:${v}`;
    const canUse = sel !== null && !locked;
    const taken = used.has(v);
    g.rect(bx, by, bw, bh, taken ? '#2a1f4d' : g.isHover(id) && canUse ? '#5a4a96' : '#3d3270');
    g.text(`${v}`, bx + bw / 2, by + 5, { align: 'center', size: 8, color: taken ? '#6b6390' : COLORS.ink });
    if (sel !== null && grid[sel] === v) g.frame(bx, by, bw, bh, COLORS.gold);
    if (canUse) g.hit(id, bx, by, bw, bh);
  }
  const by = 64 + Math.ceil((n * n) / cols) * (bh + 2) + 6;
  g.button('clear', 'Clear (⌫)', sx + 10, by, 80, { disabled: sel === null || locked || grid[sel] === null });
  g.button('hint', hintLabel, sx + 96, by, pw - 106);
  if (flash && performance.now() - flash.at < FLASH_MS) g.text('A correct number, flashing green', sx + 10, by + 22, { size: 7, color: COLORS.emerald });
  else {
    g.text('Dimmed numbers are on the board —', sx + 10, by + 22, { size: 7, color: COLORS.muted });
    g.text('picking one moves it here.', sx + 10, by + 32, { size: 7, color: COLORS.muted });
  }
}

function drawScene(g: Gfx, s: GameState, sel: number | null, flash: { cell: number; at: number } | null, now: number) {
  const playing = s.phase === 'play';
  const p = s.phase === 'gameOver' ? s.puzzles[s.puzzles.length - 1] : current(s);
  const n = p.n;
  const grid = s.phase === 'gameOver' ? p.solution : s.grid;
  const penalty = s.hints * HINT_MS;
  const q: Square = { n, fixed: p.givens, grid, sel, flash, playing };

  drawSquare(
    g, q,
    `SQUARE ${Math.min(s.index + 1, s.puzzles.length)}/${s.puzzles.length} · ${n}×${n}`,
    playing ? `${clock(now + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}` : 'solved!',
  );

  // side panel
  const sx = SIDE_X;
  const pw = W - sx - 4;
  if (playing) drawPad(g, q);
  else {
    g.panel('panel_night', sx, 30, pw, 236, 4);
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

// ---------------------------------------------------------------- input

/** Where a typed first digit is waiting for a possible second one. */
export interface Typed { digit: number; cell: number; at: number }
export interface Input { sel: number | null; typed: Typed | null }
/** What a click or key does: the new selection, maybe a number to put, maybe a hint. */
export interface Intent extends Input {
  handled: boolean;
  put?: { cell: number; v: number | null };
  hint?: boolean;
}

/** A click on the board or the pad. `fixed` marks the cells that can't change. */
export function squareClick(id: string, n: number, fixed: Grid, input: Input): Intent {
  const sel = input.sel;
  const open = sel !== null && fixed[sel] === null;
  const out: Intent = { sel, typed: null, handled: true };
  if (id.startsWith('cell:')) {
    const c = Number(id.slice(5));
    return Number.isInteger(c) && c >= 0 && c < n * n ? { ...out, sel: c } : out;
  }
  if (id.startsWith('num:') && open) {
    const v = Number(id.slice(4));
    return v >= 1 && v <= n * n ? { ...out, put: { cell: sel, v } } : out;
  }
  if (id === 'clear' && open) return { ...out, put: { cell: sel, v: null } };
  if (id === 'hint') return { ...out, hint: true };
  return out;
}

/** A key press: arrows move, digits type (two quick digits make 10 and up), ⌫ clears. */
export function squareKey(key: string, now: number, n: number, fixed: Grid, input: Input): Intent {
  const { sel, typed } = input;
  const skip: Intent = { sel, typed, handled: false };
  if (sel === null) return skip;
  const [x, y] = [sel % n, Math.floor(sel / n)];
  const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[key]) {
    const [dx, dy] = moves[key];
    const nx = Math.min(n - 1, Math.max(0, x + dx));
    const ny = Math.min(n - 1, Math.max(0, y + dy));
    return { sel: ny * n + nx, typed: null, handled: true };
  }
  if (fixed[sel] !== null) return skip;
  if (key === 'Backspace' || key === 'Delete' || key === '0' && !typed) {
    return { sel, typed: null, handled: true, put: { cell: sel, v: null } };
  }
  if (!/^[0-9]$/.test(key)) return skip;
  const d = Number(key);
  // a second digit soon after the first makes a two-digit number (4×4 and 5×5)
  if (typed && typed.cell === sel && now - typed.at < 1200 && typed.digit * 10 + d <= n * n) {
    return { sel, typed: null, handled: true, put: { cell: sel, v: typed.digit * 10 + d } };
  }
  if (d >= 1) {
    return { sel, typed: d * 10 <= n * n ? { digit: d, cell: sel, at: now } : null, handled: true, put: { cell: sel, v: d } };
  }
  return { sel, typed, handled: true };
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
