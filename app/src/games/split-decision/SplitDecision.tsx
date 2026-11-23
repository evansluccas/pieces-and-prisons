import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { cardSprite } from '../deadeye-holdem/cards';
import { Persona, botAnswer } from './bots';
import { DEFAULT_CONFIG, KIND_NAME, choose, newGame, next, standings, startAnswering, timeUp } from './logic';
import type { SeenData, SeenState } from './online';

const W = 480;
const H = 270;
const ME = 'you';
const BOTS: { name: string; persona: Persona }[] = [
  { name: 'Hana', persona: 'sharp' },
  { name: 'Jun', persona: 'steady' },
  { name: 'Seo', persona: 'shaky' },
  { name: 'Mira', persona: 'steady' },
  { name: 'Taeo', persona: 'sharp' },
];

export const RULES = [
  '10 questions, each with exactly TWO answers. Everyone answers in secret against a 30-second clock.',
  'COUNT THE CUBES (×3): how many cubes are in the stack? Cubes under the ones you see count too — every cube sits on the floor or on another cube.',
  'COUNT THE BLOCKS (×3): how many rectangles in the number grid add up exactly to the target? Any size counts, from one cell to the whole grid.',
  'LAY THE GRASS (×2): can the three turf pieces cover the field exactly? Pieces may be turned but not flipped, and can’t overlap.',
  'CARD MEMORY (×2): study 16 cards for 8 seconds; then say which of two squares held a card. Right answer = 1 point. Most points wins (ties: faster total on right answers); last place goes to prison.',
];

// Dev-only: ?quick plays one question of each kind.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(1, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, perKind: { cubes: 1, blocks: 1, grass: 1, memory: 1 } } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function SplitDecision({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const phaseAt = useRef(performance.now());
  const s = game.state;
  const since = () => performance.now() - phaseAt.current;

  useEffect(() => {
    phaseAt.current = performance.now();
  }, [s.index, s.phase]);

  // memorising, then the answer clock; bots answer at their own pace
  useEffect(() => {
    if (s.phase === 'memorize') {
      const t = setTimeout(() => setGame((g) => (g.state.phase === 'memorize' ? { ...g, state: startAnswering(g.state) } : g)), s.config.memorizeMs);
      return () => clearTimeout(t);
    }
    if (s.phase !== 'answer') return;
    const timers = game.bots.map((b, i) => {
      const id = `bot${i}`;
      const a = botAnswer(s, b.persona, game.rng);
      return setTimeout(() => setGame((g) => (g.state.phase === 'answer' && !(id in g.state.picks) ? { ...g, state: choose(g.state, id, a.choice, a.ms) } : g)), a.ms);
    });
    timers.push(setTimeout(() => setGame((g) => (g.state.phase === 'answer' ? { ...g, state: timeUp(g.state) } : g)), s.config.answerMs));
    return () => timers.forEach(clearTimeout);
  }, [s.index, s.phase]);

  const onHit = (id: string) => {
    const m = decisionClick(id, s);
    if (m?.type === 'again') return setGame(setup(botCount));
    if (m?.type === 'next') return setGame((g) => ({ ...g, state: next(g.state) }));
    if (m?.type === 'answer') setGame((g) => ({ ...g, state: choose(g.state, ME, m.choice, since()) }));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, since())} onHit={onHit} />
      <DecisionLog state={s} />
    </div>
  );
}

export type DecisionMove = { type: 'again' } | { type: 'next' } | { type: 'answer'; choice: 0 | 1 };

/** What a click does (solo and online share this): play again, go on, or answer the open question. */
export function decisionClick(id: string, s: SeenState): DecisionMove | null {
  if (id === 'again') return { type: 'again' };
  if (id === 'next') return s.phase === 'reveal' ? { type: 'next' } : null;
  if ((id === 'opt:0' || id === 'opt:1') && s.phase === 'answer' && !(ME in s.picks)) return { type: 'answer', choice: id === 'opt:0' ? 0 : 1 };
  return null;
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: SeenState, id: string) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? id);
const SX = 6;
const SY = 44;
const SW = 314;
const SH = 176;

function poly(g: Gfx, pts: [number, number][], fill: string, stroke = '#1b1233') {
  const c = g.ctx;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = stroke;
  c.lineWidth = 1;
  c.stroke();
}

function drawCubes(g: Gfx, d: Extract<SeenData, { kind: 'cubes' }>) {
  const hw = 16; // half width of a cube's top
  const hh = 8;  // half height of a cube's top
  const ch = 18; // cube side height
  const ox = SX + SW / 2;
  const oy = SY + 84; // room above for a 4-high tower under the question text
  // floor
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const sx = ox + (x - y) * hw;
    const sy = oy + (x + y) * hh + ch * 0;
    poly(g, [[sx, sy + 4 * 0], [sx + hw, sy + hh], [sx, sy + 2 * hh], [sx - hw, sy + hh]].map(([a, b]) => [a, b + 0] as [number, number]), '#3a2d6e', '#2a1f4d');
  }
  for (let sum = 0; sum <= 6; sum++)
    for (let y = 0; y < 4; y++) {
      const x = sum - y;
      if (x < 0 || x > 3) continue;
      for (let z = 0; z < d.heights[y][x]; z++) {
        const sx = ox + (x - y) * hw;
        const sy = oy + (x + y) * hh - (z + 1) * ch;
        poly(g, [[sx - hw, sy + hh], [sx, sy + 2 * hh], [sx, sy + 2 * hh + ch], [sx - hw, sy + hh + ch]], '#c9a35c');
        poly(g, [[sx + hw, sy + hh], [sx, sy + 2 * hh], [sx, sy + 2 * hh + ch], [sx + hw, sy + hh + ch]], '#8f6a35');
        poly(g, [[sx, sy], [sx + hw, sy + hh], [sx, sy + 2 * hh], [sx - hw, sy + hh]], '#f1d590');
      }
    }
}

function drawBlocks(g: Gfx, d: Extract<SeenData, { kind: 'blocks' }>) {
  const cw = 46;
  const chh = 40;
  const x0 = SX + (SW - cw * 4) / 2;
  const y0 = SY + 16;
  d.grid.forEach((row, r) => row.forEach((v, c) => {
    g.panel('panel_parchment', x0 + c * cw, y0 + r * chh, cw - 2, chh - 2, 4);
    g.text(`${v}`, x0 + c * cw + cw / 2 - 1, y0 + r * chh + 10, { align: 'center', size: 16, color: '#3a2216', shadow: false });
  }));
  g.text(`target ${d.target}`, SX + SW / 2, y0 + 3 * chh + 8, { align: 'center', size: 12, color: COLORS.gold });
}

const PIECE_INK = ['#6edd8c', '#70adf2', '#f5cd5b'];

function drawGrass(g: Gfx, d: Extract<SeenData, { kind: 'grass' }>) {
  const cs = 22;
  const fx = SX + 12;
  const fy = SY + 16;
  g.text('FIELD', fx, fy - 10, { size: 7, color: COLORS.muted });
  for (const [x, y] of d.field) {
    g.sprite('board', 'tile_grass', fx + x * cs, fy + y * cs, { scale: 1 });
    g.sprite('board', 'tile_grass', fx + x * cs + 6, fy + y * cs + 6, { scale: 1 });
    g.rect(fx + x * cs, fy + y * cs, cs - 1, cs - 1, '#2fa864', 0.65);
    g.frame(fx + x * cs, fy + y * cs, cs - 1, cs - 1, '#12301c');
  }
  g.text(`${d.field.length} squares`, fx, fy + 5 * cs + 6, { size: 7, color: COLORS.muted });
  const px = SX + 168;
  g.text('PIECES (turn, no flip)', px, fy - 10, { size: 7, color: COLORS.muted });
  const ps = 12;
  d.pieces.forEach((p, i) => {
    const y = fy + i * 52;
    for (const [x, yy] of p) {
      g.rect(px + x * ps, y + yy * ps, ps - 1, ps - 1, PIECE_INK[i]);
      g.frame(px + x * ps, y + yy * ps, ps - 1, ps - 1, '#1b1233');
    }
  });
}

function drawMemory(g: Gfx, d: Extract<SeenData, { kind: 'memory' }>, show: boolean, reveal: boolean) {
  const cw = 36;
  const chh = 42;
  const x0 = SX + (SW - cw * 4) / 2;
  const y0 = SY + 2;
  d.cards.forEach((c, i) => {
    const x = x0 + (i % 4) * cw;
    const y = y0 + Math.floor(i / 4) * chh;
    const spot = d.spots?.indexOf(i) ?? -1;
    const open = c !== null && (show || (reveal && spot >= 0));
    g.sprite('cards', open ? cardSprite(c) : 'back', x, y, { alpha: !show && !open && spot < 0 ? 0.6 : 1 });
    if (spot >= 0 && !show) {
      g.frame(x - 1, y - 1, 34, 46, COLORS.gold, 2);
      if (!open) g.rect(x + 7, y + 11, 18, 20, '#1b1233', 0.9);
      if (open) g.rect(x + 22, y + 30, 10, 12, '#1b1233', 0.9);
      g.text(spot === 0 ? 'A' : 'B', open ? x + 27 : x + 16, open ? y + 31 : y + 14, { align: 'center', size: open ? 9 : 14, color: COLORS.gold });
    }
  });
}

/** Online play: the server's clock (ms left) and the label on the "next" button. */
export interface DecisionHud { left?: number; nextLabel?: string; sub?: string }

export function drawScene(g: Gfx, s: SeenState, since: number, hud?: DecisionHud) {
  const over = s.phase === 'gameOver';
  const q = over ? s.results[s.results.length - 1].question : s.questions[s.index]!;
  const reveal = s.phase === 'reveal' || over;
  const picks = reveal ? s.results[s.results.length - 1].picks : s.picks;
  const left = hud?.left ?? (s.phase === 'memorize' ? s.config.memorizeMs - since : s.config.answerMs - since);

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `Q ${s.index + 1}/${s.questions.length}`, color: COLORS.gold },
    { text: KIND_NAME[q.data.kind].toUpperCase(), color: COLORS.amethyst },
    { text: s.phase === 'memorize' ? `MEMORISE ${Math.ceil(left / 1000)}s` : s.phase === 'answer' ? `${Math.ceil(Math.max(0, left) / 1000)}s` : '', color: left < 8000 ? COLORS.ruby : COLORS.ink },
  ], 'SPLIT DECISION');

  // stage
  g.panel('panel_night', SX - 2, 30, SW + 4, 192, 4);
  g.text(s.phase === 'memorize' ? 'Remember where every card is…' : q.prompt, SX + 8, 34, { size: 9, color: COLORS.gold });
  if (q.data.kind === 'cubes') drawCubes(g, q.data);
  if (q.data.kind === 'blocks') drawBlocks(g, q.data);
  if (q.data.kind === 'grass') drawGrass(g, q.data);
  if (q.data.kind === 'memory') drawMemory(g, q.data, s.phase === 'memorize', reveal);

  // the two answers
  const mine = picks[ME];
  if (s.phase !== 'memorize') {
    q.options.forEach((label, i) => {
      const x = SX + i * 160;
      const id = `opt:${i}`;
      const chosen = mine?.choice === i;
      const right = reveal && q.answer === i;
      const hover = s.phase === 'answer' && !mine && g.isHover(id);
      g.panel(right ? 'button_blue' : chosen ? 'button_red' : hover ? 'button_blue_pressed' : 'button_blue', x, 228, 154, 36, 4);
      g.text(label, x + 77, 238, { align: 'center', size: 14, color: reveal && !right ? COLORS.muted : COLORS.ink });
      if (chosen) g.text(reveal ? (right ? '✓ you' : '✗ you') : 'your pick', x + 6, 231, { size: 7, color: COLORS.gold });
      if (right) g.frame(x - 1, 227, 156, 38, COLORS.emerald, 2);
      if (s.phase === 'answer' && !mine) g.hit(id, x, 228, 154, 36);
    });
  }

  // players
  const px = 328;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  g.text('PLAYERS', px + 8, 36, { size: 7, color: COLORS.muted });
  g.text('PTS', W - 14, 36, { size: 7, color: COLORS.muted, align: 'right' });
  s.players.forEach((p, i) => {
    const y = 48 + i * 22;
    g.text(nameOf(s, p.id), px + 8, y, { size: 9, color: p.id === ME ? COLORS.gold : COLORS.ink });
    g.text(`${p.points}`, W - 14, y, { size: 9, color: COLORS.ink, align: 'right' });
    const pk = picks[p.id];
    let st = '';
    let col: string = COLORS.muted;
    if (reveal && pk) {
      const right = pk.choice === q.answer;
      st = pk.choice === null ? 'no answer' : `${right ? '✓' : '✗'} ${q.options[pk.choice]} · ${(pk.ms / 1000).toFixed(1)}s`;
      col = right ? COLORS.emerald : COLORS.ruby;
    } else if (s.phase === 'answer') st = pk ? 'answered' : 'thinking…';
    g.text(st, px + 8, y + 10, { size: 7, color: col });
  });
  if (s.phase === 'reveal') g.button('next', hud?.nextLabel ?? (s.index + 1 >= s.questions.length ? 'Final result' : 'Next question'), px + 8, 246, W - px - 20);
  if (s.phase === 'reveal' && hud?.sub) g.text(hud.sub, px + 8, 236, { size: 7, color: COLORS.muted });
  if (s.phase === 'answer' && mine) g.text('waiting for the others…', px + 8, 236, { size: 7, color: COLORS.muted });

  if (over) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.points}/${s.questions.length} · ${(p.timeMs / 1000).toFixed(0)}s` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function DecisionLog({ state }: { state: SeenState }) {
  const name = (id: string) => nameOf(state, id);
  return (
    <aside className="log">
      <h3>Answer log</h3>
      {!state.results.length && <p className="muted">Each question, the right answer and everyone’s pick appear here.</p>}
      <ol>
        {[...state.results].reverse().map((r, i) => (
          <li key={state.results.length - i}>
            <b>Q{state.results.length - i}</b> {KIND_NAME[r.question.data.kind]} — {r.question.prompt}
            <em className="win">Answer: {r.question.options[r.question.answer]}</em>
            <em>
              {Object.entries(r.picks).map(([id, p]) => `${name(id)} ${p.choice === null ? '—' : p.choice === r.question.answer ? '✓' : '✗'}`).join(' · ')}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
