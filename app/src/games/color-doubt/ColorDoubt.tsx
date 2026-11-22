import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botBack, botMove } from './bots';
import {
  COLOR_NAME, COLOR_ORDER, Color, DEFAULT_CONFIG, GameState, back, backers, canDoubt, cardsInPlay, currentBid, doubt,
  isOver, isRaise, minRaise, newGame, nextRound, raise, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 900;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'cautious', portrait: 'officer' },
  { name: 'Jun', persona: 'bluffer', portrait: 'journalist' },
  { name: 'Seo', persona: 'doubter', portrait: 'fanatic' },
  { name: 'Mira', persona: 'cautious', portrait: 'researcher' },
  { name: 'Taeo', persona: 'bluffer', portrait: 'terrorist' },
];
const INK: Record<Color, string> = { ruby: '#f2687a', topaz: '#f5cd5b', emerald: '#6edd8c', sapphire: '#70adf2', amethyst: '#bf89ea' };

export const RULES = [
  'The deck has 7 cards of each colour: ruby, topaz, emerald, sapphire, amethyst. Each round everyone gets 5 cards — you only see your own.',
  'BID: in turn, say “there are at least N cards of colour C across ALL hands”. Each bid must beat the last: a higher number, or the same number in a colour further right (ruby → topaz → emerald → sapphire → amethyst).',
  'DOUBT: instead of raising, the next player can doubt the last bid.',
  'BET: when a bid is doubted, everyone else secretly backs the BID or the DOUBT.',
  'REVEAL: all hands are shown and the colour is counted. Bid true → the doubter pays the bidder 2 chips. Bid false → the bidder pays the doubter 2. Right backers win 1 chip, wrong backers pay 1. The loser starts the next round.',
  'Everyone starts with 10 chips. 8 rounds (or until someone hits 0). Most chips wins; fewest goes to prison.',
];

// Dev-only: ?quick plays a 2-round match.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, rounds: 2 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

interface Draft { color: Color; count: number }

export function ColorDoubt({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [draft, setDraft] = useState<Draft>({ color: 'ruby', count: 1 });
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;
  const set = (next: GameState) => setGame((g) => ({ ...g, state: next }));

  // bots bid one at a time, then back a side together
  useEffect(() => {
    let job: (() => GameState) | null = null;
    if (s.phase === 'bid' && s.turn && s.turn !== ME) {
      const id = s.turn;
      job = () => {
        const m = botMove(s, id, persona(id), game.rng);
        return m.kind === 'doubt' ? doubt(s, id) : raise(s, id, m.count, m.color);
      };
    } else if (s.phase === 'back' && backers(s).some((id) => id !== ME)) {
      job = () => {
        let next = s;
        for (const id of backers(s)) if (id !== ME && next.phase === 'back') next = back(next, id, botBack(next, id, game.rng));
        return next;
      };
    }
    if (!job) return;
    const t = setTimeout(() => set(job!()), pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  // when my turn starts, pick my most common colour at the smallest legal count
  useEffect(() => {
    if (s.phase !== 'bid' || s.turn !== ME) return;
    const hand = s.players.find((p) => p.id === ME)!.hand;
    const byCount = [...COLOR_ORDER].sort((a, b) => hand.filter((c) => c === b).length - hand.filter((c) => c === a).length);
    const color = byCount.find((c) => minRaise(s, c) !== null) ?? 'amethyst';
    setDraft({ color, count: minRaise(s, color) ?? 1 });
  }, [s.phase, s.turn, s.bids.length]);

  const onHit = (id: string) => {
    if (id === 'again') return setGame(setup(botCount));
    if (id === 'next') return set(nextRound(s, game.rng));
    if (s.phase === 'back' && backers(s).includes(ME)) {
      if (id === 'backBid') set(back(s, ME, 'bid'));
      if (id === 'backDoubt') set(back(s, ME, 'doubt'));
      return;
    }
    if (s.phase !== 'bid' || s.turn !== ME) return;
    if (id.startsWith('col:')) {
      const color = id.slice(4) as Color;
      const min = minRaise(s, color);
      if (min !== null) setDraft({ color, count: Math.max(min, draft.count) });
    }
    if (id === 'n-') setDraft((d) => ({ ...d, count: Math.max(minRaise(s, d.color) ?? 1, d.count - 1) }));
    if (id === 'n+') setDraft((d) => ({ ...d, count: Math.min(cardsInPlay(s), d.count + 1) }));
    if (id === 'raise' && isRaise(s, draft.count, draft.color)) set(raise(s, ME, draft.count, draft.color));
    if (id === 'doubt' && canDoubt(s, ME)) set(doubt(s, ME));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, draft)} onHit={onHit} />
      <BidLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, id: string | null) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? '');
const bidText = (count: number, color: Color) => `${count} ${COLOR_NAME[color]}`;

/** A small card: face colour when shown, otherwise a back. */
function miniCard(g: Gfx, x: number, y: number, color: Color | null, lit = true) {
  g.rect(x, y, 10, 14, '#1b1233');
  g.rect(x + 1, y + 1, 8, 12, color ? INK[color] : '#4a3a8a', color && !lit ? 0.3 : 1);
  if (!color) g.rect(x + 3, y + 5, 4, 4, '#7d6bc4');
}

function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, draft: Draft) {
  const reveal = s.phase === 'reveal' || s.phase === 'gameOver';
  const last = s.history[s.history.length - 1];
  const bid = reveal && last ? last.bids[last.bids.length - 1] : currentBid(s);
  const bids = reveal && last ? last.bids : s.bids;
  const doubter = reveal && last ? last.doubter : s.doubter;
  const myTurn = s.phase === 'bid' && s.turn === ME;
  const me = s.players.find((p) => p.id === ME)!;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    { text: `${cardsInPlay(s)} cards in play · 7 of each colour exist`, color: COLORS.muted },
  ], 'COLOR DOUBT');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const x0 = Math.round(4 + slot * i + 4);
    const w = Math.round(slot - 8);
    g.panel('panel_parchment', x0, 30, w, 84, 4);
    if (s.turn === p.id) g.frame(x0 - 1, 29, w + 2, 86, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.text(p.name, x0 + 6, 34, { size: 8, color: '#3a2216', shadow: false });
    g.sprite('portraits', meta[p.id], x0 + 4, 46, { scale: 2 });
    g.text(`${p.chips}¢`, x0 + 42, 50, { size: 9, color: p.chips <= 2 ? '#86192f' : '#3a2216', shadow: false });
    const st = status(s, p.id);
    if (st) g.text(st, x0 + 42, 64, { size: 7, color: '#86192f', shadow: false });
    if (reveal && last) {
      const d = last.delta[p.id];
      if (d) g.text(`${d > 0 ? '+' : ''}${d}`, x0 + w - 8, 50, { align: 'right', size: 9, color: d < 0 ? '#86192f' : '#1b6a43', shadow: false });
    }
    const hand = reveal && last ? last.hands[p.id] : p.hand;
    hand.forEach((c, k) => miniCard(g, x0 + 6 + k * 12, 94, reveal ? c : null, !bid || c === bid.color));
  });

  // current bid
  g.panel('panel_night', 4, 118, 200, 64, 4);
  g.text(reveal ? 'DOUBTED BID' : 'CURRENT BID', 12, 124, { size: 7, color: COLORS.muted });
  if (bid) {
    g.sprite('cards', `color_${bid.color}`, 14, 134);
    g.text(`${bid.count} ×`, 52, 138, { size: 16, color: COLORS.gold });
    g.text(COLOR_NAME[bid.color], 90, 142, { size: 10, color: INK[bid.color] });
    g.text(`by ${nameOf(s, bid.player)}`, 52, 160, { size: 8, color: COLORS.ink });
    if (doubter) g.text(`${nameOf(s, doubter)} ${doubter === ME ? 'doubt' : 'doubts'} it`, 52, 170, { size: 8, color: COLORS.ruby });
  } else {
    g.text('No bid yet', 14, 146, { size: 10, color: COLORS.muted });
  }

  // bid history for this round
  g.panel('panel_night', 208, 118, W - 212, 64, 4);
  g.text('BIDS THIS ROUND', 216, 124, { size: 7, color: COLORS.muted });
  bids.slice(-4).forEach((b, i, arr) => {
    const latest = i === arr.length - 1;
    g.text(`${nameOf(s, b.player)}: ${bidText(b.count, b.color)}`, 216, 134 + i * 11, {
      size: 8, color: latest ? INK[b.color] : COLORS.muted,
    });
  });
  if (bids.length > 4) g.text(`+${bids.length - 4} earlier`, W - 14, 124, { align: 'right', size: 7, color: COLORS.muted });

  // message
  let msg = '';
  if (s.phase === 'bid') msg = myTurn ? (bid ? 'Your turn — raise the bid, or doubt it' : 'You open — make the first bid') : `${nameOf(s, s.turn)} is thinking…`;
  else if (s.phase === 'back') msg = backers(s).includes(ME) ? 'Back a side: is the bid true?' : 'Everyone is backing a side…';
  else if (reveal && last && bid) {
    msg = `${COLOR_NAME[bid.color]} in play: ${last.actual} — the bid ${last.holds ? 'HOLDS' : 'FAILS'}`;
  }
  if (msg) g.text(msg, 8, 186, { size: 9, color: COLORS.gold });

  // your panel
  g.panel('panel_night', 4, 198, W - 8, 68, 4);
  me.hand.forEach((c, k) => {
    g.sprite('cards', `color_${c}`, 10 + k * 26, 206);
    if (reveal && bid && c === bid.color) g.frame(9 + k * 26, 205, 34, 46, COLORS.gold);
  });
  g.text(`${me.chips}¢`, 150, 208, { size: 12, color: me.chips <= 2 ? COLORS.ruby : COLORS.gold });
  if (reveal && last && last.delta[ME]) {
    const d = last.delta[ME];
    g.text(`${d > 0 ? '+' : ''}${d}`, 150, 224, { size: 9, color: d < 0 ? COLORS.ruby : COLORS.emerald });
  }
  const st = status(s, ME);
  if (st) g.text(st, 150, 240, { size: 7, color: COLORS.muted });

  const bx = 196;
  if (s.phase === 'bid' && myTurn) {
    COLOR_ORDER.forEach((c, i) => {
      const x = bx + i * 22;
      const ok = minRaise(s, c) !== null;
      g.sprite('coins', `chip_${c}`, x, 206, { alpha: ok ? 1 : 0.3 });
      if (draft.color === c) g.frame(x - 2, 204, 20, 20, COLORS.gold);
      if (ok) g.hit(`col:${c}`, x - 2, 204, 20, 20);
    });
    g.button('n-', '−', bx, 230, 16);
    g.text(`${draft.count}`, bx + 30, 231, { align: 'center', size: 12, color: COLORS.gold });
    g.button('n+', '+', bx + 44, 230, 16);
    g.text(COLOR_NAME[draft.color], bx + 66, 233, { size: 9, color: INK[draft.color] });
    const legal = isRaise(s, draft.count, draft.color);
    g.button('raise', `Bid ${bidText(draft.count, draft.color)}`, 352, 206, 116, { disabled: !legal });
    g.button('doubt', bid ? `Doubt ${nameOf(s, bid.player)}` : 'Doubt', 352, 228, 116, { color: 'red', disabled: !canDoubt(s, ME) });
    g.text('pick a colour and a number', bx, 252, { size: 7, color: COLORS.muted });
  } else if (s.phase === 'back' && backers(s).includes(ME) && bid) {
    g.text(`${nameOf(s, doubter)} doubts ${bid.player === ME ? 'your' : `${nameOf(s, bid.player)}’s`} ${bidText(bid.count, bid.color)}.`, bx, 208, { size: 8, color: COLORS.ink });
    g.text('Right side +1 chip · wrong side −1', bx, 220, { size: 7, color: COLORS.muted });
    g.button('backBid', 'Back the bid', bx, 236, 120);
    g.button('backDoubt', 'Back the doubt', bx + 128, 236, 120, { color: 'red' });
  } else if (s.phase === 'reveal') {
    g.button('next', isOver(s) ? 'Final result' : 'Next round', 352, 244, 116);
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.chips}¢  ${p.won} won` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

function status(s: GameState, id: string): string {
  const reveal = s.phase === 'reveal' || s.phase === 'gameOver';
  const last = s.history[s.history.length - 1];
  if (reveal && last) {
    const bidder = last.bids[last.bids.length - 1].player;
    if (id === bidder) return 'bidder';
    if (id === last.doubter) return 'doubter';
    const b = last.backs[id];
    return b ? `backed ${b}` : '';
  }
  if (s.phase === 'back') {
    if (id === currentBid(s)?.player) return 'bidder';
    if (id === s.doubter) return 'DOUBTS';
    return s.players.find((p) => p.id === id)!.back ? 'decided' : 'deciding…';
  }
  if (s.phase === 'bid') {
    if (s.turn === id) return id === ME ? '' : 'thinking…';
    const mine = [...s.bids].reverse().find((b) => b.player === id);
    return mine ? `bid ${bidText(mine.count, mine.color)}` : '';
  }
  return '';
}

// ---------------------------------------------------------------- log (DOM)

function BidLog({ state }: { state: GameState }) {
  const name = (id: string) => nameOf(state, id);
  return (
    <aside className="log">
      <h3>Round log</h3>
      {state.history.length === 0 && <p className="muted">Each round’s bids, the doubt and the count appear here.</p>}
      <ol>
        {[...state.history].reverse().map((r) => {
          const bid = r.bids[r.bids.length - 1];
          return (
            <li key={r.round}>
              <b>Round {r.round}</b>
              <em>{r.bids.map((b) => `${name(b.player)} ${b.count} ${COLOR_NAME[b.color]}`).join(' → ')}</em>
              <em className={r.holds ? 'win' : 'tip'}>
                {name(r.doubter)} doubted {bid.player === ME ? 'your' : `${name(bid.player)}’s`} {bid.count} {COLOR_NAME[bid.color]} · {r.actual} in play → {r.holds ? 'bid holds' : 'bid fails'}
              </em>
              <em>
                {state.players.filter((p) => r.delta[p.id]).map((p) => `${name(p.id)} ${r.delta[p.id] > 0 ? '+' : ''}${r.delta[p.id]}`).join(' · ')}
              </em>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
