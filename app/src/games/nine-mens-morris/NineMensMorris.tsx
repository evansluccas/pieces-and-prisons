import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Level, botTurn } from './bots';
import {
  GameState, POINTS, Side, Turn, count, describe, flying, makesMill, newGame, placing, play, removable, steps,
} from './logic';

const W = 480;
const H = 270;
const ME: Side = 0;
const BOT: Side = 1;
const SP = 32;      // spacing between points
const BX = 42;      // board origin
const BY = 46;
const BOT_DELAY = 700;
const LEVELS: { id: Level; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'looks one move ahead, makes mistakes' },
  { id: 'normal', label: 'Normal', note: 'looks two moves ahead' },
  { id: 'hard', label: 'Hard', note: 'looks three moves ahead' },
];
const SPRITE: Record<Side, string> = { 0: 'counter_round_sapphire', 1: 'counter_round_ruby' };

export const RULES = [
  'FINAL DUEL — you against one opponent. Each of you has 9 men; you are blue and go first.',
  'PLACE: take turns putting a man on any empty point until all 18 are down. MOVE: then slide one of your men along a line to the next empty point.',
  'MILL: three of your men in a straight line. Making one lets you remove one enemy man — not one standing in a mill, unless all of them are.',
  'FLY: down to 3 men, you may jump a man to any empty point.',
  'You win when your opponent has fewer than 3 men or no legal move. 50 moves in a row without a mill is a draw.',
];

const px = (p: number) => BX + POINTS[p][0] * SP;
const py = (p: number) => BY + POINTS[p][1] * SP;

/** A turn being built: chosen man (moving), chosen point, waiting for a removal. */
export interface Pick { from: number | null; to: number | null }

/** What a click on a point does on your turn (solo and online share this): the new pick, and the turn once it's complete. */
export function pointClick(id: string, s: GameState, pick: Pick): { pick: Pick; turn?: Turn } {
  if (!id.startsWith('pt:')) return { pick };
  const none: Pick = { from: null, to: null };
  const p = Number(id.slice(3));
  // waiting for a removal after a mill
  if (pick.to !== null) {
    const b = [...s.board];
    if (pick.from !== null) b[pick.from] = null;
    b[pick.to] = ME;
    return removable(b, ME).includes(p) ? { pick: none, turn: { from: pick.from, to: pick.to, remove: p } } : { pick };
  }
  const options = steps(s, ME);
  const go = (from: number | null, to: number) =>
    makesMill(s.board, ME, from, to) ? { pick: { from, to } } : { pick: none, turn: { from, to, remove: null } };
  if (placing(s, ME)) return s.board[p] === null ? go(null, p) : { pick };
  if (s.board[p] === ME && options.some((o) => o.from === p)) return { pick: { from: p, to: null } };
  if (pick.from !== null && options.some((o) => o.from === pick.from && o.to === p)) return go(pick.from, p);
  return { pick };
}

export function NineMensMorris() {
  const [level, setLevel] = useState<Level | null>(null);
  const [s, setS] = useState<GameState>(() => newGame());
  const [pick, setPick] = useState<Pick>({ from: null, to: null });
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));

  useEffect(() => {
    if (!level || s.winner !== null || s.turn !== BOT) return;
    const t = setTimeout(() => setS((st) => (st.turn === BOT && st.winner === null ? play(st, botTurn(st, level, rng)) : st)), pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const commit = (t: Turn) => {
    setPick({ from: null, to: null });
    setS(play(s, t));
  };

  const onHit = (id: string) => {
    if (id.startsWith('level:')) {
      setLevel(id.slice(6) as Level);
      setS(newGame());
      return setPick({ from: null, to: null });
    }
    if (id === 'again') return setLevel(null);
    if (s.turn !== ME || s.winner !== null) return;
    const r = pointClick(id, s, pick);
    setPick(r.pick);
    if (r.turn) commit(r.turn);
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (level ? drawScene(g, s, pick, level) : drawIntro(g))} onHit={onHit} />
      <MoveLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'FINAL DUEL', color: COLORS.amethyst }], "NINE MEN'S MORRIS");
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.sprite('board', SPRITE[0], 210, 58, { scale: 2 });
  g.sprite('board', SPRITE[1], 238, 58, { scale: 2 });
  g.text('Line up three. Take a man.', 240, 94, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose your opponent', 240, 108, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 126 + i * 28;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function line(g: Gfx, a: number, b: number) {
  const [x0, y0, x1, y1] = [px(a), py(a), px(b), py(b)];
  if (y0 === y1) g.rect(Math.min(x0, x1), y0 - 1, Math.abs(x1 - x0), 3, '#c9a35c');
  else g.rect(x0 - 1, Math.min(y0, y1), 3, Math.abs(y1 - y0), '#c9a35c');
}

/** Online play: the opponent's name (instead of "Easy bot"), and the move clock. */
export interface OnlineHud { opponent: string; clock?: string }

export function drawScene(g: Gfx, s: GameState, pick: Pick, level: Level | null, hud?: OnlineHud) {
  const rival = hud?.opponent ?? `${level![0].toUpperCase()}${level!.slice(1)} bot`;
  const myTurn = s.turn === ME && s.winner === null;
  const last = s.history[s.history.length - 1];

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: s.winner !== null ? 'GAME OVER' : placing(s, s.turn) ? 'PLACING' : flying(s, s.turn) ? 'FLYING' : 'MOVING', color: COLORS.gold },
    { text: `vs ${hud ? hud.opponent : `${level} bot`}`, color: COLORS.muted },
    hud?.clock ? { text: hud.clock, color: COLORS.ruby } : { text: `${s.quiet} moves since a mill`, color: s.quiet > 40 ? COLORS.ruby : COLORS.muted },
  ], "NINE MEN'S MORRIS");

  // board
  g.panel('panel_parchment', BX - 26, BY - 22, 6 * SP + 52, 6 * SP + 44, 4);
  for (const [a, b] of [[0, 2], [2, 23], [21, 23], [0, 21], [3, 5], [5, 20], [18, 20], [3, 18], [6, 8], [8, 17], [15, 17], [6, 15], [1, 7], [16, 22], [9, 11], [12, 14]]) line(g, a, b);

  // what can be clicked right now
  const removing = pick.to !== null;
  const b = [...s.board];
  if (removing) {
    if (pick.from !== null) b[pick.from] = null;
    b[pick.to!] = ME;
  }
  const canTake = removing ? removable(b, ME) : [];
  const options = myTurn && !removing ? steps(s, ME) : [];
  const targets = placing(s, ME) ? options.map((o) => o.to) : options.filter((o) => o.from === pick.from).map((o) => o.to);
  const movable = new Set(options.filter((o) => o.from !== null).map((o) => o.from!));

  POINTS.forEach((_, p) => {
    const x = px(p);
    const y = py(p);
    const id = `pt:${p}`;
    const who = removing && (p === pick.from) ? null : removing && p === pick.to ? ME : s.board[p];
    g.rect(x - 3, y - 3, 7, 7, '#5e3a24');
    if (who !== null) g.sprite('board', SPRITE[who], x - 16, y - 16, { scale: 2 });
    if (last && (last.turn.to === p) && Math.floor(g.time / 500) % 2) g.frame(x - 15, y - 15, 30, 30, '#fff3b0');
    if (myTurn) {
      if (removing && canTake.includes(p)) g.frame(x - 15, y - 15, 30, 30, Math.floor(g.time / 250) % 2 ? COLORS.ruby : '#ffb0b8', 2);
      else if (!removing && targets.includes(p) && (placing(s, ME) || pick.from !== null)) {
        g.rect(x - 5, y - 5, 11, 11, COLORS.gold, g.isHover(id) ? 0.95 : 0.55);
      } else if (!removing && movable.has(p)) {
        if (pick.from === p) g.frame(x - 15, y - 15, 30, 30, COLORS.gold, 2);
        else if (!pick.from && Math.floor(g.time / 400) % 2) g.frame(x - 14, y - 14, 28, 28, '#fff3b0');
      }
      g.hit(id, x - 14, y - 14, 28, 28);
    }
  });

  // side panel
  const sx = 272;
  g.panel('panel_night', sx, 30, W - sx - 4, 236, 4);
  let title = '';
  let hint = '';
  if (s.winner !== null) title = s.winner === 'draw' ? 'Draw' : s.winner === ME ? 'You win!' : 'You lose';
  else if (!myTurn) title = hud ? `${hud.opponent} is thinking…` : 'Opponent is thinking…';
  else if (removing) { title = 'MILL! Take one of theirs'; hint = 'flashing red men can be taken'; }
  else if (placing(s, ME)) { title = 'Place a man'; hint = 'click any empty point'; }
  else if (pick.from === null) { title = flying(s, ME) ? 'You can FLY' : 'Move a man'; hint = flying(s, ME) ? 'pick a man, then ANY empty point' : 'pick a man, then a gold spot next to it'; }
  else { title = 'Where to?'; hint = 'click a gold spot (or another man)'; }
  g.text(title, sx + 10, 38, { size: 10, color: s.winner === ME ? COLORS.emerald : COLORS.gold });
  if (hint) g.text(hint, sx + 10, 54, { size: 7, color: COLORS.muted });

  const row = (side: Side, y: number) => {
    g.sprite('board', SPRITE[side], sx + 10, y - 4);
    g.text(side === ME ? 'You' : hud?.opponent ?? 'Opponent', sx + 30, y, { size: 9, color: s.turn === side && s.winner === null ? COLORS.gold : COLORS.ink });
    g.text(`${count(s, side)} on board · ${s.inHand[side]} in hand`, sx + 30, y + 11, { size: 7, color: COLORS.muted });
    for (let i = 0; i < s.inHand[side]; i++) g.rect(sx + 112 + (i % 9) * 8, y + 2, 6, 6, side === ME ? COLORS.sapphire : COLORS.ruby);
  };
  row(ME, 76);
  row(BOT, 106);

  g.text('LAST MOVES', sx + 10, 136, { size: 7, color: COLORS.muted });
  s.history.slice(-8).reverse().forEach((h, i) => {
    g.text(`${h.side === ME ? 'You' : hud ? hud.opponent.slice(0, 10) : 'Opp'}: ${describe(h.turn, h.side === ME)}`, sx + 10, 147 + i * 11, {
      size: 7, color: h.turn.remove !== null ? COLORS.ruby : i === 0 ? COLORS.ink : COLORS.muted,
    });
  });

  if (s.winner !== null) {
    const youWin = s.winner === ME;
    standingsPanel(
      g,
      [ME, BOT].sort((a, c) => (s.winner === c ? 1 : s.winner === a ? -1 : 0)).map((side) => ({
        name: side === ME ? 'You' : rival,
        detail: `${count(s, side as Side) + s.inHand[side as Side]} men left`,
      })),
      s.winner === 'draw' ? 'A draw — 50 moves without a mill.' : youWin ? 'You win the duel!' : hud ? `${hud.opponent} wins the duel.` : 'The bot wins the duel.',
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function MoveLog({ state, opponent = 'Opponent' }: { state: GameState; opponent?: string }) {
  return (
    <aside className="log">
      <h3>Move log</h3>
      {!state.history.length && <p className="muted">Points are named by column a–g and row 1–7 from the bottom.</p>}
      <ol>
        {[...state.history].reverse().map((h, i) => (
          <li key={state.history.length - i}>
            <em className={h.turn.remove !== null ? (h.side === ME ? 'win' : 'tip') : ''}>
              {state.history.length - i}. {h.side === ME ? 'You' : opponent} {describe(h.turn, h.side === ME)}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}

