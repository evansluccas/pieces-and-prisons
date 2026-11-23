import { useCallback, useMemo, useRef, useState } from 'react';
import { getSheet } from '../../engine/atlas';
import { PixelStage } from '../../engine/PixelStage';
import { standingsPanel, starCount, topBar } from '../shared/draw';
import { COLORS, Gfx } from '../../engine/gfx';
import { Persona, botKeep, botPickPair, seededRng } from './bots';
import {
  Card, DEFAULT_CONFIG, GameState, cycleOf, newGame, nextRound, roundInCycle, standings, submitKeep, submitPair, totalRounds,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'cautious', portrait: 'officer' },
  { name: 'Jun', persona: 'greedy', portrait: 'journalist' },
  { name: 'Seo', persona: 'wild', portrait: 'fanatic' },
  { name: 'Mira', persona: 'greedy', portrait: 'researcher' },
  { name: 'Taeo', persona: 'cautious', portrait: 'terrorist' },
];

export const RULES = [
  'Everyone holds number cards 1–8. The match is 3 cycles of 6 rounds; hands refill each cycle.',
  'PICK: secretly choose two different cards to show.',
  'KEEP: all pairs are revealed. Secretly keep one of your two; the other returns to your hand.',
  'The lowest number kept by exactly one player wins — that player earns stars equal to the card.',
  'Kept cards are spent. Most stars after 18 rounds wins; last place goes to prison.',
];

// Dev-only: append ?quick to the URL for a one-round match (to test the ending).
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number, seed: number) {
  const bots = BOTS.slice(0, botCount);
  const state = newGame([
    { id: ME, name: 'You', isBot: false },
    ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true })),
  ], QUICK ? { ...DEFAULT_CONFIG, cycles: 1, roundsPerCycle: 1 } : DEFAULT_CONFIG);
  return { state, bots, rng: seededRng(seed) };
}

export function LonelyNumber({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount, Date.now() & 0xffff));
  const [selected, setSelected] = useState<Card[]>([]);
  const phaseAt = useRef(performance.now());
  const s = game.state;

  const update = useCallback((next: GameState) => {
    phaseAt.current = performance.now();
    setGame((g) => ({ ...g, state: next }));
  }, []);

  const botMeta = useMemo(() => {
    const m: Record<string, { persona: Persona; portrait: string }> = { [ME]: { persona: 'wild', portrait: 'citizen' } };
    game.bots.forEach((b, i) => (m[`bot${i}`] = b));
    return m;
  }, [game.bots]);

  const confirmPair = () => {
    if (selected.length !== 2) return;
    let next = submitPair(s, ME, [selected[0], selected[1]]);
    for (const p of next.players.filter((p) => p.isBot))
      next = submitPair(next, p.id, botPickPair(p.hand, botMeta[p.id].persona, game.rng));
    update(next);
  };

  const keep = (card: Card) => {
    let next = submitKeep(s, ME, card);
    for (const p of s.players.filter((p) => p.isBot)) {
      const others = s.players.filter((o) => o.id !== p.id).map((o) => s.pairs[o.id]);
      next = submitKeep(next, p.id, botKeep(s.pairs[p.id], others, botMeta[p.id].persona, game.rng));
    }
    setSelected([]);
    update(next);
  };

  const onHit = (id: string) => {
    if (id.startsWith('hand:') && s.phase === 'pick') {
      const c = Number(id.slice(5));
      setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : sel.length < 2 ? [...sel, c] : [sel[1], c]));
    } else if (id === 'confirm') confirmPair();
    else if (id.startsWith('keep:')) keep(Number(id.slice(5)));
    else if (id === 'next') update(nextRound(s));
    else if (id === 'again') {
      setSelected([]);
      phaseAt.current = performance.now();
      setGame(setup(botCount, Date.now() & 0xffff));
    }
  };

  const draw = (g: Gfx) => drawScene(g, s, selected, botMeta, g.time - phaseAt.current);

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={draw} onHit={onHit} />
      <RoundLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/** Online play: replace the centre message, hide buttons while waiting, show the move clock. */
export interface OnlineHud { msg?: string; sub?: string; canAct: boolean; clock?: string }

export function drawScene(
  g: Gfx, s: GameState, selected: Card[], meta: Record<string, { portrait: string }>, since: number, online?: OnlineHud,
) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `CYCLE ${cycleOf(s)}/${s.config.cycles}`, color: COLORS.gold },
    { text: `ROUND ${roundInCycle(s)}/${s.config.roundsPerCycle}` },
    { text: `(${s.round}/${totalRounds(s)})`, color: COLORS.muted },
    ...(online?.clock ? [{ text: online.clock, color: COLORS.ruby }] : []),
  ], 'LONELY NUMBER');

  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  const result = s.history[s.history.length - 1];
  const showResult = s.phase === 'result' || s.phase === 'gameOver';
  const flip = Math.min(1, Math.max(0, since / 260));

  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    g.panel('panel_parchment', cx - slot / 2 + 4, 30, slot - 8, 108, 4);
    g.sprite('portraits', meta[p.id].portrait, cx - 16, 36, { scale: 2 });
    g.text(p.name, cx, 70, { align: 'center', color: '#3a2216', shadow: false });
    starCount(g, cx, 80, p.tokens, '#5e3a24');
    const pair = s.pairs[p.id];
    [0, 1].forEach((k) => {
      const x = cx - 33 + k * 34;
      const y = 92;
      if (!pair) return g.sprite('cards', 'back', x, y, { alpha: 0.25 });
      if (s.phase === 'pick') return g.sprite('cards', 'back', x, y);
      const card = pair[k];
      const isKept = showResult && result?.kept[p.id] === card;
      const dim = showResult && !isKept;
      drawFlipCard(g, `number_${card}`, x, y, s.phase === 'keep' ? flip : 1, dim ? 0.3 : 1);
      if (isKept && result.winner === p.id) winnerGlow(g, x, y, since);
    });
  });

  // centre message
  const me = s.players.find((p) => p.id === ME)!;
  let msg = '';
  let sub = '';
  if (s.phase === 'pick') {
    msg = 'Pick two cards to show';
    sub = `${selected.length}/2 selected  ·  lowest number nobody else keeps wins its value`;
  } else if (s.phase === 'keep') {
    msg = 'All pairs revealed — keep one card';
    sub = 'The other card goes back to your hand';
  } else if (s.phase === 'result' && result) {
    const w = s.players.find((p) => p.id === result.winner);
    msg = w ? `${w.id === ME ? 'You keep' : `${w.name} keeps`} the lonely ${result.card}!  +${result.card}★` : 'No lonely number — nobody scores';
    sub = roundInCycle(s) === s.config.roundsPerCycle && s.round < totalRounds(s) ? 'Cycle over — hands refill next round' : '';
  }
  if (online?.msg) msg = online.msg;
  if (online?.sub) sub = online.sub;
  if (msg) {
    g.text(msg, W / 2, 146, { align: 'center', size: 12, color: COLORS.gold });
    if (sub) g.text(sub, W / 2, 162, { align: 'center', size: 8, color: COLORS.muted });
  }

  // player area
  g.panel('panel_night', 4, 176, W - 8, 90, 4);
  g.sprite('portraits', meta[ME].portrait, 14, 186, { scale: 2 });
  g.text('You', 30, 222, { align: 'center' });
  starCount(g, 30, 234, me.tokens, COLORS.ink);

  const handX = 60;
  const myPair = s.pairs[ME];
  me.hand.forEach((c, i) => {
    const x = handX + i * 35;
    let y = 210;
    const id = s.phase === 'pick' ? `hand:${c}` : s.phase === 'keep' && myPair?.includes(c) ? `keep:${c}` : '';
    const inPair = (s.phase === 'keep' && myPair?.includes(c)) || (s.phase === 'pick' && selected.includes(c));
    if (inPair) y -= 14;
    if (id && g.isHover(id)) y -= 3;
    const faded = s.phase === 'keep' && !myPair?.includes(c);
    g.sprite('cards', `number_${c}`, x, y, { alpha: faded ? 0.4 : 1 });
    if (inPair && s.phase !== 'keep') g.frame(x - 1, y - 1, 34, 46, COLORS.gold);
    if (s.phase === 'keep' && myPair?.includes(c) && g.isHover(id)) g.frame(x - 1, y - 1, 34, 46, COLORS.emerald);
    if (id) g.hit(id, x, y, 32, 44 + (inPair ? 14 : 0));
  });
  if (showResult && result) {
    const k = result.kept[ME];
    g.text('kept', 400, 186, { color: COLORS.muted });
    drawFlipCard(g, `number_${k}`, 400, 198, 1, 1);
    if (result.winner === ME) winnerGlow(g, 400, 198, since);
  }

  const canAct = !online || online.canAct;
  if (s.phase === 'pick' && canAct) g.button('confirm', 'Show pair', 400, 246, 70, { disabled: selected.length !== 2 });
  if (s.phase === 'result' && canAct) g.button('next', online ? 'Ready' : s.round >= totalRounds(s) ? 'Final result' : 'Next round', 400, 246, 70);
  if (s.phase === 'gameOver') drawGameOver(g, s);
}

function drawFlipCard(g: Gfx, name: string, x: number, y: number, t: number, alpha: number) {
  // t: 0 → back, 1 → face. Squash horizontally around the middle.
  const half = t < 0.5;
  const k = Math.abs(1 - t * 2);
  const w = Math.max(1, Math.round(32 * k));
  const { image, frames } = getSheet('cards');
  const f = frames[half ? 'back' : name];
  g.ctx.globalAlpha = alpha;
  g.ctx.drawImage(image, f.x, f.y, f.w, f.h, Math.round(x + (32 - w) / 2), y, w, f.h);
  g.ctx.globalAlpha = 1;
}

function winnerGlow(g: Gfx, x: number, y: number, since: number) {
  const pulse = Math.floor(since / 200) % 2 === 0 ? COLORS.gold : '#fff3b0';
  g.frame(x - 2, y - 2, 36, 48, pulse, 2);
}

function drawGameOver(g: Gfx, s: GameState) {
  const order = standings(s);
  standingsPanel(
    g,
    order.map((p) => ({ name: p.name, detail: `${p.tokens}★  ${p.wins} wins` })),
    order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
  );
}

// ---------------------------------------------------------------- log (DOM)

export function RoundLog({ state }: { state: GameState }) {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <aside className="log">
      <h3>Round log</h3>
      {state.history.length === 0 && <p className="muted">Results appear here after each round.</p>}
      <ol reversed>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>R{r.round}</b>{' '}
            {state.players.map((p) => (
              <span key={p.id} className={r.winner === p.id ? 'win' : ''}>
                {name(p.id)} {r.kept[p.id]}{' '}
              </span>
            ))}
            <em>{r.winner ? `→ ${name(r.winner)} +${r.card}` : '→ no winner'}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
