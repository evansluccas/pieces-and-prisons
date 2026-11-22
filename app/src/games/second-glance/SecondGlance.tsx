import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { Category } from '../../engine/atlas';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import {
  COLS, DEFAULT_CONFIG, Difficulty, GameState, ROWS, Scene, clock, memorizeMs, newGame, nextRound, objName, score, standings,
  startSpotting, submit,
} from './logic';

const W = 480;
const H = 270;
const CW = 46;
const CH = 42;
const SX = 6;
const SY = 32;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: '14 objects · 15 s to look' },
  { id: 'normal', label: 'Normal', note: '18 objects · 10 s, colour changes' },
  { id: 'hard', label: 'Hard', note: '23 objects · 7 s, more colour changes' },
];

export const RULES = [
  'EXILE PUZZLE — you race the others on the same scenes; their results appear as you go.',
  'MEMORISE: study the scene while the timer runs (or press “I’m ready”).',
  'SPOT: the scene comes back with exactly 5 changes — something removed, added, swapped for another object, or the same object in another colour or number.',
  'Click up to 5 squares to mark them with an X (click again to take it back), then press Done. You have 60 seconds.',
  '3 rounds. Most changes found wins (ties: less time spotting). The lowest is exiled.',
];

// Dev-only: ?quick plays a single round.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(d: Difficulty, ghosts: number) {
  const rng = seededRng(Date.now() & 0xffff);
  return newGame(rng, d, GHOSTS.slice(0, Math.max(1, ghosts)), QUICK ? { ...DEFAULT_CONFIG, rounds: 1 } : DEFAULT_CONFIG);
}

export function SecondGlance({ botCount = 3 }: { botCount?: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [marks, setMarks] = useState<number[]>([]);
  const [compare, setCompare] = useState(false);
  const phaseAt = useRef(performance.now());
  const s = state;
  const since = () => performance.now() - phaseAt.current;

  useEffect(() => {
    phaseAt.current = performance.now();
    if (s?.phase === 'memorize') {
      setMarks([]);
      setCompare(false);
    }
  }, [s?.phase, s?.index]);

  // memorise countdown, then the spotting clock
  useEffect(() => {
    if (!s || (s.phase !== 'memorize' && s.phase !== 'spot')) return;
    const t = setInterval(() => {
      setState((st) => {
        if (!st) return st;
        if (st.phase === 'memorize' && since() >= memorizeMs(st.difficulty)) return startSpotting(st);
        if (st.phase === 'spot' && since() >= st.config.spotMs) return submit(st, marksRef.current, st.config.spotMs);
        return st;
      });
    }, 200);
    return () => clearInterval(t);
  }, [s?.phase, s?.index]);

  const marksRef = useRef(marks);
  marksRef.current = marks;

  const onHit = (id: string) => {
    if (id.startsWith('diff:')) return setState(setup(id.slice(5) as Difficulty, botCount));
    if (!s) return;
    if (id === 'again') return setState(null);
    if (id === 'ready' && s.phase === 'memorize') return setState(startSpotting(s));
    if (id === 'next') return setState(nextRound(s));
    if (id === 'compare') return setCompare((v) => !v);
    if (s.phase !== 'spot') return;
    if (id.startsWith('cell:')) {
      const c = Number(id.slice(5));
      setMarks((m) => (m.includes(c) ? m.filter((x) => x !== c) : m.length < s.config.maxMarks ? [...m, c] : m));
    }
    if (id === 'done') setState(submit(s, marks, since()));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (s ? drawScene(g, s, marks, compare, since()) : drawIntro(g))} onHit={onHit} />
      <GlanceLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'EXILE PUZZLE', color: COLORS.amethyst }], 'SECOND GLANCE');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.sprite('icons', 'eye', 232, 60);
  g.text('Look once. Then find what changed.', 240, 82, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose a difficulty', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  DIFFS.forEach((d, i) => {
    const y = 120 + i * 30;
    g.button(`diff:${d.id}`, d.label, 130, y, 70, { color: d.id === 'hard' ? 'red' : 'blue' });
    g.text(d.note, 208, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function drawField(g: Gfx, scene: Scene, clickable: boolean) {
  g.tile('board', 'tile_sand', SX, SY, COLS * CW, ROWS * CH);
  for (let c = 1; c < COLS; c++) g.rect(SX + c * CW, SY, 1, ROWS * CH, '#000000', 0.08);
  for (let r = 1; r < ROWS; r++) g.rect(SX, SY + r * CH, COLS * CW, 1, '#000000', 0.08);
  scene.forEach((o, i) => {
    const x = SX + (i % COLS) * CW;
    const y = SY + Math.floor(i / COLS) * CH;
    const id = `cell:${i}`;
    if (clickable && g.isHover(id)) g.rect(x, y, CW, CH, '#ffffff', 0.18);
    if (o) g.sprite(o.cat as Category, o.name, x + 7, y + 5, { scale: 2 });
    if (clickable) g.hit(id, x, y, CW, CH);
  });
  g.frame(SX - 1, SY - 1, COLS * CW + 2, ROWS * CH + 2, '#5e3a24', 2);
}

const cellXY = (i: number) => ({ x: SX + (i % COLS) * CW, y: SY + Math.floor(i / COLS) * CH });

function drawX(g: Gfx, i: number, color: string) {
  const { x, y } = cellXY(i);
  for (let k = 0; k < 24; k++) {
    g.rect(x + 11 + k, y + 9 + k, 3, 3, color);
    g.rect(x + 34 - k, y + 9 + k, 3, 3, color);
  }
}

function drawScene(g: Gfx, s: GameState, marks: number[], compare: boolean, since: number) {
  const px = 380;
  const pw = W - px - 4;
  g.tile('board', 'tile_night', 0, 0, W, H);

  if (s.phase === 'memorize') {
    const left = Math.max(0, memorizeMs(s.difficulty) - since);
    topBar(g, [
      { text: `ROUND ${s.index + 1}/${s.config.rounds}`, color: COLORS.gold },
      { text: `MEMORISE — ${Math.ceil(left / 1000)}s`, color: COLORS.emerald },
    ], 'SECOND GLANCE');
    drawField(g, s.round.before, false);
    g.panel('panel_night', px, 30, pw, 236, 4);
    g.text('MEMORISE', px + 8, 38, { size: 10, color: COLORS.emerald });
    g.text('5 things will change', px + 8, 56, { size: 7, color: COLORS.muted });
    g.rect(px + 8, 70, pw - 16, 6, '#2a1f4d');
    g.rect(px + 8, 70, Math.round((pw - 16) * (left / memorizeMs(s.difficulty))), 6, COLORS.emerald);
    g.button('ready', 'I’m ready', px + 8, 90, pw - 16);
    return;
  }

  const res = s.results[s.results.length - 1];
  const spotting = s.phase === 'spot';
  const round = spotting ? s.round : res.round;
  const left = Math.max(0, s.config.spotMs - since);
  topBar(g, [
    { text: `ROUND ${s.index + 1}/${s.config.rounds}`, color: COLORS.gold },
    { text: spotting ? `SPOT THE CHANGES — ${Math.ceil(left / 1000)}s` : 'results', color: spotting ? (left < 10_000 ? COLORS.ruby : COLORS.ink) : COLORS.muted },
  ], 'SECOND GLANCE');

  drawField(g, !spotting && compare ? round.before : round.after, spotting);
  g.panel('panel_night', px, 30, pw, 236, 4);

  if (spotting) {
    for (const m of marks) drawX(g, m, COLORS.ruby);
    g.text('SPOT', px + 8, 38, { size: 10, color: COLORS.gold });
    g.text('click squares to mark X', px + 8, 54, { size: 7, color: COLORS.muted });
    g.text(`marks ${marks.length}/${s.config.maxMarks}`, px + 8, 70, { size: 9, color: COLORS.ink });
    g.rect(px + 8, 86, pw - 16, 6, '#2a1f4d');
    g.rect(px + 8, 86, Math.round((pw - 16) * (left / s.config.spotMs)), 6, left < 10_000 ? COLORS.ruby : COLORS.gold);
    g.button('done', 'Done', px + 8, 104, pw - 16, { color: 'red', disabled: !marks.length });
    return;
  }

  // results
  const sc = score(round, res.marks);
  if (!compare) {
    for (const i of sc.hits) {
      const { x, y } = cellXY(i);
      g.frame(x + 1, y + 1, CW - 2, CH - 2, COLORS.emerald, 2);
    }
    for (const i of sc.wrong) drawX(g, i, COLORS.ruby);
    for (const i of sc.missed) {
      const { x, y } = cellXY(i);
      if (Math.floor(g.time / 400) % 2) g.frame(x + 1, y + 1, CW - 2, CH - 2, COLORS.gold, 2);
    }
  }
  g.text(`FOUND ${res.found}/5`, px + 8, 38, { size: 10, color: res.found >= 4 ? COLORS.emerald : res.found >= 2 ? COLORS.gold : COLORS.ruby });
  g.text(`in ${clock(res.timeMs)}`, px + 8, 52, { size: 8, color: COLORS.ink });
  g.text('green found · gold missed', px + 8, 64, { size: 7, color: COLORS.muted });
  g.button('compare', compare ? 'Show after' : 'Show before', px + 8, 76, pw - 16);
  g.text('THIS ROUND', px + 8, 98, { size: 7, color: COLORS.muted });
  const rows = [{ name: 'You', found: res.found, ms: res.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, found: gh.found[s.results.length - 1], ms: gh.times[s.results.length - 1] }))]
    .sort((a, b) => b.found - a.found || a.ms - b.ms);
  rows.slice(0, 6).forEach((r, i) => {
    g.text(r.name, px + 8, 110 + i * 11, { size: 8, color: r.name === 'You' ? COLORS.gold : COLORS.ink });
    g.text(`${r.found}/5`, W - 12, 110 + i * 11, { align: 'right', size: 8, color: COLORS.ink });
  });
  if (s.phase === 'reveal') g.button('next', s.results.length >= s.config.rounds ? 'Final result' : 'Next round', px + 8, 244, pw - 16);

  if (s.phase === 'gameOver') {
    const order = standings(s);
    const youLast = order[order.length - 1].name === 'You';
    standingsPanel(
      g,
      order.map((r) => ({ name: r.name, detail: `${r.found} found · ${clock(r.ms)}` })),
      order[0].name === 'You' ? 'Sharpest eye — you win the exile match!' : youLast ? 'Fewest found — you are exiled.' : `${order[0].name} saw the most. You survive.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

const KIND_TEXT = { removed: 'removed', added: 'added', swapped: 'swapped', recolored: 'colour/number changed' };

function GlanceLog({ state }: { state: GameState | null }) {
  return (
    <aside className="log">
      <h3>Glance log</h3>
      {!state?.results.length && <p className="muted">After each round, every change and whether you caught it appears here.</p>}
      <ol>
        {(state?.results ?? []).map((r, i) => {
          const marked = new Set(r.marks);
          return (
            <li key={i}>
              <b>Round {i + 1}</b> · found {r.found}/5 in {clock(r.timeMs)}
              {r.round.changes.map((c) => (
                <em key={c.slot} className={marked.has(c.slot) ? 'win' : 'tip'}>
                  row {Math.floor(c.slot / COLS) + 1}, column {(c.slot % COLS) + 1}: {KIND_TEXT[c.kind]} — {objName(c.before)} → {objName(c.after)}
                  {marked.has(c.slot) ? ' ✓' : ' (missed)'}
                </em>
              ))}
              <em>{state!.ghosts.map((gh) => `${gh.name} ${gh.found[i]}/5`).join(' · ')}</em>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
