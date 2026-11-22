import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botMove, botPlace, influence } from './bots';
import {
  Cell, Dir, GameState, MoveRecord, SIZE, freeSides, move, newGame, place, reachable, regions, scores, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const CELL = 32;
const OX = 12;
const OY = 32;
const BOT_DELAY = 700;
const BOTS: { name: string; persona: Persona }[] = [
  { name: 'Hana', persona: 'builder' },
  { name: 'Jun', persona: 'raider' },
  { name: 'Seo', persona: 'wild' },
];
const GEM = ['sapphire', 'ruby', 'emerald', 'topaz'] as const;
const TINT: Record<(typeof GEM)[number], string> = { sapphire: '#3a72d0', ruby: '#cf3446', emerald: '#2fa864', topaz: '#d6b021' };
const COL = 'ABCDEFG';
const cellName = (c: Cell) => `${COL[c.x]}${c.y + 1}`;
const DIR_NAME: Record<Dir, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

export const RULES = [
  'A 7×7 board. Everyone has two counters: a SQUARE (moves 1–2 cells in a straight line) and a ROUND one (moves 1 cell, then may turn left or right for 1 more).',
  'SETUP: take turns placing your counters on empty cells — first to last, then back. Square first, round second.',
  'YOUR TURN: click one of your counters, click where it goes (or its own cell to stay), then you MUST build a wall on one free side of that cell. Counters can’t pass through walls or other counters.',
  'The match ends when no open area holds counters of two different players.',
  'Your territory = every cell in areas only your counters are in (tinted in your colour). Most cells wins; ties go to the bigger single area. Last place goes to prison.',
];

// Dev-only: ?quick starts with most of the board already walled.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.min(3, Math.max(1, botCount)));
  let state = newGame([{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))]);
  if (QUICK) {
    // pre-built maze so the match settles in a few turns
    const walls: string[] = [];
    for (let x = 0; x < SIZE; x++) if (x !== 3) walls.push(`h:${x}:2`);
    for (let y = 0; y < SIZE; y++) if (y !== 5) walls.push(`v:2:${y}`);
    state = { ...state, walls };
  }
  return { state, bots, rng: seededRng(Date.now() & 0xffff) };
}

interface Sel { counter: string | null; to: Cell | null }

export function WallsAndWards({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [sel, setSel] = useState<Sel>({ counter: null, to: null });
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;
  const color = useMemo(() => Object.fromEntries(s.players.map((p, i) => [p.id, GEM[i]])), [s.players]);

  useEffect(() => {
    if (!s.turn || s.turn === ME || s.phase === 'gameOver') return;
    const id = s.turn;
    const t = setTimeout(() => {
      setGame((g) => {
        const st = g.state;
        if (st.turn !== id) return g;
        if (st.phase === 'place') return { ...g, state: place(st, id, botPlace(st, id, g.rng)) };
        const m = botMove(st, id, persona(id), g.rng);
        return { ...g, state: move(st, id, m.counter, m.to, m.wall) };
      });
    }, BOT_DELAY);
    return () => clearTimeout(t);
  });

  const commit = (counter: string, to: Cell, wall: Dir | null) => {
    setSel({ counter: null, to: null });
    setGame((g) => ({ ...g, state: move(g.state, ME, counter, to, wall) }));
  };

  const onHit = (id: string) => {
    if (id === 'again') {
      setSel({ counter: null, to: null });
      return setGame(setup(botCount));
    }
    if (id === 'cancel') return setSel({ counter: null, to: null });
    if (s.turn !== ME) return;
    if (id.startsWith('cell:')) {
      const [x, y] = id.slice(5).split(':').map(Number);
      if (s.phase === 'place') return setGame((g) => ({ ...g, state: place(g.state, ME, { x, y }) }));
      const mine = s.counters.find((c) => c.owner === ME && c.x === x && c.y === y);
      if (mine && !(sel.counter === mine.id && sel.to === null)) return setSel({ counter: mine.id, to: null });
      if (sel.counter && !sel.to && reachable(s, sel.counter).some((c) => c.x === x && c.y === y)) {
        const moved = { ...s, counters: s.counters.map((c) => (c.id === sel.counter ? { ...c, x, y } : c)) };
        if (!freeSides(moved, { x, y }).length) return commit(sel.counter, { x, y }, null);
        return setSel({ counter: sel.counter, to: { x, y } });
      }
    } else if (id.startsWith('wall:') && sel.counter && sel.to) {
      commit(sel.counter, sel.to, id.slice(5) as Dir);
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, sel, color)} onHit={onHit} />
      <MoveLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const cx = (x: number) => OX + x * CELL;
const cy = (y: number) => OY + y * CELL;

function drawWall(g: Gfx, key: string, color = '#a6a2ad', edge = '#25232c') {
  const [kind, xs, ys] = key.split(':');
  const x = Number(xs);
  const y = Number(ys);
  if (kind === 'h') {
    g.rect(cx(x) - 1, cy(y + 1) - 2, CELL + 2, 4, edge);
    g.rect(cx(x), cy(y + 1) - 1, CELL, 2, color);
  } else {
    g.rect(cx(x + 1) - 2, cy(y) - 1, 4, CELL + 2, edge);
    g.rect(cx(x + 1) - 1, cy(y), 2, CELL, color);
  }
}

function drawScene(g: Gfx, s: GameState, sel: Sel, color: Record<string, (typeof GEM)[number]>) {
  const myTurn = s.turn === ME;
  const regs = regions(s);
  const sc = scores(s);
  const inf = s.phase === 'gameOver' ? null : influence(s);

  g.tile('board', 'tile_night', 0, 0, W, H);
  const placing = s.phase === 'place';
  const left = 2 - s.counters.filter((c) => c.owner === ME).length;
  topBar(g, [
    { text: placing ? 'SETUP' : `TURN ${s.turns + 1}`, color: COLORS.gold },
    { text: `${s.walls.length} walls`, color: COLORS.muted },
  ], 'WALLS & WARDS');

  // board
  g.frame(OX - 3, OY - 3, SIZE * CELL + 6, SIZE * CELL + 6, '#5e3a24', 3);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) g.sprite('board', 'tile_grass', cx(x), cy(y), { scale: 2 });
  // territory tint (areas held by exactly one player)
  for (const r of regs) {
    if (r.owners.length !== 1) continue;
    for (const c of r.cells) g.rect(cx(c.x), cy(c.y), CELL, CELL, TINT[color[r.owners[0]]], 0.38);
  }
  for (let i = 1; i < SIZE; i++) {
    g.rect(cx(i), OY, 1, SIZE * CELL, '#12301c', 0.45);
    g.rect(OX, cy(i), SIZE * CELL, 1, '#12301c', 0.45);
  }
  // coordinates
  for (let i = 0; i < SIZE; i++) {
    g.text(COL[i], cx(i) + CELL / 2, OY + SIZE * CELL + 2, { align: 'center', size: 6, color: COLORS.muted, shadow: false });
  }

  // highlight the last move
  const last = s.history[s.history.length - 1];
  for (const w of s.walls) drawWall(g, w);
  if (last?.wall) {
    const k = wallKeyOf(last.to, last.wall);
    if (k && Math.floor(g.time / 300) % 2) drawWall(g, k, COLORS.gold, '#5e3a24');
  }

  // move targets
  const reach = myTurn && s.phase === 'play' && sel.counter && !sel.to ? reachable(s, sel.counter) : [];
  for (const c of reach) {
    g.rect(cx(c.x) + 11, cy(c.y) + 11, 10, 10, COLORS.gold, g.isHover(`cell:${c.x}:${c.y}`) ? 0.95 : 0.55);
  }

  // counters
  for (const c of s.counters) {
    const at = sel.counter === c.id && sel.to ? sel.to : c;
    g.sprite('board', `counter_${c.kind}_${color[c.owner]}`, cx(at.x), cy(at.y), { scale: 2 });
    if (sel.counter === c.id) g.frame(cx(at.x) + 1, cy(at.y) + 1, CELL - 2, CELL - 2, COLORS.gold, 2);
    if (c.owner === ME && myTurn && s.phase === 'play' && !sel.counter && Math.floor(g.time / 400) % 2) {
      g.frame(cx(c.x) + 2, cy(c.y) + 2, CELL - 4, CELL - 4, '#fff3b0');
    }
  }

  // wall choices after choosing a destination
  if (myTurn && sel.counter && sel.to) {
    const moved = { ...s, counters: s.counters.map((c) => (c.id === sel.counter ? { ...c, ...sel.to! } : c)) };
    for (const d of freeSides(moved, sel.to)) {
      const k = wallKeyOf(sel.to, d)!;
      const hover = g.isHover(`wall:${d}`);
      drawWall(g, k, hover ? COLORS.gold : '#f5cd5b88', hover ? '#5e3a24' : '#5e3a2488');
      const r = wallRect(sel.to, d);
      g.hit(`wall:${d}`, r.x, r.y, r.w, r.h);
    }
  }

  // clickable cells
  if (myTurn && s.phase !== 'gameOver') {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (placing && s.counters.some((c) => c.x === x && c.y === y)) continue;
      g.hit(`cell:${x}:${y}`, cx(x) + 3, cy(y) + 3, CELL - 6, CELL - 6);
      if (placing && g.isHover(`cell:${x}:${y}`)) g.frame(cx(x) + 1, cy(y) + 1, CELL - 2, CELL - 2, COLORS.gold, 2);
    }
  }

  // right panel
  const px = 248;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  let title = '';
  let hint = '';
  if (placing) {
    title = myTurn ? `Place your ${left === 2 ? 'SQUARE' : 'ROUND'} counter` : `${nameOf(s, s.turn)} is placing…`;
    hint = 'square: 1–2 straight · round: 1, then may turn';
  } else if (s.phase === 'play') {
    if (!myTurn) title = `${nameOf(s, s.turn)} is moving…`;
    else if (!sel.counter) {
      title = 'Your turn — pick a counter';
      hint = 'then pick where it goes, then build a wall';
    } else if (!sel.to) {
      title = 'Where does it go?';
      hint = 'gold dots = reachable · its own cell = stay';
    } else {
      title = 'Build a wall';
      hint = 'click a glowing side of its cell';
    }
  } else title = 'The board is settled';
  g.text(title, px + 10, 38, { size: 9, color: COLORS.gold });
  if (hint) g.text(hint, px + 10, 52, { size: 7, color: COLORS.muted });
  if (myTurn && sel.counter) g.button('cancel', 'Cancel', W - 70, 36, 56, { color: 'red' });

  g.text('PLAYER', px + 10, 70, { size: 7, color: COLORS.muted });
  g.text('SEALED', px + 120, 70, { size: 7, color: COLORS.muted });
  g.text('REACH', px + 170, 70, { size: 7, color: COLORS.muted });
  s.players.forEach((p, i) => {
    const y = 82 + i * 22;
    g.sprite('board', `counter_square_${color[p.id]}`, px + 8, y - 4);
    g.text(p.id === ME ? 'You' : p.name, px + 28, y, { size: 9, color: s.turn === p.id ? COLORS.gold : COLORS.ink });
    g.text(`${sc.find((x) => x.id === p.id)!.territory}`, px + 128, y, { size: 9, color: COLORS.emerald });
    g.text(inf ? `~${inf[p.id]}` : '—', px + 176, y, { size: 9, color: COLORS.muted });
  });
  const ly = 82 + s.players.length * 22 + 6;
  wrap(g, 'SEALED = cells in areas only you are in. REACH = cells you would get to first (a rough forecast).', px + 10, ly, 210);

  if (last) {
    g.text('LAST MOVE', px + 10, 220, { size: 7, color: COLORS.muted });
    g.text(describeMove(s, last), px + 10, 230, { size: 8, color: COLORS.ink });
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.territory} cells · biggest ${p.largest}` })),
      order[0].id === ME ? 'You win the board!' : `${order[0].name} wins the board.`,
    );
  }
}

function wallKeyOf(c: Cell, d: Dir) {
  if (d === 'N') return c.y > 0 ? `h:${c.x}:${c.y - 1}` : null;
  if (d === 'S') return c.y < SIZE - 1 ? `h:${c.x}:${c.y}` : null;
  if (d === 'W') return c.x > 0 ? `v:${c.x - 1}:${c.y}` : null;
  return c.x < SIZE - 1 ? `v:${c.x}:${c.y}` : null;
}

function wallRect(c: Cell, d: Dir) {
  const x = cx(c.x);
  const y = cy(c.y);
  if (d === 'N') return { x, y: y - 5, w: CELL, h: 10 };
  if (d === 'S') return { x, y: y + CELL - 5, w: CELL, h: 10 };
  if (d === 'W') return { x: x - 5, y, w: 10, h: CELL };
  return { x: x + CELL - 5, y, w: 10, h: CELL };
}

const nameOf = (s: GameState, id: string | null) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? '');

function describeMove(s: GameState, m: MoveRecord) {
  const kind = s.counters.find((c) => c.id === m.counter)?.kind ?? '';
  const stay = m.from.x === m.to.x && m.from.y === m.to.y;
  const where = stay ? `stays on ${cellName(m.to)}` : `${cellName(m.from)}→${cellName(m.to)}`;
  return `${nameOf(s, m.player)}: ${kind} ${where}${m.wall ? `, wall ${DIR_NAME[m.wall]}` : ''}`;
}

function wrap(g: Gfx, text: string, x: number, y: number, maxW: number) {
  g.ctx.font = '7px "DotGothic16", monospace';
  let line = '';
  let row = 0;
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (g.ctx.measureText(test).width > maxW && line) {
      g.text(line, x, y + row * 9, { size: 7, color: COLORS.muted });
      line = w;
      row++;
    } else line = test;
  }
  if (line) g.text(line, x, y + row * 9, { size: 7, color: COLORS.muted });
}

// ---------------------------------------------------------------- log (DOM)

function MoveLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Move log</h3>
      {state.history.length === 0 && <p className="muted">Moves appear here. Columns A–G, rows 1–7 from the top.</p>}
      <ol>
        {[...state.history].reverse().map((m, i) => (
          <li key={state.history.length - i}>
            <em className={m.player === ME ? 'win' : ''}>{describeMove(state, m)}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}

