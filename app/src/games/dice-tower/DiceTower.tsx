import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { Rng, seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, starCount, topBar } from '../shared/draw';
import { Persona, botDraft, botPredict } from './bots';
import {
  DEFAULT_CONFIG, GameState, currentPicker, scoringTable, draft, evaluate, handOf, newGame, nextRound, predict, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 550;
const REVEAL_MS = 450;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'sharp', portrait: 'officer' },
  { name: 'Jun', persona: 'gambler', portrait: 'journalist' },
  { name: 'Seo', persona: 'cautious', portrait: 'fanatic' },
  { name: 'Mira', persona: 'sharp', portrait: 'researcher' },
  { name: 'Taeo', persona: 'gambler', portrait: 'terrorist' },
];

export const RULES = [
  'ROLL: the tower rolls an open tray of white dice everyone can see. You also get one SECRET red die that only you can see.',
  'DRAFT: taking turns (first to last, then back), everyone claims two white dice. Your hand is 3 dice: your 2 white dice + your secret die.',
  'HANDS, best to worst: Triple (three alike) › Straight (three in a row, e.g. 3-4-5) › Pair › nothing (your highest die counts). Same kind? Higher dice win.',
  'SCORING: all hands are ranked against each other. Best hand = 6 points, 2nd best = 3, 3rd best = 1, everyone below = 0. The worst hand always gets 0 — so with 3 players it is 6 / 3 / 0. Tied hands share the better place.',
  'BET: before the reveal, bet on the points you will get (6, 3, 1 or 0). Right bet = your points doubled (a right bet on 0 earns 4). Wrong bet = you just keep your normal points.',
  'Example: Seo has a Triple (best → 6), Hana a Straight (2nd → 3), Jun a Pair of 4s (3rd → 1), you a Pair of 2s (worst → 0). Seo bet 6, so scores 12. Highest total after 5 rounds wins; last place goes to prison.',
];

// Dev-only: ?quick plays a 1-round match.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, botCount);
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { rounds: 1 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export function DiceTower({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const phaseAt = useRef(performance.now());
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  const update = (next: GameState) => {
    if (next.phase !== s.phase || next.round !== s.round) phaseAt.current = performance.now();
    setGame((g) => ({ ...g, state: next }));
  };

  // bots draft one die at a time (with a short pause so you can follow),
  // and lock in their predictions as soon as the draft ends
  useEffect(() => {
    const picker = currentPicker(s);
    if (picker && picker !== ME) {
      const t = setTimeout(() => {
        const p = s.players.find((x) => x.id === picker)!;
        update(draft(s, picker, botDraft(p.secret, p.picks, s.pool, persona(picker), game.rng)));
      }, pace(BOT_DELAY));
      return () => clearTimeout(t);
    }
    if (s.phase === 'predict' && s.players.some((p) => p.isBot && p.prediction === null)) {
      update(predictBots(s, game.rng, persona));
    }
  });

  const onHit = (id: string) => {
    if (id.startsWith('die:')) update(draft(s, ME, Number(id.slice(4))));
    else if (id.startsWith('bet:')) update(predict(s, ME, Number(id.slice(4))));
    else if (id === 'next') update(nextRound(s, game.rng));
    else if (id === 'again') {
      phaseAt.current = performance.now();
      setGame(setup(botCount));
    }
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, g.time - phaseAt.current)} onHit={onHit} />
      <DiceLog state={s} />
    </div>
  );
}

function predictBots(s: GameState, rng: Rng, persona: (id: string) => Persona): GameState {
  // Each bot sees every player's two white dice plus only its own secret die.
  const visible = Object.fromEntries(s.players.map((p) => [p.id, p.picks]));
  let next = s;
  for (const p of s.players) {
    if (!p.isBot || p.prediction !== null) continue;
    const hands = { ...visible, [p.id]: handOf(p) };
    next = predict(next, p.id, botPredict(p.id, hands, persona(p.id), rng));
  }
  return next;
}

// ---------------------------------------------------------------- drawing

function drawDice(g: Gfx, dice: { name: string; alpha?: number }[], cx: number, y: number) {
  const w = dice.length * 18 - 2;
  dice.forEach((d, i) => g.sprite('dice', d.name, cx - w / 2 + i * 18, y, { alpha: d.alpha }));
}

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/** Online play: the move clock, a replacement hint line, and the label on the "next" button. */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string }

export function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, since: number, hud?: OnlineHud) {
  const picker = currentPicker(s);
  const showResult = s.phase === 'result' || s.phase === 'gameOver';
  const revealed = showResult && since > pace(REVEAL_MS);
  const last = s.history[s.history.length - 1];
  const me = s.players.find((p) => p.id === ME)!;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], 'DICE TOWER');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    const x0 = cx - slot / 2 + 4;
    g.panel('panel_parchment', x0, 30, slot - 8, 88, 4);
    if (picker === p.id) g.frame(x0 - 1, 29, slot - 6, 90, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.sprite('portraits', meta[p.id], cx - 16, 33, { scale: 2 });
    g.text(p.name, cx, 66, { align: 'center', color: '#3a2216', shadow: false });
    starCount(g, cx, 76, p.score, '#5e3a24');
    const dice = [
      ...p.picks.map((v) => ({ name: `die_white_${v}` })),
      ...Array.from({ length: 2 - p.picks.length }, () => ({ name: 'die_white_1', alpha: 0.15 })),
      { name: revealed ? `die_red_${p.secret}` : 'die_hidden' },
    ];
    drawDice(g, dice, cx, 84);
    if (s.phase === 'predict') {
      g.text(p.prediction !== null ? 'bet placed' : 'thinking…', cx, 103, { align: 'center', size: 7, color: '#5e3a24', shadow: false });
    } else if (revealed && last) {
      const hit = last.predictions[p.id] === last.base[p.id];
      g.text(`${last.places[p.id]} · ${last.combos[p.id]}`, cx, 101, { align: 'center', size: 7, color: '#3a2216', shadow: false });
      g.text(`${pts(last.base[p.id])} · bet ${last.predictions[p.id]} ${betMark(last.predictions[p.id], last.base[p.id])} → +${last.earned[p.id]}`, cx, 109, {
        align: 'center', size: 7, color: hit ? '#1b6a43' : '#86192f', shadow: false,
      });
    } else if (picker === p.id) {
      g.text('picking…', cx, 103, { align: 'center', size: 7, color: '#86192f', shadow: false });
    }
  });

  // the tray
  const n = s.pool.length;
  const trayW = n * 22 + 12;
  const tx = Math.round(W / 2 - trayW / 2);
  g.panel('panel_night', tx, 122, trayW, 28, 4);
  const myTurn = picker === ME;
  s.pool.forEach((d, i) => {
    const x = tx + 8 + i * 22;
    const id = `die:${d.id}`;
    const hover = myTurn && !d.takenBy && g.isHover(id);
    const y = 128 - (hover ? 2 : 0);
    g.sprite('dice', `die_white_${d.value}`, x, y, { alpha: d.takenBy ? 0.18 : 1 });
    if (myTurn && !d.takenBy) {
      g.hit(id, x, 126, 16, 20);
      if (hover) g.frame(x - 2, y - 2, 20, 20, COLORS.gold);
    }
  });

  // messages
  let msg = '';
  let sub = '';
  if (s.phase === 'draft') {
    if (myTurn) {
      msg = me.picks.length === 0 ? 'Your pick — claim a white die' : 'Your last pick — claim one more die';
      sub = `your secret die is a ${me.secret}`;
    } else {
      msg = `${s.players.find((p) => p.id === picker)?.name} is picking…`;
      sub = 'snake order: first to last, then back again';
    }
  } else if (s.phase === 'predict') {
    msg = me.prediction === null ? 'Which place will your hand finish?' : 'Waiting for the reveal…';
    sub = 'you can see every white die — only the secret dice are hidden';
  } else if (showResult && last) {
    if (!revealed) msg = 'Revealing secret dice…';
    else {
      const ranked = [...s.players].sort((a, b) => last.base[b.id] - last.base[a.id] || compareRank(last.places[a.id], last.places[b.id]));
      msg = ranked.map((p) => `${last.places[p.id]} ${p.id === ME ? 'You' : p.name}`).join(' · ');
      sub = `You: ${last.places[ME]} with ${last.combos[ME]} = ${pts(last.base[ME])} · bet ${last.predictions[ME]} ${betMark(last.predictions[ME], last.base[ME])} → +${last.earned[ME]}`;
    }
  }
  if (hud?.sub) sub = hud.sub;
  if (msg) g.text(msg, W / 2, 154, { align: 'center', size: 11, color: COLORS.gold });
  if (sub) g.text(sub, W / 2, 167, { align: 'center', size: 8, color: COLORS.muted });

  // your panel
  g.panel('panel_night', 4, 180, W - 8, 86, 4);
  if (myTurn) g.frame(3, 179, W - 6, 88, Math.floor(g.time / 250) % 2 ? COLORS.gold : '#fff3b0', 2);
  g.sprite('portraits', meta[ME], 14, 188, { scale: 2 });
  g.text('You', 30, 222, { align: 'center' });
  starCount(g, 30, 234, me.score, COLORS.ink);

  g.text('YOUR HAND', 70, 190, { color: COLORS.muted, size: 8 });
  const mine: { name: string; alpha?: number }[] = [
    { name: `die_red_${me.secret}` },
    ...me.picks.map((v) => ({ name: `die_white_${v}` })),
    ...Array.from({ length: 2 - me.picks.length }, () => ({ name: 'die_white_1', alpha: 0.15 })),
  ];
  mine.forEach((d, i) => g.sprite('dice', d.name, 70 + i * 36, 202, { scale: 2, alpha: d.alpha }));
  g.text('secret', 86, 238, { align: 'center', size: 7, color: COLORS.ruby });
  g.text(me.picks.length === 2 ? evaluate(handOf(me)).label : '…', 70, 250, { size: 9, color: COLORS.ink });

  const table = scoringTable(s.players.length);
  if (s.phase === 'predict' && me.prediction === null) {
    g.text('YOUR BET — pick the place you expect', 236, 190, { color: COLORS.gold, size: 8 });
    table.forEach((row, i) => {
      const label = `${row.place.replace(' & below', '+')} · ${row.points}`;
      g.button(`bet:${row.points}`, label, 236 + i * 58, 204, 54, { color: row.points === 0 ? 'red' : 'blue' });
    });
    g.text('right bet = points ×2 · right bet on 0 = 4 pts', 236, 224, { color: COLORS.muted, size: 7 });
  } else {
    g.text('POINTS PER ROUND', 236, 190, { color: COLORS.muted, size: 8 });
    table.forEach((row, i) => {
      g.text(row.place, 236 + i * 58, 203, { size: 8, color: COLORS.ink });
      g.text(pts(row.points), 236 + i * 58, 214, { size: 9, color: row.points ? COLORS.gold : COLORS.ruby });
    });
    g.text(me.prediction !== null && s.phase === 'predict' ? `You bet ${me.prediction} — right bet doubles it` : 'right bet = ×2 · right bet on 0 = 4', 236, 227, {
      size: 7, color: me.prediction !== null && s.phase === 'predict' ? COLORS.gold : COLORS.muted,
    });
  }
  if (s.phase === 'result' && revealed) g.button('next', hud?.nextLabel ?? (s.round >= s.config.rounds ? 'Final result' : 'Next round'), 396, 244, 72);
  if (s.phase === 'gameOver' && revealed) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.score} pts  ${p.correct} bet${p.correct === 1 ? '' : 's'} right` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`;
/** "✓ ×2", "✓ +4" (right bet on 0) or "✗". */
const betMark = (bet: number, base: number) => (bet !== base ? '✗' : base === 0 ? '✓ +4' : '✓ ×2');

const PLACE_ORDER = ['1st', '2nd', '3rd', '4th', '5th', '6th', 'Last'];
const compareRank = (a: string, b: string) => PLACE_ORDER.indexOf(a) - PLACE_ORDER.indexOf(b);

// ---------------------------------------------------------------- log (DOM)

export function DiceLog({ state }: { state: GameState }) {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <aside className="log">
      <h3>Round log</h3>
      {state.history.length === 0 && <p className="muted">Hands, bets and points appear here after each reveal.</p>}
      <ol reversed>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>Round {r.round}</b>
            {Object.keys(r.hands).map((id) => (
              <em key={id} className={r.base[id] === 6 ? 'win' : ''}>
                {name(id)}: {r.places[id]} · {r.combos[id]} = {pts(r.base[id])} · bet {r.predictions[id]} {betMark(r.predictions[id], r.base[id])} → +{r.earned[id]}
              </em>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  );
}
