import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { placedCells, rotate } from '../piece-together/logic';
import {
  Cell, DEFAULT_CONFIG, Difficulty, GameState, Placement, Puzzle, canPlace, clock, finish, newGame, nextPuzzle, standings,
} from './logic';

const W = 480;
const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const INK = ['#f2687a', '#f5cd5b', '#6edd8c', '#70adf2', '#bf89ea', '#e89a5e'];
const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: '4 small pieces' },
  { id: 'normal', label: 'Normal', note: '5 pieces' },
  { id: 'hard', label: 'Hard', note: '6 pieces, mostly big ones' },
];

export const RULES = [
  'EXILE PUZZLE — you race the clock; the others race the same puzzles and their times appear as you go.',
  'A gold mirror line splits the board. Build the exact MIRROR IMAGE of the left-hand picture on the right: every piece the same colour, reflected into the matching spot.',
  'Pieces can be TURNED (R) but never FLIPPED — find the turn that makes each piece its own reflection.',
  'Click a piece in the tray to pick it up, then click the right half to put it down; click a placed piece to pick it back up, Esc to drop it back in the tray.',
  'The puzzle opens the moment the reflection is perfect. 3 puzzles; lowest total time wins, the slowest is exiled.',
];

// Dev-only: ?quick plays a single easy puzzle.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(d: Difficulty, ghosts: number) {
  const rng = seededRng(Date.now() & 0xffff);
  return newGame(rng, d, GHOSTS.slice(0, Math.max(1, ghosts)), QUICK ? { ...DEFAULT_CONFIG, puzzles: 1 } : DEFAULT_CONFIG);
}

interface Held { piece: number; cells: Cell[] }

/** Where a held piece's (0,0) goes so that its middle square sits on the hovered cell. */
function anchorAt(cells: Cell[], hover: Cell): Cell {
  const cx = Math.max(...cells.map((c) => c[0])) / 2;
  const cy = Math.max(...cells.map((c) => c[1])) / 2;
  const mid = cells.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? c : b));
  return [hover[0] - mid[0], hover[1] - mid[1]];
}

export function MirrorPieces({ botCount = 3 }: { botCount?: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [placed, setPlaced] = useState<Placement[]>([]);
  const [shapes, setShapes] = useState<Cell[][]>([]);
  const [held, setHeld] = useState<Held | null>(null);
  const [warn, setWarn] = useState(0);
  const start = useRef(performance.now());
  const s = state;

  useEffect(() => {
    if (!s || s.phase !== 'solve') return;
    start.current = performance.now();
    setPlaced([]);
    setHeld(null);
    setShapes(s.puzzle.tray);
  }, [s?.index, s?.phase === 'solve', s?.puzzle]);

  const turn = () => {
    if (!held) return;
    const cells = rotate(held.cells);
    setHeld({ ...held, cells });
    setShapes((sh) => sh.map((c, i) => (i === held.piece ? cells : c)));
  };

  const put = (at: Cell) => {
    if (!s || !held || !canPlace(s.puzzle, placed, held.cells, at, held.piece)) return;
    const next = [...placed.filter((p) => p.piece !== held.piece), { piece: held.piece, cells: held.cells, at }];
    setPlaced(next);
    setHeld(null);
    setState(finish(s, next, performance.now() - start.current));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!s || s.phase !== 'solve' || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k === 'r') turn();
      else if (k === 'f') setWarn(performance.now()); // no flipping in this one
      else if (e.key === 'Escape') setHeld(null);
      else return;
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
    if (s.phase !== 'solve') return;
    if (id === 'turn') return turn();
    if (id === 'clear') {
      setPlaced([]);
      return setHeld(null);
    }
    if (id.startsWith('tray:')) {
      const i = Number(id.slice(5));
      if (held?.piece === i) return setHeld(null);
      setPlaced((p) => p.filter((x) => x.piece !== i));
      return setHeld({ piece: i, cells: shapes[i] });
    }
    if (id.startsWith('cell:')) {
      const [x, y] = id.slice(5).split(':').map(Number);
      if (held) return put(anchorAt(held.cells, [x, y]));
      const hit = placed.find((p) => placedCells(p).some((c) => c[0] === x && c[1] === y));
      if (hit) {
        setPlaced((p) => p.filter((q) => q.piece !== hit.piece));
        setHeld({ piece: hit.piece, cells: hit.cells });
      }
    }
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (s ? drawScene(g, s, placed, shapes, held, s.phase === 'solve' ? performance.now() - start.current : 0, performance.now() - warn < 1800) : drawIntro(g))}
        onHit={onHit}
      />
      <PuzzleLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'EXILE PUZZLE', color: COLORS.amethyst }], 'MIRROR PIECES');
  g.panel('panel_parchment', 120, 50, 240, 170, 4);
  g.sprite('icons', 'rotate', 232, 60);
  g.text('Build the reflection. Never flip.', 240, 82, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose a difficulty', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  DIFFS.forEach((d, i) => {
    const y = 120 + i * 30;
    g.button(`diff:${d.id}`, d.label, 150, y, 80, { color: d.id === 'hard' ? 'red' : 'blue' });
    g.text(d.note, 240, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function layout(p: Puzzle) {
  const cs = Math.min(22, Math.floor(262 / (2 * p.cols)), Math.floor(210 / p.rows));
  const width = 2 * p.cols * cs;
  return { cs, x0: Math.round(4 + (278 - width) / 2), y0: Math.round(40 + (218 - p.rows * cs) / 2) };
}

function block(g: Gfx, x: number, y: number, cs: number, color: string, alpha = 1) {
  g.rect(x + 1, y + 1, cs - 2, cs - 2, color, alpha);
  g.rect(x + 1, y + 1, cs - 2, 2, '#ffffff', 0.35 * alpha);
  g.rect(x + 1, y + cs - 3, cs - 2, 2, '#000000', 0.3 * alpha);
}

function drawScene(g: Gfx, s: GameState, placed: Placement[], shapes: Cell[][], held: Held | null, now: number, warn: boolean) {
  const solving = s.phase === 'solve';
  const pz = solving ? s.puzzle : s.results[s.results.length - 1].puzzle;
  const { cs, x0, y0 } = layout(pz);
  const mx = x0 + pz.cols * cs; // mirror line

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `PUZZLE ${s.index + 1}/${s.config.puzzles}`, color: COLORS.gold },
    { text: solving ? clock(now) : 'perfect reflection!', color: COLORS.ink },
    { text: s.difficulty.toUpperCase(), color: COLORS.muted },
  ], 'MIRROR PIECES');

  g.panel('panel_night', 4, 30, 278, 236, 4);
  g.text('PICTURE', x0, y0 - 14, { size: 7, color: COLORS.muted });
  g.text('YOUR REFLECTION', mx + 6, y0 - 14, { size: 7, color: COLORS.muted });
  for (let y = 0; y < pz.rows; y++)
    for (let x = 0; x < 2 * pz.cols; x++) {
      g.rect(x0 + x * cs, y0 + y * cs, cs, cs, x < pz.cols ? '#1f1840' : '#2a2050');
      g.frame(x0 + x * cs, y0 + y * cs, cs, cs, '#3d3175');
    }
  for (const p of pz.left) for (const [x, y] of placedCells(p)) block(g, x0 + x * cs, y0 + y * cs, cs, INK[p.piece % INK.length]);
  for (const p of placed) for (const [x, y] of placedCells(p)) block(g, x0 + x * cs, y0 + y * cs, cs, INK[p.piece % INK.length]);
  // the mirror
  g.rect(mx - 1, y0 - 4, 2, pz.rows * cs + 8, COLORS.gold);
  g.rect(mx - 3, y0 - 6, 6, 2, COLORS.gold);
  g.rect(mx - 3, y0 + pz.rows * cs + 4, 6, 2, COLORS.gold);

  if (solving) {
    let hover: Cell | null = null;
    for (let y = -1; y <= pz.rows; y++)
      for (let x = pz.cols - 1; x <= 2 * pz.cols; x++) {
        const id = `cell:${x}:${y}`;
        g.hit(id, x0 + x * cs, y0 + y * cs, cs, cs);
        if (g.isHover(id)) hover = [x, y];
      }
    if (held && hover) {
      const at = anchorAt(held.cells, hover);
      const ok = canPlace(pz, placed, held.cells, at, held.piece);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(mx, 33, 282 - mx - 3, 230); // keep the preview on the right half
      g.ctx.clip();
      for (const [x, y] of held.cells) block(g, x0 + (x + at[0]) * cs, y0 + (y + at[1]) * cs, cs, ok ? INK[held.piece % INK.length] : COLORS.ruby, 0.6);
      g.ctx.restore();
    }
  }

  // tray
  const tx = 286;
  g.panel('panel_night', tx, 30, W - tx - 4, 236, 4);
  if (solving) {
    g.text(held ? 'R turn · Esc back · no flipping!' : 'TRAY — click a piece', tx + 8, 35, { size: 7, color: warn ? COLORS.ruby : COLORS.muted });
    const bw = 88;
    const bh = 58;
    pz.tray.forEach((_, i) => {
      const bx = tx + 6 + (i % 2) * (bw + 4);
      const by = 46 + Math.floor(i / 2) * (bh + 4);
      const onBoard = placed.some((p) => p.piece === i);
      const inHand = held?.piece === i;
      const id = `tray:${i}`;
      g.rect(bx, by, bw, bh, inHand ? '#3a2d6e' : g.isHover(id) ? '#2e2258' : '#1b1233');
      g.frame(bx, by, bw, bh, inHand ? COLORS.gold : '#3d3175');
      const shape = shapes[i] ?? pz.tray[i];
      const ms = 9;
      const sw = (Math.max(...shape.map((c) => c[0])) + 1) * ms;
      const sh = (Math.max(...shape.map((c) => c[1])) + 1) * ms;
      for (const [x, y] of shape) block(g, bx + (bw - sw) / 2 + x * ms, by + (bh - sh) / 2 + y * ms, ms, INK[i % INK.length], onBoard && !inHand ? 0.25 : 1);
      if (onBoard && !inHand) g.text('placed', bx + bw - 4, by + bh - 10, { align: 'right', size: 6, color: COLORS.muted });
      g.hit(id, bx, by, bw, bh);
    });
    if (warn) g.text('Pieces can’t be flipped — only turned.', tx + 8, 238, { size: 7, color: COLORS.ruby });
    g.button('turn', 'Turn (R)', tx + 6, 250, 84, { disabled: !held });
    g.button('clear', 'Clear', tx + 96, 250, 84, { color: 'red', disabled: !placed.length });
  } else {
    const r = s.results[s.results.length - 1];
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    g.text('PERFECT!', tx + 10, 38, { size: 12, color: COLORS.emerald });
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
            <b>Puzzle {i + 1}</b> · {r.puzzle.tray.length} pieces
            <em className="win">You {clock(r.timeMs)}</em>
            <em>{state!.ghosts.map((gh) => `${gh.name} ${clock(gh.times[i])}`).join(' · ')}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
