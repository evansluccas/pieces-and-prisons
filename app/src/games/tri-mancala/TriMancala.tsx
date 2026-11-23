import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Skill, botSow } from './bots';
import {
  COLOURS, Colour, GameState, SEG, Sow, counts, isStore, landing, newGame, ownerOf, pitsOf, sow, standings, storeOf,
} from './logic';

const W = 480;
const H = 270;
const ME = 0;
const BOT_DELAY = 900;
const SLOT = 26;
const BOTS: { name: string; skill: Skill }[] = [
  { name: 'Hana', skill: 'normal' },
  { name: 'Jun', skill: 'hard' },
  { name: 'Seo', skill: 'easy' },
];
const STONE = ['#e0505a', '#4f8fe8', '#f0c040'];
const SHORT = ['R', 'B', 'G'];

export const RULES = [
  'Mancala with three colours of stone — red, blue and gold. The board is one ring: each player owns 4 pits followed by their STORE. Every pit starts with 3 stones.',
  'On your turn pick one of your pits, then choose the ORDER of its stones. They are sown one by one into the next slots around the ring (rival stores are skipped). Stones in your store are yours.',
  'Last stone in your own store: go again. Last stone in a rival’s pit that now holds 2 or 3: capture it — and keep capturing backwards through their pits while those hold 2 or 3.',
  'The game ends when the player to move has empty pits, or after 12 rounds; stones left in pits go to their owner. Your SCORE is your WEAKEST colour — keep all three balanced!',
];

// Dev-only: ?quick plays 3 rounds.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.min(3, Math.max(1, botCount)));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame([{ id: 'you', name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))], rng, QUICK ? 3 : undefined);
  return { state, bots, rng };
}

/** You're sowing: the pit picked, and the order chosen so far. */
interface Hand { pit: number; order: Colour[] }

export function TriMancala({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [hand, setHand] = useState<Hand | null>(null);
  const s = game.state;
  const myTurn = !s.over && s.turn === ME;

  useEffect(() => setHand(null), [s.history.length]);

  useEffect(() => {
    if (s.over || s.turn === ME) return;
    const t = setTimeout(() => {
      setGame((g) => {
        const st = g.state;
        if (st.over || st.turn === ME) return g;
        const m = botSow(st, st.turn, g.bots[st.turn - 1].skill, g.rng);
        return { ...g, state: sow(st, st.turn, m.pit, m.order) };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'again') {
      setHand(null);
      return setGame(setup(botCount));
    }
    if (!myTurn) return;
    if (id.startsWith('slot:')) {
      const slot = Number(id.slice(5));
      if (ownerOf(slot) === ME && !isStore(slot) && s.slots[slot].length) setHand(hand?.pit === slot ? null : { pit: slot, order: [] });
      return;
    }
    if (!hand) return;
    const left = remaining(s.slots[hand.pit], hand.order);
    if (id.startsWith('stone:')) {
      const c = Number(id.slice(6)) as Colour;
      if (left.includes(c)) setHand({ ...hand, order: [...hand.order, c] });
      return;
    }
    if (id === 'undo') return setHand({ ...hand, order: hand.order.slice(0, -1) });
    if (id === 'cancel') return setHand(null);
    if (id === 'asis') return setHand({ ...hand, order: [...hand.order, ...left] });
    if (id === 'sow' && !left.length) setGame((g) => ({ ...g, state: sow(g.state, ME, hand.pit, hand.order) }));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, hand)} onHit={onHit} />
      <SowLog state={s} />
    </div>
  );
}

/** Stones still to be ordered. */
function remaining(stones: Colour[], order: Colour[]): Colour[] {
  const left = [...stones];
  for (const c of order) left.splice(left.indexOf(c), 1);
  return left;
}

// ---------------------------------------------------------------- layout

/** Where each slot sits: the ring runs along the bottom, up the right, along the top, down the left. */
function slotPos(n: number, slot: number): [number, number] {
  const seat = Math.floor(slot / SEG);
  const k = slot % SEG;
  const step = SLOT + 4;
  if (n === 2) {
    // classic: you along the bottom, the rival along the top going back
    return seat === 0 ? [58 + k * step, 222] : [208 - k * step, 44];
  }
  switch (seat) {
    case 0: return [58 + k * step, 228];
    case 1: return [240, 196 - k * step];
    case 2: return [208 - k * step, 38];
    default: return [16, 70 + k * step];
  }
}

function drawStones(g: Gfx, stones: Colour[], x: number, y: number) {
  const shown = stones.slice(0, 16);
  shown.forEach((c, i) => g.rect(x + 2 + (i % 4) * 6, y + 2 + Math.floor(i / 4) * 6, 5, 5, STONE[c]));
  if (stones.length > 16) g.text(`${stones.length}`, x + SLOT / 2, y + 8, { align: 'center', size: 8, color: COLORS.ink });
}

// ---------------------------------------------------------------- drawing

function drawScene(g: Gfx, s: GameState, hand: Hand | null) {
  const n = s.players.length;
  const myTurn = !s.over && s.turn === ME;
  const last: Sow | undefined = s.history[s.history.length - 1];
  const flash = Math.floor(g.time / 300) % 2 === 0;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: s.over ? 'GAME OVER' : `ROUND ${s.round}/${s.rounds}`, color: COLORS.gold },
    { text: s.over ? '' : myTurn ? 'YOUR TURN' : `${s.players[s.turn].name}'s turn`, color: myTurn ? COLORS.emerald : COLORS.muted },
    { text: 'score = weakest colour', color: COLORS.muted },
  ], 'TRI-MANCALA');

  g.panel('panel_parchment', 4, 30, 278, 236, 4);
  g.rect(48, 72, 186, 142, '#5e3a24', 0.25);

  // where your hand would land, colour by colour
  const preview = new Map<number, Colour[]>();
  if (hand) {
    const path = landing(s, ME, hand.pit);
    hand.order.forEach((c, i) => preview.set(path[i], [...(preview.get(path[i]) ?? []), c]));
  }

  for (let slot = 0; slot < s.slots.length; slot++) {
    const [x, y] = slotPos(n, slot);
    const owner = ownerOf(slot);
    const store = isStore(slot);
    const id = `slot:${slot}`;
    const mine = owner === ME && !store;
    const pickable = myTurn && mine && s.slots[slot].length > 0;
    g.rect(x, y, SLOT, SLOT, store ? '#3a2216' : '#7a5530');
    if (store) g.frame(x - 1, y - 1, SLOT + 2, SLOT + 2, s.turn === owner && !s.over ? COLORS.gold : '#c9a35c', store ? 2 : 1);
    const stones = hand?.pit === slot ? remaining(s.slots[slot], hand.order) : s.slots[slot];
    drawStones(g, stones, x, y);
    for (const [i, c] of (preview.get(slot) ?? []).entries()) g.rect(x + SLOT - 7 - i * 6, y + SLOT - 7, 5, 5, STONE[c], flash ? 1 : 0.5);
    if (hand?.pit === slot) g.frame(x, y, SLOT, SLOT, COLORS.gold, 2);
    else if (pickable && g.isHover(id)) g.frame(x, y, SLOT, SLOT, '#fff3b0');
    if (last && !hand && last.path.includes(slot) && flash) g.frame(x + 1, y + 1, SLOT - 2, SLOT - 2, '#ffffff');
    if (last && !hand && last.captured.includes(slot)) g.frame(x, y, SLOT, SLOT, COLORS.ruby, 2);
    if (pickable) g.hit(id, x, y, SLOT, SLOT);
    if (store) {
      const name = s.players[owner].name;
      const [lx, ly] = n === 2 ? [x + SLOT / 2, owner === 0 ? y + SLOT + 2 : y - 9] : owner === 1 ? [x + SLOT / 2, y - 9] : owner === 2 ? [x + SLOT / 2, y + SLOT + 2] : owner === 3 ? [x + SLOT / 2, y + SLOT + 2] : [x + SLOT / 2, y - 9];
      g.text(name, lx, ly, { align: 'center', size: 7, color: '#3a2216', shadow: false });
    }
  }
  g.text('stones travel anticlockwise ↺', 141, 140, { align: 'center', size: 7, color: '#5e3a24', shadow: false });

  // side panel
  const sx = 286;
  const pw = W - sx - 4;
  g.panel('panel_night', sx, 30, pw, 236, 4);
  let title = '';
  if (s.over) title = 'Final stores';
  else if (!myTurn) title = `${s.players[s.turn].name} is sowing…`;
  else if (!hand) title = 'Pick one of your pits';
  else title = 'Choose the order to sow';
  g.text(title, sx + 8, 36, { size: 8, color: myTurn ? COLORS.gold : COLORS.muted });

  if (hand && myTurn) {
    const left = remaining(s.slots[hand.pit], hand.order);
    g.text(`order (${hand.order.length}/${s.slots[hand.pit].length}):`, sx + 8, 50, { size: 7, color: COLORS.muted });
    hand.order.forEach((c, i) => g.rect(sx + 70 + (i % 12) * 9, 50 + Math.floor(i / 12) * 9, 7, 7, STONE[c]));
    ([0, 1, 2] as Colour[]).forEach((c, i) => {
      const k = left.filter((x) => x === c).length;
      const bx = sx + 8 + i * 60;
      const id = `stone:${c}`;
      g.rect(bx, 68, 56, 20, k ? (g.isHover(id) ? '#5a4a96' : '#3d3270') : '#2a2050');
      g.rect(bx + 5, 74, 8, 8, STONE[c], k ? 1 : 0.3);
      g.text(`${COLOURS[c]} ×${k}`, bx + 17, 74, { size: 7, color: k ? COLORS.ink : '#6b6390' });
      if (k) g.hit(id, bx, 68, 56, 20);
    });
    g.text('Next stone lands on the flashing square.', sx + 8, 94, { size: 6, color: COLORS.muted });
    g.button('sow', 'Sow', sx + 8, 104, 52, { color: 'red', disabled: left.length > 0 });
    g.button('asis', 'Rest as is', sx + 64, 104, 64, { disabled: !left.length });
    g.button('undo', 'Undo', sx + 132, 104, 46, { disabled: !hand.order.length });
  } else if (myTurn) {
    g.text('Click a pit along your side.', sx + 8, 52, { size: 7, color: COLORS.muted });
    g.text('Your store is the gold-framed box', sx + 8, 64, { size: 7, color: COLORS.muted });
    g.text('at the end of your row.', sx + 8, 74, { size: 7, color: COLORS.muted });
  }

  // scoreboard: every store, by colour; the weakest colour is the score
  g.text('STORE    R    B    G   SCORE  PITS', sx + 8, 132, { size: 7, color: COLORS.muted });
  s.players.forEach((p, i) => {
    const y = 144 + i * 16;
    const c = counts(s.slots[storeOf(i)]);
    const weakest = Math.min(...c);
    g.text(p.name, sx + 8, y, { size: 8, color: s.turn === i && !s.over ? COLORS.gold : COLORS.ink });
    c.forEach((v, k) => {
      g.rect(sx + 46 + k * 22, y + 1, 6, 6, STONE[k]);
      g.text(`${v}`, sx + 54 + k * 22, y, { size: 8, color: v === weakest ? COLORS.ruby : COLORS.ink });
    });
    g.text(`${weakest}`, sx + 124, y, { size: 9, color: COLORS.emerald });
    const inPits = pitsOf(i).reduce((t, slot) => t + s.slots[slot].length, 0);
    if (!s.over) g.text(`${inPits}`, sx + 158, y, { size: 8, color: COLORS.muted });
  });
  g.text('Pit stones go home at the end.', sx + 8, 214, { size: 6, color: COLORS.muted });
  if (last && !s.over) {
    const who = s.players[last.player].name;
    const msg = last.captured.length ? `${who} captured ${last.capturedStones.length}!` : last.extra ? `${who} landed in the store — again!` : '';
    if (msg) g.text(msg, sx + 8, 226, { size: 7, color: last.captured.length ? COLORS.ruby : COLORS.emerald });
  }

  if (s.over) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `weakest ${p.score} · ${p.counts.join('/')}` })),
      order[0].id === 'you' ? 'Best balance — you win!' : `${order[0].name} kept the best balance.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

function SowLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Sowing log</h3>
      {!state.history.length && <p className="muted">Every pit sown, extra turn and capture appears here.</p>}
      <ol>
        {[...state.history].reverse().slice(0, 40).map((m, i) => (
          <li key={state.history.length - i}>
            <em className={m.captured.length ? 'tip' : m.extra ? 'win' : ''}>
              {state.players[m.player].name} sowed {m.order.map((c) => SHORT[c]).join(' ')}
              {m.extra ? ' — into the store, again!' : ''}
              {m.captured.length ? ` — captured ${m.capturedStones.map((c) => SHORT[c]).join(' ')}` : ''}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
