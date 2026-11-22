import { useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS as UI, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botPlay } from './bots';
import {
  COLORS, Chip, Color, DEFAULT_CONFIG, GameState, Play, newGame, nextRound, simulate, standings, submitPlay, weight,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const STEP_MS = 850;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'careful', portrait: 'officer' },
  { name: 'Jun', persona: 'trapper', portrait: 'journalist' },
  { name: 'Seo', persona: 'loose', portrait: 'fanatic' },
  { name: 'Mira', persona: 'careful', portrait: 'researcher' },
  { name: 'Taeo', persona: 'trapper', portrait: 'terrorist' },
];
const SCALE_NAME: Record<Color, string> = { ruby: 'Ruby', emerald: 'Emerald', sapphire: 'Sapphire' };
const SCALE_INK: Record<Color, string> = { ruby: '#f2687a', emerald: '#6edd8c', sapphire: '#70adf2' };
/** Darker scale colours that read on parchment panels. */
const SCALE_INK_DARK: Record<Color, string> = { ruby: '#86192f', emerald: '#1b6a43', sapphire: '#22408e' };
const CHIPS: Chip[] = ['ruby', 'emerald', 'sapphire', 'rainbow'];

export const RULES = [
  'Three scales — Ruby, Emerald and Sapphire. A scale TIPS the moment its total weight reaches 13 — 12 is the most it can safely hold.',
  'You hold stone cards 0–6 and 7 chips: 2 ruby, 2 emerald, 2 sapphire, 1 rainbow. Your hand refills after round 7 (14 rounds in all).',
  'Each round everyone secretly plays 1 card + 1 chip. The chip colour picks the scale. Rainbow = pick ANY scale and place first.',
  'Placing order: rainbow first, then heaviest card first; ties go clockwise from the start player.',
  'If your stone brings a scale to 13 or more, you take 1 penalty per stone on it (yours included). The scale empties and your stone stays as the new base. A 0 stone weighs nothing but still counts as a stone!',
  'Played cards and chips are public. Fewest penalties after 14 rounds wins; the most penalties goes to prison.',
];

// Dev-only: ?quick plays a 3-round match.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, botCount);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    QUICK ? { ...DEFAULT_CONFIG, rounds: 3 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng: seededRng(Date.now() & 0xffff) };
}

export function TippingScales({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [card, setCard] = useState<number | null>(null);
  const [chip, setChip] = useState<Chip | null>(null);
  const [rainbowScale, setRainbowScale] = useState<Color>('ruby');
  const resultAt = useRef(performance.now());
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  const place = () => {
    if (card === null || chip === null) return;
    const mine: Play = { card, chip, scale: chip === 'rainbow' ? rainbowScale : chip };
    // bots decide from the same information you had (before anyone played)
    const botPlays = s.players.filter((p) => p.isBot).map((p) => [p.id, botPlay(s, p.id, persona(p.id), game.rng)] as const);
    let next = submitPlay(s, ME, mine);
    for (const [id, play] of botPlays) next = submitPlay(next, id, play);
    resultAt.current = performance.now();
    setCard(null);
    setChip(null);
    setGame((g) => ({ ...g, state: next }));
  };

  const onHit = (id: string) => {
    if (id.startsWith('card:')) setCard(Number(id.slice(5)));
    else if (id.startsWith('chip:')) setChip(id.slice(5) as Chip);
    else if (id.startsWith('rs:')) setRainbowScale(id.slice(3) as Color);
    else if (id === 'place') place();
    else if (id === 'skip') resultAt.current = -1e9;
    else if (id === 'next') setGame((g) => ({ ...g, state: nextRound(g.state) }));
    else if (id === 'again') setGame(setup(botCount));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));
  const sel = { card, chip, rainbowScale };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, sel, g.time - resultAt.current)} onHit={onHit} />
      <ScaleLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

interface Sel { card: number | null; chip: Chip | null; rainbowScale: Color }

function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, sel: Sel, since: number) {
  const last = s.history[s.history.length - 1];
  const inResult = s.phase === 'result' || s.phase === 'gameOver';
  const steps = inResult && last ? last.events.length : 0;
  const shown = inResult ? Math.min(steps, Math.floor(since / pace(STEP_MS)) + 1) : 0; // events revealed so far
  const revealDone = !inResult || shown >= steps;
  const current = inResult && last && !revealDone ? last.events[shown - 1] : null;
  const name = (id: string) => (id === ME ? 'You' : s.players.find((p) => p.id === id)!.name);
  const me = s.players.find((p) => p.id === ME)!;

  // penalties shown so far (count up during the reveal)
  const shownPenalty: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, p.penalty]));
  if (inResult && last && !revealDone) {
    for (const e of last.events.slice(shown)) if (e.tipped) shownPenalty[e.player] -= e.penalty;
  }

  g.tile('board', 'tile_night', 0, 0, W, H);
  const hand = Math.ceil(s.round / s.config.handRounds);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: UI.gold },
    { text: `HAND ${hand}/${Math.ceil(s.config.rounds / s.config.handRounds)}`, color: UI.muted },
  ], 'TIPPING SCALES');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const x0 = Math.round(4 + slot * i + 4);
    const w = Math.round(slot - 8);
    const placing = current?.player === p.id;
    g.panel('panel_parchment', x0, 30, w, 62, 4);
    if (placing) g.frame(x0 - 1, 29, w + 2, 64, current!.tipped ? UI.ruby : UI.gold, 2);
    g.sprite('portraits', meta[p.id], x0 + 4, 36, { scale: 2 });
    const tx = x0 + 40;
    g.text(p.name, tx, 35, { color: '#3a2216', shadow: false, size: 8 });
    g.sprite('icons', 'skull', tx - 3, 43);
    g.text(`${shownPenalty[p.id]}`, tx + 13, 47, { color: '#86192f', shadow: false, size: 8 });
    // remaining chips (public)
    const chipsLeft = inResult && last ? chipsBefore(p.chips, last.plays[p.id]?.chip, revealDone) : p.chips;
    CHIPS.forEach((c, k) => {
      const cx = tx + k * 13;
      g.rect(cx, 60, 5, 5, c === 'rainbow' ? '#d9a83e' : SCALE_INK[c], chipsLeft[c] ? 1 : 0.25);
      g.text(`${chipsLeft[c]}`, cx + 6, 58, { size: 7, color: '#5e3a24', shadow: false });
    });
    // remaining cards (public)
    const cardsLeft = inResult && last && !revealDone ? [...p.cards, last.plays[p.id].card].sort() : p.cards;
    g.text(cardsLeft.length ? cardsLeft.join(' ') : '—', tx, 70, { size: 7, color: '#3a2216', shadow: false });
    if (s.phase === 'choose') g.text('choosing…', tx, 80, { size: 7, color: '#5e3a24', shadow: false });
    else if (last) {
      const pl = last.plays[p.id];
      const idx = last.order.indexOf(p.id);
      if (idx < shown) {
        g.text(`${pl.card} → ${SCALE_NAME[pl.scale]}${pl.chip === 'rainbow' ? ' ★' : ''}`, tx, 80, {
          size: 7, color: SCALE_INK_DARK[pl.scale], shadow: false,
        });
      } else g.text('waiting…', tx, 80, { size: 7, color: '#5e3a24', shadow: false });
    }
  });

  // scales
  const scalesNow = inResult && last
    ? simulate(last.scalesBefore, last.order.slice(0, shown), last.plays, s.config.limit).scales
    : s.scales;
  COLORS.forEach((c, i) => {
    const cx = 80 + i * 160;
    drawScale(g, c, cx, scalesNow[c], s.config.limit, current?.scale === c ? current : null, name, since);
  });

  // message line
  let msg = '';
  let sub = '';
  if (s.phase === 'choose') {
    msg = 'Play 1 stone card + 1 chip';
    sub = 'chip colour = scale · rainbow = any scale & you place first';
  } else if (current) {
    msg = current.tipped
      ? `${name(current.player)} ${current.player === ME ? 'tip' : 'tips'} ${SCALE_NAME[current.scale]}!  +${current.penalty} penalt${current.penalty === 1 ? 'y' : 'ies'}`
      : `${name(current.player)} ${current.player === ME ? 'place' : 'places'} ${current.card} on ${SCALE_NAME[current.scale]}  (${current.weightAfter}/13)`;
    sub = `placing ${shown} of ${steps} · rainbow first, then heaviest card`;
  } else if (last) {
    const tips = last.events.filter((e) => e.tipped);
    msg = tips.length ? tips.map((e) => `${name(e.player)} +${e.penalty}`).join(' · ') : 'Nobody tipped a scale';
    const mine = tips.filter((e) => e.player === ME).reduce((t, e) => t + e.penalty, 0);
    sub = mine ? `You took ${mine} penalt${mine === 1 ? 'y' : 'ies'} this round` : 'You stayed safe this round';
  }
  if (msg) g.text(msg, W / 2, 169, { align: 'center', size: 10, color: current?.tipped ? UI.ruby : UI.gold });
  if (sub) g.text(sub, W / 2, 180, { align: 'center', size: 7, color: UI.muted });

  // your panel
  g.panel('panel_night', 4, 188, W - 8, 78, 4);
  g.sprite('portraits', meta[ME], 12, 194, { scale: 2 });
  g.text('You', 28, 228, { align: 'center' });
  g.sprite('icons', 'skull', 12, 236);
  g.text(`${shownPenalty[ME]}`, 30, 240, { color: UI.ruby });

  const choosing = s.phase === 'choose';
  me.cards.forEach((c, i) => {
    const x = 52 + i * 34;
    const id = `card:${c}`;
    const picked = sel.card === c;
    const y = 194 - (picked ? 6 : 0) - (choosing && g.isHover(id) && !picked ? 2 : 0);
    g.sprite('cards', `number_${c}`, x, y);
    if (picked) g.frame(x - 1, y - 1, 34, 46, UI.gold);
    if (choosing) g.hit(id, x, 188, 32, 52);
  });
  if (!me.cards.length) g.text('hand empty — refills next round', 60, 214, { color: UI.muted, size: 8 });

  // chips
  const cx0 = 296;
  g.text('CHIP', cx0, 192, { color: UI.muted, size: 7 });
  CHIPS.forEach((c, i) => {
    const x = cx0 + i * 22;
    const id = `chip:${c}`;
    const n = me.chips[c];
    g.sprite('coins', `chip_${c}`, x, 202, { alpha: n ? 1 : 0.25 });
    g.text(`×${n}`, x + 3, 220, { size: 7, color: n ? UI.ink : UI.muted });
    if (sel.chip === c) g.frame(x - 2, 200, 20, 20, UI.gold);
    if (choosing && n) g.hit(id, x, 200, 18, 28);
  });
  if (choosing && sel.chip === 'rainbow') {
    g.text('rainbow →', cx0, 236, { size: 7, color: UI.muted });
    COLORS.forEach((c, i) => {
      const x = cx0 + 40 + i * 22;
      g.rect(x, 232, 18, 12, SCALE_INK[c], sel.rainbowScale === c ? 1 : 0.35);
      if (sel.rainbowScale === c) g.frame(x - 1, 231, 20, 14, UI.gold);
      g.hit(`rs:${c}`, x, 232, 18, 12);
    });
  }

  if (choosing) {
    const ready = sel.card !== null && sel.chip !== null;
    const target = sel.chip === 'rainbow' ? sel.rainbowScale : sel.chip;
    g.button('place', ready ? `Place on ${SCALE_NAME[target as Color]}` : 'Place', 392, 248, 80, { disabled: !ready });
  } else if (!revealDone) {
    g.button('skip', 'Skip ▸▸', 400, 248, 72);
  } else if (s.phase === 'result') {
    g.button('next', s.round >= s.config.rounds ? 'Final result' : 'Next round', 400, 248, 72);
  }

  if (s.phase === 'gameOver' && revealDone) {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.penalty} penalt${p.penalty === 1 ? 'y' : 'ies'}  ${p.tips} tips` })),
      order[0].id === ME ? 'You win — fewest penalties!' : `${order[0].name} wins with the fewest penalties.`,
    );
  }
}

/** During the reveal, show chip counts from before this round's play. */
function chipsBefore(chips: Record<Chip, number>, used: Chip | undefined, done: boolean) {
  if (done || !used) return chips;
  return { ...chips, [used]: chips[used] + 1 };
}

function drawScale(
  g: Gfx, c: Color, cx: number, stones: number[], limit: number,
  current: { player: string; card: number; tipped: boolean; penalty: number } | null,
  name: (id: string) => string, since: number,
) {
  const w = weight(stones);
  const danger = w >= limit - 2 ? UI.ruby : w >= limit - 5 ? UI.gold : UI.ink;
  g.text(`${SCALE_NAME[c].toUpperCase()}`, cx, 94, { align: 'center', size: 7, color: SCALE_INK[c] });
  g.text(`${w}/${limit}`, cx - 4, 102, { align: 'right', size: 10, color: danger });
  g.text(`${stones.length} stone${stones.length === 1 ? '' : 's'}`, cx + 2, 104, { size: 7, color: UI.muted });
  // weight meter
  g.rect(cx - 30, 114, 60, 3, '#241944');
  g.rect(cx - 30, 114, Math.round((60 * Math.min(w, limit)) / limit), 3, danger);
  // stones piled on the pan (newest on top)
  const shake = current?.tipped && Math.floor(since / 60) % 2 ? 1 : 0;
  stones.forEach((v, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const x = cx - 22 + col * 11 + (row % 2) * 5 + shake;
    const y = 140 - row * 8 - 4;
    g.sprite('items', 'rock_small', x, y);
    g.text(`${v}`, x + 5, y + 2, { size: 6, align: 'center', color: '#0f0e14', shadow: false });
  });
  g.sprite('items', `scale_pan_${c}`, cx - 24 + shake, 138, { scale: 2 });
  if (current) {
    const label = current.tipped ? `TIP! ${name(current.player)} +${current.penalty}` : `+${current.card} ${name(current.player)}`;
    g.text(label, cx, 124 - Math.min(6, since % 850 / 60), { align: 'center', size: 8, color: current.tipped ? UI.ruby : UI.gold });
  }
}

// ---------------------------------------------------------------- log (DOM)

function ScaleLog({ state }: { state: GameState }) {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <aside className="log">
      <h3>Round log</h3>
      {state.history.length === 0 && <p className="muted">Each round’s placements appear here, in placing order.</p>}
      <ol reversed>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>Round {r.round}</b>
            {r.events.map((e, i) => (
              <em key={i} className={e.tipped ? 'tip' : ''}>
                {name(e.player)} {e.card}{r.plays[e.player].chip === 'rainbow' ? '★' : ''} → {SCALE_NAME[e.scale]}{' '}
                {e.tipped ? `TIPS +${e.penalty}` : `(${e.weightAfter})`}
              </em>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  );
}
