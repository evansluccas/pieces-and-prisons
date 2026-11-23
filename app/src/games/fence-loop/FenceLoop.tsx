import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { DEFAULT_CONFIG, Difficulty, GameState, clock, finish, geometry, newGame, nextPuzzle, standings } from './logic';

export const W = 480;
export const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: '5 × 5, extra numbers' },
  { id: 'normal', label: 'Normal', note: '6 × 6' },
  { id: 'hard', label: 'Hard', note: '7 × 7, fewest numbers' },
];

export const RULES = [
  'EXILE PUZZLE — you race the clock; the others race the same puzzles and their times appear as you go.',
  'Draw fences between neighbouring dots to make ONE closed loop: no crossings, no branches, no loose ends.',
  'A number tells how many of that square’s four sides are fenced. Squares without a number can have any count.',
  'Click a gap between two dots: fence → ✗ (sure there’s no fence) → empty. Numbers turn green when they’re satisfied and red when there are too many fences.',
  'Each puzzle has exactly one answer and opens the moment your loop matches it. 3 puzzles; lowest total time wins, the slowest is exiled.',
];

// Dev-only: ?quick plays a single easy puzzle.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

export type Mark = 0 | 1 | 2; // empty, fence, cross

/** What a player has drawn so far, with the undo history. */
export interface Marking { marks: Mark[]; undo: Mark[][] }

/**
 * A click on the board or its tools (edges, Undo, Clear). Returns the new
 * marking, or null if the click isn't one of those. Shared by solo and online.
 */
export function fenceClick(id: string, m: Marking): Marking | null {
  const push = (marks: Mark[]): Marking => ({ marks, undo: [...m.undo.slice(-200), m.marks] });
  if (id.startsWith('edge:')) {
    const e = Number(id.slice(5));
    return push(m.marks.map((x, i) => (i === e ? (((x + 1) % 3) as Mark) : x)));
  }
  if (id === 'undo') return m.undo.length ? { marks: m.undo[m.undo.length - 1], undo: m.undo.slice(0, -1) } : null;
  if (id === 'clear') return push(m.marks.map(() => 0));
  if (id === 'clearX') return push(m.marks.map((x) => (x === 2 ? 0 : x)));
  return null;
}

function setup(d: Difficulty, ghosts: number) {
  const rng = seededRng(Date.now() & 0xffff);
  return newGame(rng, d, GHOSTS.slice(0, Math.max(1, ghosts)), QUICK ? { ...DEFAULT_CONFIG, puzzles: 1 } : DEFAULT_CONFIG);
}

export function FenceLoop({ botCount = 3 }: { botCount?: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [undo, setUndo] = useState<Mark[][]>([]);
  const start = useRef(performance.now());
  const s = state;

  useEffect(() => {
    if (!s || s.phase !== 'solve') return;
    start.current = performance.now();
    setMarks(Array<Mark>(geometry(s.puzzle.R, s.puzzle.C).edges).fill(0));
    setUndo([]);
  }, [s?.index, s?.phase === 'solve', s?.puzzle]);

  const onHit = (id: string) => {
    if (id.startsWith('diff:')) return setState(setup(id.slice(5) as Difficulty, botCount));
    if (!s) return;
    if (id === 'again') return setState(null);
    if (id === 'next') return setState(nextPuzzle(s));
    if (s.phase !== 'solve') return;
    const next = fenceClick(id, { marks, undo });
    if (!next) return;
    setMarks(next.marks);
    setUndo(next.undo);
    if (id !== 'undo') setState(finish(s, next.marks.map((m) => m === 1), performance.now() - start.current));
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (s ? drawScene(g, s, marks, undo.length > 0, s.phase === 'solve' ? performance.now() - start.current : 0) : drawIntro(g))}
        onHit={onHit}
      />
      <PuzzleLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'EXILE PUZZLE', color: COLORS.amethyst }], 'FENCE LOOP');
  g.panel('panel_parchment', 120, 50, 240, 170, 4);
  g.sprite('board', 'wall_h', 224, 62);
  g.text('Fence in three pastures, fast.', 240, 82, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose a difficulty', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  DIFFS.forEach((d, i) => {
    const y = 120 + i * 30;
    g.button(`diff:${d.id}`, d.label, 150, y, 80, { color: d.id === 'hard' ? 'red' : 'blue' });
    g.text(d.note, 240, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

/** What the board needs to draw: the grid size and the numbers (never the answer). */
export interface Board { R: number; C: number; clues: (number | null)[] }

function layout(p: Board) {
  const cell = Math.floor(Math.min(228, 260) / p.R);
  const size = cell * p.C;
  return { cell, x0: Math.round(4 + (264 - size) / 2), y0: Math.round(32 + (232 - size) / 2) };
}

function drawScene(g: Gfx, s: GameState, marks: Mark[], canUndo: boolean, now: number) {
  const solving = s.phase === 'solve';
  const p = solving ? s.puzzle : s.results[s.results.length - 1].puzzle;
  const shown: Mark[] = solving ? marks : p.answer.map((x) => (x ? 1 : 0));

  g.tile('board', 'tile_grass', 0, 0, W, H);
  topBar(g, [
    { text: `PUZZLE ${s.index + 1}/${s.config.puzzles}`, color: COLORS.gold },
    { text: solving ? clock(now) : 'fenced in!', color: COLORS.ink },
    { text: s.difficulty.toUpperCase(), color: COLORS.muted },
  ], 'FENCE LOOP');

  drawField(g, p, shown, solving);

  // side panel
  const px = 276;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  if (solving) {
    drawTools(g, px, marks, canUndo);
    const done = s.results.length;
    if (done) {
      g.text('SO FAR', px + 10, 150, { size: 7, color: COLORS.muted });
      g.text(`you ${clock(s.results.reduce((t, r) => t + r.timeMs, 0))}`, px + 10, 162, { size: 8, color: COLORS.gold });
      s.ghosts.slice(0, 4).forEach((gh, i) => {
        g.text(`${gh.name} ${clock(gh.times.slice(0, done).reduce((a, b) => a + b, 0))}`, px + 10 + (i % 2) * 90, 176 + Math.floor(i / 2) * 12, {
          size: 8, color: COLORS.ink,
        });
      });
    }
  } else {
    const r = s.results[s.results.length - 1];
    g.text('FENCED IN!', px + 10, 40, { size: 12, color: COLORS.emerald });
    g.text(`Your time ${clock(r.timeMs)}`, px + 10, 60, { size: 9, color: COLORS.ink });
    g.text(`PUZZLE ${s.results.length} TIMES`, px + 10, 82, { size: 7, color: COLORS.muted });
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    rows.slice(0, 6).forEach((row, i) => {
      g.text(`${i + 1}. ${row.name}`, px + 10, 94 + i * 12, { size: 8, color: row.name === 'You' ? COLORS.gold : COLORS.ink });
      g.text(clock(row.ms), W - 14, 94 + i * 12, { align: 'right', size: 8, color: COLORS.ink });
    });
    if (s.phase === 'solved') g.button('next', s.results.length >= s.config.puzzles ? 'Final result' : 'Next puzzle', W - 94, 244, 80);
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    const youLast = order[order.length - 1].name === 'You';
    standingsPanel(
      g,
      order.map((row) => ({ name: row.name, detail: clock(row.ms) })),
      order[0].name === 'You' ? 'Fastest — you win the exile match!' : youLast ? 'Slowest — you are exiled.' : `${order[0].name} was fastest. You survive.`,
    );
  }
}

/** The field: numbers, fences (clickable while solving) and posts. */
export function drawField(g: Gfx, p: Board, shown: Mark[], solving: boolean) {
  const geo = geometry(p.R, p.C);
  const { cell, x0, y0 } = layout(p);
  // field
  g.rect(x0 - 6, y0 - 6, cell * p.C + 12, cell * p.R + 12, '#173018', 0.82);

  // numbers
  p.clues.forEach((k, i) => {
    if (k === null) return;
    const r = Math.floor(i / p.C);
    const c = i % p.C;
    const fenced = geo.cellEdges[i].filter((e) => shown[e] === 1).length;
    const color = fenced > k ? COLORS.ruby : fenced === k ? '#9fe3b0' : COLORS.ink;
    g.text(`${k}`, x0 + c * cell + cell / 2, y0 + r * cell + cell / 2 - Math.round(cell * 0.22), {
      align: 'center', size: cell >= 40 ? 16 : 12, color,
    });
  });

  // edges
  const HE = (p.R + 1) * p.C; // horizontal edges come first
  for (let e = 0; e < geo.edges; e++) {
    const horiz = e < HE;
    const r = horiz ? Math.floor(e / p.C) : Math.floor((e - HE) / (p.C + 1));
    const c = horiz ? e % p.C : (e - HE) % (p.C + 1);
    const x = x0 + c * cell;
    const y = y0 + r * cell;
    const id = `edge:${e}`;
    const hover = solving && g.isHover(id);
    const m = shown[e];
    if (horiz) {
      if (m === 1) g.rect(x + 2, y - 1, cell - 3, 3, solving ? '#e8c27a' : COLORS.gold);
      else if (hover) g.rect(x + 2, y, cell - 3, 1, '#ffffff', 0.5);
      if (m === 2) g.text('×', x + cell / 2, y - 5, { align: 'center', size: 8, color: COLORS.ruby });
      if (solving) g.hit(id, x + 5, y - 5, cell - 10, 11);
    } else {
      if (m === 1) g.rect(x - 1, y + 2, 3, cell - 3, solving ? '#e8c27a' : COLORS.gold);
      else if (hover) g.rect(x, y + 2, 1, cell - 3, '#ffffff', 0.5);
      if (m === 2) g.text('×', x, y + cell / 2 - 5, { align: 'center', size: 8, color: COLORS.ruby });
      if (solving) g.hit(id, x - 5, y + 5, 11, cell - 10);
    }
  }

  // posts
  for (let r = 0; r <= p.R; r++) for (let c = 0; c <= p.C; c++) g.rect(x0 + c * cell - 1, y0 + r * cell - 1, 3, 3, '#f1e4c3');
}

/** The solving tools in the side panel: hints, fence count, Undo and Clear. */
export function drawTools(g: Gfx, px: number, marks: Mark[], canUndo: boolean) {
  const fences = marks.filter((m) => m === 1).length;
  g.text('ONE CLOSED LOOP', px + 10, 38, { size: 8, color: COLORS.gold });
  g.text('number = fenced sides of that square', px + 10, 52, { size: 7, color: COLORS.muted });
  g.text('click a gap: fence → × → empty', px + 10, 63, { size: 7, color: COLORS.muted });
  g.text(`${fences} fence${fences === 1 ? '' : 's'} placed`, px + 10, 82, { size: 8, color: COLORS.ink });
  g.button('undo', 'Undo', px + 10, 100, 60, { disabled: !canUndo });
  g.button('clearX', 'Clear ×', px + 76, 100, 60, { disabled: !marks.some((m) => m === 2) });
  g.button('clear', 'Clear all', px + 10, 120, 126, { color: 'red', disabled: !marks.some((m) => m) });
}

// ---------------------------------------------------------------- log (DOM)

function PuzzleLog({ state }: { state: GameState | null }) {
  return (
    <aside className="log">
      <h3>Puzzle log</h3>
      {!state?.results.length && <p className="muted">Your time and everyone else’s appear here after each puzzle.</p>}
      <ol>
        {(state?.results ?? []).map((r, i) => (
          <li key={i}>
            <b>Puzzle {i + 1}</b> · {r.puzzle.R}×{r.puzzle.C}
            <em className="win">You {clock(r.timeMs)}</em>
            <em>{state!.ghosts.map((gh) => `${gh.name} ${clock(gh.times[i])}`).join(' · ')}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
