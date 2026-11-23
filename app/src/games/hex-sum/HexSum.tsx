import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Level, Memory, botLine, memorize } from './bots';
import { GameState, HEXES, LINES, Side, lineOf, newGame, startPlay, tryLine } from './logic';
import type { SeenState } from './online';

const W = 480;
const H = 270;
const ME: Side = 0;
const BOT: Side = 1;
const S = 19;          // hex size (centre to corner)
const CX = 136;
const CY = 150;
export const FLASH_MS = 1700;
const LEVELS: { id: Level; label: string; note: string; studyMs: number }[] = [
  { id: 'easy', label: 'Easy', note: '40 s to study · forgetful bot', studyMs: 40_000 },
  { id: 'normal', label: 'Normal', note: '30 s to study', studyMs: 30_000 },
  { id: 'hard', label: 'Hard', note: '20 s to study · sharp bot', studyMs: 20_000 },
];

export const RULES = [
  'FINAL DUEL — 19 hexagon tiles, each with a number 1–9. Study the board, then every tile turns face down.',
  '8 rounds. Each round shows a TARGET. Take turns picking THREE tiles in a straight line (side by side, in any direction) — they flip up.',
  'If they add up to the target you win the round, and that line is claimed for the rest of the match. If not, they flip back and it’s your opponent’s turn.',
  'Both players see every flip — use what the other player reveals. A round with 6 misses is void. The round’s first player alternates.',
  'Most rounds won after 8 wins the duel.',
];

const hexX = (i: number) => CX + S * Math.sqrt(3) * (HEXES[i][0] + HEXES[i][1] / 2);
const hexY = (i: number) => CY + S * 1.5 * HEXES[i][1];

export function HexSum() {
  const [level, setLevel] = useState<(typeof LEVELS)[number] | null>(null);
  const [s, setS] = useState<GameState | null>(null);
  const [memory, setMemory] = useState<Memory>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const phaseAt = useRef(performance.now());
  const flashAt = useRef(0);

  // a new attempt starts a flash; the memorise clock starts with the game
  useEffect(() => {
    if (s?.attempts.length) flashAt.current = performance.now();
  }, [s?.attempts.length]);
  useEffect(() => {
    phaseAt.current = performance.now();
  }, [s?.phase]);

  useEffect(() => {
    if (!s || !level) return;
    if (s.phase === 'memorize') {
      const t = setTimeout(() => setS((st) => (st && st.phase === 'memorize' ? startPlay(st) : st)), level.studyMs);
      return () => clearTimeout(t);
    }
    if (s.phase !== 'play' || s.turn !== BOT) return;
    // wait for the last flip to be seen, then think a moment
    const wait = Math.max(0, flashAt.current + FLASH_MS - performance.now()) + pace(900);
    const t = setTimeout(() => setS((st) => (st && st.phase === 'play' && st.turn === BOT ? tryLine(st, BOT, botLine(st, memory, rng), rng) : st)), wait);
    return () => clearTimeout(t);
  }, [s?.phase, s?.turn, s?.attempts.length, level]);

  const flashing = () => performance.now() - flashAt.current < FLASH_MS;

  const onHit = (id: string) => {
    const l = LEVELS.find((x) => `level:${x.id}` === id);
    if (l) {
      const g = newGame(rng);
      setLevel(l);
      setS(g);
      setMemory(memorize(g.values, l.id, rng));
      return setPicked([]);
    }
    if (!s) return;
    if (id === 'again') {
      setLevel(null);
      return setS(null);
    }
    if (id === 'ready' && s.phase === 'memorize') return setS(startPlay(s));
    if (s.phase !== 'play' || s.turn !== ME || flashing()) return;
    const r = tileClick(id, s, picked);
    setPicked(r.picked);
    if (r.line !== undefined) setS(tryLine(s, ME, r.line, rng));
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (s && level
          ? drawScene(g, s, picked, { left: level.studyMs - (performance.now() - phaseAt.current), total: level.studyMs }, flashing() ? performance.now() - flashAt.current : -1, `${level.label} bot`)
          : drawIntro(g))}
        onHit={onHit}
      />
      <HexLog state={s} />
    </div>
  );
}

/** A click on your turn (shared by solo and online): pick tiles, clear, or flip a line. */
export function tileClick(id: string, s: SeenState, picked: number[]): { picked: number[]; line?: number } {
  if (id.startsWith('hex:')) {
    const i = Number(id.slice(4));
    return { picked: picked.includes(i) ? picked.filter((x) => x !== i) : picked.length < 3 ? [...picked, i] : picked };
  }
  if (id === 'flip') {
    const line = lineOf(picked);
    if (line < 0 || s.claimed.includes(line)) return { picked };
    return { picked: [], line };
  }
  if (id === 'clear') return { picked: [] };
  return { picked };
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'FINAL DUEL', color: COLORS.amethyst }], 'HEX SUM');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.text('Remember the numbers.', 240, 66, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Find three in a row that hit the target.', 240, 80, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  g.text('Choose your opponent', 240, 100, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 118 + i * 28;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function hexPath(g: Gfx, x: number, y: number, r: number) {
  const c = g.ctx;
  c.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (k) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
}

function hex(g: Gfx, i: number, fill: string, edge: string, edgeW = 1) {
  hexPath(g, hexX(i), hexY(i), S - 1);
  g.ctx.fillStyle = fill;
  g.ctx.fill();
  g.ctx.lineWidth = edgeW;
  g.ctx.strokeStyle = edge;
  g.ctx.stroke();
}

/** Online play: the opponent's name (instead of "Bot"), the move clock, and the round-result countdown. */
export interface OnlineHud { opponent: string; clock?: string; nextIn?: number }

/** `study` is the time left to study (ms) and its total; `rival` names the bot on the final standings. */
export function drawScene(g: Gfx, s: SeenState, picked: number[], study: { left: number; total: number }, sinceFlash: number, rival: string, hud?: OnlineHud) {
  const over = s.phase === 'gameOver';
  const memo = s.phase === 'memorize';
  const between = hud?.nextIn !== undefined;
  const last = s.attempts[s.attempts.length - 1];
  const flashLine = (sinceFlash >= 0 || between) && last ? LINES[last.line] : [];
  const myTurn = s.phase === 'play' && s.turn === ME && sinceFlash < 0 && !between;
  const left = study.left;
  const foe = hud ? hud.opponent.slice(0, 10) : 'Bot';

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: memo ? `STUDY — ${Math.max(0, Math.ceil(left / 1000))}s` : `ROUND ${s.round}/${s.config.rounds}`, color: memo ? COLORS.emerald : COLORS.gold },
    { text: memo ? 'every tile turns face down when time is up' : `misses ${s.misses}/${s.config.maxMisses}`, color: COLORS.muted },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], 'HEX SUM');
  g.panel('panel_night', 4, 30, 266, 236, 4);

  const claimedTiles = new Set(s.claimed.flatMap((l) => LINES[l]));
  const line = picked.length === 3 ? lineOf(picked) : -1;
  HEXES.forEach((_, i) => {
    const up = memo || over || flashLine.includes(i);
    const sel = picked.includes(i);
    const hover = myTurn && g.isHover(`hex:${i}`);
    let fill = up ? '#f1e4c3' : hover ? '#4a3a8a' : '#2e2258';
    if (flashLine.includes(i) && last) fill = last.ok ? '#9fe3b0' : '#f2a3ad';
    hex(g, i, fill, sel ? COLORS.gold : claimedTiles.has(i) ? '#c9a35c' : '#140e2a', sel ? 2 : 1);
    if (up) g.text(`${s.values[i]}`, hexX(i), hexY(i) - 7, { align: 'center', size: 14, color: '#3a2216', shadow: false });
    else g.sprite('icons', 'question', hexX(i) - 8, hexY(i) - 8, { alpha: 0.18 });
    if (sel) g.text(`${picked.indexOf(i) + 1}`, hexX(i), hexY(i) + 5, { align: 'center', size: 7, color: COLORS.gold });
    if (myTurn) g.hit(`hex:${i}`, hexX(i) - 13, hexY(i) - 13, 26, 26);
  });

  // side panel
  const px = 274;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  if (memo) {
    g.text('STUDY THE BOARD', px + 10, 38, { size: 10, color: COLORS.emerald });
    g.rect(px + 10, 56, W - px - 24, 5, '#2a1f4d');
    g.rect(px + 10, 56, Math.round((W - px - 24) * Math.max(0, left / study.total)), 5, COLORS.emerald);
    g.text('Lines run in 3 directions:', px + 10, 72, { size: 7, color: COLORS.muted });
    g.text('across, and both diagonals.', px + 10, 82, { size: 7, color: COLORS.muted });
    g.button('ready', 'I’m ready', px + 10, 100, 90);
    return;
  }

  g.text(between ? 'NEXT TARGET' : 'TARGET', px + 10, 36, { size: 7, color: COLORS.muted });
  g.text(`${s.target}`, px + 10, 44, { size: 24, color: COLORS.gold });
  g.text('YOU', px + 90, 40, { size: 7, color: COLORS.muted });
  g.text(`${s.scores[ME]}`, px + 90, 50, { size: 16, color: COLORS.sapphire });
  g.text(foe.toUpperCase(), px + 140, 40, { size: 7, color: COLORS.muted });
  g.text(`${s.scores[BOT]}`, px + 140, 50, { size: 16, color: COLORS.ruby });

  let msg = '';
  if (over) msg = '';
  else if ((sinceFlash >= 0 || between) && last) msg = `${last.side === ME ? 'You' : foe}: ${LINES[last.line].map((i) => s.values[i]).join(' + ')} = ${last.sum} ${last.ok ? '— HIT!' : '— miss'}`;
  else if (s.turn === BOT) msg = hud ? `${hud.opponent} is choosing…` : 'The bot is choosing…';
  else if (picked.length < 3) msg = `Pick 3 tiles in a straight line (${picked.length}/3)`;
  else if (line < 0) msg = 'Those three aren’t a straight line';
  else if (s.claimed.includes(line)) msg = 'That line is already claimed';
  else msg = 'Flip them!';
  g.text(msg, px + 10, 80, { size: 8, color: (sinceFlash >= 0 || between) && last ? (last.ok ? COLORS.emerald : COLORS.ruby) : COLORS.ink });
  if (between) {
    g.button('ready', 'Ready', px + 10, 94, 72);
    g.text(`${last && !last.ok ? 'Round void. ' : ''}Next round in ${hud!.nextIn}s`, px + 90, 98, { size: 7, color: COLORS.muted });
  }
  if (myTurn) {
    g.button('flip', 'Flip them', px + 10, 94, 96, { color: 'red', disabled: line < 0 || s.claimed.includes(line) });
    g.button('clear', 'Clear', px + 112, 94, 72, { disabled: !picked.length });
  }

  // between rounds, keep showing the round that just ended
  const shown = between && last ? last.round : s.round;
  g.text(between ? `ROUND ${shown}` : 'THIS ROUND', px + 10, 118, { size: 7, color: COLORS.muted });
  s.attempts.filter((a) => a.round === shown).slice(-6).forEach((a, i) => {
    g.text(`${a.side === ME ? 'You' : foe}: ${LINES[a.line].map((t) => s.values[t]).join('+')} = ${a.sum}`, px + 10, 130 + i * 11, {
      size: 7, color: a.ok ? COLORS.emerald : COLORS.muted,
    });
  });
  const won = s.attempts.filter((a) => a.ok).slice(-3).reverse();
  if (won.length) {
    g.text('LAST HITS', px + 10, 200, { size: 7, color: COLORS.muted });
    won.forEach((a, i) => g.text(`R${a.round} ${a.side === ME ? 'You' : foe} hit ${a.target}`, px + 10, 212 + i * 11, { size: 7, color: COLORS.ink }));
  }

  if (over && sinceFlash < 0) {
    const w = s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? ME : BOT;
    standingsPanel(
      g,
      [ME, BOT].sort((a, b) => s.scores[b] - s.scores[a]).map((side) => ({
        name: side === ME ? 'You' : hud?.opponent ?? rival,
        detail: `${s.scores[side]} rounds`,
      })),
      w === 'draw' ? 'A draw!' : w === ME ? 'You win the duel!' : hud ? `${hud.opponent} wins the duel.` : 'The bot wins the duel.',
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function HexLog({ state, opponent }: { state: SeenState | null; opponent?: string }) {
  const list = state?.attempts ?? [];
  return (
    <aside className="log">
      <h3>Flip log</h3>
      {!list.length && <p className="muted">Every flip appears here — yours and {opponent ? `${opponent}’s` : 'the bot’s'}. Memory is part of the game, but nothing here is secret.</p>}
      <ol>
        {[...list].reverse().map((a, i) => (
          <li key={list.length - i}>
            <em className={a.ok ? 'win' : ''}>
              R{a.round} (target {a.target}) — {a.side === ME ? 'You' : opponent ?? 'Bot'}: {LINES[a.line].map((t) => state!.values[t]).join(' + ')} = {a.sum} {a.ok ? '✓' : '✗'}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
