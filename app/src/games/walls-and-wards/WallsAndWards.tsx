import { useEffect, useMemo, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botMove, botPlace, influence } from './bots';
import {
  Cell, Dir, GameState, MoveRecord, SIZE, breakableWalls, freeSides, hasBreaker, move, newGame, place, reachable, regions, scores,
  standings, wallCells,
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
  'WALL BREAKER: once per match, at the start of your turn, you may knock down one wall touching one of your counters’ cells — then move and build as usual.',
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

export interface Sel { counter: string | null; to: Cell | null; breaking?: boolean; broke?: string | null }

export const viewWithBreak = (s: GameState, sel: Sel): GameState => (sel.broke ? { ...s, walls: s.walls.filter((w) => w !== sel.broke) } : s);

/**
 * What a click on the board does on your turn (solo and online share this).
 * Returns the new selection and, once a choice is complete, the placement
 * or move to make.
 */
export function boardClick(id: string, s: GameState, sel: Sel): {
  sel: Sel; place?: Cell; move?: { counter: string; to: Cell; wall: Dir | null; broke: string | null };
} {
  const none: Sel = { counter: null, to: null };
  if (id === 'cancel') return { sel: none };
  if (id === 'breaker') return { sel: { ...none, breaking: !sel.breaking } };
  if (id.startsWith('break:') && sel.breaking) return { sel: { ...none, broke: id.slice(6) } };
  if (sel.breaking) return { sel };
  const view = viewWithBreak(s, sel);
  const done = (counter: string, to: Cell, wall: Dir | null) => ({ sel: none, move: { counter, to, wall, broke: sel.broke ?? null } });
  if (id.startsWith('cell:')) {
    const [x, y] = id.slice(5).split(':').map(Number);
    if (s.phase === 'place') return { sel, place: { x, y } };
    const mine = s.counters.find((c) => c.owner === ME && c.x === x && c.y === y);
    if (mine && !(sel.counter === mine.id && sel.to === null)) return { sel: { ...sel, counter: mine.id, to: null } };
    if (sel.counter && !sel.to && reachable(view, sel.counter).some((c) => c.x === x && c.y === y)) {
      const moved = { ...view, counters: view.counters.map((c) => (c.id === sel.counter ? { ...c, x, y } : c)) };
      if (!freeSides(moved, { x, y }).length) return done(sel.counter, { x, y }, null);
      return { sel: { ...sel, to: { x, y } } };
    }
  } else if (id.startsWith('wall:') && sel.counter && sel.to) {
    return done(sel.counter, sel.to, id.slice(5) as Dir);
  }
  return { sel };
}

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
        return { ...g, state: move(st, id, m.counter, m.to, m.wall, m.broke ?? null) };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  // what the board looks like with the wall you chose to break already gone
  const view = viewWithBreak(s, sel);

  const onHit = (id: string) => {
    if (id === 'again') {
      setSel({ counter: null, to: null });
      return setGame(setup(botCount));
    }
    if (s.turn !== ME) return id === 'cancel' && setSel({ counter: null, to: null });
    const r = boardClick(id, s, sel);
    setSel(r.sel);
    if (r.place) setGame((g) => ({ ...g, state: place(g.state, ME, r.place!) }));
    if (r.move) setGame((g) => ({ ...g, state: move(g.state, ME, r.move!.counter, r.move!.to, r.move!.wall, r.move!.broke) }));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, view, sel, color, s)} onHit={onHit} />
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

export { GEM };

export function drawScene(g: Gfx, s: GameState, sel: Sel, color: Record<string, (typeof GEM)[number]>, real: GameState, hud?: { clock?: string }) {
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
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
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

  // wall breaker: pick a wall touching one of your counters
  if (myTurn && sel.breaking) {
    for (const w of breakableWalls(real, ME)) {
      const hover = g.isHover(`break:${w}`);
      drawWall(g, w, hover ? COLORS.ruby : '#f2687a99', '#5e1020');
      const [a, b] = wallCells(w);
      const x = Math.min(cx(a.x), cx(b.x));
      const y = Math.min(cy(a.y), cy(b.y));
      if (a.y === b.y) g.hit(`break:${w}`, x + CELL - 5, y, 10, CELL);
      else g.hit(`break:${w}`, x, y + CELL - 5, CELL, 10);
    }
  }
  if (sel.broke) {
    const [a, b] = wallCells(sel.broke);
    if (Math.floor(g.time / 300) % 2) {
      if (a.y === b.y) g.rect(cx(b.x) - 1, cy(a.y) + 4, 2, CELL - 8, COLORS.ruby);
      else g.rect(cx(a.x) + 4, cy(b.y) - 1, CELL - 8, 2, COLORS.ruby);
    }
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
  if (myTurn && s.phase !== 'gameOver' && !sel.breaking) {
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
    else if (sel.breaking) {
      title = 'Break which wall?';
      hint = 'red walls touch your counters · once per match';
    } else if (!sel.counter) {
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
  if (myTurn && (sel.counter || sel.breaking || sel.broke)) g.button('cancel', 'Cancel', W - 70, 36, 56, { color: 'red' });
  if (myTurn && s.phase === 'play' && !sel.counter && !sel.broke && hasBreaker(real, ME)) {
    const can = breakableWalls(real, ME).length > 0;
    g.button('breaker', sel.breaking ? 'Keep it' : 'Wall breaker (1×)', W - 120, 200, 106, { color: 'red', disabled: !can && !sel.breaking });
  }
  if (sel.broke && !sel.counter) g.text('wall down — now move a counter', px + 10, 62, { size: 7, color: COLORS.ruby });

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
  const broke = m.broke ? `broke a wall, then ` : '';
  return `${nameOf(s, m.player)}: ${broke}${kind} ${where}${m.wall ? `, wall ${DIR_NAME[m.wall]}` : ''}`;
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

export function MoveLog({ state }: { state: GameState }) {
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

