import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import {
  Cell, DEFAULT_CONFIG, Difficulty, GameState, Placement, Puzzle, canPlace, clock, finish, flip, key, newGame, nextPuzzle,
  placedCells, rotate, standings,
} from './logic';

export const W = 480;
export const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const INK = ['#f2687a', '#f5cd5b', '#6edd8c', '#70adf2', '#bf89ea', '#e89a5e', '#7fe0d8', '#f29ad6'];
const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: '6 small pieces' },
  { id: 'normal', label: 'Normal', note: '8 pieces' },
  { id: 'hard', label: 'Hard', note: '8 pieces, mostly big ones' },
];

export const RULES = [
  'EXILE PUZZLE — you race the clock; the others race the same puzzles and their times appear as you go.',
  'Fit EVERY piece from the tray into the outline: no gaps, no overlaps, nothing sticking out.',
  'Click a piece in the tray to pick it up, then click the board to put it down. Turn it with R (or Turn) and flip it with F (or Flip). Click a piece on the board to pick it back up; Esc puts it back in the tray.',
  'The puzzle opens the moment the last piece fits. 3 puzzles; lowest total time wins, the slowest is exiled.',
];

// Dev-only: ?quick plays a single easy puzzle.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(d: Difficulty, ghosts: number) {
  const rng = seededRng(Date.now() & 0xffff);
  return newGame(rng, d, GHOSTS.slice(0, Math.max(1, ghosts)), QUICK ? { ...DEFAULT_CONFIG, puzzles: 1 } : DEFAULT_CONFIG);
}

/** A piece in hand: which one, and its current turn/flip. */
export interface Held { piece: number; cells: Cell[] }

/** What the solver sees of a puzzle: the outline and the tray (never the answer). */
export type Shape = Pick<Puzzle, 'outline' | 'pieces'>;

/** Your board as you work: what's placed, each tray piece's turn/flip, and the piece in hand. */
export interface Board { placed: Placement[]; shapes: Cell[][]; held: Held | null }
export const freshBoard = (pz: Shape): Board => ({ placed: [], shapes: pz.pieces, held: null });

/** R, F and Esc as the same ids as the buttons. */
export function keyHit(key: string): string | null {
  const k = key.toLowerCase();
  return k === 'r' ? 'turn' : k === 'f' ? 'flip' : key === 'Escape' ? 'drop' : null;
}

/**
 * A click on the board or the tray (or a key, via `keyHit`), shared by the
 * solo and online screens. Returns the new board, or null if `id` isn't a
 * board control.
 */
export function boardHit(pz: Shape, b: Board, id: string): Board | null {
  const { held } = b;
  const turn = (fn: (c: Cell[]) => Cell[]): Board => {
    if (!held) return b;
    const cells = fn(held.cells);
    return { ...b, held: { ...held, cells }, shapes: b.shapes.map((c, i) => (i === held.piece ? cells : c)) };
  };
  if (id === 'turn') return turn(rotate);
  if (id === 'flip') return turn(flip);
  if (id === 'drop') return { ...b, held: null };
  if (id === 'clear') return { ...b, placed: [], held: null };
  if (id.startsWith('tray:')) {
    const i = Number(id.slice(5));
    if (held?.piece === i) return { ...b, held: null };
    // taking it from the board, if it was there
    return { ...b, placed: b.placed.filter((x) => x.piece !== i), held: { piece: i, cells: b.shapes[i] } };
  }
  if (id.startsWith('cell:')) {
    const [x, y] = id.slice(5).split(':').map(Number);
    if (held) {
      const at = anchorAt(held.cells, [x, y]);
      if (!canPlace(pz.outline, b.placed, held.cells, at, held.piece)) return b;
      return { ...b, placed: [...b.placed.filter((p) => p.piece !== held.piece), { piece: held.piece, cells: held.cells, at }], held: null };
    }
    const hit = b.placed.find((p) => placedCells(p).some((c) => c[0] === x && c[1] === y));
    if (!hit) return b;
    return { ...b, placed: b.placed.filter((q) => q.piece !== hit.piece), held: { piece: hit.piece, cells: hit.cells } };
  }
  return null;
}

export function PieceTogether({ botCount = 3 }: { botCount?: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [board, setBoard] = useState<Board>({ placed: [], shapes: [], held: null });
  const start = useRef(performance.now());
  const s = state;

  useEffect(() => {
    if (!s || s.phase !== 'solve') return;
    start.current = performance.now();
    setBoard(freshBoard(s.puzzle));
  }, [s?.index, s?.phase === 'solve', s?.puzzle]);

  /** Apply a board control; the puzzle opens the moment the last piece fits. */
  const play = (id: string) => {
    if (!s || s.phase !== 'solve') return false;
    const next = boardHit(s.puzzle, board, id);
    if (!next) return false;
    setBoard(next);
    if (next.placed !== board.placed) setState(finish(s, next.placed, performance.now() - start.current));
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!s || s.phase !== 'solve' || e.target instanceof HTMLSelectElement) return;
      const id = keyHit(e.key);
      if (!id) return;
      play(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id.startsWith('diff:')) return setState(setup(id.slice(5) as Difficulty, botCount));
    if (!s) return;
    if (id === 'again') return setState(null);
    if (id === 'next') return setState(nextPuzzle(s));
    play(id);
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (s ? drawScene(g, s, board, s.phase === 'solve' ? performance.now() - start.current : 0) : drawIntro(g))}
        onHit={onHit}
      />
      <PuzzleLog state={s} />
    </div>
  );
}

/** Where a held piece's (0,0) goes so that its middle square sits on the hovered cell. */
function anchorAt(cells: Cell[], hover: Cell): Cell {
  const cx = Math.max(...cells.map((c) => c[0])) / 2;
  const cy = Math.max(...cells.map((c) => c[1])) / 2;
  const mid = cells.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? c : b));
  return [hover[0] - mid[0], hover[1] - mid[1]];
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'EXILE PUZZLE', color: COLORS.amethyst }], 'PIECE TOGETHER');
  g.panel('panel_parchment', 120, 50, 240, 170, 4);
  g.sprite('items', 'piece', 232, 60);
  g.text('Fit every piece. Leave no gaps.', 240, 82, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose a difficulty', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  DIFFS.forEach((d, i) => {
    const y = 120 + i * 30;
    g.button(`diff:${d.id}`, d.label, 150, y, 80, { color: d.id === 'hard' ? 'red' : 'blue' });
    g.text(d.note, 240, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function boardLayout(p: Shape) {
  const w = Math.max(...p.outline.map((c) => c[0])) + 1;
  const h = Math.max(...p.outline.map((c) => c[1])) + 1;
  // one empty square of margin around the outline so pieces can hang over the edge while you aim
  const cs = Math.min(24, Math.floor(268 / (w + 2)), Math.floor(224 / (h + 2)));
  return { w, h, cs, x0: Math.round(4 + (276 - w * cs) / 2), y0: Math.round(34 + (228 - h * cs) / 2) };
}

function block(g: Gfx, x: number, y: number, cs: number, color: string, alpha = 1) {
  g.rect(x + 1, y + 1, cs - 2, cs - 2, color, alpha);
  g.rect(x + 1, y + 1, cs - 2, 2, '#ffffff', 0.35 * alpha);
  g.rect(x + 1, y + cs - 3, cs - 2, 2, '#000000', 0.3 * alpha);
}

/** Left edge of the tray panel; callers draw their own text there when not solving. */
export const TRAY_X = 286;

/**
 * The board (outline and `shown` pieces) and the tray panel. While `solving`
 * it also draws the hover preview, the tray's pieces and the Turn/Flip/Clear
 * buttons, with their click areas; otherwise the tray panel is left empty.
 */
export function drawPlay(g: Gfx, pz: Shape, b: Board, solving: boolean, shown: Placement[] = b.placed) {
  const { placed, shapes, held } = b;
  const { w, h, cs, x0, y0 } = boardLayout(pz);

  // board
  g.panel('panel_night', 4, 30, 278, 236, 4);
  const inside = new Set(pz.outline.map(key));
  for (const [x, y] of pz.outline) {
    g.rect(x0 + x * cs, y0 + y * cs, cs, cs, '#2a2050');
    g.frame(x0 + x * cs, y0 + y * cs, cs, cs, '#3d3175');
  }
  // outline edge
  for (const [x, y] of pz.outline) {
    const px = x0 + x * cs;
    const py = y0 + y * cs;
    if (!inside.has(`${x},${y - 1}`)) g.rect(px - 1, py - 1, cs + 2, 2, COLORS.gold);
    if (!inside.has(`${x},${y + 1}`)) g.rect(px - 1, py + cs - 1, cs + 2, 2, COLORS.gold);
    if (!inside.has(`${x - 1},${y}`)) g.rect(px - 1, py - 1, 2, cs + 2, COLORS.gold);
    if (!inside.has(`${x + 1},${y}`)) g.rect(px + cs - 1, py - 1, 2, cs + 2, COLORS.gold);
  }
  for (const p of shown) for (const [x, y] of placedCells(p)) block(g, x0 + x * cs, y0 + y * cs, cs, INK[p.piece % INK.length]);

  // hover preview for the piece in hand
  if (solving) {
    let hover: Cell | null = null;
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const id = `cell:${x}:${y}`;
      g.hit(id, x0 + x * cs, y0 + y * cs, cs, cs);
      if (g.isHover(id)) hover = [x, y];
    }
    if (held && hover) {
      const at = anchorAt(held.cells, hover);
      const ok = canPlace(pz.outline, placed, held.cells, at, held.piece);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(7, 33, 272, 230); // keep the preview inside the board panel
      g.ctx.clip();
      for (const [x, y] of held.cells) block(g, x0 + (x + at[0]) * cs, y0 + (y + at[1]) * cs, cs, ok ? INK[held.piece % INK.length] : COLORS.ruby, 0.6);
      g.ctx.restore();
    }
  }

  // tray
  const tx = TRAY_X;
  g.panel('panel_night', tx, 30, W - tx - 4, 236, 4);
  if (!solving) return;
  g.text(held ? 'R turn · F flip · Esc back' : 'TRAY — click a piece', tx + 8, 35, { size: 7, color: COLORS.muted });
  const bw = 88;
  const bh = 46;
  pz.pieces.forEach((_, i) => {
    const bx = tx + 6 + (i % 2) * (bw + 4);
    const by = 46 + Math.floor(i / 2) * (bh + 4);
    const onBoard = shown.some((p) => p.piece === i);
    const inHand = held?.piece === i;
    const id = `tray:${i}`;
    g.rect(bx, by, bw, bh, inHand ? '#3a2d6e' : g.isHover(id) ? '#2e2258' : '#1b1233');
    g.frame(bx, by, bw, bh, inHand ? COLORS.gold : '#3d3175');
    const shape = shapes[i] ?? pz.pieces[i];
    const ms = 8;
    const sw = (Math.max(...shape.map((c) => c[0])) + 1) * ms;
    const sh = (Math.max(...shape.map((c) => c[1])) + 1) * ms;
    for (const [x, y] of shape) block(g, bx + (bw - sw) / 2 + x * ms, by + (bh - sh) / 2 + y * ms, ms, INK[i % INK.length], onBoard && !inHand ? 0.25 : 1);
    if (onBoard && !inHand) g.text('placed', bx + bw - 4, by + bh - 10, { align: 'right', size: 6, color: COLORS.muted });
    g.hit(id, bx, by, bw, bh);
  });

  g.button('turn', 'Turn (R)', tx + 6, 250, 58, { disabled: !held });
  g.button('flip', 'Flip (F)', tx + 68, 250, 58, { disabled: !held });
  g.button('clear', 'Clear', tx + 130, 250, 50, { color: 'red', disabled: !placed.length });
}

function drawScene(g: Gfx, s: GameState, b: Board, now: number) {
  const solving = s.phase === 'solve';
  const pz = solving ? s.puzzle : s.results[s.results.length - 1].puzzle;
  // after solving, keep showing YOUR arrangement (any complete fill counts)
  const shown = solving || b.placed.length ? b.placed : pz.solution;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `PUZZLE ${s.index + 1}/${s.config.puzzles}`, color: COLORS.gold },
    { text: solving ? clock(now) : 'complete!', color: COLORS.ink },
    { text: s.difficulty.toUpperCase(), color: COLORS.muted },
  ], 'PIECE TOGETHER');

  drawPlay(g, pz, b, solving, shown);

  if (!solving) {
    const tx = TRAY_X;
    const r = s.results[s.results.length - 1];
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    g.text('COMPLETE!', tx + 10, 38, { size: 12, color: COLORS.emerald });
    g.text(`Your time ${clock(r.timeMs)}`, tx + 10, 56, { size: 9, color: COLORS.ink });
    g.text(`PUZZLE ${s.results.length} TIMES`, tx + 10, 78, { size: 7, color: COLORS.muted });
    rows.slice(0, 6).forEach((row, i) => {
      g.text(`${i + 1}. ${row.name}`, tx + 10, 90 + i * 12, { size: 8, color: row.name === 'You' ? COLORS.gold : COLORS.ink });
      g.text(clock(row.ms), W - 14, 90 + i * 12, { align: 'right', size: 8, color: COLORS.ink });
    });
    if (s.phase === 'solved') g.button('next', s.results.length >= s.config.puzzles ? 'Final result' : 'Next puzzle', tx + 6, 250, W - tx - 16);
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

// ---------------------------------------------------------------- log (DOM)

function PuzzleLog({ state }: { state: GameState | null }) {
  return (
    <aside className="log">
      <h3>Puzzle log</h3>
      {!state?.results.length && <p className="muted">Your time and everyone else’s appear here after each puzzle.</p>}
      <ol>
        {(state?.results ?? []).map((r, i) => (
          <li key={i}>
            <b>Puzzle {i + 1}</b> · {r.puzzle.pieces.length} pieces, {r.puzzle.outline.length} squares
            <em className="win">You {clock(r.timeMs)}</em>
            <em>{state!.ghosts.map((gh) => `${gh.name} ${clock(gh.times[i])}`).join(' · ')}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
