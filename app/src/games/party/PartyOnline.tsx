import { useMemo, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { ONLINE_VIEWS } from '../../ui/Online';
import { BOARD, BoardState, SpaceKind, current, standings } from './logic';
import type { PartyView } from '../../../server/games/party';
import { RulesDialog } from '../../ui/RulesDialog';
import { miniInfo } from './minis';

const W = 480;
const H = 270;

/** One colour per seat (in turn order), matching the pawn's clothes. */
export const TOKEN = ['#70adf2', '#f2687a', '#6edd8c', '#f5cd5b', '#bf89ea', '#f6a650', '#f6afc6', '#eee6d4'];

// ------------------------------------------------------------ the track ----
// A running track in the prison yard: two straights and two half circles.
// GO is at the top middle; play goes clockwise.
const CX = 240;
const CY = 135;
const HALF = 100; // half the straight
const R = 86;
const PERIM = 4 * HALF + 2 * Math.PI * R;

export function trackAt(d: number): [number, number] {
  let t = ((d % PERIM) + PERIM) % PERIM;
  if (t < HALF) return [CX + t, CY - R];
  t -= HALF;
  if (t < Math.PI * R) {
    const a = -Math.PI / 2 + t / R;
    return [CX + HALF + R * Math.cos(a), CY + R * Math.sin(a)];
  }
  t -= Math.PI * R;
  if (t < 2 * HALF) return [CX + HALF - t, CY + R];
  t -= 2 * HALF;
  if (t < Math.PI * R) {
    const a = Math.PI / 2 + t / R;
    return [CX - HALF + R * Math.cos(a), CY + R * Math.sin(a)];
  }
  t -= Math.PI * R;
  return [CX - HALF + t, CY - R];
}

/** The middle of space `i` (where a pawn stands). */
export const spaceAt = (i: number): [number, number] => {
  const [x, y] = trackAt((i * PERIM) / BOARD.length);
  return [Math.round(x), Math.round(y)];
};

const SPACE_SPRITE: Record<SpaceKind, string> = {
  gate: 'space_gate', blue: 'space_blue', red: 'space_red', event: 'space_event',
  duel: 'space_duel', prison: 'space_prison', vault: 'space_vault',
};

const KIND_TEXT = { ffa: 'Everyone for themselves', teams: 'Team blue vs team red', duel: 'Duel' } as const;

// a move on screen: the die tumbles, then the pawn hops space by space
const DIE_MS = 450;
const DIE_HOLD_MS = 250;
const HOP_MS = 150;

interface Anim { key: string; start: number; who: string; die: number; path: number[] }

export function PartyOnline({ game, room, send, onAgain, error }: OnlineGameProps) {
  const v = game.view as PartyView;
  const b = v.board;
  const names = useMemo(() => Object.fromEntries(b.players.map((p) => [p.id, p.id === v.me ? 'You' : p.name])), [b.players, v.me]);
  const seatNo = useMemo(() => Object.fromEntries(b.order.map((id, i) => [id, i % 8])), [b.order]);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const rules = rulesFor && (
    <RulesDialog gameId={rulesFor} title={miniInfo(rulesFor)?.label ?? rulesFor} note={miniInfo(rulesFor)?.blurb} onClose={() => setRulesFor(null)} />
  );

  // start an animation whenever a new move arrives (not for the one already on screen when we open)
  const anim = useRef<Anim | null>(null);
  const seen = useRef<string | null>(null);
  const lm = b.lastMove;
  const key = lm ? `${b.round}.${b.turn}.${b.notes.length}.${lm.who}.${lm.die}.${lm.path.join('-')}` : null;
  if (key !== seen.current) {
    if (seen.current !== null && lm && key) anim.current = { key, start: performance.now(), who: lm.who, die: lm.die, path: lm.path };
    seen.current = key;
  }

  // a mini-game I'm playing: its own screen, with my moves sent through the Party
  if (v.stage === 'mini' && v.mini?.playing) {
    const View = ONLINE_VIEWS[v.mini.id];
    const inner = {
      view: v.mini.view,
      waiting: v.mini.waiting,
      deadline: v.mini.leftMs === null ? null : Date.now() + v.mini.leftMs,
      pauseUntil: game.pauseUntil,
    };
    const relay = (msg: Record<string, unknown>) =>
      send(msg.type === 'act' ? { type: 'act', action: { type: 'mini', action: msg.action } } : msg);
    const match = v.mini.match;
    const team = match?.teams ? (match.teams[0].includes(v.me!) ? 'blue' : 'red') : null;
    const miniId = v.mini.id;
    return (
      <div className="party-mini">
        <p className="party-bar">
          <b>Party</b> · {v.practice ? <b className="practice">practice round — nothing at stake</b> : <>round {b.round}/{b.rounds}</>} · <b>{v.mini.label}</b> — {match ? KIND_TEXT[match.kind] : ''}
          {team && <span className={`team ${team}`}> · you’re on team {team}</span>}
          {match?.kind === 'duel' && <span> · {match.seats.map((id) => names[id]).join(' vs ')}</span>}
          <button className="link" onClick={() => setRulesFor(miniId)}>Rules</button>
        </p>
        {rules}
        {View && <View key={`${b.round}-${b.turn}-${v.mini.id}`} game={inner} room={room} send={relay} error={error} onAgain={() => undefined} />}
      </div>
    );
  }

  const me = v.me;
  const myTurn = v.stage === 'board' && current(b) === me;
  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'ready') return send({ type: 'ready' });
    if (id === 'rules' && v.next) return setRulesFor(v.next.id);
    if (id === 'roll' && myTurn && b.phase === 'roll') send({ type: 'act', action: { type: 'roll' } });
    if (id.startsWith('rival:') && myTurn && b.phase === 'duelPick') send({ type: 'act', action: { type: 'duel', rival: id.slice(6) } });
  };

  const draw = (g: Gfx) => {
    const pauseLeft = game.pauseUntil ? Math.max(0, Math.ceil((game.pauseUntil - Date.now()) / 1000)) : null;
    const a = anim.current && g.time - anim.current.start < DIE_MS + DIE_HOLD_MS + anim.current.path.length * HOP_MS + 200 ? anim.current : null;
    const ctx: Ctx = { b, v, names, seatNo, anim: a };
    drawYard(g, ctx);
    drawCards(g, ctx);
    drawCentre(g, ctx, myTurn);
    drawPawns(g, ctx);
    if (v.stage === 'intro' && v.next) drawIntro(g, ctx, pauseLeft);
    else if (v.stage === 'payout' && v.last) drawPayout(g, ctx, pauseLeft);
    else if (v.stage === 'mini' && v.mini && !v.mini.playing) drawWatching(g, ctx);
    else if (room.status === 'over' || v.stage === 'done') drawFinal(g, ctx);
  };

  return (
    <div className="party-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <PartyLog board={b} names={names} />
      {rules}
    </div>
  );
}

interface Ctx {
  b: BoardState;
  v: PartyView;
  names: Record<string, string>;
  seatNo: Record<string, number>;
  anim: Anim | null;
}

// ------------------------------------------------------------- the yard ----

function drawYard(g: Gfx, { b }: Ctx) {
  g.tile('board', 'tile_grass', 0, 0, W, H);
  // the track: a dark edge, then packed sand
  for (const [size, color] of [[18, '#96773f'], [14, '#d1b06a']] as const) {
    for (let d = 0; d < PERIM; d += 2) {
      const [x, y] = trackAt(d);
      g.rect(Math.round(x - size / 2), Math.round(y - size / 2), size, size, color);
    }
  }
  // the infield, a little darker
  g.rect(CX - HALF, CY - R + 14, 2 * HALF, 2 * R - 28, '#2a6232', 0.25);

  // the jails stand by the jail spaces; towers watch the other corners
  g.sprite('party', 'jail_house', 6, 34);
  g.sprite('party', 'jail_house', 444, 206);
  g.sprite('party', 'watchtower', 452, 30);
  g.sprite('party', 'watchtower', 6, 198);
  for (const [x, y] of [[24, 112], [8, 140], [448, 112], [462, 140], [40, 226], [424, 36]]) g.sprite('board', 'tree', x, y);
  g.sprite('board', 'manhole', 232, 214);

  // spaces, with the last move's path lit up
  const lit = new Set(b.lastMove?.path ?? []);
  const blink = Math.floor(g.time / 300) % 2 === 0;
  BOARD.forEach((kind, i) => {
    const [x, y] = spaceAt(i);
    if (lit.has(i) && blink) g.frame(x - 12, y - 10, 24, 20, COLORS.gold, 1);
    g.sprite('party', SPACE_SPRITE[kind], x - 12, y - 9);
  });
}

// ----------------------------------------------------------- the pawns ----

function pawnSpot(ctx: Ctx, id: string, t: number): { x: number; y: number; hop: number; moving: boolean } {
  const a = ctx.anim;
  if (a && a.who === id && a.path.length) {
    const since = t - a.start - DIE_MS - DIE_HOLD_MS;
    const from = (a.path[0] - 1 + BOARD.length) % BOARD.length;
    if (since < 0) {
      const [x, y] = spaceAt(from);
      return { x, y, hop: 0, moving: true };
    }
    const step = Math.floor(since / HOP_MS);
    if (step < a.path.length) {
      const f = (since % HOP_MS) / HOP_MS;
      const [x0, y0] = spaceAt(step === 0 ? from : a.path[step - 1]);
      const [x1, y1] = spaceAt(a.path[step]);
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, hop: Math.sin(Math.PI * f) * 7, moving: true };
    }
  }
  const [x, y] = spaceAt(ctx.b.pos[id]);
  return { x, y, hop: 0, moving: false };
}

function drawPawns(g: Gfx, ctx: Ctx) {
  const { b } = ctx;
  const who = current(b);
  // pawns sharing a space stand side by side
  const at: Record<number, string[]> = {};
  const spots = b.order.map((id) => ({ id, ...pawnSpot(ctx, id, g.time) }));
  for (const s of spots) if (!s.moving) (at[b.pos[s.id]] ??= []).push(s.id);
  for (const s of spots) {
    if (s.moving) continue;
    const group = at[b.pos[s.id]];
    const k = group.indexOf(s.id);
    s.x += (k - (group.length - 1) / 2) * 7;
    s.y += (k % 2) * 3 - 2;
  }
  spots.sort((p, q) => p.y - q.y);
  for (const s of spots) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const bob = s.id === who && !s.moving ? (Math.floor(g.time / 350) % 2) : 0;
    g.rect(x - 5, y + 1, 10, 2, '#000000', 0.35);
    g.sprite('party', `pawn_${ctx.seatNo[s.id]}`, x - 8, y - 21 - Math.round(s.hop) - bob);
    if (s.id === who && !s.moving) {
      const ay = y - 30 - (Math.floor(g.time / 250) % 2);
      g.rect(x - 2, ay, 5, 1, COLORS.gold);
      g.rect(x - 1, ay + 1, 3, 1, COLORS.gold);
      g.rect(x, ay + 2, 1, 1, COLORS.gold);
    }
    if (s.id === ctx.v.me && !s.moving) g.text('YOU', x, y + 3, { size: 6, color: '#ffffff', align: 'center' });
  }
}

// ---------------------------------------------------------- score cards ----

const CARD_W = 112;
const CARD_H = 26;

function cardSpots(n: number): [number, number][] {
  const top = Math.ceil(n / 2);
  const row = (k: number, y: number) => {
    const total = k * CARD_W + (k - 1) * 6;
    return Array.from({ length: k }, (_, i): [number, number] => [Math.round((W - total) / 2) + i * (CARD_W + 6), y]);
  };
  return [...row(top, 2), ...row(n - top, H - CARD_H - 2)];
}

function drawCards(g: Gfx, { b, v, names, seatNo }: Ctx) {
  const who = current(b);
  const spots = cardSpots(b.order.length);
  const rank = Object.fromEntries(standings(b).map((p, i) => [p.id, i + 1]));
  b.order.forEach((id, i) => {
    const [x, y] = spots[i];
    g.panel('panel_night', x, y, CARD_W, CARD_H, 4);
    if (id === who) g.frame(x, y, CARD_W, CARD_H, COLORS.gold, 1);
    else if (id === v.me) g.frame(x, y, CARD_W, CARD_H, '#ffffff', 1);
    g.sprite('party', `head_${seatNo[id]}`, x + 4, y + 5);
    g.text(`${rank[id]}.`, x + 23, y + 3, { size: 7, color: COLORS.muted });
    g.text(names[id].slice(0, 11), x + 33, y + 3, { size: 8, color: id === who ? COLORS.gold : COLORS.ink });
    g.sprite('items', 'piece', x + 22, y + 12, { alpha: 1 });
    g.text(`${b.pieces[id]}`, x + 39, y + 14, { size: 8, color: COLORS.gold });
    g.sprite('icons', 'trophy', x + 62, y + 10);
    g.text(`${b.wins[id]}`, x + 79, y + 14, { size: 8, color: COLORS.ink });
    if (b.skip[id]) g.text('JAIL', x + CARD_W - 6, y + 14, { size: 7, color: COLORS.ruby, align: 'right' });
  });
}

// --------------------------------------------------- the middle of the yard ----

function drawCentre(g: Gfx, ctx: Ctx, myTurn: boolean) {
  const { b, v, names, seatNo, anim } = ctx;
  // round sign
  g.panel('panel_parchment', CX - 48, 66, 96, 17, 4);
  g.text(`ROUND ${Math.min(b.round, b.rounds)} / ${b.rounds}`, CX, 70, { size: 9, color: '#5e3a24', align: 'center', shadow: false });

  // the vault
  g.sprite('items', 'safe', 146, 100, { scale: 2 });
  g.text('VAULT', 162, 136, { size: 7, color: COLORS.muted, align: 'center' });
  g.text(`${b.vault}`, 162, 145, { size: 10, color: COLORS.emerald, align: 'center' });

  // the die: tumbling while a move starts, then the number rolled
  if (b.lastMove) {
    const tumbling = anim && g.time - anim.start < DIE_MS;
    const face = tumbling ? 1 + (Math.floor(g.time / 70) % 6) : b.lastMove.die;
    const dy = tumbling ? -Math.abs(Math.sin((g.time - anim!.start) / 70)) * 4 : 0;
    g.sprite('dice', `die_white_${face}`, 302, 104 + dy, { scale: 2 });
    if (!tumbling) g.text(`${names[b.lastMove.who]} rolled ${b.lastMove.die}`.slice(0, 18), 318, 140, { size: 7, color: COLORS.muted, align: 'center' });
  }

  // what's happening now
  const box = { x: CX - 44, y: 88, w: 88, h: 66 };
  if (v.stage === 'board') {
    const who = current(b);
    const left = v.leftMs === null ? '' : `${Math.ceil(v.leftMs / 1000)}s`;
    if (b.phase === 'duelPick' && myTurn && !anim) {
      const rivals = b.order.filter((id) => id !== who);
      const rows = Math.ceil(rivals.length / 2);
      const h = 22 + rows * 16;
      g.panel('panel_night', CX - 84, 88, 168, h, 4);
      g.text(`Duel! Pick a rival · ${left}`, CX, 93, { size: 8, color: COLORS.gold, align: 'center' });
      rivals.forEach((id, i) => {
        const bx = CX - 80 + (i % 2) * 82;
        const by = 106 + Math.floor(i / 2) * 16;
        g.button(`rival:${id}`, `${names[id]} (${b.pieces[id]})`.slice(0, 13), bx, by, 78, { color: 'red' });
      });
    } else if (who) {
      g.panel('panel_night', box.x, box.y, box.w, box.h, 4);
      g.sprite('party', `pawn_${seatNo[who]}`, CX - 16, box.y + 6, { scale: 2 });
      if (myTurn) {
        g.text(`Your turn · ${left}`, CX, box.y + 54, { size: 7, color: COLORS.gold, align: 'center' });
        g.button('roll', 'Roll the die', box.x - 6, box.y + box.h + 2, box.w + 12);
      } else {
        g.text(b.phase === 'duelPick' ? `${names[who]} picks a rival…` : `${names[who]} is rolling…`, CX, box.y + 56, { size: 7, color: COLORS.muted, align: 'center' });
      }
    }
  }

  // the latest thing that happened
  const last = b.notes[b.notes.length - 1];
  if (last) {
    g.panel('panel_parchment', CX - 110, 176, 220, 28, 4);
    wrap(g, yours(last.text, b, names), CX - 104, 179, 208, '#3a2216', 2);
  }
}

// ------------------------------------------------------------ overlays ----

function card(g: Gfx, title: string, h = 150) {
  g.rect(0, 0, W, H, COLORS.night, 0.65);
  g.panel('panel_parchment', 70, (H - h) / 2, W - 140, h, 4);
  g.text(title, W / 2, (H - h) / 2 + 10, { align: 'center', size: 12, color: '#5e3a24', shadow: false });
  return (H - h) / 2;
}

function heads(g: Gfx, ctx: Ctx, ids: string[], cx: number, y: number) {
  const total = ids.length * 20 - 4;
  ids.forEach((id, i) => g.sprite('party', `head_${ctx.seatNo[id]}`, cx - total / 2 + i * 20, y));
}

function drawIntro(g: Gfx, ctx: Ctx, pauseLeft: number | null) {
  const { v, names } = ctx;
  const n = v.next!;
  const top = card(g, `${v.practice ? 'Practice' : 'Next'}: ${n.label}`, 170);
  const kind = n.kind === 'duel' ? `Duel — ${n.seats.map((id) => names[id]).join(' vs ')}` : KIND_TEXT[n.kind];
  g.text(v.practice ? 'Practice round — nothing at stake, just learn the game' : kind, W / 2, top + 28, { align: 'center', size: 9, color: '#86192f', shadow: false });
  if (n.teams) {
    g.text('BLUE', 150, top + 48, { size: 8, color: '#22408e', shadow: false, align: 'right' });
    heads(g, ctx, n.teams[0], 240, top + 43);
    g.text('RED', 150, top + 68, { size: 8, color: '#86192f', shadow: false, align: 'right' });
    heads(g, ctx, n.teams[1], 240, top + 63);
  } else heads(g, ctx, n.seats, W / 2, top + 44);
  wrap(g, n.blurb, 90, top + 88, W - 180, '#3a2216', 3);
  const playing = v.me && n.seats.includes(v.me);
  g.text(playing ? `starts in ${pauseLeft ?? 0} s` : `you’re watching this one · ${pauseLeft ?? 0} s`, W / 2, top + 130, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  if (playing) {
    g.button('rules', 'Rules', W / 2 - 86, top + 144, 80);
    g.button('ready', 'Ready', W / 2 + 6, top + 144, 80);
  } else g.button('rules', 'Rules', W / 2 - 40, top + 144, 80);
}

function drawPayout(g: Gfx, ctx: Ctx, pauseLeft: number | null) {
  const { v, names, seatNo } = ctx;
  const l = v.last!;
  const h = 36 + l.results.length * 19 + 36;
  const top = card(g, l.practice ? 'Practice result' : l.kind === 'duel' ? 'Duel result' : 'Mini-game result', h);
  [...l.results].sort((a, b) => a.place - b.place).forEach((r, i) => {
    const y = top + 28 + i * 19;
    const d = (l.after[r.seat] ?? 0) - (l.before[r.seat] ?? 0);
    g.sprite('party', `head_${seatNo[r.seat]}`, 92, y);
    g.text(`${r.place}. ${names[r.seat]}`, 112, y + 5, { size: 8, color: '#3a2216', shadow: false });
    g.text(r.detail.slice(0, 28), 220, y + 5, { size: 7, color: '#5e3a24', shadow: false });
    g.text(d ? `${d > 0 ? '+' : ''}${d}` : '', W - 86, y + 5, { size: 9, color: d > 0 ? '#1b6a43' : '#86192f', shadow: false, align: 'right' });
  });
  g.text(l.practice ? `nothing at stake — the party starts in ${pauseLeft ?? 0} s` : `back to the board in ${pauseLeft ?? 0} s`, W / 2, top + h - 30, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
  g.button('ready', 'Ready', W / 2 - 40, top + h - 20, 80);
}

function drawWatching(g: Gfx, ctx: Ctx) {
  const m = ctx.v.mini?.match ?? ctx.b.match;
  const top = card(g, 'A duel is on', 84);
  if (m) heads(g, ctx, m.seats, W / 2, top + 26);
  g.text(m ? m.seats.map((id) => ctx.names[id]).join(' vs ') : '', W / 2, top + 48, { align: 'center', size: 10, color: '#86192f', shadow: false });
  g.text('the board carries on when it’s over', W / 2, top + 64, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
}

function drawFinal(g: Gfx, ctx: Ctx) {
  const { b, names, seatNo } = ctx;
  const order = standings(b);
  const h = 44 + order.length * 19 + 30;
  const top = card(g, 'Final result', h);
  order.forEach((p, i) => {
    const y = top + 28 + i * 19;
    g.sprite('party', `head_${seatNo[p.id]}`, 92, y);
    const tag = i === 0 ? ' — wins!' : i === order.length - 1 ? ' — goes to prison' : '';
    g.text(`${i + 1}. ${names[p.id]}${tag}`, 112, y + 5, { size: 8, color: i === order.length - 1 ? '#86192f' : '#3a2216', shadow: false });
    g.text(`${p.pieces} Pieces · ${p.wins} wins`, W - 86, y + 5, { size: 8, color: '#5e3a24', shadow: false, align: 'right' });
  });
  g.button('again', 'Play again', W / 2 - 45, top + h - 24, 90);
}

function wrap(g: Gfx, text: string, x: number, y: number, maxW: number, color: string, lines: number) {
  g.ctx.font = '8px "DotGothic16", monospace';
  let line = '';
  let row = 0;
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (g.ctx.measureText(test).width > maxW && line) {
      if (row >= lines - 1) break;
      g.text(line, x, y + row * 11, { size: 8, color, shadow: false });
      line = w;
      row++;
    } else line = test;
  }
  if (line) g.text(line, x, y + row * 11, { size: 8, color, shadow: false });
}

/** A note as I should read it: my own name becomes “You”. */
function yours(text: string, board: BoardState, names: Record<string, string>) {
  let t = text;
  for (const p of board.players) if (names[p.id] === 'You') t = t.split(p.name).join('You');
  return t;
}

// ---------------------------------------------------------------- log (DOM)

function PartyLog({ board, names }: { board: BoardState; names: Record<string, string> }) {
  return (
    <aside className="log">
      <h3>Party log</h3>
      <ol>
        {[...board.notes].reverse().slice(0, 40).map((n, i) => (
          <li key={board.notes.length - i}><em className={n.text.startsWith('—') ? 'win' : ''}>{yours(n.text, board, names)}</em></li>
        ))}
      </ol>
    </aside>
  );
}
