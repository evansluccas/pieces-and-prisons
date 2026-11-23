import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botAct, botSnipe } from './bots';
import { CATEGORIES, Card, bestHand, cardSprite, cardText, handName, rankName } from './cards';
import {
  Action, DEFAULT_CONFIG, GameState, Snipe, act, betSize, currentTurn, legalActions, newGame, nextHand, pot, snipe, snipeName,
  snipers, standings,
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
const STREET = ['before the flop', 'three cards out', 'four cards out'];

export const RULES = [
  'Poker with a twist. Everyone starts with 60 chips; 75 is the SAFE line. 10 hands.',
  'Each hand: ante 1, get 2 private cards. Only FOUR shared cards come out (3, then 1). Your hand is the best five of your six cards.',
  'BETTING (fixed): check, bet, call, raise or fold. Bets are 2 chips in the first two rounds and 4 in the last; at most 3 raises a round. Short on chips? You go all-in and can only win what you matched.',
  'SNIPE: after the last round, everyone still in secretly names one exact hand — like “Flush, A-high” or “Pair of 9s” — or passes. Any hand that matches a snipe CAN’T WIN the showdown.',
  'The best un-sniped hand takes the pot; if every hand was sniped, the pot carries over. Most chips after 10 hands wins; fewest goes to prison.',
];

// Dev-only: ?quick plays 3 hands.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(1, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, hands: 3 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function DeadeyeHoldem({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [aim, setAim] = useState<Snipe>({ cat: 1, key: 14 });
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;
  const set = (fn: (st: GameState) => GameState) => setGame((g) => ({ ...g, state: fn(g.state) }));

  // bots bet one at a time; at the snipe they all choose together
  useEffect(() => {
    const turn = currentTurn(s);
    const botSnipers = snipers(s).filter((id) => id !== ME);
    if (!(turn && turn !== ME) && !botSnipers.length) return;
    const t = setTimeout(() => {
      setGame((g) => {
        let st = g.state;
        const who = currentTurn(st);
        if (who && who !== ME) st = act(st, who, botAct(st, who, persona(who), g.rng));
        else for (const id of snipers(st).filter((x) => x !== ME)) if (st.phase === 'snipe') st = snipe(st, id, botSnipe(st, id, g.rng));
        return { ...g, state: st };
      });
    }, pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  const onHit = (id: string) => {
    if (id === 'again') return setGame(setup(botCount));
    if (id === 'next') return set((st) => nextHand(st, game.rng));
    if (id.startsWith('act:')) return set((st) => act(st, ME, id.slice(4) as Action));
    if (id.startsWith('cat:')) return setAim((a) => ({ ...a, cat: Number(id.slice(4)) }));
    if (id.startsWith('key:')) return setAim((a) => ({ ...a, key: Number(id.slice(4)) }));
    if (id === 'snipe') return set((st) => snipe(st, ME, aim));
    if (id === 'pass') return set((st) => snipe(st, ME, null));
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, aim)} onHit={onHit} />
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

function card(g: Gfx, c: Card | null, x: number, y: number, dim = false) {
  g.sprite('cards', c ? cardSprite(c) : 'back', x, y, { alpha: dim ? 0.45 : 1 });
}

/** Online play: the move clock, a hint line and the label on the "next" button. */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string }

export function drawScene(g: Gfx, s: GameState, aim: Snipe, hud?: OnlineHud) {
  const res = s.phase === 'result' || s.phase === 'gameOver' ? s.results[s.results.length - 1] : null;
  const board = res ? res.board : s.board;
  const me = s.players.find((p) => p.id === ME)!;
  const turn = currentTurn(s);

  g.tile('board', 'tile_night', 0, 0, W, H);
  g.rect(110, 100, 260, 62, '#16402a', 0.85);
  g.frame(110, 100, 260, 62, '#5e3a24', 2);
  topBar(g, [
    { text: `HAND ${s.hand}/${s.config.hands}`, color: COLORS.gold },
    { text: res ? 'showdown' : s.phase === 'snipe' ? 'SNIPE' : STREET[s.street], color: s.phase === 'snipe' ? COLORS.ruby : COLORS.muted },
    { text: `pot ${res ? Object.values(res.winnings).reduce((a, b) => a + b, 0) + res.carried : pot(s)}`, color: COLORS.ink },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], "DEADEYE HOLD'EM");

  // opponents
  const opps = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opps.length;
  opps.forEach((p, i) => {
    const x0 = Math.round(4 + slot * i + 3);
    const w = Math.round(slot - 6);
    g.panel('panel_parchment', x0, 30, w, 66, 4);
    if (turn === p.id) g.frame(x0 - 1, 29, w + 2, 68, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.text(p.name, x0 + 5, 33, { size: 8, color: '#3a2216', shadow: false });
    const dealer = s.players[s.dealer].id === p.id;
    if (dealer) g.text('D', x0 + w - 8, 33, { size: 7, color: '#86192f', shadow: false });
    const shown = res?.holes[p.id];
    if (!p.out) {
      card(g, shown ? shown[0] : null, x0 + 4, 44, p.folded && !shown);
      card(g, shown ? shown[1] : null, x0 + 16, 44, p.folded && !shown);
    }
    const tx = x0 + 52;
    g.text(`${p.chips}`, tx, 46, { size: 9, color: p.chips >= s.config.safe ? '#1b6a43' : '#3a2216', shadow: false });
    let status = p.out ? 'out' : p.folded ? 'folded' : res ? '' : s.phase === 'snipe' ? (p.snipe === undefined ? 'aiming…' : 'ready') : lastAction(s, p.id);
    if (res && res.values[p.id]) status = handName(res.values[p.id]);
    g.text(status, tx, 58, { size: 7, color: '#86192f', shadow: false });
    if (res && res.sniped.includes(p.id)) g.text('SNIPED', tx, 68, { size: 7, color: '#86192f', shadow: false });
    if (res && res.winnings[p.id]) g.text(`+${res.winnings[p.id]}`, tx, 80, { size: 9, color: '#1b6a43', shadow: false });
    else if (!res && p.streetBet) g.text(`in ${p.streetBet}`, tx, 80, { size: 7, color: '#5e3a24', shadow: false });
  });

  // board
  for (let k = 0; k < 4; k++) card(g, board[k] ?? null, 160 + k * 38, 109, !board[k]);
  g.text(`pot ${res ? '' : pot(s)}`, 118, 106, { size: 8, color: COLORS.gold });
  if (s.carry && !res) g.text(`(+${s.carry} carried)`, 118, 118, { size: 7, color: COLORS.muted });

  // your seat
  g.panel('panel_night', 4, 166, W - 8, 100, 4);
  if (!me.out) {
    card(g, me.hole[0] ?? null, 12, 174, me.folded);
    card(g, me.hole[1] ?? null, 48, 174, me.folded);
  }
  g.text(`${me.chips} chips`, 12, 224, { size: 10, color: me.chips >= s.config.safe ? COLORS.emerald : COLORS.gold });
  g.text(me.chips >= s.config.safe ? 'SAFE' : `${s.config.safe - me.chips} to safe`, 12, 238, { size: 7, color: COLORS.muted });
  if (s.players[s.dealer].id === ME) g.text('dealer', 12, 250, { size: 7, color: COLORS.ruby });
  const now = me.hole.length && !me.folded ? bestHand([...me.hole, ...board]) : null;
  const px = 90;
  if (now) g.text(`you have: ${handName(now)}`, px, 172, { size: 8, color: COLORS.ink });

  if (s.phase === 'bet') {
    if (turn === ME) {
      g.text(`Your move — bets are ${betSize(s)} this round`, px, 186, { size: 9, color: COLORS.gold });
      legalActions(s, ME).forEach((a, i) => {
        const label = a.action === 'fold' || a.action === 'check' ? cap(a.action) : `${cap(a.action)} ${a.amount}`;
        g.button(`act:${a.action}`, label, px + i * 92, 204, 86, { color: a.action === 'fold' ? 'red' : 'blue' });
      });
    } else {
      g.text(me.folded ? 'You folded — watching' : turn ? `${nameOf(s, turn)} is thinking…` : '', px, 186, { size: 9, color: COLORS.muted });
    }
  } else if (s.phase === 'snipe') {
    if (me.snipe === undefined && !me.folded && !me.out) {
      g.text('SNIPE one exact hand — it can’t win', px, 184, { size: 8, color: COLORS.ruby });
      CATEGORIES.forEach((name, i) => {
        const x = px + (i % 5) * 76;
        const y = 196 + Math.floor(i / 5) * 16;
        g.button(`cat:${i}`, name, x, y, 72, { color: aim.cat === i ? 'red' : 'blue' });
      });
      for (let r = 2; r <= 14; r++) {
        const x = px + (r - 2) * 18;
        g.button(`key:${r}`, rankName(r), x, 230, 17, { color: aim.key === r ? 'red' : 'blue' });
      }
      g.button('snipe', `Snipe: ${snipeName(aim)}`, px, 248, 196, { color: 'red' });
      g.button('pass', 'No snipe', px + 202, 248, 80);
    } else {
      g.text(me.snipe ? `You aim at: ${snipeName(me.snipe)}` : 'Waiting for the others to aim…', px, 186, { size: 9, color: COLORS.muted });
    }
  } else if (res) {
    const winners = Object.entries(res.winnings).filter(([, v]) => v > 0);
    const headline = res.foldWin
      ? `${nameOf(s, res.foldWin)} ${res.foldWin === ME ? 'win' : 'wins'} — everyone else folded`
      : winners.length
        ? winners.map(([id, v]) => `${nameOf(s, id)} +${v}`).join(' · ')
        : 'Every hand was sniped — the pot carries over';
    g.text(headline, px, 186, { size: 9, color: COLORS.gold });
    const shots = Object.entries(res.snipes).filter(([, t]) => t);
    shots.slice(0, 5).forEach(([id, t], i) => {
      const hit = Object.entries(res.values).some(([, v]) => v.cat === t!.cat && v.key === t!.key);
      g.text(`${nameOf(s, id)} sniped ${snipeName(t!)}${hit ? ' — HIT' : ''}`, px, 200 + i * 10, { size: 7, color: hit ? COLORS.ruby : COLORS.muted });
    });
    if (!shots.length && !res.foldWin) g.text('Nobody sniped.', px, 200, { size: 7, color: COLORS.muted });
    if (res.carried) g.text(`${res.carried} carried to the next hand`, px, 252, { size: 7, color: COLORS.muted });
    if (s.phase === 'result') g.button('next', hud?.nextLabel ?? (s.hand >= s.config.hands ? 'Final result' : 'Next hand'), W - 96, 248, 84);
    if (s.phase === 'result' && hud?.sub) g.text(hud.sub, W - 96, 240, { size: 6, color: COLORS.muted });
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.chips} chips${p.safe ? ' · safe' : ''}` })),
      order[0].id === ME ? 'You win the table!' : `${order[0].name} wins the table.`,
    );
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- log (DOM)

export function HandLog({ state }: { state: GameState }) {
  const name = (id: string) => nameOf(state, id);
  return (
    <aside className="log">
      <h3>Hand log</h3>
      {!state.results.length && <p className="muted">Each hand’s board, showdown, snipes and winnings appear here.</p>}
      <ol>
        {[...state.results].reverse().map((r) => (
          <li key={r.hand}>
            <b>Hand {r.hand}</b> · {r.board.map(cardText).join(' ')}
            {r.foldWin && <em className="win">{name(r.foldWin)} won {r.winnings[r.foldWin]} — everyone else folded</em>}
            {Object.entries(r.values).map(([id, v]) => (
              <em key={id} className={r.sniped.includes(id) ? 'tip' : r.winnings[id] ? 'win' : ''}>
                {name(id)}: {r.holes[id].map(cardText).join(' ')} — {handName(v)}
                {r.sniped.includes(id) ? ' (sniped)' : ''}{r.winnings[id] ? ` +${r.winnings[id]}` : ''}
              </em>
            ))}
            {Object.entries(r.snipes).filter(([, t]) => t).map(([id, t]) => <em key={`s${id}`}>{name(id)} aimed at {snipeName(t!)}</em>)}
            {r.carried > 0 && <em>{r.carried} carried over</em>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
