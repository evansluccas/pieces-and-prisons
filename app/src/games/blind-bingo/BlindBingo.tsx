import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botBid, botChoose } from './bots';
import {
  DEFAULT_CONFIG, GameState, LINES, PlayerState, SHAPES, Shape, bid, bingos, choose, filled, newGame, nextRound, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 600;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'saver', portrait: 'officer' },
  { name: 'Jun', persona: 'shark', portrait: 'journalist' },
  { name: 'Seo', persona: 'wild', portrait: 'fanatic' },
  { name: 'Mira', persona: 'saver', portrait: 'researcher' },
  { name: 'Taeo', persona: 'shark', portrait: 'terrorist' },
];
const SHAPE_NAME: Record<Shape, string> = { triangle: 'Triangle', circle: 'Circle', star: 'Star' };
const plural = (sh: Shape, n: number) => `${n} ${sh}${n === 1 ? '' : 's'}`;

export const RULES = [
  'Your 3×3 card has 3 triangles, 3 circles and 3 stars. You have ten coins: 1, 1, 1, 2, 2, 2, 3, 3, 5, 10 (30 in all). Coins can’t be broken or changed.',
  '7 rounds. CHOOSE: everyone secretly picks a shape — then all choices are shown, so you see who you are competing with.',
  'BID: click coins to bid on your shape (at least one). Every coin you bid is spent, win or lose.',
  'RESULT: the highest bid on each shape wins ONE STAMP PER PLAYER who chose it — crowded shapes pay more. Tied top bids split the stamps (rounded down). Only winning amounts are announced, never who won. Stamps fill your matching cells, picking the ones that help your lines most.',
  'At the end: most bingo lines (rows, columns, diagonals) wins, then most cells filled, then most coins left. Last place goes to prison.',
];

// Dev-only: ?quick plays 2 rounds.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { rounds: 2 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function BlindBingo({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [picked, setPicked] = useState<number[]>([]); // indexes into my coins
  const resultAt = useRef(0);
  const s = game.state;
  const me = s.players.find((p) => p.id === ME)!;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  // remember when each result appeared (new stamps flash for a moment)
  useEffect(() => {
    if (s.phase === 'result') resultAt.current = performance.now();
  }, [s.phase, s.round]);

  // bots choose and bid on their own (their picks and bids stay hidden)
  useEffect(() => {
    const pending = s.players.filter((p) => p.isBot && (s.phase === 'choose' ? !p.choice : s.phase === 'bid' ? p.bid === null : false));
    if (!pending.length) return;
    const t = setTimeout(() => {
      setGame((g) => {
        let st = g.state;
        for (const p of pending) {
          if (st.phase === 'choose') st = choose(st, p.id, botChoose(st, p.id, persona(p.id), g.rng));
          else if (st.phase === 'bid') st = bid(st, p.id, botBid(st, p.id, persona(p.id), g.rng));
        }
        return { ...g, state: st };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'again') {
      setPicked([]);
      return setGame(setup(botCount));
    }
    if (id.startsWith('shape:') && s.phase === 'choose' && !me.choice) {
      return setGame((g) => ({ ...g, state: choose(g.state, ME, id.slice(6) as Shape) }));
    }
    if (id.startsWith('coin:') && s.phase === 'bid' && me.bid === null) {
      const i = Number(id.slice(5));
      return setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
    }
    if (id === 'bid' && s.phase === 'bid' && me.bid === null) {
      const coins = picked.map((i) => me.coins[i]);
      setPicked([]);
      return setGame((g) => ({ ...g, state: bid(g.state, ME, coins) }));
    }
    if (id === 'next') setGame((g) => ({ ...g, state: nextRound(g.state) }));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, picked, g.time - resultAt.current)} onHit={onHit} />
      <BingoLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawCard(g: Gfx, p: PlayerState, x: number, y: number, cell: number, gained: number[] = [], since = 9999) {
  const pad = cell === 34 ? 2 : 1;
  for (let i = 0; i < 9; i++) {
    const cx = x + (i % 3) * cell;
    const cy = y + Math.floor(i / 3) * cell;
    const sz = cell - pad;
    g.rect(cx, cy, sz, sz, p.stamped[i] ? '#f1e4c3' : '#d8c29c');
    g.frame(cx, cy, sz, sz, '#5e3a24');
    const scale = cell >= 30 ? 1 : 0;
    if (scale) g.sprite('board', `shape_${p.card[i]}`, cx + (sz - 16) / 2, cy + (sz - 16) / 2, { alpha: p.stamped[i] ? 1 : 0.45 });
    else g.rect(cx + 2, cy + 2, sz - 4, sz - 4, p.card[i] === 'triangle' ? '#2fa864' : p.card[i] === 'circle' ? '#3a72d0' : '#d9952a', p.stamped[i] ? 1 : 0.3);
    if (p.stamped[i] && scale) {
      const fresh = gained.includes(i) && Math.floor(since / 200) % 2 === 0 && since < 2400;
      g.frame(cx + 1, cy + 1, sz - 2, sz - 2, fresh ? '#fff3b0' : COLORS.gold, 2);
    }
  }
  // completed lines
  for (const l of LINES) {
    if (!l.every((i) => p.stamped[i])) continue;
    const a = l[0];
    const b = l[2];
    const ax = x + (a % 3) * cell + cell / 2;
    const ay = y + Math.floor(a / 3) * cell + cell / 2;
    const bx = x + (b % 3) * cell + cell / 2;
    const by = y + Math.floor(b / 3) * cell + cell / 2;
    g.ctx.strokeStyle = COLORS.ruby;
    g.ctx.lineWidth = cell >= 30 ? 2 : 1;
    g.ctx.beginPath();
    g.ctx.moveTo(ax, ay);
    g.ctx.lineTo(bx, by);
    g.ctx.stroke();
  }
}

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/** Online play: a clock or countdown in the top bar, and the label on the "next" button. */
export interface OnlineHud { clock?: string; nextLabel?: string }

export function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, picked: number[], sinceResult: number, hud?: OnlineHud) {
  const me = s.players.find((p) => p.id === ME)!;
  const last = s.history[s.history.length - 1];
  const over = s.phase === 'gameOver';
  const showResult = s.phase === 'result' || over;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], 'BLIND BINGO');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    const x0 = Math.round(cx - slot / 2 + 4);
    g.panel('panel_parchment', x0, 30, Math.round(slot - 8), 62, 4);
    g.sprite('portraits', meta[p.id], x0 + 6, 36, { scale: 2 });
    g.text(p.name, x0 + 44, 36, { size: 8, color: '#3a2216', shadow: false });
    let line = '';
    if (s.phase === 'choose') line = p.choice ? 'chose ✓' : 'choosing…';
    else if (s.phase === 'bid') line = p.bid !== null ? 'bid placed' : 'bidding…';
    if (line) g.text(line, x0 + 44, 48, { size: 7, color: '#86192f', shadow: false });
    const shown = s.phase === 'bid' ? p.choice : showResult ? last?.choices[p.id] : null;
    if (shown) g.sprite('board', `shape_${shown}`, x0 + 44, s.phase === 'bid' ? 58 : 48);
    if (over) drawCard(g, p, x0 + 72, 44, 14);
    else g.text('card hidden', x0 + 44, 78, { size: 7, color: '#5e3a24', shadow: false });
  });

  // your card
  g.text('YOUR CARD', 14, 98, { size: 7, color: COLORS.muted });
  drawCard(g, me, 14, 108, 34, s.phase === 'result' ? last?.gained[ME] ?? [] : [], sinceResult);
  g.text(`${bingos(me.stamped)} bingo · ${filled(me.stamped)}/9 cells`, 14, 212, { size: 8, color: COLORS.gold });

  // middle panel
  const mx = 128;
  g.panel('panel_night', mx, 96, W - mx - 4, 104, 4);
  if (s.phase === 'choose') {
    if (!me.choice) {
      g.text('Choose a shape to bid on this round', mx + 10, 104, { size: 9, color: COLORS.gold });
      SHAPES.forEach((sh, i) => {
        const bx = mx + 14 + i * 112;
        const free = me.card.filter((c, k) => c === sh && !me.stamped[k]).length;
        const hover = g.isHover(`shape:${sh}`);
        g.panel(hover ? 'panel_parchment' : 'panel_night', bx, 120, 100, 70, 4);
        g.sprite('board', `shape_${sh}`, bx + 34, 128, { scale: 2 });
        g.text(SHAPE_NAME[sh], bx + 50, 164, { align: 'center', size: 9, color: hover ? '#3a2216' : COLORS.ink, shadow: hover ? false : undefined });
        g.text(`${free} empty on your card`, bx + 50, 176, { align: 'center', size: 7, color: hover ? '#5e3a24' : COLORS.muted, shadow: false });
        g.hit(`shape:${sh}`, bx, 120, 100, 70);
      });
    } else {
      g.text(`You chose ${SHAPE_NAME[me.choice]} — waiting for the others…`, mx + 10, 140, { size: 9, color: COLORS.gold });
    }
  } else if (s.phase === 'bid') {
    g.text('Everyone has chosen. The winner of a shape gets one stamp per player on it.', mx + 10, 104, { size: 7, color: COLORS.muted });
    SHAPES.forEach((sh, i) => {
      const bx = mx + 14 + i * 112;
      const on = s.players.filter((p) => p.choice === sh);
      const mine = me.choice === sh;
      g.panel(mine ? 'panel_parchment' : 'panel_night', bx, 116, 100, 78, 4);
      g.sprite('board', `shape_${sh}`, bx + 8, 122);
      g.text(`${on.length} player${on.length === 1 ? '' : 's'}`, bx + 28, 124, { size: 8, color: mine ? '#3a2216' : COLORS.ink, shadow: mine ? false : undefined });
      on.slice(0, 4).forEach((p, k) => g.text(p.id === ME ? 'You' : p.name, bx + 10, 142 + k * 10, {
        size: 7, color: mine ? '#5e3a24' : COLORS.muted, shadow: false,
      }));
      if (on.length) g.text(`win → ${on.length} stamp${on.length === 1 ? '' : 's'}`, bx + 50, 184, { align: 'center', size: 7, color: mine ? '#86192f' : COLORS.gold, shadow: false });
    });
  } else if (showResult && last) {
    g.text('Winning bids (winners are secret)', mx + 10, 104, { size: 8, color: COLORS.muted });
    SHAPES.forEach((sh, i) => {
      const bx = mx + 14 + i * 112;
      const r = last.results[sh];
      g.panel('panel_night', bx, 116, 100, 50, 4);
      g.sprite('board', `shape_${sh}`, bx + 8, 122);
      g.text(r.bidders ? (r.amount ? `won with ${r.amount}` : 'no winner') : 'nobody chose it', bx + 28, 124, { size: 8, color: COLORS.ink });
      if (r.amount) g.text(`${r.stamps} stamp${r.stamps === 1 ? '' : 's'}${r.winners.length > 1 ? ' each (tie)' : ''}`, bx + 28, 136, { size: 7, color: COLORS.gold });
      if (over && r.winners.length) g.text(r.winners.map((w) => (w === ME ? 'You' : s.players.find((p) => p.id === w)!.name)).join(', '), bx + 8, 150, { size: 7, color: COLORS.emerald });
    });
    const mineShape = last.choices[ME];
    const won = last.results[mineShape].winners.includes(ME);
    const got = last.gained[ME].length;
    const msg = won
      ? got ? `You won! +${plural(mineShape, got)} stamped` : `You won ${SHAPE_NAME[mineShape].toLowerCase()}s — but had no empty ones left`
      : `You lost the ${mineShape}s — your bid was ${last.bids[ME]}`;
    g.text(msg, mx + 10, 176, { size: 9, color: won ? COLORS.emerald : COLORS.ruby });
    if (s.phase === 'result') g.button('next', hud?.nextLabel ?? (s.round >= s.config.rounds ? 'Final result' : 'Next round'), W - 92, 180, 80);
  }

  // coins
  g.panel('panel_night', 4, 222, W - 8, 44, 4);
  const coinsLeft = me.coins.reduce((a, b) => a + b, 0);
  g.text(`YOUR COINS · ${coinsLeft} left (hidden from others)`, 14, 226, { size: 7, color: COLORS.muted });
  const bidding = s.phase === 'bid' && me.bid === null;
  me.coins.forEach((c, i) => {
    const x = 14 + i * 22;
    const sel = picked.includes(i);
    const hover = bidding && g.isHover(`coin:${i}`);
    g.sprite('coins', `coin_${c}`, x, 240 - (sel ? 4 : 0) - (hover && !sel ? 1 : 0));
    if (sel) g.frame(x - 2, 234, 20, 20, COLORS.gold);
    if (bidding) g.hit(`coin:${i}`, x - 2, 234, 20, 24);
  });
  if (bidding) {
    const total = picked.reduce((t, i) => t + me.coins[i], 0);
    g.text(`bid ${total}`, 250, 244, { size: 10, color: total ? COLORS.gold : COLORS.muted });
    g.button('bid', me.coins.length ? 'Place bid' : 'Pass', 392, 244, 80, { disabled: me.coins.length > 0 && picked.length === 0 });
  } else if (s.phase === 'bid') {
    g.text(`You bid ${me.bid!.reduce((a, b) => a + b, 0)} — waiting…`, 250, 244, { size: 9, color: COLORS.gold });
  }

  if (over) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.bingos} bingo · ${p.cells} cells · ${p.left}c` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function BingoLog({ state }: { state: GameState }) {
  const over = state.phase === 'gameOver';
  const name = (id: string) => (id === ME ? 'You' : state.players.find((p) => p.id === id)?.name ?? id);
  return (
    <aside className="log">
      <h3>Auction log</h3>
      <p className="muted">{over ? 'Match over — winners and bids revealed.' : 'Who won is secret until the end. You see the choices and winning amounts.'}</p>
      <ol>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>Round {r.round}</b>
            {SHAPES.map((sh) => {
              const res = r.results[sh];
              const who = Object.keys(r.choices).filter((id) => r.choices[id] === sh).map(name).join(', ');
              return (
                <em key={sh} className={res.winners.includes(ME) ? 'win' : ''}>
                  {SHAPE_NAME[sh]}: {who || '—'} {res.amount ? `· won with ${res.amount}` : ''}
                  {over && res.winners.length ? ` by ${res.winners.map(name).join(', ')}` : ''}
                  {over ? ` · bids ${Object.keys(r.choices).filter((id) => r.choices[id] === sh).map((id) => r.bids[id]).join('/')}` : ''}
                </em>
              );
            })}
          </li>
        ))}
      </ol>
    </aside>
  );
}
