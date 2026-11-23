import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botTurn } from './bots';
import {
  BUYER, Card, DEFAULT_CONFIG, DISCARD, GameState, TurnEvent, canSwapWith, cardName, cardSprite, currentTurn,
  newGame, nextRound, pass, peek, standings, swap, visibleEvent,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 900;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'sharp', portrait: 'officer' },
  { name: 'Jun', persona: 'greedy', portrait: 'journalist' },
  { name: 'Seo', persona: 'loose', portrait: 'fanatic' },
  { name: 'Mira', persona: 'sharp', portrait: 'researcher' },
  { name: 'Taeo', persona: 'greedy', portrait: 'terrorist' },
];
const KIND_INK: Record<Card['kind'], string> = { diamond: '#c8e8ff', gold: '#f5cd5b', silver: '#d3d9ea', copper: '#e89a5e', bomb: '#f2687a' };

export const RULES = [
  'Each round the cards in play are ANNOUNCED (listed on the table): two bombs (−6, −4) plus gem cards. They are dealt face down — 1 to each player, 3 to the BUYER row, 1 to the DISCARD. You only see your own card.',
  'EXCHANGES: everyone gets two turns (first → last, then back). On your turn click a card to SWAP yours with it blindly — another player’s, a Buyer card or the Discard — or PASS. A bomb can only go to another player.',
  'MEMORY: everyone sees who swapped with what, never the cards. Nothing is written down — each move is announced once. Remember what you gave, got and peeked, and follow where those cards travel.',
  'PEEK: once per match, look at one Buyer or Discard card without using your turn.',
  'SCORING: the Buyer row is revealed. Your gem scores its value × the number of Buyer cards of the same kind (no match = 0). A bomb costs its value. The −6 holder starts next round.',
  'SECRET PARTNER: your partner’s total is added to yours at the end. 3 rounds; highest final score wins, last place goes to prison.',
];

// Dev-only: ?quick plays a single round.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { rounds: 1 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function SmugglersGems({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [peeking, setPeeking] = useState(false);
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  useEffect(() => {
    const id = currentTurn(s);
    if (!id || id === ME) return;
    const t = setTimeout(() => {
      setGame((g) => {
        const st = g.state;
        if (currentTurn(st) !== id) return g;
        const a = botTurn(st, id, persona(id), g.rng);
        let next = a.kind === 'pass' ? pass(st, id) : a.kind === 'peek' ? peek(st, id, a.target) : swap(st, id, a.target);
        // a peek doesn't use the turn: take the real action right away
        if (a.kind === 'peek') {
          const b = botTurn(next, id, persona(id), g.rng);
          next = b.kind === 'swap' ? swap(next, id, b.target) : pass(next, id);
        }
        return { ...g, state: next };
      });
    }, pace(s.events[s.events.length - 1]?.player === ME ? BOT_DELAY * 2.5 : BOT_DELAY)); // time to read your own result
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'again') {
      setPeeking(false);
      return setGame(setup(botCount));
    }
    if (id === 'next') return setGame((g) => ({ ...g, state: nextRound(g.state, g.rng) }));
    const r = gemClick(id, s, peeking);
    setPeeking(r.peeking);
    const a = r.action;
    if (a) setGame((g) => ({ ...g, state: a.type === 'pass' ? pass(g.state, ME) : a.type === 'peek' ? peek(g.state, ME, a.target) : swap(g.state, ME, a.target) }));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, peeking)} onHit={onHit} />
      <GemLog state={s} />
    </div>
  );
}

export type GemAction = { type: 'pass' } | { type: 'swap'; target: string } | { type: 'peek'; target: string };

/** What a click does (solo and online share this): the new peek mode, and a move once one is chosen. */
export function gemClick(id: string, s: GameState, peeking: boolean): { peeking: boolean; action?: GemAction } {
  if (currentTurn(s) !== ME) return { peeking };
  if (id === 'pass') return { peeking, action: { type: 'pass' } };
  if (id === 'peek') return { peeking: !peeking };
  if (id.startsWith('loc:')) {
    const target = id.slice(4);
    return peeking ? { peeking: false, action: { type: 'peek', target } } : { peeking, action: { type: 'swap', target } };
  }
  return { peeking };
}

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/** Online play: the move clock, a hint line and the label on the "next" button. */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string }

// ---------------------------------------------------------------- drawing

const locName = (s: GameState, loc: string) =>
  loc === DISCARD ? 'the Discard' : loc.startsWith('buyer') ? `Buyer ${Number(loc.slice(5)) + 1}` : loc === ME ? 'you' : s.players.find((p) => p.id === loc)?.name ?? loc;

function drawCardAt(g: Gfx, loc: string, x: number, y: number, face: Card | null, clickable: boolean, peekMode: boolean) {
  const id = `loc:${loc}`;
  const hover = clickable && g.isHover(id);
  g.sprite('cards', face ? cardSprite(face) : 'back', x, y - (hover ? 2 : 0));
  if (clickable) {
    g.hit(id, x, y - 2, 32, 46);
    g.frame(x - 1, y - 1 - (hover ? 2 : 0), 34, 46, hover ? COLORS.gold : peekMode ? COLORS.sapphire : '#f5cd5b55');
  }
}

export function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, peeking: boolean, hud?: OnlineHud) {
  const turn = currentTurn(s);
  const myTurn = turn === ME;
  const reveal = s.phase === 'reveal' || s.phase === 'gameOver';
  const last = s.history[s.history.length - 1];
  // only your own card is face up; everything else you have to remember
  const faceOf = (loc: string) => (reveal ? last?.hands[loc] ?? s.hands[loc] : loc === ME ? s.hands[ME] : null);
  const me = s.players.find((p) => p.id === ME)!;
  const partner = s.players.find((p) => p.id === me.partner)!;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    hud?.clock
      ? { text: hud.clock, color: COLORS.ruby }
      : { text: s.phase === 'exchange' ? `turn ${s.turnIdx + 1}/${s.order.length}` : 'reveal', color: COLORS.muted },
  ], "SMUGGLER'S GEMS");

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const x0 = Math.round(4 + slot * i + 4);
    const w = Math.round(slot - 8);
    g.panel('panel_parchment', x0, 30, w, 68, 4);
    if (turn === p.id) g.frame(x0 - 1, 29, w + 2, 70, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.text(p.name, x0 + 6, 34, { size: 8, color: '#3a2216', shadow: false });
    g.sprite('portraits', meta[p.id], x0 + 4, 46, { scale: 2 });
    const can = myTurn && !peeking && canSwapWith(s, ME, p.id);
    drawCardAt(g, p.id, x0 + w - 38, 38, faceOf(p.id), can, false);
    g.text(`${p.total} pts`, x0 + 6, 84, { size: 7, color: '#5e3a24', shadow: false });
    if (reveal && last) {
      const sc = last.scores[p.id];
      g.text(`${sc >= 0 ? '+' : ''}${sc}`, x0 + w - 22, 86, { align: 'center', size: 8, color: sc < 0 ? '#86192f' : '#1b6a43', shadow: false });
    }
  });

  // buyer row + discard
  g.text('BUYER ROW', 12, 103, { size: 7, color: COLORS.gold });
  BUYER.forEach((b, i) => {
    const can = myTurn && (peeking ? !me.peeked : canSwapWith(s, ME, b));
    drawCardAt(g, b, 12 + i * 36, 112, faceOf(b), can, peeking);
  });
  g.text('DISCARD', 130, 103, { size: 7, color: COLORS.muted });
  const canD = myTurn && (peeking ? !me.peeked : canSwapWith(s, ME, DISCARD));
  drawCardAt(g, DISCARD, 130, 112, faceOf(DISCARD), canD, peeking);

  // public card list
  g.panel('panel_night', 172, 100, W - 176, 58, 4);
  g.text("THIS ROUND'S CARDS (everyone knows)", 180, 106, { size: 7, color: COLORS.muted });
  let cx = 180;
  let cy = 118;
  for (const c of s.deck) {
    const label = cardName(c);
    g.ctx.font = '8px "DotGothic16", monospace';
    const w = g.ctx.measureText(label).width + 8;
    if (cx + w > W - 10) {
      cx = 180;
      cy += 12;
    }
    g.text(label, cx, cy, { size: 8, color: KIND_INK[c.kind] });
    cx += w;
  }

  // message
  let msg = '';
  let sub = '';
  if (s.phase === 'exchange') {
    msg = myTurn ? (peeking ? 'Peek: click a Buyer or Discard card' : 'Your turn — click a card to swap, or Pass') : `${locName(s, turn!)}'s turn…`;
    // only the move that just happened — remember the rest yourself
    const e = s.events[s.events.length - 1];
    if (e) sub = `last move: ${describe(s, e)}`;
    else if (myTurn) sub = 'swaps are blind — you only see what you get';
  } else if (reveal && last) {
    const buyer = BUYER.map((b) => last.hands[b]);
    msg = `Buyer wants: ${buyer.map(cardName).join(' · ')}`;
    sub = `You scored ${last.scores[ME]} with ${cardName(last.hands[ME])}`;
  }
  if (msg) g.text(msg, 172, 162, { size: 9, color: COLORS.gold });
  if (sub) g.text(sub, 172, 174, { size: 7, color: COLORS.muted });

  // your panel
  g.panel('panel_night', 4, 186, W - 8, 80, 4);
  const mine = reveal && last ? last.hands[ME] : s.hands[ME];
  g.sprite('cards', cardSprite(mine), 14, 194);
  g.sprite('portraits', meta[ME], 52, 196, { scale: 2 });
  if (myTurn) g.frame(13, 193, 34, 46, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0');
  g.text(`Your card: ${cardName(mine)}`, 92, 196, { size: 9, color: KIND_INK[mine.kind] });
  g.text(
    mine.kind === 'bomb' ? `costs ${mine.value} — pass it to a player!` : `scores ${mine.value} × each ${mine.kind} in the Buyer row`,
    92, 208, { size: 7, color: COLORS.muted },
  );
  g.text(`Secret partner: ${partner.name} (their total adds to yours)`, 92, 232, { size: 7, color: COLORS.amethyst });
  g.text(`Your total: ${me.total}  ·  partner: ${partner.total}`, 92, 244, { size: 8, color: COLORS.ink });

  if (s.phase === 'exchange') {
    g.button('pass', 'Pass', 392, 206, 80, { disabled: !myTurn });
    g.button('peek', peeking ? 'Cancel peek' : me.peeked ? 'Peek used' : 'Peek (once)', 392, 228, 80, {
      disabled: !myTurn || me.peeked, color: peeking ? 'red' : 'blue',
    });
  } else if (s.phase === 'reveal') {
    g.button('next', hud?.nextLabel ?? (s.round >= s.config.rounds ? 'Final result' : 'Next round'), 392, 244, 80);
    if (hud?.sub) g.text(hud.sub, 392, 236, { size: 6, color: COLORS.muted });
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.total} + ${p.final - p.total} partner = ${p.final}` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

function describe(s: GameState, ev: TurnEvent): string {
  const e = visibleEvent(ev, ME);
  const who = e.player === ME ? 'You' : locName(s, e.player);
  if (e.kind === 'pass') return `${who} passed`;
  if (e.kind === 'peek') return e.seen ? `${who} peeked at ${locName(s, e.target!)}: ${cardName(e.seen)}` : `${who} used their peek`;
  if (e.gave && e.got) {
    if (e.player === ME) return `You swapped with ${locName(s, e.target!)}: gave ${cardName(e.gave)}, got ${cardName(e.got)}`;
    return `${who} swapped with you: you gave ${cardName(e.got)}, got ${cardName(e.gave)}`;
  }
  return `${who} swapped with ${locName(s, e.target!)}`;
}

// ---------------------------------------------------------------- log (DOM)

export function GemLog({ state }: { state: GameState }) {
  const over = state.phase === 'gameOver';
  const name = (id: string) => locName(state, id);
  return (
    <aside className="log">
      <h3>Smuggling log</h3>
      {over ? (
        <p className="muted">Match over — every move you saw, and the partners.</p>
      ) : (
        <p className="sealed">Sealed until the match ends — remembering the swaps is part of the game.</p>
      )}
      {over && (
        <p className="muted">
          {state.players.map((p) => `${p.id === ME ? 'You' : p.name} → ${name(p.partner)}`).join(' · ')}
        </p>
      )}
      {over && <ol>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>Round {r.round} result</b>
            <em>Buyer: {BUYER.map((b) => cardName(r.hands[b])).join(' · ')}</em>
            {r.events.map((e, i) => <em key={`e${i}`}>{describe(state, e)}</em>)}
            {state.players.map((p) => (
              <em key={p.id} className={r.scores[p.id] < 0 ? 'tip' : r.scores[p.id] > 0 ? 'win' : ''}>
                {p.id === ME ? 'You' : p.name}: {cardName(r.hands[p.id])} → {r.scores[p.id] >= 0 ? '+' : ''}{r.scores[p.id]}
              </em>
            ))}
          </li>
        ))}
      </ol>}
    </aside>
  );
}

