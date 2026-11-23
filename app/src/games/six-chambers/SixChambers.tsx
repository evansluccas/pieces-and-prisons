import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botAction } from './bots';
import {
  Action, ActionKind, COST, DEFAULT_CONFIG, GameState, NEEDS_PAIR, SEATS, TurnEvent, act, eventVisibleTo, fireThreshold,
  newGame, nextRound, pairOf, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 850;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'careful', portrait: 'officer' },
  { name: 'Jun', persona: 'pusher', portrait: 'journalist' },
  { name: 'Seo', persona: 'wild', portrait: 'fanatic' },
  { name: 'Mira', persona: 'careful', portrait: 'researcher' },
  { name: 'Taeo', persona: 'pusher', portrait: 'terrorist' },
];
const ACTIONS: { kind: ActionKind; label: string }[] = [
  { kind: 'peekPublic', label: 'Peek · everyone sees' },
  { kind: 'peekPrivate', label: 'Peek · only you see' },
  { kind: 'spin1', label: 'Spin 1 seat' },
  { kind: 'spin2', label: 'Spin 2 seats' },
  { kind: 'swap', label: 'Secret swap' },
];

export const RULES = [
  'Six seats surround a six-chamber cylinder; each chamber faces one seat. Two chambers are loaded at random. Empty seats are safe spots for a round to point at.',
  'Everyone starts each round with 16 credits. On your turn you MUST take one action and pay for it:',
  'Peek, everyone sees (1) · Peek, only you see (2) — look at the chambers facing a seat and its clockwise neighbour. Spin 1 seat (3) · Spin 2 seats (4) — turn the cylinder clockwise. Secret swap (6) — swap the chambers facing two neighbouring seats; others only see that you made a secret move.',
  'When half the table (rounded up) is out of credits, the cylinder fires: anyone facing a loaded chamber is knocked out of the round. Survivors score 1 point.',
  'MEMORY: nothing is written down. Each move — and what your peeks show — is announced once, as it happens. Keep track of the cylinder yourself. Most points after 3 rounds wins (ties: more credits saved). Last place goes to prison.',
];

// Dev-only: ?quick plays a 1-round match with 6 credits each.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, rounds: 1, credits: 6 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/**
 * Online play: the move clock, a hint line, the label on the "next" button,
 * and your own move held on screen for a moment after someone else moved.
 */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string; held?: TurnEvent }

/** What a click does (solo and online share this): the action being aimed, and a move once one is chosen. */
export function chambersClick(id: string, s: GameState, kind: ActionKind | null): { kind: ActionKind | null; action?: Action } {
  const me = s.players.find((p) => p.id === ME)!;
  if (s.phase !== 'turns' || s.turn !== ME) return { kind: null };
  if (id.startsWith('act:')) {
    const k = id.slice(4) as ActionKind;
    if (!(k in COST) || me.credits < COST[k]) return { kind };
    if (NEEDS_PAIR[k]) return { kind: kind === k ? null : k };
    return { kind: null, action: { kind: k } };
  }
  if (id.startsWith('seat:') && kind) return { kind: null, action: { kind, seat: Number(id.slice(5)) } };
  return { kind };
}

export function SixChambers({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [kind, setKind] = useState<ActionKind | null>(null);
  const firedAt = useRef(0);
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  const apply = (next: GameState) => {
    if (next.phase === 'fired' && s.phase !== 'fired') firedAt.current = performance.now();
    setGame((g) => ({ ...g, state: next }));
  };

  // bots take their turns with a short pause so you can follow
  useEffect(() => {
    if (s.phase !== 'turns' || !s.turn || s.turn === ME) return;
    const id = s.turn;
    // after your own move, wait longer so you can read (and memorise) what it showed
    const mine = s.events[s.events.length - 1]?.player === ME;
    const t = setTimeout(() => apply(act(s, id, botAction(s, id, persona(id), game.rng))), pace(mine ? BOT_DELAY * 2.5 : BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'next') return apply(nextRound(s, game.rng));
    if (id === 'again') {
      setKind(null);
      return setGame(setup(botCount));
    }
    const r = chambersClick(id, s, kind);
    setKind(r.kind);
    if (r.action) apply(act(s, ME, r.action));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, kind, g.time - firedAt.current)} onHit={onHit} />
      <ChamberLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- helpers

const seatPos = (k: number) => {
  const a = (-90 + k * 60) * (Math.PI / 180);
  return { x: Math.round(150 + 96 * Math.cos(a)), y: Math.round(146 + 76 * Math.sin(a)) };
};

function seatLabel(s: GameState, k: number) {
  const p = s.players.find((x) => x.seat === k);
  return p ? (p.id === ME ? 'You' : p.name) : `empty seat ${k + 1}`;
}

function pairLabel(s: GameState, seat: number) {
  const [a, b] = pairOf(seat);
  return `${seatLabel(s, a)} & ${seatLabel(s, b)}`;
}

export function describe(s: GameState, ev: TurnEvent, viewer = ME): string {
  const e = eventVisibleTo(ev, viewer);
  const who = e.player === viewer ? 'You' : s.players.find((p) => p.id === e.player)!.name;
  const res = (r: [boolean, boolean]) => `${r[0] ? 'LOADED' : 'empty'} / ${r[1] ? 'LOADED' : 'empty'}`;
  switch (e.kind) {
    case 'peekPublic':
      return `${who} peeked at ${pairLabel(s, e.seat!)}: ${res(e.result!)}`;
    case 'peekPrivate':
      return e.result ? `${who} privately peeked at ${pairLabel(s, e.seat!)}: ${res(e.result)}` : `${who} peeked privately (2)`;
    case 'spin1':
      return `${who} spun the cylinder 1 seat`;
    case 'spin2':
      return `${who} spun the cylinder 2 seats`;
    case 'swap':
      return e.seat !== undefined ? `${who} secretly swapped ${pairLabel(s, e.seat)}` : `${who} made a secret swap (6)`;
  }
}

// ---------------------------------------------------------------- drawing

export function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, kind: ActionKind | null, sinceFire: number, hud?: OnlineHud) {
  const fired = s.phase === 'fired' || s.phase === 'gameOver';
  const last = s.history[s.history.length - 1];
  const reveal = fired && sinceFire > pace(700);
  const me = s.players.find((p) => p.id === ME)!;
  const myTurn = s.phase === 'turns' && s.turn === ME;
  const broke = s.players.filter((p) => p.credits === 0).length;
  const need = fireThreshold(s.players.length);

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    { text: `fires at ${need} broke (${broke}/${need})`, color: broke >= need - 1 ? COLORS.ruby : COLORS.muted },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], 'SIX CHAMBERS');

  // nothing is tracked for you: chambers stay hidden until the cylinder fires
  const truth = fired && last ? last.chambers : null;

  // pair being targeted
  const hoverSeat = kind ? [...Array(SEATS).keys()].find((k) => g.isHover(`seat:${k}`)) : undefined;
  const target: number[] = hoverSeat !== undefined ? pairOf(hoverSeat) : [];

  // cylinder
  const shake = fired && !reveal ? (Math.floor(sinceFire / 50) % 2 ? 1 : -1) : 0;
  g.sprite('items', 'revolver_empty', 150 - 36 + shake, 146 - 36, { scale: 3 });
  for (let k = 0; k < SEATS; k++) {
    const a = (-90 + k * 60) * (Math.PI / 180);
    const cx = 150 + 18.6 * Math.cos(a) + shake;
    const cy = 146 + 18.6 * Math.sin(a);
    if (fired && !reveal) continue;
    if (truth?.[k]) g.sprite('items', 'bullet', Math.round(cx - 4), Math.round(cy - 8));
    else if (truth) g.frame(Math.round(cx - 4), Math.round(cy - 4), 8, 8, COLORS.emerald);
    if (target.includes(k)) g.frame(Math.round(cx - 6), Math.round(cy - 6), 12, 12, COLORS.gold);
  }
  if (fired && !reveal) g.text('BANG!', 150, 138, { align: 'center', size: 14, color: COLORS.ruby });

  // seats
  for (let k = 0; k < SEATS; k++) {
    const { x, y } = seatPos(k);
    const p = s.players.find((pl) => pl.seat === k);
    const id = `seat:${k}`;
    const targeted = target.includes(k);
    g.text(`${k + 1}`, x - 22, y - 18, { size: 7, color: COLORS.muted });
    if (p) {
      const isTurn = s.turn === p.id && s.phase === 'turns';
      const hit = fired && last?.hit.includes(p.id);
      g.sprite('portraits', meta[p.id], x - 16, y - 18, { scale: 2, alpha: reveal && hit ? 0.45 : 1 });
      if (reveal && hit) g.sprite('icons', 'skull', x - 8, y - 10);
      if (isTurn) g.frame(x - 18, y - 20, 36, 36, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0');
      g.text(p.id === ME ? 'You' : p.name, x, y + 16, { align: 'center', size: 8, color: p.id === ME ? COLORS.gold : COLORS.ink });
      g.text(`${p.credits}¢  ${p.points}★`, x, y + 25, { align: 'center', size: 7, color: p.credits === 0 ? COLORS.ruby : COLORS.muted });
    } else {
      g.sprite('icons', 'player', x - 8, y - 10, { alpha: 0.2 });
      g.text('empty', x, y + 8, { align: 'center', size: 7, color: COLORS.muted });
    }
    if (targeted) g.frame(x - 20, y - 22, 40, 56, COLORS.gold);
    if (kind && myTurn) g.hit(id, x - 20, y - 22, 40, 56);
  }

  // right panel: your actions
  const px = 302;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  g.text('YOUR CREDITS', px + 10, 38, { size: 7, color: COLORS.muted });
  g.text(`${me.credits}`, px + 10, 46, { size: 16, color: me.credits ? COLORS.gold : COLORS.ruby });
  g.text(myTurn ? 'YOUR TURN' : s.phase === 'turns' ? `${s.players.find((p) => p.id === s.turn)?.name ?? ''}'s turn…` : '', px + 70, 50, {
    size: 8, color: myTurn ? COLORS.emerald : COLORS.muted,
  });
  ACTIONS.forEach((a, i) => {
    const y = 70 + i * 19;
    const can = myTurn && me.credits >= COST[a.kind];
    g.button(`act:${a.kind}`, `${a.label}  (${COST[a.kind]})`, px + 8, y, 158, {
      disabled: !can, color: kind === a.kind ? 'red' : 'blue',
    });
  });

  let hint = '';
  if (myTurn && kind) hint = 'Click a seat: you target it + its clockwise neighbour';
  else if (myTurn) hint = 'Every turn costs credits — choose one action';
  else if (s.phase === 'turns' && me.credits === 0) hint = 'You are out of credits — waiting for the shot';
  if (hint) wrapText(g, hint, px + 10, 168, 150, COLORS.muted);

  // only the move that just happened — remember the rest yourself
  const lastMove = s.phase === 'turns' ? s.events[s.events.length - 1] : undefined;
  if (lastMove) {
    g.text('LAST MOVE', px + 10, 192, { size: 7, color: COLORS.muted });
    // online, your own move stays up a moment even if the next player was quick
    const held = hud?.held;
    wrapText(g, describe(s, lastMove), px + 10, 203, 156, COLORS.gold, held ? 2 : 4);
    if (held) {
      g.text('YOUR MOVE', px + 10, 222, { size: 7, color: COLORS.muted });
      wrapText(g, describe(s, held), px + 10, 233, 156, COLORS.gold, 2);
    }
  }

  if (fired && reveal && last) {
    const names = last.hit.map((id) => (id === ME ? 'You' : s.players.find((p) => p.id === id)!.name));
    const verb = names.length === 1 && names[0] !== 'You' ? 'is' : 'are';
    const msg = names.length ? `${names.join(' & ')} ${verb} knocked out` : 'Both rounds hit empty seats!';
    g.text(msg, 150, 262 - 4, { align: 'center', size: 9, color: COLORS.ruby });
    if (s.phase === 'fired') g.button('next', hud?.nextLabel ?? (s.round >= s.config.rounds ? 'Final result' : 'Next round'), px + 8, 246, 158);
    if (s.phase === 'fired' && hud?.sub) g.text(hud.sub, px + 10, 238, { size: 6, color: COLORS.muted });
  }

  if (s.phase === 'gameOver' && reveal) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.points}★  ${p.saved}¢ saved` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

function wrapText(g: Gfx, text: string, x: number, y: number, maxW: number, color: string, maxLines = 3) {
  g.ctx.font = '7px "DotGothic16", monospace';
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.ctx.measureText(test).width > maxW && line) {
      g.text(line, x, y + row * 8, { size: 7, color });
      line = w;
      if (++row >= maxLines) return;
    } else line = test;
  }
  if (line) g.text(line, x, y + row * 8, { size: 7, color });
}

// ---------------------------------------------------------------- log (DOM)

export function ChamberLog({ state }: { state: GameState }) {
  const rounds = [
    ...state.history.map((r) => ({ round: r.round, events: r.events, hit: r.hit, chambers: r.chambers as boolean[] | null })),
    ...(state.phase === 'turns' ? [{ round: state.round, events: state.events, hit: [] as string[], chambers: null }] : []),
  ].reverse();
  const name = (id: string) => (id === ME ? 'You' : state.players.find((p) => p.id === id)?.name ?? id);
  return (
    <aside className="log">
      <h3>Round log</h3>
      {state.phase !== 'gameOver' ? (
        <p className="sealed">Sealed until the match ends — remembering the moves is part of the game.</p>
      ) : (
        <p className="muted">Everything you saw this match. Secret moves show up as “secret”.</p>
      )}
      {state.phase === 'gameOver' && <ol>
        {rounds.map((r) => (
          <li key={r.round}>
            <b>Round {r.round}</b>
            {r.events.map((e, i) => <em key={i}>{describe(state, e)}</em>)}
            {r.chambers && (
              <em className="tip">
                Fired — loaded: {r.chambers.map((x, k) => (x ? seatLabel(state, k) : null)).filter(Boolean).join(' & ')}
                {' · '}{r.hit.length ? `${r.hit.map(name).join(' & ')} out` : 'nobody hit'}
              </em>
            )}
          </li>
        ))}
      </ol>}
    </aside>
  );
}
