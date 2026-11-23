import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { Category } from '../../engine/atlas';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botTurn } from './bots';
import {
  COMPANIES, DEFAULT_CONFIG, GameState, Orders, buyRumor, knows, money, newGame, orderCash, ruleText, standings, submit, worth,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOTS: { name: string; persona: Persona }[] = [
  { name: 'Hana', persona: 'analyst' },
  { name: 'Jun', persona: 'trend' },
  { name: 'Seo', persona: 'gambler' },
  { name: 'Mira', persona: 'analyst' },
  { name: 'Taeo', persona: 'trend' },
];

export const RULES = [
  'Six companies start at 10,000 a share. Each one’s price follows a SECRET RULE — steady growth, zigzags, copying another company, reacting to what the table buys, and so on. Prices never fall below 100.',
  'Everyone starts with 100,000. Each of the 15 rounds, place your orders in secret: buy or sell whole shares at today’s price (no borrowing, no short selling). Sales settle before purchases. Then every price moves by its rule.',
  'RUMORS: after rounds 4, 8 and 12 the rules of two companies are published to everyone. Any time you can also buy a PRIVATE rumor for 6,000 — pick a company and learn its rule, only you.',
  'Watch the charts: until you know a rule, the price history is your best clue. After round 15 all shares are sold at the final prices. Most money wins; least money goes to prison.',
];

// Dev-only: ?quick plays 5 rounds with rumors after rounds 2 and 4.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(1, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, rounds: 5, publishAfter: [2, 4] } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function RumorExchange({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [sel, setSel] = useState(0);
  const [orders, setOrders] = useState<Orders>({});
  const s = game.state;
  const me = s.players.find((p) => p.id === ME)!;

  // bots place their orders at the start of each round (secretly)
  useEffect(() => {
    if (s.phase !== 'trade' || !s.players.some((p) => p.isBot && !p.orders)) return;
    const t = setTimeout(() => {
      setGame((g) => {
        let st = g.state;
        g.bots.forEach((b, i) => {
          const id = `bot${i}`;
          if (st.players.find((p) => p.id === id)!.orders) return;
          const turn = botTurn(st, id, b.persona, g.rng);
          if (turn.rumor !== null) st = buyRumor(st, id, turn.rumor);
          st = submit(st, id, turn.orders, g.rng);
        });
        return { ...g, state: st };
      });
    }, 400);
    return () => clearTimeout(t);
  });

  const after = orderCash(s, ME, orders);
  const setQty = (i: number, q: number) => {
    const min = -me.shares[i];
    setOrders((o) => ({ ...o, [i]: Math.max(min, q) }));
  };

  const onHit = (id: string) => {
    if (id === 'again') {
      setOrders({});
      return setGame(setup(botCount));
    }
    if (s.phase !== 'trade') return;
    if (id.startsWith('row:')) setSel(Number(id.slice(4)));
    const q = orders[sel] ?? 0;
    if (id === 'q-10') setQty(sel, q - 10);
    if (id === 'q-1') setQty(sel, q - 1);
    if (id === 'q+1') setQty(sel, q + 1);
    if (id === 'q+10') setQty(sel, q + 10);
    if (id === 'qmax') {
      const rest = (orderCash(s, ME, { ...orders, [sel]: 0 }) ?? 0);
      setQty(sel, Math.floor(rest / s.prices[sel]));
    }
    if (id === 'qsell') setQty(sel, -me.shares[sel]);
    if (id === 'qzero') setQty(sel, 0);
    if (id === 'rumor') setGame((g) => ({ ...g, state: buyRumor(g.state, ME, sel) }));
    if (id === 'end' && after !== null) {
      setGame((g) => ({ ...g, state: submit(g.state, ME, orders, g.rng) }));
      setOrders({});
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, sel, orders, after)} onHit={onHit} />
      <MarketLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, id: string) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? id);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${money(Math.abs(n))}`;

function wrap(g: Gfx, text: string, x: number, y: number, maxW: number, color: string, size = 7, maxLines = 4) {
  g.ctx.font = `${size}px "DotGothic16", monospace`;
  let line = '';
  let row = 0;
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (g.ctx.measureText(test).width > maxW && line) {
      g.text(line, x, y + row * (size + 2), { size, color });
      line = w;
      if (++row >= maxLines) return;
    } else line = test;
  }
  if (line) g.text(line, x, y + row * (size + 2), { size, color });
}

function spark(g: Gfx, series: number[], x: number, y: number, w: number, h: number) {
  g.rect(x, y, w, h, '#1b1233');
  const pts = series.slice(-16);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = Math.max(1, hi - lo);
  const step = pts.length > 1 ? (w - 2) / (pts.length - 1) : 0;
  const yOf = (v: number) => y + h - 2 - Math.round(((v - lo) / span) * (h - 4));
  for (let k = 1; k < pts.length; k++) {
    const up = pts[k] >= pts[k - 1];
    const x0 = x + 1 + Math.round((k - 1) * step);
    const x1 = x + 1 + Math.round(k * step);
    const y0 = yOf(pts[k - 1]);
    const y1 = yOf(pts[k]);
    // pixel line: step across, then up/down
    g.rect(x0, y0, Math.max(1, x1 - x0), 1, up ? COLORS.emerald : COLORS.ruby);
    g.rect(x1, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, up ? COLORS.emerald : COLORS.ruby);
  }
}

export function drawScene(g: Gfx, s: GameState, sel: number, orders: Orders, after: number | null, hud?: { clock?: string }) {
  const me = s.players.find((p) => p.id === ME)!;
  const over = s.phase === 'gameOver';
  const nextPublish = s.config.publishAfter.find((r) => r >= s.round);
  const last = s.records[s.records.length - 1];

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    { text: nextPublish ? `rumors published after round ${nextPublish}` : 'all scheduled rumors are out', color: COLORS.muted },
    hud?.clock ? { text: hud.clock, color: COLORS.ruby } : { text: `worth ${money(worth(s, me))}`, color: COLORS.ink },
  ], 'RUMOR EXCHANGE');
  // once your orders are in (online, while others decide) the desk is closed
  const placed = !over && !!me.orders;

  // market table
  g.panel('panel_night', 4, 30, 316, 176, 4);
  g.text('COMPANY', 12, 35, { size: 7, color: COLORS.muted });
  g.text('PRICE', 156, 35, { size: 7, color: COLORS.muted, align: 'right' });
  g.text('LAST', 200, 35, { size: 7, color: COLORS.muted, align: 'right' });
  g.text('CHART', 208, 35, { size: 7, color: COLORS.muted });
  g.text('YOURS', 312, 35, { size: 7, color: COLORS.muted, align: 'right' });
  COMPANIES.forEach((c, i) => {
    const y = 46 + i * 26;
    const id = `row:${i}`;
    const prev = s.history.length >= 2 ? s.history[s.history.length - 2][i] : s.prices[i];
    const d = s.prices[i] - prev;
    if (i === sel) g.rect(8, y - 3, 308, 25, '#2e2258');
    else if (g.isHover(id)) g.rect(8, y - 3, 308, 25, '#231a45');
    g.sprite(c.icon[0] as Category, c.icon[1], 12, y);
    g.text(c.name, 32, y, { size: 8, color: COLORS.ink });
    const known = knows(s, ME, i);
    g.text(known ? (s.published.includes(i) ? 'rule public' : 'rule: your rumor') : 'rule ???', 32, y + 10, {
      size: 7, color: known ? COLORS.emerald : COLORS.muted,
    });
    g.text(money(s.prices[i]), 156, y + 3, { align: 'right', size: 9, color: COLORS.gold });
    g.text(signed(d), 200, y + 4, { align: 'right', size: 7, color: d > 0 ? COLORS.emerald : d < 0 ? COLORS.ruby : COLORS.muted });
    spark(g, s.history.map((h) => h[i]), 208, y, 70, 18);
    const q = orders[i] ?? 0;
    g.text(`${me.shares[i]}`, 312, y + 1, { align: 'right', size: 8, color: me.shares[i] ? COLORS.ink : COLORS.muted });
    if (q) g.text(`${q > 0 ? '+' : ''}${q}`, 312, y + 11, { align: 'right', size: 7, color: q > 0 ? COLORS.emerald : COLORS.ruby });
    if (!over) g.hit(id, 8, y - 3, 308, 25);
  });

  // selected company
  const c = COMPANIES[sel];
  g.panel('panel_night', 324, 30, 152, 176, 4);
  g.sprite(c.icon[0] as Category, c.icon[1], 332, 36);
  g.text(c.name, 352, 38, { size: 9, color: COLORS.gold });
  g.text(`price ${money(s.prices[sel])} · you own ${me.shares[sel]}`, 332, 56, { size: 7, color: COLORS.ink });
  if (knows(s, ME, sel)) {
    g.text(s.published.includes(sel) ? 'RULE (public)' : 'RULE (your rumor)', 332, 68, { size: 7, color: COLORS.emerald });
    wrap(g, ruleText(s, sel), 332, 78, 138, COLORS.ink, 7, 4);
  } else {
    g.text('RULE unknown', 332, 68, { size: 7, color: COLORS.muted });
    wrap(g, 'Read the chart, wait for the public rumors, or buy one now.', 332, 78, 138, COLORS.muted, 7, 3);
    if (!over && !placed) {
      g.button('rumor', `Buy rumor (${money(s.config.rumorCost)})`, 332, 106, 136, { disabled: me.cash < s.config.rumorCost });
    }
  }
  if (!over && !placed) {
    const q = orders[sel] ?? 0;
    g.text('YOUR ORDER', 332, 126, { size: 7, color: COLORS.muted });
    g.button('q-10', '−10', 332, 136, 26);
    g.button('q-1', '−1', 360, 136, 22);
    g.text(`${q > 0 ? '+' : ''}${q}`, 400, 138, { align: 'center', size: 10, color: q > 0 ? COLORS.emerald : q < 0 ? COLORS.ruby : COLORS.ink });
    g.button('q+1', '+1', 418, 136, 22);
    g.button('q+10', '+10', 442, 136, 26);
    g.button('qmax', 'Max buy', 332, 154, 44);
    g.button('qsell', 'Sell all', 378, 154, 44, { disabled: !me.shares[sel] });
    g.button('qzero', 'Clear', 424, 154, 44, { disabled: !q });
    if (q) g.text(`${q > 0 ? 'costs' : 'brings in'} ${money(Math.abs(q) * s.prices[sel])}`, 332, 174, { size: 7, color: COLORS.muted });
  }

  // your desk
  g.panel('panel_night', 4, 210, W - 8, 56, 4);
  g.text(`Cash ${money(me.cash)}`, 12, 216, { size: 10, color: COLORS.gold });
  const others = s.players.filter((p) => p.id !== ME && !p.orders).length;
  if (placed) {
    const list = Object.entries(me.orders!).filter(([, q]) => q).map(([i, q]) => `${COMPANIES[Number(i)].name} ${q > 0 ? '+' : ''}${q}`);
    g.text(list.length ? `Your orders: ${list.join(' · ')}` : 'You are holding this round', 12, 232, { size: 7, color: COLORS.ink });
    g.text(`waiting for ${others} more player${others === 1 ? '' : 's'}…`, 12, 244, { size: 7, color: COLORS.gold });
  } else if (!over) {
    const list = Object.entries(orders).filter(([, q]) => q).map(([i, q]) => `${COMPANIES[Number(i)].name} ${q > 0 ? '+' : ''}${q}`);
    g.text(list.length ? `Orders: ${list.join(' · ')}` : 'No orders — End trading to just hold', 12, 232, { size: 7, color: COLORS.ink });
    g.text(after === null ? 'You can’t afford these orders' : `cash after orders: ${money(after)}`, 12, 244, {
      size: 7, color: after === null ? COLORS.ruby : COLORS.muted,
    });
    g.button('end', s.round === s.config.rounds ? 'Final trades' : 'End trading', 388, 244, 80, { disabled: after === null });
    g.text(others ? 'others are deciding…' : 'others are ready', 468, 232, { align: 'right', size: 7, color: COLORS.muted });
  }
  if (last && !over) {
    const pub = last.published.length ? `Published: ${last.published.map((i) => COMPANIES[i].name).join(' & ')}` : '';
    if (pub) g.text(pub, 200, 216, { size: 7, color: COLORS.emerald });
  }

  if (over) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: money(p.worth) })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function MarketLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Market log</h3>
      {state.records.length === 0 && <p className="muted">Price moves, published rules and your trades appear here each round.</p>}
      <ol>
        {[...state.records].reverse().map((r) => {
          const mine = r.orders[ME] ?? {};
          const trades = Object.entries(mine).map(([i, q]) => `${COMPANIES[Number(i)].name} ${q > 0 ? '+' : ''}${q}`);
          return (
            <li key={r.round}>
              <b>Round {r.round}</b>
              <em>
                {COMPANIES.map((c) => `${c.name} ${signed(r.after[c.id] - r.before[c.id])}`).join(' · ')}
              </em>
              {trades.length > 0 && <em>You traded: {trades.join(' · ')}</em>}
              {(r.rumors[ME] ?? []).map((i) => <em key={`r${i}`} className="win">Your rumor — {COMPANIES[i].name}: {ruleText(state, i)}</em>)}
              {r.published.map((i) => <em key={`p${i}`} className="win">Published — {COMPANIES[i].name}: {ruleText(state, i)}</em>)}
            </li>
          );
        })}
      </ol>
      {state.phase === 'gameOver' && (
        <p className="muted">
          All rules: {COMPANIES.map((c) => `${c.name} — ${ruleText(state, c.id)}`).join(' ')}
          {' '}Final: {standings(state).map((p) => `${nameOf(state, p.id)} ${money(p.worth)}`).join(' · ')}
        </p>
      )}
    </aside>
  );
}
