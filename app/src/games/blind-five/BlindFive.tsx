import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { topBar } from '../shared/draw';
import { Level, Memory, botMove, fade, observe, wrongCall } from './bots';
import { CELLS, GameState, MAX_STRIKES, Move, N, Side, Turn, lineBetween, newGame, play, square, xy } from './logic';

const W = 480;
const H = 270;
const ME: Side = 0;
const BOT: Side = 1;
const CS = 20;
const X0 = 4 + (278 - N * CS) / 2;
const Y0 = 32 + (234 - N * CS) / 2;
const BOT_DELAY = 900;
const LEVELS: { id: Level; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'forgets a lot, mixes stones up' },
  { id: 'normal', label: 'Normal', note: 'decent memory' },
  { id: 'hard', label: 'Hard', note: 'remembers almost everything' },
];
const COLOR_SPRITE: Record<Side, string> = { 0: 'counter_round_sapphire', 1: 'counter_round_ruby' };

export const RULES = [
  'HIDDEN STAGE — five in a row, blind. You and one opponent take turns placing a stone on any empty square of an 11×11 board. You go first.',
  'Every stone is FACE DOWN: they all look the same, so you must remember which ones are yours (and which are theirs, to block them).',
  'Instead of placing, you may CALL FIVE: pick five stones in a straight line — across, down or diagonal. All yours? You win. Otherwise it is a strike, and you learn nothing more.',
  `${MAX_STRIKES} strikes and you lose. A full board is a draw. Nothing is written down until the game ends.`,
];

/** Building a call: first stone picked, then the far end. */
interface Calling { from: number | null; line: number[] | null }

export function BlindFive() {
  const [level, setLevel] = useState<Level | null>(null);
  const [s, setS] = useState<GameState>(() => newGame());
  const [calling, setCalling] = useState<Calling | null>(null);
  const [flash, setFlash] = useState<{ cells: number[]; at: number } | null>(null);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const mem = useRef<Memory>(new Map());

  const apply = (st: GameState, side: Side, m: Move): GameState => {
    const next = play(st, side, m);
    if (level && m.kind === 'place') observe(mem.current, m.cell, side, BOT, level, rng);
    if (m.kind === 'call') {
      if (side === BOT && !next.history[next.history.length - 1].ok) wrongCall(mem.current, m.cells);
      setFlash({ cells: m.cells, at: performance.now() });
    }
    return next;
  };

  useEffect(() => {
    if (!level || s.winner !== null || s.turn !== BOT) return;
    const t = setTimeout(() => {
      fade(mem.current, level, rng);
      setS(apply(s, BOT, botMove(s, BOT, mem.current, level, rng)));
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id.startsWith('level:')) {
      mem.current = new Map();
      setLevel(id.slice(6) as Level);
      setCalling(null);
      setFlash(null);
      return setS(newGame());
    }
    if (id === 'again') return setLevel(null);
    if (s.winner !== null || s.turn !== ME) return;
    if (id === 'call') return setCalling({ from: null, line: null });
    if (id === 'cancel') return setCalling(null);
    if (id === 'confirm' && calling?.line) {
      setS(apply(s, ME, { kind: 'call', cells: calling.line }));
      return setCalling(null);
    }
    if (!id.startsWith('sq:')) return;
    const c = Number(id.slice(3));
    if (!calling) {
      if (s.board[c] === null) setS(apply(s, ME, { kind: 'place', cell: c }));
      return;
    }
    if (s.board[c] === null) return;
    if (calling.from === null || calling.line) return setCalling({ from: c, line: null });
    if (c === calling.from) return setCalling({ from: null, line: null });
    const line = lineBetween(calling.from, c);
    if (line && line.every((d) => s.board[d] !== null)) setCalling({ ...calling, line });
    else setCalling({ from: c, line: null });
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (level ? drawScene(g, s, level, calling, flash) : drawIntro(g))} onHit={onHit} />
      <StoneLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'HIDDEN STAGE', color: COLORS.amethyst }], 'BLIND FIVE');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  for (let i = 0; i < 5; i++) g.sprite('coins', 'coin_black', 204 + i * 14, 62);
  g.text('Five in a row. Every stone face down.', 240, 84, { align: 'center', size: 9, color: '#3a2216', shadow: false });
  g.text('Choose your opponent', 240, 104, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 122 + i * 28;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

const cx = (c: number) => X0 + xy(c)[0] * CS;
const cy = (c: number) => Y0 + xy(c)[1] * CS;

/** Valid far ends for a call starting at `from`: four away in a line, every square holding a stone. */
function ends(s: GameState, from: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < CELLS; c++) {
    const line = lineBetween(from, c);
    if (line && line.every((d) => s.board[d] !== null)) out.push(c);
  }
  return out;
}

function drawScene(g: Gfx, s: GameState, level: Level, calling: Calling | null, flash: { cells: number[]; at: number } | null) {
  const over = s.winner !== null;
  const myTurn = s.turn === ME && !over;
  const last = s.history[s.history.length - 1];
  const lastBot = [...s.history].reverse().find((h) => h.side === BOT && h.move.kind === 'place');
  const callFlash = flash && performance.now() - flash.at < pace(2600) ? flash.cells : null;
  const targets = calling?.from != null && !calling.line ? ends(s, calling.from) : [];
  const placed = s.board.filter((b) => b !== null).length;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: over ? 'GAME OVER' : myTurn ? 'YOUR TURN' : "OPPONENT'S TURN", color: COLORS.gold },
    { text: `vs ${level} bot`, color: COLORS.muted },
    { text: `${placed} stones down`, color: COLORS.muted },
  ], 'BLIND FIVE');

  // board
  g.panel('panel_parchment', X0 - 8, Y0 - 8, N * CS + 16, N * CS + 16, 4);
  for (let i = 0; i < N; i++) {
    g.rect(X0 + CS / 2, Y0 + i * CS + CS / 2, (N - 1) * CS, 1, '#a07a4a');
    g.rect(X0 + i * CS + CS / 2, Y0 + CS / 2, 1, (N - 1) * CS, '#a07a4a');
  }
  for (const [x, y] of [[2, 2], [8, 2], [5, 5], [2, 8], [8, 8]]) g.rect(X0 + x * CS + CS / 2 - 1, Y0 + y * CS + CS / 2 - 1, 3, 3, '#7a5530');

  for (let c = 0; c < CELLS; c++) {
    const x = cx(c);
    const y = cy(c);
    const id = `sq:${c}`;
    const who = s.board[c];
    if (who !== null) {
      if (over) g.sprite('board', COLOR_SPRITE[who], x + 2, y + 2);
      else g.sprite('coins', 'coin_black', x + 4, y + 4);
    }
    // the opponent's newest stone is ringed so you can see where it went
    if (!over && lastBot?.move.kind === 'place' && lastBot.move.cell === c && last === lastBot) g.frame(x + 1, y + 1, CS - 2, CS - 2, COLORS.gold);
    if (callFlash?.includes(c)) g.frame(x + 1, y + 1, CS - 2, CS - 2, Math.floor(g.time / 200) % 2 ? COLORS.ruby : '#ffd0d6', 2);
    if (over && s.winLine?.includes(c)) g.frame(x, y, CS, CS, s.history[s.history.length - 1].ok ? COLORS.emerald : COLORS.ruby, 2);
    if (!myTurn) continue;
    if (!calling) {
      if (who === null) {
        if (g.isHover(id)) g.sprite('coins', 'coin_black', x + 4, y + 4, { alpha: 0.45 });
        g.hit(id, x, y, CS, CS);
      }
    } else if (who !== null) {
      const picked = calling.from === c || calling.line?.includes(c);
      if (picked) g.frame(x + 1, y + 1, CS - 2, CS - 2, COLORS.gold, 2);
      else if (targets.includes(c)) g.frame(x + 2, y + 2, CS - 4, CS - 4, Math.floor(g.time / 300) % 2 ? COLORS.gold : '#fff3b0');
      else if (g.isHover(id)) g.frame(x + 2, y + 2, CS - 4, CS - 4, '#fff3b0');
      g.hit(id, x, y, CS, CS);
    }
  }

  // side panel
  const sx = 286;
  const pw = W - sx - 4;
  g.panel('panel_night', sx, 30, pw, 236, 4);
  const lastCall = last?.move.kind === 'call' ? last : null;
  let title = '';
  let note = '';
  let color: string = COLORS.gold;
  if (over) {
    const won = s.winner === ME;
    title = s.winner === 'draw' ? 'Draw — board full' : won ? 'You win!' : 'You lose';
    color = won ? COLORS.emerald : s.winner === 'draw' ? COLORS.gold : COLORS.ruby;
    const callBy = last.side === ME ? 'Your' : 'Their';
    note = s.winner === 'draw' ? 'nobody called five' : last.ok ? `${callBy} call was right` : `${callBy} 2nd wrong call`;
  } else if (!myTurn) title = 'Opponent is thinking…';
  else if (calling) {
    title = calling.line ? 'Call these five?' : calling.from === null ? 'Pick the first stone' : 'Pick the stone 4 away';
    note = calling.line ? 'all yours = you win' : calling.from === null ? 'one end of your line' : 'flashing stones end a full line';
  } else {
    title = 'Place a stone';
    note = 'or call five if you have them';
  }
  g.text(title, sx + 10, 38, { size: 10, color });
  if (note) g.text(note, sx + 10, 53, { size: 7, color: COLORS.muted });
  if (!over && lastCall && lastCall.side === BOT) g.text('Opponent called five — wrong! Strike.', sx + 10, 64, { size: 7, color: COLORS.ruby });
  if (!over && lastCall && lastCall.side === ME) g.text('Not all yours — strike!', sx + 10, 64, { size: 7, color: COLORS.ruby });

  const row = (side: Side, y: number) => {
    if (over) g.sprite('board', COLOR_SPRITE[side], sx + 10, y - 4);
    else g.sprite('coins', 'coin_black', sx + 12, y - 2);
    g.text(side === ME ? 'You' : 'Opponent', sx + 30, y, { size: 9, color: s.turn === side && !over ? COLORS.gold : COLORS.ink });
    g.text('strikes', sx + 104, y + 1, { size: 7, color: COLORS.muted });
    for (let i = 0; i < MAX_STRIKES; i++) g.rect(sx + 140 + i * 12, y + 1, 8, 8, i < s.strikes[side] ? COLORS.ruby : '#2a1f4d');
  };
  row(ME, 84);
  row(BOT, 104);

  if (myTurn) {
    if (!calling) g.button('call', 'Call five', sx + 10, 130, pw - 20, { color: 'red', disabled: placed < 5 });
    else {
      g.button('confirm', 'Call it!', sx + 10, 130, 84, { color: 'red', disabled: !calling.line });
      g.button('cancel', 'Cancel', sx + 100, 130, pw - 110);
    }
  }
  if (over) {
    g.text('All stones turned over:', sx + 10, 132, { size: 7, color: COLORS.muted });
    g.text('blue = yours, red = theirs', sx + 10, 143, { size: 7, color: COLORS.muted });
    g.button('again', 'Play again', sx + 10, 240, pw - 20);
  } else {
    g.text('Every stone looks the same.', sx + 10, 166, { size: 7, color: COLORS.muted });
    g.text('Remember which are yours —', sx + 10, 177, { size: 7, color: COLORS.muted });
    g.text('and which are theirs.', sx + 10, 188, { size: 7, color: COLORS.muted });
    g.text('A gold ring marks their last stone.', sx + 10, 204, { size: 7, color: COLORS.muted });
  }
}

// ---------------------------------------------------------------- log (DOM)

function describeTurn(t: Turn) {
  const who = t.side === ME ? 'You' : 'Opponent';
  if (t.move.kind === 'place') return `${who} placed ${square(t.move.cell)}`;
  return `${who} called ${square(t.move.cells[0])}–${square(t.move.cells[4])}: ${t.ok ? 'five!' : 'wrong (strike)'}`;
}

function StoneLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Stone log</h3>
      {state.winner === null ? (
        <p className="sealed">Sealed until the game ends — remembering your stones is the whole game.</p>
      ) : (
        <ol>
          {state.history.map((t, i) => (
            <li key={i}><em className={t.move.kind === 'call' ? (t.ok ? 'win' : 'tip') : ''}>{i + 1}. {describeTurn(t)}</em></li>
          ))}
        </ol>
      )}
    </aside>
  );
}
