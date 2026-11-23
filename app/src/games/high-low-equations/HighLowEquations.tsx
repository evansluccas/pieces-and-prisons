import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botAct, botDeclare } from './bots';
import {
  Action, Card, DEFAULT_CONFIG, Declaration, Equation, GameState, Op, Side, TARGET, act, betSize, cardsOf, currentTurn, declare, declarers, equationText,
  evaluate, fmt, legalActions, newGame, nextHand, pot, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 900;
const BOTS: { name: string; persona: Persona }[] = [
  { name: 'Hana', persona: 'rock' },
  { name: 'Jun', persona: 'shark' },
  { name: 'Seo', persona: 'maniac' },
  { name: 'Mira', persona: 'shark' },
  { name: 'Taeo', persona: 'rock' },
];
const STREET = ['2 cards each', '3 cards each', '4 cards each'];
const METAL_COLOR = ['#f5cd5b', '#d0d4dc', '#c07a3a', '#6b6f78'];
const OP_SPRITE: Record<Op, string> = { '+': 'op_plus', '-': 'op_minus', '*': 'op_times', '/': 'op_divide' };
const OP_TEXT: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export const RULES = [
  'Betting with arithmetic. Everyone starts with 40 chips; 8 hands. Most chips wins; fewest goes to prison.',
  'Number cards run 0–10 in four metals (gold > silver > bronze > iron). You always hold +, − and ÷. Each hand: ante 1, one HIDDEN number and one open; two more open cards follow. A betting round after each (bets 2, 2, then 4; at most 3 raises).',
  'SPECIALS come face up and you get another card at once. × must be used and replaces one of +, −, ÷. √ must be used in front of one of your numbers.',
  'After betting, build an equation with ALL your numbers and three operators (× and ÷ first). Declare HIGH (nearest 20), LOW (nearest 1) or SWING (both — win both sides or get nothing).',
  'High and low split the pot; if nobody went one way, the other side takes it all. Ties: highest card wins high, lowest card wins low.',
];

// Dev-only: ?quick plays 2 hands.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, hands: 2 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

/** One piece of the equation being built: a card from your hand (by index) or one of +, −, ÷. */
type Token = { t: 'num' | 'root' | 'times'; idx: number } | { t: 'op'; op: Op };
export interface Builder { side: Side; editing: 'high' | 'low'; high: Token[]; low: Token[] }
export const emptyBuilder = (): Builder => ({ side: 'high', editing: 'high', high: [], low: [] });

/** What a click does while declaring (solo and online share this): the new builder, and the declaration once made. */
export function builderClick(id: string, s: GameState, b: Builder): { b: Builder; declaration?: Declaration } {
  if (s.phase !== 'declare') return { b };
  const cards = cardsOf(s.players.find((p) => p.id === ME)!);
  const tokens = b[b.editing];
  const put = (next: Token[]) => ({ b: { ...b, [b.editing]: next } });
  if (id.startsWith('side:')) {
    const side = id.slice(5) as Side;
    return { b: { ...b, side, editing: side === 'low' ? 'low' : 'high' } };
  }
  if (id === 'edit:high' || id === 'edit:low') return { b: { ...b, editing: id.slice(5) as 'high' | 'low' } };
  if (id === 'undo') return put(tokens.slice(0, -1));
  if (id === 'clear') return put([]);
  if (id.startsWith('tk:')) {
    const [, kind, v] = id.split(':');
    const tk: Token = kind === 'op' ? { t: 'op', op: v as Op } : { t: kind as 'num' | 'root' | 'times', idx: Number(v) };
    return canAdd(tokens, tk, cards) ? put([...tokens, tk]) : { b };
  }
  if (id === 'declare') {
    const high = b.side !== 'low' ? toEquation(b.high, cards) : null;
    const low = b.side !== 'high' ? toEquation(b.low, cards) : null;
    return { b, declaration: { side: b.side, high, low } };
  }
  return { b };
}

/** Online play: the move clock, a hint line and the label on the "next" button. */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string }

/** Turn tokens into an equation, or null if it isn't complete yet. */
function toEquation(tokens: Token[], cards: Card[]): Equation | null {
  const terms: Equation['terms'] = [];
  const ops: Op[] = [];
  let root = false;
  for (const tk of tokens) {
    if (tk.t === 'root') root = true;
    else if (tk.t === 'num') {
      const c = cards[tk.idx];
      if (c.kind !== 'num') return null;
      terms.push({ value: c.value, metal: c.metal, root });
      root = false;
    } else if (tk.t === 'op') ops.push(tk.op);
    else ops.push('*');
  }
  const nums = cards.filter((c) => c.kind === 'num').length;
  const roots = cards.filter((c) => c.kind === 'root').length;
  const times = cards.filter((c) => c.kind === 'times').length;
  if (terms.length !== nums || ops.length !== nums - 1 || terms.filter((t) => t.root).length !== roots) return null;
  if (ops.filter((o) => o === '*').length !== times) return null;
  return { terms, ops };
}

/** What may come next: a number (or √ first) after an operator, an operator after a number. */
function canAdd(tokens: Token[], tk: Token, cards: Card[]): boolean {
  const same = (x: Token, y: Token) => {
    if (x.t === 'op' || y.t === 'op') return x.t === 'op' && y.t === 'op' && x.op === y.op;
    return x.idx === y.idx;
  };
  const used = (t: Token) => tokens.some((x) => same(x, t));
  if (used(tk)) return false;
  const last = tokens[tokens.length - 1];
  const wantNumber = !last || last.t === 'op' || last.t === 'times' || last.t === 'root';
  const nums = cards.filter((c) => c.kind === 'num').length;
  const placedNums = tokens.filter((t) => t.t === 'num').length;
  const placedOps = tokens.filter((t) => t.t === 'op' || t.t === 'times').length;
  if (tk.t === 'num') return wantNumber;
  if (tk.t === 'root') return wantNumber && last?.t !== 'root';
  // an operator: after a number, and only while more numbers remain
  if (wantNumber || placedNums >= nums) return false;
  if (tk.t === 'op') {
    // keep room for every × you hold
    const times = cards.filter((c) => c.kind === 'times').length;
    const timesLeft = times - tokens.filter((t) => t.t === 'times').length;
    return placedOps + timesLeft < nums - 1;
  }
  return placedOps < nums - 1;
}

export function HighLowEquations({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [b, setB] = useState<Builder>(emptyBuilder);
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;
  const set = (fn: (st: GameState) => GameState) => setGame((g) => ({ ...g, state: fn(g.state) }));
  const me = s.players.find((p) => p.id === ME)!;
  const cards = cardsOf(me);

  useEffect(() => {
    if (s.phase !== 'declare') setB(emptyBuilder());
  }, [s.phase, s.hand]);

  // bots bet one at a time; when betting ends they all declare together
  useEffect(() => {
    const turn = currentTurn(s);
    const botDeclarers = declarers(s).filter((id) => id !== ME);
    if (!(turn && turn !== ME) && !botDeclarers.length) return;
    const t = setTimeout(() => {
      setGame((g) => {
        let st = g.state;
        const who = currentTurn(st);
        if (who && who !== ME) st = act(st, who, botAct(st, who, persona(who), g.rng));
        else for (const id of declarers(st).filter((x) => x !== ME)) if (st.phase === 'declare') st = declare(st, id, botDeclare(st, id, g.rng));
        return { ...g, state: st };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'again') {
      setB(emptyBuilder());
      return setGame(setup(botCount));
    }
    if (id === 'next') return set((st) => nextHand(st, game.rng));
    if (id.startsWith('act:')) return set((st) => act(st, ME, id.slice(4) as Action));
    const r = builderClick(id, s, b);
    setB(r.b);
    if (r.declaration) set((st) => declare(st, ME, r.declaration!));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, b)} onHit={onHit} />
      <HandLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, id: string) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? id);

function lastAction(s: GameState, id: string): string {
  const a = [...s.actions].reverse().find((x) => x.player === id && x.street === s.street);
  if (!a) return '';
  return a.action === 'call' || a.action === 'bet' || a.action === 'raise' ? `${a.action}s ${a.amount}` : `${a.action}s`;
}

/** A full-size card. */
function bigCard(g: Gfx, c: Card | null, x: number, y: number, dim = false) {
  const alpha = dim ? 0.35 : 1;
  if (!c) return g.sprite('cards', 'back', x, y, { alpha });
  if (c.kind === 'num') {
    g.sprite('cards', `number_${c.value}`, x, y, { alpha });
    g.rect(x + 4, y + 38, 24, 3, METAL_COLOR[c.metal], alpha);
  } else if (c.kind === 'times') g.sprite('cards', 'op_times', x, y, { alpha });
  else {
    g.sprite('cards', 'blank', x, y, { alpha });
    g.text('√', x + 16, y + 12, { align: 'center', size: 16, color: '#3a2216', shadow: false });
  }
}

/** A small tile for opponents' cards. */
function miniCard(g: Gfx, c: Card | null, x: number, y: number) {
  g.rect(x, y, 13, 17, c ? '#efe2c4' : '#4a3d82');
  if (!c) return g.frame(x, y, 13, 17, '#2a2050');
  g.frame(x, y, 13, 17, '#5e3a24');
  const label = c.kind === 'num' ? `${c.value}` : c.kind === 'times' ? '×' : '√';
  g.text(label, x + 7, y + 3, { align: 'center', size: 7, color: c.kind === 'num' ? '#3a2216' : '#86192f', shadow: false });
  if (c.kind === 'num') g.rect(x + 2, y + 13, 9, 2, METAL_COLOR[c.metal]);
}

export function drawScene(g: Gfx, s: GameState, b: Builder, hud?: OnlineHud) {
  const res = s.phase === 'result' || s.phase === 'gameOver' ? s.results[s.results.length - 1] : null;
  const me = s.players.find((p) => p.id === ME)!;
  const cards = cardsOf(me);
  const turn = currentTurn(s);
  const declaring = s.phase === 'declare' && me.declared === undefined && !me.folded && !me.out;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `HAND ${s.hand}/${s.config.hands}`, color: COLORS.gold },
    { text: res ? 'showdown' : s.phase === 'declare' ? 'DECLARE' : STREET[s.street], color: s.phase === 'declare' ? COLORS.ruby : COLORS.muted },
    { text: `pot ${res ? Object.values(res.winnings).reduce((a, c) => a + c, 0) : pot(s)}`, color: COLORS.ink },
    hud?.clock ? { text: hud.clock, color: COLORS.ruby } : { text: 'HIGH = 20 · LOW = 1', color: COLORS.emerald },
  ], 'HIGH-LOW EQUATIONS');

  // opponents
  const opps = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opps.length;
  opps.forEach((p, i) => {
    const x0 = Math.round(4 + slot * i + 3);
    const w = Math.round(slot - 6);
    g.panel('panel_parchment', x0, 30, w, 66, 4);
    if (turn === p.id) g.frame(x0 - 1, 29, w + 2, 68, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.text(`${p.name}${s.players[s.dealer].id === p.id ? ' · dealer' : ''}`, x0 + 5, 33, { size: 8, color: '#3a2216', shadow: false });
    g.text(`${p.chips}`, x0 + w - 5, 33, { align: 'right', size: 8, color: '#1b6a43', shadow: false });
    const shown = res?.showings[p.id];
    let status = p.out ? 'out' : p.folded ? 'folded' : res ? '' : s.phase === 'declare' ? (p.declared === undefined ? 'building…' : 'declared') : lastAction(s, p.id);
    if (shown) status = shown.declared.side.toUpperCase();
    g.text(status, x0 + 5, 44, { size: 7, color: '#86192f', shadow: false });
    if (!res && p.streetBet) g.text(`in ${p.streetBet}`, x0 + w - 5, 44, { align: 'right', size: 7, color: '#5e3a24', shadow: false });
    if (!p.out) {
      const list: (Card | null)[] = [shown ? p.hidden : null, ...p.open];
      list.forEach((c, k) => miniCard(g, c, x0 + 4 + k * 14, 56));
    }
    if (shown) {
      const parts = [shown.high !== null ? `H ${fmt(shown.high)}` : '', shown.low !== null ? `L ${fmt(shown.low)}` : ''].filter(Boolean).join(' ');
      g.text(parts, x0 + 5, 78, { size: 7, color: '#3a2216', shadow: false });
    }
    if (res && res.winnings[p.id]) g.text(`+${res.winnings[p.id]}`, x0 + w - 5, 84, { align: 'right', size: 9, color: '#1b6a43', shadow: false });
  });

  // middle strip
  g.rect(8, 100, W - 16, 62, '#16402a', 0.85);
  g.frame(8, 100, W - 16, 62, '#5e3a24', 2);
  if (declaring) drawBuilder(g, b, cards);
  else if (res) {
    const head = res.foldWin
      ? `${nameOf(s, res.foldWin)} ${res.foldWin === ME ? 'win' : 'wins'} ${res.winnings[res.foldWin]} — everyone else folded`
      : `HIGH: ${res.highWinner ? nameOf(s, res.highWinner) : '—'}   LOW: ${res.lowWinner ? nameOf(s, res.lowWinner) : '—'}`;
    g.text(head, 16, 103, { size: 8, color: COLORS.gold });
    Object.entries(res.showings).slice(0, 6).forEach(([id, sh], i) => {
      const d = sh.declared;
      const eqs = [d.high ? `${equationText(d.high)} = ${fmt(sh.high!)}` : '', d.low ? `${equationText(d.low)} = ${fmt(sh.low!)}` : ''].filter(Boolean).join('  |  ');
      const failed = res.failedSwing.includes(id);
      g.text(`${nameOf(s, id)} ${d.side}${failed ? ' (failed)' : ''}: ${eqs}`, 16, 114 + i * 8, { size: 6, color: failed ? COLORS.ruby : res.winnings[id] ? COLORS.emerald : COLORS.ink });
    });
  } else {
    g.text(`pot ${pot(s)}`, 16, 106, { size: 10, color: COLORS.gold });
    g.text(s.phase === 'declare' ? 'Everyone is building their equations…' : `Betting: ${STREET[s.street]}, bets of ${betSize(s)}`, 16, 122, { size: 8, color: COLORS.muted });
    g.text('Build from ALL your numbers with three of +, −, ÷ (×, √ if you have them).', 16, 136, { size: 7, color: COLORS.muted });
    g.text('× and ÷ are worked out before + and −.', 16, 147, { size: 7, color: COLORS.muted });
  }

  // your seat
  g.panel('panel_night', 4, 166, W - 8, 100, 4);
  const trayIds: string[] = [];
  if (!me.out) {
    cards.forEach((c, i) => {
      const x = 12 + i * 34;
      const kind = c.kind === 'num' ? 'num' : c.kind === 'times' ? 'times' : 'root';
      const id = `tk:${kind}:${i}`;
      const used = declaring && b[b.editing].some((t) => t.t !== 'op' && t.idx === i);
      const ok = declaring && !used && canAdd(b[b.editing], { t: kind, idx: i }, cards);
      bigCard(g, c, x, 172 - (ok && g.isHover(id) ? 2 : 0), me.folded || used);
      if (i === 0) g.text('hidden', x + 16, 218, { align: 'center', size: 6, color: COLORS.muted });
      if (declaring) {
        g.hit(id, x, 172, 32, 44);
        trayIds.push(id);
      }
    });
    if (declaring) {
      (['+', '-', '/'] as Op[]).forEach((op, k) => {
        const x = 12 + (cards.length + k) * 34 + 6;
        const id = `tk:op:${op}`;
        const used = b[b.editing].some((t) => t.t === 'op' && t.op === op);
        const ok = !used && canAdd(b[b.editing], { t: 'op', op }, cards);
        g.sprite('cards', OP_SPRITE[op], x, 172 - (ok && g.isHover(id) ? 2 : 0), { alpha: used ? 0.35 : 1 });
        g.hit(id, x, 172, 32, 44);
      });
    }
  }
  g.text(`${me.chips} chips`, 12, 226, { size: 10, color: COLORS.gold });
  if (s.players[s.dealer].id === ME) g.text('dealer', 12, 240, { size: 7, color: COLORS.ruby });

  const px = 96;
  if (s.phase === 'bet') {
    if (turn === ME) {
      g.text(`Your move — bets are ${betSize(s)} this round`, px, 226, { size: 8, color: COLORS.gold });
      legalActions(s, ME).forEach((a, i) => {
        const label = a.action === 'fold' || a.action === 'check' ? cap(a.action) : `${cap(a.action)} ${a.amount}`;
        g.button(`act:${a.action}`, label, px + i * 92, 242, 86, { color: a.action === 'fold' ? 'red' : 'blue' });
      });
    } else {
      g.text(me.folded ? 'You folded — watching' : turn ? `${nameOf(s, turn)} is thinking…` : '', px, 226, { size: 8, color: COLORS.muted });
    }
  } else if (s.phase === 'declare') {
    if (declaring) {
      const ready = readyToDeclare(b, cards);
      g.button('undo', 'Undo', px, 244, 60, { disabled: !b[b.editing].length });
      g.button('clear', 'Clear', px + 66, 244, 60, { disabled: !b[b.editing].length });
      g.button('declare', `Declare ${b.side.toUpperCase()}`, px + 160, 244, 120, { color: 'red', disabled: !ready });
      g.text(ready ? 'Ready!' : 'Click your cards in order: number, operator, number…', px + 160, 230, { size: 7, color: ready ? COLORS.emerald : COLORS.muted });
    } else if (!me.folded) g.text('Declared — waiting for the others…', px, 226, { size: 8, color: COLORS.muted });
  } else if (res) {
    const mine = res.showings[ME];
    if (mine) g.text(`You went ${mine.declared.side.toUpperCase()}${res.failedSwing.includes(ME) ? ' — but lost a side' : ''}`, px, 226, { size: 8, color: COLORS.ink });
    if (res.winnings[ME]) g.text(`+${res.winnings[ME]} chips`, px, 238, { size: 9, color: COLORS.emerald });
    if (s.phase === 'result') g.button('next', hud?.nextLabel ?? (s.hand >= s.config.hands ? 'Final result' : 'Next hand'), W - 96, 246, 84);
    if (s.phase === 'result' && hud?.sub) g.text(hud.sub, W - 96, 238, { size: 6, color: COLORS.muted });
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.chips} chips` })),
      order[0].id === ME ? 'You win the table!' : `${order[0].name} wins the table.`,
    );
  }
}

function readyToDeclare(b: Builder, cards: Card[]) {
  const ok = (t: Token[]) => {
    const e = toEquation(t, cards);
    return !!e && evaluate(e) !== null;
  };
  if (b.side === 'high') return ok(b.high);
  if (b.side === 'low') return ok(b.low);
  return ok(b.high) && ok(b.low);
}

/** The equation being built, plus the side choice. */
function drawBuilder(g: Gfx, b: Builder, cards: Card[]) {
  (['high', 'low', 'swing'] as Side[]).forEach((side, i) => {
    g.button(`side:${side}`, side === 'high' ? 'HIGH 20' : side === 'low' ? 'LOW 1' : 'SWING', 16 + i * 62, 104, 58, { color: b.side === side ? 'red' : 'blue' });
  });
  if (b.side === 'swing') {
    g.button('edit:high', 'Edit high', 210, 104, 60, { color: b.editing === 'high' ? 'red' : 'blue' });
    g.button('edit:low', 'Edit low', 274, 104, 60, { color: b.editing === 'low' ? 'red' : 'blue' });
  }
  const tokens = b[b.editing];
  let x = 16;
  for (const tk of tokens) {
    let label = '';
    if (tk.t === 'op') label = OP_TEXT[tk.op];
    else if (tk.t === 'times') label = '×';
    else if (tk.t === 'root') label = '√';
    else {
      const c = cards[tk.idx];
      label = c.kind === 'num' ? `${c.value}` : '?';
    }
    const isNum = tk.t === 'num';
    g.rect(x, 124, isNum ? 22 : 16, 24, isNum ? '#efe2c4' : '#3d3270');
    g.text(label, x + (isNum ? 11 : 8), 129, { align: 'center', size: 11, color: isNum ? '#3a2216' : COLORS.ink, shadow: false });
    if (isNum) {
      const c = cards[(tk as { idx: number }).idx];
      if (c.kind === 'num') g.rect(x + 3, 144, 16, 2, METAL_COLOR[c.metal]);
    }
    x += (isNum ? 22 : 16) + 3;
  }
  if (!tokens.length) g.text(`Build your ${b.editing.toUpperCase()} equation from the cards below`, 16, 130, { size: 8, color: COLORS.muted });
  const e = toEquation(tokens, cards);
  const v = e ? evaluate(e) : null;
  const target = TARGET[b.editing];
  if (e) {
    g.text(v === null ? '÷ 0 — not allowed' : `= ${fmt(v)}`, x + 6, 130, { size: 11, color: v === null ? COLORS.ruby : COLORS.gold });
    if (v !== null) g.text(`${fmt(Math.abs(v - target))} from ${target}`, W - 20, 150, { align: 'right', size: 7, color: COLORS.muted });
  }
  if (b.side === 'swing') {
    const other = b.editing === 'high' ? 'low' : 'high';
    const oe = toEquation(b[other], cards);
    const ov = oe ? evaluate(oe) : null;
    g.text(`${other}: ${oe && ov !== null ? `${equationText(oe)} = ${fmt(ov)}` : 'not built yet'}`, 16, 151, { size: 7, color: COLORS.muted });
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- log (DOM)

export function HandLog({ state }: { state: GameState }) {
  const name = (id: string) => nameOf(state, id);
  return (
    <aside className="log">
      <h3>Hand log</h3>
      {!state.results.length && <p className="muted">Each hand’s equations, sides and winnings appear here.</p>}
      <ol>
        {[...state.results].reverse().map((r) => (
          <li key={r.hand}>
            <b>Hand {r.hand}</b>
            {r.foldWin && <em className="win">{name(r.foldWin)} won {r.winnings[r.foldWin]} — everyone else folded</em>}
            {Object.entries(r.showings).map(([id, sh]) => (
              <em key={id} className={r.failedSwing.includes(id) ? 'tip' : r.winnings[id] ? 'win' : ''}>
                {name(id)} {sh.declared.side}
                {sh.declared.high && ` · ${equationText(sh.declared.high)} = ${fmt(sh.high!)}`}
                {sh.declared.low && ` · ${equationText(sh.declared.low)} = ${fmt(sh.low!)}`}
                {r.failedSwing.includes(id) ? ' (swing failed)' : ''}{r.winnings[id] ? ` +${r.winnings[id]}` : ''}
              </em>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  );
}
