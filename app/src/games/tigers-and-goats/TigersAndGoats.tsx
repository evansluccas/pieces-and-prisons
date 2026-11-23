import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Level, botMove } from './bots';
import {
  GameState, MatchResult, Move, Role, SIZE, describe, hasDiagonals, legalMoves, matchWinner, newGame, play, trapped, xy,
} from './logic';

const W = 480;
const H = 270;
const SP = 46;
const BX = 42;
const BY = 50;
const BOT_DELAY = 750;
const LEVELS: { id: Level; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'looks one move ahead, makes mistakes' },
  { id: 'normal', label: 'Normal', note: 'looks two moves ahead' },
  { id: 'hard', label: 'Hard', note: 'looks three moves ahead' },
];
const SPRITE: Record<Role, string> = { T: 'counter_square_topaz', G: 'counter_round_ivory' };
const ROLE_NAME: Record<Role, string> = { T: 'TIGERS', G: 'GOATS' };

export const RULES = [
  'FINAL DUEL — two games with swapped sides: you play the GOATS first, then the TIGERS.',
  'Board: a 5×5 grid of points; every other point also has diagonal lines. The 4 tigers (orange squares) start on the corners. The goats (white) have 20 pieces and move first.',
  'GOATS: place one goat per turn until all 20 are down; only then may goats slide to a neighbouring empty point. TIGERS: slide to a neighbouring point, or JUMP over one goat along a line to capture it.',
  'Tigers win by capturing 5 goats. Goats win by trapping every tiger so none can move. 60 moves without a capture (after all goats are placed) is a draw.',
  'Most games won takes the match; at 1–1, whoever captured more goats as the tigers wins.',
];

/** What a click on a point does on your turn (solo and online share this): the new selection, and the move once it's complete. */
export function pointClick(id: string, s: GameState, mine: Role, sel: number | null): { sel: number | null; move?: Move } {
  if (!id.startsWith('pt:')) return { sel };
  const p = Number(id.slice(3));
  const moves = legalMoves(s);
  if (mine === 'G' && s.toPlace > 0) {
    const m = moves.find((x) => x.to === p);
    return m ? { sel, move: m } : { sel };
  }
  if (s.board[p] === mine && moves.some((m) => m.from === p)) return { sel: p };
  const m = moves.find((x) => x.from === sel && x.to === p);
  return m ? { sel: null, move: m } : { sel };
}

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

const px = (p: number) => BX + xy(p)[0] * SP;
const py = (p: number) => BY + xy(p)[1] * SP;

export function TigersAndGoats() {
  const [level, setLevel] = useState<Level | null>(null);
  const [game, setGame] = useState(0); // 0: you are goats, 1: you are tigers
  const [s, setS] = useState<GameState>(() => newGame());
  const [results, setResults] = useState<MatchResult[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const mine: Role = game === 0 ? 'G' : 'T';

  // the bot plays the other side
  useEffect(() => {
    if (!level || s.winner !== null || s.turn === mine) return;
    const t = setTimeout(() => setS((st) => (st.winner === null && st.turn !== mine ? play(st, botMove(st, level, rng)) : st)), pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  // record a finished game once
  useEffect(() => {
    if (s.winner !== null && results.length === game) {
      setResults((r) => [...r, { youAs: mine, winner: s.winner!, captured: s.captured, moves: s.history.length }]);
    }
  }, [s.winner]);

  const onHit = (id: string) => {
    if (id.startsWith('level:')) {
      setLevel(id.slice(6) as Level);
      setGame(0);
      setResults([]);
      setS(newGame());
      return setSel(null);
    }
    if (id === 'again') return setLevel(null);
    if (id === 'game2') {
      setGame(1);
      setS(newGame());
      return setSel(null);
    }
    if (s.turn !== mine || s.winner !== null) return;
    const r = pointClick(id, s, mine, sel);
    setSel(r.sel);
    if (r.move) setS(play(s, r.move));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => (level ? drawScene(g, s, mine, sel, `${cap(level)} bot`, game, results) : drawIntro(g))} onHit={onHit} />
      <MoveLog state={s} mine={mine} results={results} opponent={level ? `${cap(level)} bot` : 'Bot'} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'FINAL DUEL', color: COLORS.amethyst }], 'TIGERS & GOATS');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.sprite('board', SPRITE.T, 206, 58, { scale: 2 });
  g.sprite('board', SPRITE.G, 242, 58, { scale: 2 });
  g.text('Hunt as the tigers. Trap as the goats.', 240, 96, { align: 'center', size: 9, color: '#3a2216', shadow: false });
  g.text('Choose your opponent', 240, 110, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 126 + i * 28;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function seg(g: Gfx, x0: number, y0: number, x1: number, y1: number) {
  g.ctx.beginPath();
  g.ctx.moveTo(x0 + 0.5, y0 + 0.5);
  g.ctx.lineTo(x1 + 0.5, y1 + 0.5);
  g.ctx.strokeStyle = '#8f6a35';
  g.ctx.lineWidth = 2;
  g.ctx.stroke();
}

/** Online play: the move clock, and the between-games button and note. */
export interface OnlineHud { clock?: string; nextLabel?: string; note?: string }

export function drawScene(
  g: Gfx, s: GameState, mine: Role, sel: number | null, opponent: string, game: number, results: MatchResult[], hud?: OnlineHud,
) {
  const myTurn = s.turn === mine && s.winner === null;
  const last = s.history[s.history.length - 1];
  const between = s.winner !== null && game === 0;
  const over = s.winner !== null && game === 1;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `GAME ${game + 1}/2`, color: COLORS.gold },
    { text: `you are the ${ROLE_NAME[mine]}`, color: mine === 'T' ? '#e89a5e' : COLORS.ink },
    hud?.clock ? { text: hud.clock, color: COLORS.ruby } : { text: `vs ${opponent}`, color: COLORS.muted },
  ], 'TIGERS & GOATS');

  // board
  g.panel('panel_parchment', BX - 26, BY - 22, 4 * SP + 52, 4 * SP + 46, 4);
  const L = BX + 4 * SP;
  const B = BY + 4 * SP;
  for (let i = 0; i < SIZE; i++) {
    seg(g, BX, BY + i * SP, L, BY + i * SP);
    seg(g, BX + i * SP, BY, BX + i * SP, B);
  }
  // diagonals through the "even" points
  seg(g, BX, BY, L, B);
  seg(g, L, BY, BX, B);
  seg(g, BX + 2 * SP, BY, L, BY + 2 * SP);
  seg(g, L, BY + 2 * SP, BX + 2 * SP, B);
  seg(g, BX + 2 * SP, B, BX, BY + 2 * SP);
  seg(g, BX, BY + 2 * SP, BX + 2 * SP, BY);

  const moves = myTurn ? legalMoves(s) : [];
  const placing = mine === 'G' && s.toPlace > 0;
  const targets: Move[] = placing ? moves : moves.filter((m) => m.from === sel);
  const movable = new Set(moves.filter((m) => m.from !== null).map((m) => m.from!));
  const caged = new Set(trapped(s.board));

  for (let p = 0; p < SIZE * SIZE; p++) {
    const x = px(p);
    const y = py(p);
    const id = `pt:${p}`;
    g.rect(x - 2, y - 2, 5, 5, hasDiagonals(p) ? '#5e3a24' : '#8f6a35');
    const piece = s.board[p];
    if (piece) {
      g.sprite('board', SPRITE[piece], x - 16, y - 16, { scale: 2 });
      if (piece === 'T') g.text('T', x, y - 6, { align: 'center', size: 10, color: '#5e2a0a', shadow: false });
      if (piece === 'T' && caged.has(p)) g.frame(x - 16, y - 16, 32, 32, '#5a4c8a', 2);
    }
    if (last && last.move.to === p && Math.floor(g.time / 500) % 2) g.frame(x - 17, y - 17, 34, 34, '#fff3b0');
    if (last && last.move.jumped === p && Math.floor(g.time / 250) % 2) g.text('✗', x, y - 8, { align: 'center', size: 14, color: COLORS.ruby });
    if (myTurn) {
      const t = targets.find((m) => m.to === p);
      if (t && (placing || sel !== null)) g.rect(x - 6, y - 6, 13, 13, t.jumped !== null ? COLORS.ruby : COLORS.gold, g.isHover(id) ? 0.95 : 0.6);
      else if (!placing && movable.has(p)) {
        if (sel === p) g.frame(x - 17, y - 17, 34, 34, COLORS.gold, 2);
        else if (sel === null && Math.floor(g.time / 400) % 2) g.frame(x - 16, y - 16, 32, 32, '#fff3b0');
      }
      g.hit(id, x - 18, y - 18, 36, 36);
    }
  }

  // side panel
  const sx = 262;
  g.panel('panel_night', sx, 30, W - sx - 4, 236, 4);
  let title = '';
  let hint = '';
  if (s.winner !== null) title = s.winner === 'draw' ? 'Draw' : s.winner === mine ? 'You win this game!' : `${opponent} wins this game`;
  else if (!myTurn) title = `${opponent}'s ${ROLE_NAME[s.turn].toLowerCase()} are thinking…`;
  else if (placing) { title = 'Place a goat'; hint = 'click any empty point'; }
  else if (sel === null) { title = mine === 'T' ? 'Move a tiger' : 'Move a goat'; hint = 'pick one of yours (blinking)'; }
  else { title = 'Where to?'; hint = mine === 'T' ? 'gold = slide · red = jump and capture' : 'click a gold point'; }
  g.text(title, sx + 10, 38, { size: 10, color: s.winner === mine ? COLORS.emerald : COLORS.gold });
  if (hint) g.text(hint, sx + 10, 54, { size: 7, color: COLORS.muted });

  g.sprite('board', SPRITE.G, sx + 10, 72);
  g.text(`Goats to place: ${s.toPlace}`, sx + 32, 74, { size: 8, color: COLORS.ink });
  g.text(`Captured: ${s.captured}/${s.config.toWin}`, sx + 32, 85, { size: 8, color: s.captured >= 3 ? COLORS.ruby : COLORS.ink });
  for (let i = 0; i < s.config.toWin; i++) g.rect(sx + 120 + i * 12, 85, 9, 9, i < s.captured ? COLORS.ruby : '#2a1f4d');
  g.sprite('board', SPRITE.T, sx + 10, 98);
  g.text(`Tigers trapped: ${trapped(s.board).length}/4`, sx + 32, 102, { size: 8, color: COLORS.ink });

  if (results[0]) {
    const r = results[0];
    g.text(`Game 1 (you goats): ${r.winner === 'draw' ? 'draw' : r.winner === 'G' ? 'you won' : `${opponent} won`} · ${r.captured} taken`, sx + 10, 120, { size: 7, color: COLORS.muted });
  }

  g.text('LAST MOVES', sx + 10, 136, { size: 7, color: COLORS.muted });
  s.history.slice(-8).reverse().forEach((h, i) => {
    const you = h.role === mine;
    g.text(`${you ? 'You' : opponent.slice(0, 10)}: ${describe(h.role, h.move, you).replace('capturing the goat on', '✗')}`, sx + 10, 147 + i * 11, {
      size: 7, color: h.move.jumped !== null ? COLORS.ruby : i === 0 ? COLORS.ink : COLORS.muted,
    });
  });

  if (between) {
    g.rect(0, 0, W, H, COLORS.night, 0.7);
    g.panel('panel_parchment', 130, 70, 220, 120, 4);
    const won = s.winner === mine;
    g.text('GAME 1 OVER', 240, 82, { align: 'center', size: 12, color: '#5e3a24', shadow: false });
    g.text(s.winner === 'draw' ? 'A draw.' : won ? 'Your goats trapped the tigers!' : `The tigers took ${s.captured} goats.`, 240, 104, {
      align: 'center', size: 9, color: '#3a2216', shadow: false,
    });
    g.text('Now swap: you play the TIGERS.', 240, 124, { align: 'center', size: 9, color: '#86192f', shadow: false });
    if (hud?.note) g.text(hud.note, 240, 140, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
    g.button('game2', hud?.nextLabel ?? 'Start game 2', 190, 156, 100);
  }

  if (over && results.length === 2) {
    const w = matchWinner(results);
    const youWins = results.filter((r) => r.winner === r.youAs).length;
    const botWins = results.filter((r) => r.winner !== 'draw' && r.winner !== r.youAs).length;
    const rows = [
      { name: 'You', detail: `${youWins} won · ${results[1].captured} taken as tigers` },
      { name: opponent, detail: `${botWins} won · ${results[0].captured} taken as tigers` },
    ];
    standingsPanel(g, w === 'bot' ? rows.reverse() : rows, w === 'draw' ? 'The match is a draw!' : w === 'you' ? 'You win the match!' : `${opponent} wins the match.`);
  }
}

// ---------------------------------------------------------------- log (DOM)

export function MoveLog({ state, mine, results, opponent }: { state: GameState; mine: Role; results: MatchResult[]; opponent: string }) {
  return (
    <aside className="log">
      <h3>Move log</h3>
      {results.map((r, i) => (
        <p key={i} className="muted">
          Game {i + 1} (you {r.youAs === 'G' ? 'goats' : 'tigers'}): {r.winner === 'draw' ? 'draw' : r.winner === r.youAs ? 'you won' : `${opponent} won`}, {r.captured} goats taken, {r.moves} moves
        </p>
      ))}
      {!state.history.length && <p className="muted">Points are named by column a–e and row 1–5 from the bottom.</p>}
      <ol>
        {[...state.history].reverse().map((h, i) => (
          <li key={state.history.length - i}>
            <em className={h.move.jumped !== null ? (h.role === mine ? 'win' : 'tip') : ''}>
              {state.history.length - i}. {h.role === mine ? 'You' : opponent} {describe(h.role, h.move, h.role === mine)}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
