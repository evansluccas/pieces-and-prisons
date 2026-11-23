import { useMemo } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { ONLINE_VIEWS } from '../../ui/Online';
import { topBar } from '../shared/draw';
import { BOARD, BoardState, SpaceKind, current, standings } from './logic';
import type { PartyView } from '../../../server/games/party';

const W = 480;
const H = 270;
const CELL = 28;
const STEP = 31;
const X0 = 12;
const Y0 = 34;

/** One colour per seat (in turn order), the same for everyone at the table. */
export const TOKEN = ['#70adf2', '#f2687a', '#6edd8c', '#f5cd5b', '#bf89ea', '#ff9f43', '#4dd0e1', '#f1e4c3'];

const SPACE: Record<SpaceKind, { fill: string; label: string; ink: string }> = {
  gate: { fill: '#c9a227', label: 'GO', ink: '#2a1b05' },
  blue: { fill: '#2f5fa8', label: '+3', ink: '#e6f0ff' },
  red: { fill: '#a33447', label: '−3', ink: '#ffe6ea' },
  event: { fill: '#6a3fa0', label: '?', ink: '#f3e6ff' },
  duel: { fill: '#c2651f', label: 'VS', ink: '#fff0e0' },
  prison: { fill: '#45434d', label: 'JAIL', ink: '#e0dde6' },
  vault: { fill: '#2f8a52', label: '$', ink: '#e6ffee' },
};

/** Where space `i` sits: a loop — along the top, down the right, back along the bottom, up the left. */
export function spaceAt(i: number): [number, number] {
  if (i <= 8) return [X0 + i * STEP, Y0];
  if (i <= 13) return [X0 + 8 * STEP, Y0 + (i - 8) * STEP];
  if (i <= 22) return [X0 + (22 - i) * STEP, Y0 + 6 * STEP];
  return [X0, Y0 + (28 - i) * STEP];
}

const KIND_TEXT = { ffa: 'Everyone for themselves', teams: 'Team blue vs team red', duel: 'Duel' } as const;

export function PartyOnline({ game, room, send, onAgain, error }: OnlineGameProps) {
  const v = game.view as PartyView;
  const b = v.board;
  const names = useMemo(() => Object.fromEntries(b.players.map((p) => [p.id, p.id === v.me ? 'You' : p.name])), [b.players, v.me]);
  const colour = useMemo(() => Object.fromEntries(b.order.map((id, i) => [id, TOKEN[i % TOKEN.length]])), [b.order]);

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
    const match = b.match;
    const team = match?.teams ? (match.teams[0].includes(v.me!) ? 'blue' : 'red') : null;
    return (
      <div className="party-mini">
        <p className="party-bar">
          <b>Party</b> · round {b.round}/{b.rounds} · <b>{v.mini.label}</b> — {match ? KIND_TEXT[match.kind] : ''}
          {team && <span className={`team ${team}`}> · you’re on team {team}</span>}
          {match?.kind === 'duel' && <span> · {match.seats.map((id) => names[id]).join(' vs ')}</span>}
        </p>
        {View && <View key={`${b.round}-${b.turn}-${v.mini.id}`} game={inner} room={room} send={relay} error={error} onAgain={() => undefined} />}
      </div>
    );
  }

  const me = v.me;
  const myTurn = v.stage === 'board' && current(b) === me;
  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id === 'ready') return send({ type: 'ready' });
    if (id === 'roll' && myTurn && b.phase === 'roll') send({ type: 'act', action: { type: 'roll' } });
    if (id.startsWith('rival:') && myTurn && b.phase === 'duelPick') send({ type: 'act', action: { type: 'duel', rival: id.slice(6) } });
  };

  const draw = (g: Gfx) => {
    const pauseLeft = game.pauseUntil ? Math.max(0, Math.ceil((game.pauseUntil - Date.now()) / 1000)) : null;
    drawBoard(g, b, v, names, colour);
    drawSide(g, b, v, names, colour, myTurn);
    if (v.stage === 'intro' && v.next) drawIntro(g, v, names, pauseLeft);
    else if (v.stage === 'payout' && v.last) drawPayout(g, v, names, colour, pauseLeft);
    else if (v.stage === 'mini' && v.mini && !v.mini.playing) drawWatching(g, b, names);
    else if (room.status === 'over' || v.stage === 'done') drawFinal(g, b, names, colour);
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <PartyLog board={b} names={names} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawBoard(g: Gfx, b: BoardState, v: PartyView, names: Record<string, string>, colour: Record<string, string>) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${b.round}/${b.rounds}`, color: COLORS.gold },
    { text: `vault ${b.vault}`, color: COLORS.emerald },
  ], 'PARTY');
  // the yard in the middle
  g.panel('panel_parchment', X0 + STEP, Y0 + STEP, 7 * STEP - 3, 5 * STEP - 3, 4);
  g.text('THE YARD', X0 + STEP + (7 * STEP - 3) / 2, Y0 + STEP + 8, { align: 'center', size: 9, color: '#5e3a24', shadow: false });
  const last = b.notes[b.notes.length - 1];
  if (last) wrap(g, yours(last.text, b, names), X0 + STEP + 8, Y0 + STEP + 24, 7 * STEP - 20, '#3a2216', 4);

  // the path of the last move, then the spaces
  const path = new Set(b.lastMove?.path ?? []);
  BOARD.forEach((kind, i) => {
    const [x, y] = spaceAt(i);
    const s = SPACE[kind];
    g.rect(x, y, CELL, CELL, s.fill);
    g.frame(x, y, CELL, CELL, path.has(i) && Math.floor(g.time / 350) % 2 ? COLORS.gold : '#1b1233', path.has(i) ? 2 : 1);
    g.text(s.label, x + CELL / 2, y + 3, { align: 'center', size: kind === 'prison' ? 6 : 8, color: s.ink, shadow: false });
  });
  // tokens: up to four per space, in a little grid
  const at: Record<number, string[]> = {};
  for (const id of b.order) (at[b.pos[id]] ??= []).push(id);
  for (const [i, ids] of Object.entries(at)) {
    const [x, y] = spaceAt(Number(i));
    ids.slice(0, 8).forEach((id, k) => {
      const tx = x + 2 + (k % 4) * 6;
      const ty = y + 14 + Math.floor(k / 4) * 6;
      g.rect(tx, ty, 6, 6, '#120c22');
      g.rect(tx + 1, ty + 1, 4, 4, colour[id]);
      if (id === v.me) g.frame(tx - 1, ty - 1, 8, 8, '#ffffff');
    });
  }
}

function drawSide(g: Gfx, b: BoardState, v: PartyView, names: Record<string, string>, colour: Record<string, string>, myTurn: boolean) {
  const sx = 296;
  g.panel('panel_night', sx, 30, W - sx - 4, 236, 4);
  const who = current(b);
  // standings
  g.text('PIECES', sx + 10, 36, { size: 7, color: COLORS.muted });
  g.text('WINS', W - 14, 36, { size: 7, color: COLORS.muted, align: 'right' });
  standings(b).forEach((p, i) => {
    const y = 48 + i * 13;
    g.rect(sx + 10, y + 1, 6, 6, colour[p.id]);
    const label = `${names[p.id]}${b.skip[p.id] ? ' (jail)' : ''}`;
    g.text(label.slice(0, 14), sx + 20, y, { size: 8, color: p.id === who ? COLORS.gold : p.id === v.me ? '#ffffff' : COLORS.ink });
    g.text(`${p.pieces}`, sx + 120, y, { size: 8, color: COLORS.gold, align: 'right' });
    g.text(`${p.wins}`, W - 14, y, { size: 8, color: COLORS.muted, align: 'right' });
  });
  const y0 = 48 + b.order.length * 13 + 6;
  if (v.stage !== 'board') return;
  const left = v.leftMs === null ? '' : ` · ${Math.ceil(v.leftMs / 1000)}s`;
  if (b.phase === 'roll') {
    if (myTurn) {
      g.text(`Your turn${left}`, sx + 10, y0, { size: 9, color: COLORS.gold });
      g.button('roll', 'Roll the die', sx + 10, y0 + 14, W - sx - 24);
    } else g.text(`${names[who!]} is rolling…`, sx + 10, y0, { size: 8, color: COLORS.muted });
  } else if (b.phase === 'duelPick') {
    if (myTurn) {
      g.text(`Duel! Pick a rival${left}`, sx + 10, y0, { size: 8, color: COLORS.gold });
      b.order.filter((id) => id !== who).forEach((id, i) => {
        const bx = sx + 10 + (i % 2) * 86;
        const by = y0 + 12 + Math.floor(i / 2) * 18;
        g.button(`rival:${id}`, `${names[id]} (${b.pieces[id]})`.slice(0, 13), bx, by, 82, { color: 'red' });
      });
    } else g.text(`${names[who!]} is picking a rival…`, sx + 10, y0, { size: 8, color: COLORS.muted });
  }
}

function card(g: Gfx, title: string, h = 150) {
  g.rect(0, 0, W, H, COLORS.night, 0.65);
  g.panel('panel_parchment', 70, (H - h) / 2, W - 140, h, 4);
  g.text(title, W / 2, (H - h) / 2 + 10, { align: 'center', size: 12, color: '#5e3a24', shadow: false });
  return (H - h) / 2;
}

function drawIntro(g: Gfx, v: PartyView, names: Record<string, string>, pauseLeft: number | null) {
  const n = v.next!;
  const top = card(g, `Next: ${n.label}`);
  g.text(n.kind === 'duel' ? `Duel — ${n.seats.map((id) => names[id]).join(' vs ')}` : KIND_TEXT[n.kind], W / 2, top + 30, { align: 'center', size: 9, color: '#86192f', shadow: false });
  if (n.teams) {
    g.text(`Blue: ${n.teams[0].map((id) => names[id]).join(', ')}`, W / 2, top + 46, { align: 'center', size: 8, color: '#2f5fa8', shadow: false });
    g.text(`Red: ${n.teams[1].map((id) => names[id]).join(', ')}`, W / 2, top + 58, { align: 'center', size: 8, color: '#a33447', shadow: false });
  }
  wrap(g, n.blurb, 90, top + 76, W - 180, '#3a2216', 3);
  const playing = v.me && n.seats.includes(v.me);
  g.text(playing ? `starts in ${pauseLeft ?? 0} s` : `you’re watching this one · ${pauseLeft ?? 0} s`, W / 2, top + 114, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  if (playing) g.button('ready', 'Ready', W / 2 - 40, top + 126, 80);
}

function drawPayout(g: Gfx, v: PartyView, names: Record<string, string>, colour: Record<string, string>, pauseLeft: number | null) {
  const l = v.last!;
  const h = 40 + l.results.length * 13 + 40;
  const top = card(g, l.kind === 'duel' ? 'Duel result' : 'Mini-game result', h);
  [...l.results].sort((a, b) => a.place - b.place).forEach((r, i) => {
    const y = top + 30 + i * 13;
    const d = (l.after[r.seat] ?? 0) - (l.before[r.seat] ?? 0);
    g.rect(96, y + 1, 6, 6, colour[r.seat]);
    g.text(`${r.place}. ${names[r.seat]}`, 106, y, { size: 8, color: '#3a2216', shadow: false });
    g.text(r.detail.slice(0, 28), 230, y, { size: 7, color: '#5e3a24', shadow: false });
    g.text(d ? `${d > 0 ? '+' : ''}${d}` : '', W - 86, y, { size: 8, color: d > 0 ? '#1b6a43' : '#86192f', shadow: false, align: 'right' });
  });
  g.text(`back to the board in ${pauseLeft ?? 0} s`, W / 2, top + h - 30, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
  g.button('ready', 'Ready', W / 2 - 40, top + h - 20, 80);
}

function drawWatching(g: Gfx, b: BoardState, names: Record<string, string>) {
  const m = b.match;
  const top = card(g, 'A duel is on', 70);
  g.text(m ? m.seats.map((id) => names[id]).join(' vs ') : '', W / 2, top + 30, { align: 'center', size: 10, color: '#86192f', shadow: false });
  g.text('the board carries on when it’s over', W / 2, top + 48, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
}

function drawFinal(g: Gfx, b: BoardState, names: Record<string, string>, colour: Record<string, string>) {
  const order = standings(b);
  const h = 50 + order.length * 14 + 30;
  const top = card(g, 'Final result', h);
  order.forEach((p, i) => {
    const y = top + 30 + i * 14;
    g.rect(96, y + 1, 6, 6, colour[p.id]);
    const tag = i === 0 ? ' — wins!' : i === order.length - 1 ? ' — goes to prison' : '';
    g.text(`${i + 1}. ${names[p.id]}${tag}`, 106, y, { size: 8, color: i === order.length - 1 ? '#86192f' : '#3a2216', shadow: false });
    g.text(`${p.pieces} Pieces · ${p.wins} wins`, W - 86, y, { size: 8, color: '#5e3a24', shadow: false, align: 'right' });
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
  const rename = (text: string) => yours(text, board, names);
  return (
    <aside className="log">
      <h3>Party log</h3>
      <ol>
        {[...board.notes].reverse().slice(0, 40).map((n, i) => (
          <li key={board.notes.length - i}><em className={n.text.startsWith('—') ? 'win' : ''}>{rename(n.text)}</em></li>
        ))}
      </ol>
    </aside>
  );
}
