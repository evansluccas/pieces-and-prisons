import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { flip, norm, rotate } from '../piece-together/logic';
import { Skill, botMove, botRock } from './bots';
import {
  Cell, GameState, Move, N, ROCK, canLay, canRock, cellsAt, dropRock, mustPass, newGame, offered, pass, squareOf, standings, takePiece, turfOf,
  usePatch, xy,
} from './logic';

const W = 480;
const H = 270;
const ME = 0;
const CS = 14;
const X0 = 4 + (278 - N * CS) / 2;
const Y0 = 32 + (234 - N * CS) / 2;
const BOT_DELAY = 800;
const BOTS: { name: string; skill: Skill }[] = [
  { name: 'Hana', skill: 'normal' },
  { name: 'Jun', skill: 'hard' },
  { name: 'Seo', skill: 'easy' },
];
const TURF = ['#3f7fd0', '#c84a5a', '#3fae5f', '#d9a23a'];
const LIGHT = ['#a8cdf7', '#f5a8b2', '#a8ecbb', '#f7dc9e'];

export const RULES = [
  'Grow your own patch of land on a shared 16×16 field. Everyone starts with one square of turf. 9 rounds.',
  'On your turn take one of the FIRST THREE turf pieces in the queue (the ones you skip go to the back). Turn it (R) or flip it (F), then lay it so it touches your own turf along an edge, overlaps nothing, and does NOT touch anyone else’s turf along an edge — corners are fine.',
  'Cover a bonus spot to claim it. PATCH (+): a single square you can lay later instead of a piece. ROCK (▲): drop a rock on any empty square — nobody can build there.',
  'If nothing fits, you pass. At the end, your score is the side of your BIGGEST SOLID SQUARE of turf; ties go to the most turf.',
];

// Dev-only: ?quick plays 3 rounds.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.min(3, Math.max(1, botCount)));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame([{ id: 'you', name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))], rng, QUICK ? 3 : undefined);
  return { state, bots, rng };
}

/** What you're holding: one of the offered pieces (in its current turn), or a patch. */
export type Held = { kind: 'piece'; pick: number; shape: Cell[] } | { kind: 'patch' } | null;

/** The square of a shape that sits under the mouse: the one nearest its middle. */
function anchor(shape: Cell[]): Cell {
  const mx = shape.reduce((t, c) => t + c[0], 0) / shape.length;
  const my = shape.reduce((t, c) => t + c[1], 0) / shape.length;
  return shape.reduce((b, c) => (Math.hypot(c[0] - mx, c[1] - my) < Math.hypot(b[0] - mx, b[1] - my) ? c : b));
}

export function TurfWar({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [held, setHeld] = useState<Held>(null);
  const s = game.state;

  useEffect(() => setHeld(null), [s.turn, s.round]);

  // bots: one move (or rock) at a time
  useEffect(() => {
    if (s.phase === 'gameOver' || s.turn === ME) return;
    const t = setTimeout(() => {
      setGame((g) => {
        const st = g.state;
        const me = st.turn;
        if (st.phase === 'gameOver' || me === ME) return g;
        const skill = g.bots[me - 1].skill;
        let next: GameState;
        if (st.phase === 'rock') next = dropRock(st, me, botRock(st, me, g.rng));
        else {
          const m = botMove(st, me, skill, g.rng);
          next = m.kind === 'piece' ? takePiece(st, me, m.pick, m.cells) : m.kind === 'patch' ? usePatch(st, me, m.cell) : pass(st, me);
        }
        return { ...g, state: next };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const myTurn = s.turn === ME && s.phase !== 'gameOver';
  const turn = (fn: (c: Cell[]) => Cell[]) => setHeld((h) => (h?.kind === 'piece' ? { ...h, shape: fn(h.shape) } : h));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!myTurn || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k === 'r') turn(rotate);
      else if (k === 'f') turn(flip);
      else if (e.key === 'Escape') setHeld(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id === 'again') {
      setHeld(null);
      return setGame(setup(botCount));
    }
    if (!myTurn) return;
    const r = turfClick(id, s, held);
    setHeld(r.held);
    if (r.action) setGame((g) => ({ ...g, state: applyTurf(g.state, ME, r.action!) }));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, held)} onHit={onHit} />
      <TurfLog state={s} />
    </div>
  );
}

export type TurfAction = { type: 'piece'; pick: number; cells: number[] } | { type: 'patch'; cell: number } | { type: 'pass' } | { type: 'rock'; cell: number };

/** Make a move (solo play). */
function applyTurf(s: GameState, me: number, a: TurfAction): GameState {
  if (a.type === 'piece') return takePiece(s, me, a.pick, a.cells);
  if (a.type === 'patch') return usePatch(s, me, a.cell);
  if (a.type === 'rock') return dropRock(s, me, a.cell);
  return pass(s, me);
}

/** What a click does on your turn (solo and online share this): the new held piece, and a move once one is complete. */
export function turfClick(id: string, s: GameState, held: Held): { held: Held; action?: TurfAction } {
  if (s.phase === 'rock') {
    const c = Number(id.slice(5));
    return id.startsWith('cell:') && canRock(s, c) ? { held, action: { type: 'rock', cell: c } } : { held };
  }
  const turned = (fn: (c: Cell[]) => Cell[]): Held => (held?.kind === 'piece' ? { ...held, shape: fn(held.shape) } : held);
  if (id.startsWith('pick:')) {
    const pick = Number(id.slice(5));
    return { held: held?.kind === 'piece' && held.pick === pick ? null : { kind: 'piece', pick, shape: norm(offered(s)[pick]) } };
  }
  if (id === 'patch') return { held: held?.kind === 'patch' ? null : { kind: 'patch' } };
  if (id === 'turn') return { held: turned(rotate) };
  if (id === 'flip') return { held: turned(flip) };
  if (id === 'pass') return { held, action: { type: 'pass' } };
  if (id.startsWith('cell:') && held) {
    const cells = ghost(held, Number(id.slice(5)));
    if (!cells || !canLay(s, ME, cells)) return { held };
    return { held, action: held.kind === 'patch' ? { type: 'patch', cell: cells[0] } : { type: 'piece', pick: held.pick, cells } };
  }
  return { held };
}

/** Board cells the held piece would cover with the mouse over `c`. */
function ghost(held: Held, c: number): number[] | null {
  if (!held) return null;
  const [x, y] = xy(c);
  if (held.kind === 'patch') return [c];
  const [ax, ay] = anchor(held.shape);
  return cellsAt(held.shape, x - ax, y - ay);
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, i: number) => s.players[i].name;

function drawShape(g: Gfx, shape: Cell[], x: number, y: number, size: number, color: string, alpha = 1) {
  for (const [cx, cy] of shape) g.rect(x + cx * size, y + cy * size, size - 1, size - 1, color, alpha);
}

export function drawScene(g: Gfx, s: GameState, held: Held, hud?: { clock?: string }) {
  const over = s.phase === 'gameOver';
  const myTurn = s.turn === ME && !over;
  const last = s.history[s.history.length - 1];
  const hover = s.owner.map((_, c) => c).find((c) => g.isHover(`cell:${c}`));

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: over ? 'GAME OVER' : `ROUND ${s.round}/${s.rounds}`, color: COLORS.gold },
    { text: over ? '' : myTurn ? (s.phase === 'rock' ? 'DROP YOUR ROCK' : 'YOUR TURN') : `${nameOf(s, s.turn)}'s turn`, color: myTurn ? COLORS.emerald : COLORS.muted },
    { text: hud?.clock ?? 'score = biggest square', color: hud?.clock ? COLORS.ruby : COLORS.muted },
  ], 'TURF WAR');

  // field
  g.panel('panel_night', 4, 30, 278, 236, 4);
  g.rect(X0 - 1, Y0 - 1, N * CS + 1, N * CS + 1, '#1a140f');
  for (let c = 0; c < N * N; c++) {
    const [x, y] = xy(c);
    const px = X0 + x * CS;
    const py = Y0 + y * CS;
    const o = s.owner[c];
    g.rect(px, py, CS - 1, CS - 1, o === null ? ((x + y) % 2 ? '#3a2f26' : '#40342a') : o === ROCK ? '#7d7a84' : TURF[o]);
    if (o === ROCK) g.rect(px + 4, py + 4, 5, 5, '#55525c');
    const b = s.bonus[c];
    if (b === 'patch') g.text('+', px + CS / 2, py + 1, { align: 'center', size: 10, color: COLORS.gold });
    if (b === 'rock') g.text('▲', px + CS / 2, py + 2, { align: 'center', size: 8, color: '#c9c6d0' });
    if (myTurn) g.hit(`cell:${c}`, px, py, CS, CS);
  }
  // everyone's biggest square
  s.players.forEach((_, i) => {
    const sq = squareOf(s, i);
    if (sq.size >= 2) g.frame(X0 + sq.x * CS - 1, Y0 + sq.y * CS - 1, sq.size * CS + 1, sq.size * CS + 1, LIGHT[i]);
  });
  // the last move, so you can follow the bots
  if (last && !over && Math.floor(g.time / 300) % 2) for (const c of last.cells) g.frame(X0 + xy(c)[0] * CS, Y0 + xy(c)[1] * CS, CS - 1, CS - 1, '#ffffff');
  // what you're holding, under the mouse
  if (myTurn && hover !== undefined) {
    if (s.phase === 'rock') {
      const ok = canRock(s, hover);
      g.rect(X0 + xy(hover)[0] * CS, Y0 + xy(hover)[1] * CS, CS - 1, CS - 1, ok ? '#c9c6d0' : COLORS.ruby, 0.6);
    } else if (held) {
      const cells = ghost(held, hover);
      const ok = !!cells && canLay(s, ME, cells);
      for (const c of cells ?? []) g.rect(X0 + xy(c)[0] * CS, Y0 + xy(c)[1] * CS, CS - 1, CS - 1, ok ? '#e6f7ff' : COLORS.ruby, ok ? 0.65 : 0.5);
      if (!cells) g.frame(X0 + xy(hover)[0] * CS, Y0 + xy(hover)[1] * CS, CS - 1, CS - 1, COLORS.ruby);
    }
  }

  // side panel
  const sx = 286;
  const pw = W - sx - 4;
  g.panel('panel_night', sx, 30, pw, 236, 4);
  let title = '';
  if (over) title = 'Final field';
  else if (!myTurn) title = `${nameOf(s, s.turn)} is ${s.phase === 'rock' ? 'dropping a rock' : 'laying turf'}…`;
  else if (s.phase === 'rock') title = 'ROCK! Click any empty square';
  else if (mustPass(s, ME)) title = 'Nothing fits — you must pass';
  else title = held ? 'Click the field to lay it' : 'Pick one of the first three';
  g.text(title, sx + 8, 36, { size: 8, color: myTurn ? COLORS.gold : COLORS.muted });

  // the three pieces on offer
  offered(s).forEach((shape, i) => {
    const bx = sx + 8 + i * 60;
    const by = 50;
    const id = `pick:${i}`;
    const picked = held?.kind === 'piece' && held.pick === i;
    g.rect(bx, by, 56, 52, picked ? '#4a3d82' : '#2a2050');
    const shown = picked && held?.kind === 'piece' ? held.shape : norm(shape);
    const w = Math.max(...shown.map((c) => c[0])) + 1;
    const h = Math.max(...shown.map((c) => c[1])) + 1;
    const size = Math.min(9, Math.floor(48 / Math.max(w, h)));
    drawShape(g, shown, bx + (56 - w * size) / 2, by + (52 - h * size) / 2, size, TURF[ME], myTurn && s.phase === 'place' ? 1 : 0.5);
    if (picked) g.frame(bx, by, 56, 52, COLORS.gold, 2);
    else if (myTurn && s.phase === 'place' && g.isHover(id)) g.frame(bx, by, 56, 52, '#fff3b0');
    if (myTurn && s.phase === 'place') g.hit(id, bx, by, 56, 52);
  });
  if (s.queue.length > 3) g.text(`then ${s.queue.length - 3} more in the queue`, sx + 8, 105, { size: 6, color: COLORS.muted });

  if (myTurn && s.phase === 'place') {
    g.button('turn', 'Turn (R)', sx + 8, 116, 56, { disabled: held?.kind !== 'piece' });
    g.button('flip', 'Flip (F)', sx + 68, 116, 56, { disabled: held?.kind !== 'piece' });
    const patches = s.players[ME].patches;
    if (mustPass(s, ME)) g.button('pass', 'Pass', sx + 128, 116, pw - 136, { color: 'red' });
    else g.button('patch', `Patch ×${patches}`, sx + 128, 116, pw - 136, { disabled: patches < 1, color: held?.kind === 'patch' ? 'red' : 'blue' });
  }

  // scoreboard
  g.text('PLAYER      SQUARE  TURF', sx + 8, 142, { size: 7, color: COLORS.muted });
  s.players.forEach((p, i) => {
    const y = 154 + i * 14;
    g.rect(sx + 8, y, 9, 9, TURF[i]);
    g.text(p.name + (p.patches ? ` +${p.patches}` : ''), sx + 22, y, { size: 8, color: s.turn === i && !over ? COLORS.gold : COLORS.ink });
    const sq = squareOf(s, i).size;
    g.text(`${sq}×${sq}`, sx + 110, y, { size: 8, color: COLORS.emerald });
    g.text(`${turfOf(s, i)}`, sx + 152, y, { size: 8, color: COLORS.muted });
  });
  g.text('Outlines show each biggest square.', sx + 8, 216, { size: 6, color: COLORS.muted });
  g.text('Touch your turf; never touch theirs', sx + 8, 226, { size: 6, color: COLORS.muted });
  g.text('along an edge (corners are fine).', sx + 8, 235, { size: 6, color: COLORS.muted });

  if (over) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.square}×${p.square} · ${p.turf} turf` })),
      order[0].id === 'you' ? 'Biggest square — you win!' : `${order[0].name} built the biggest square.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

function describe(s: GameState, m: Move) {
  const who = s.players[m.player].name;
  const gains = m.gained.length ? ` and claimed ${m.gained.map((b) => (b === 'patch' ? 'a patch' : 'a rock')).join(' + ')}` : '';
  if (m.kind === 'pass') return `${who} passed — nothing fit`;
  if (m.kind === 'rock') return `${who} dropped a rock`;
  if (m.kind === 'patch') return `${who} laid a patch${gains}`;
  return `${who} laid a ${m.cells.length}-square piece${gains}`;
}

export function TurfLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Turf log</h3>
      {!state.history.length && <p className="muted">Every piece laid, bonus claimed and rock dropped appears here.</p>}
      <ol>
        {[...state.history].reverse().slice(0, 40).map((m, i) => (
          <li key={state.history.length - i}>
            <em className={m.gained.length ? 'win' : m.kind === 'rock' ? 'tip' : ''}>{describe(state, m)}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
