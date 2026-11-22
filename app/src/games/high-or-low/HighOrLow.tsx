import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, topBar } from '../shared/draw';
import { Level, botCall, botDeal } from './bots';
import { Call, GameState, Side, call, deal, guesser, newGame, winner } from './logic';

const W = 480;
const H = 270;
const ME: Side = 0;
const BOT: Side = 1;
const REVEAL_MS = 1900;
const LEVELS: { id: Level; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'deals at random, guesses loosely' },
  { id: 'normal', label: 'Normal', note: 'counts cards' },
  { id: 'hard', label: 'Hard', note: 'counts cards and reads your habits' },
];

export const RULES = [
  'FINAL DUEL — you and your opponent each hold the cards 1–10. 10 rounds; the dealer alternates (you deal first).',
  'DEALING: pick two of your cards — the first goes face UP, the second face DOWN.',
  'CALLING: the other player says HIGHER or LOWER — is the hidden card higher or lower than the shown one? A right call scores for the guesser; a wrong call scores for the dealer.',
  'Both cards are then revealed and leave the game, so you always know which cards each player has left. Count them — and bluff.',
  'Most points after 10 rounds wins.',
];

export function HighOrLow() {
  const [level, setLevel] = useState<Level | null>(null);
  const [s, setS] = useState<GameState>(() => newGame());
  const [picks, setPicks] = useState<number[]>([]); // [shown, hidden]
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const revealAt = useRef(0);

  useEffect(() => {
    if (s.history.length) revealAt.current = performance.now();
  }, [s.history.length]);

  // the bot deals or calls after the last reveal has been seen
  useEffect(() => {
    if (!level || s.phase === 'gameOver') return;
    const botDeals = s.phase === 'deal' && s.dealer === BOT;
    const botCalls = s.phase === 'call' && guesser(s) === BOT;
    if (!botDeals && !botCalls) return;
    const wait = Math.max(0, revealAt.current + REVEAL_MS - performance.now()) + pace(botCalls ? 1100 : 700);
    const t = setTimeout(() => setS((st) => {
      if (st.phase === 'deal' && st.dealer === BOT) {
        const d = botDeal(st, level, rng);
        return deal(st, BOT, d.shown, d.hidden);
      }
      if (st.phase === 'call' && guesser(st) === BOT) return call(st, BOT, botCall(st, level, rng));
      return st;
    }), wait);
    return () => clearTimeout(t);
  }, [s.phase, s.round, level]);

  const revealing = () => performance.now() - revealAt.current < REVEAL_MS && s.history.length > 0;

  const onHit = (id: string) => {
    if (id.startsWith('level:')) {
      setLevel(id.slice(6) as Level);
      setS(newGame());
      return setPicks([]);
    }
    if (id === 'again') return setLevel(null);
    if (revealing()) return;
    if (s.phase === 'deal' && s.dealer === ME) {
      if (id.startsWith('card:')) {
        const c = Number(id.slice(5));
        setPicks((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length < 2 ? [...p, c] : p));
      }
      if (id === 'deal' && picks.length === 2) {
        setS(deal(s, ME, picks[0], picks[1]));
        setPicks([]);
      }
    }
    if (s.phase === 'call' && guesser(s) === ME && (id === 'higher' || id === 'lower')) setS(call(s, ME, id as Call));
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (level ? drawScene(g, s, picks, level, revealing() ? performance.now() - revealAt.current : -1) : drawIntro(g))}
        onHit={onHit}
      />
      <RoundLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'FINAL DUEL', color: COLORS.amethyst }], 'HIGH OR LOW');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.sprite('cards', 'number_7', 202, 58);
  g.sprite('cards', 'back', 246, 58);
  g.text('Higher or lower? Count. Bluff.', 240, 108, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose your opponent', 240, 122, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 138 + i * 26;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

/** Ten little slots showing which cards a player still has. */
function tracker(g: Gfx, hand: number[], x: number, y: number, mark: number | null) {
  for (let c = 1; c <= 10; c++) {
    const has = hand.includes(c);
    const cx = x + (c - 1) * 22;
    g.rect(cx, y, 20, 18, has ? '#f1e4c3' : '#2a1f4d');
    g.text(`${c}`, cx + 10, y + 4, { align: 'center', size: 9, color: has ? '#3a2216' : '#5a4c8a', shadow: false });
    if (!has) g.rect(cx + 2, y + 8, 16, 2, '#5a4c8a');
    if (mark === c) g.frame(cx - 1, y - 1, 22, 20, COLORS.gold, 2);
  }
}

function drawScene(g: Gfx, s: GameState, picks: number[], level: Level, sinceReveal: number) {
  const last = s.history[s.history.length - 1];
  const showing = sinceReveal >= 0 && last;
  const over = s.phase === 'gameOver' && !showing;
  const myDeal = s.phase === 'deal' && s.dealer === ME && !showing;
  const myCall = s.phase === 'call' && guesser(s) === ME && !showing;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${Math.min(s.round, s.config.rounds)}/${s.config.rounds}`, color: COLORS.gold },
    { text: s.dealer === ME ? 'you deal' : 'the bot deals', color: COLORS.muted },
    { text: `vs ${level} bot`, color: COLORS.muted },
  ], 'HIGH OR LOW');

  // opponent's cards left (public)
  g.panel('panel_night', 4, 30, 362, 40, 4);
  g.text('BOT’S CARDS LEFT', 12, 34, { size: 7, color: COLORS.muted });
  tracker(g, s.hands[BOT], 124, 42, s.phase === 'call' && s.dealer === BOT ? s.shown : null);

  // the table
  g.rect(4, 74, 362, 104, '#16402a', 0.85);
  g.frame(4, 74, 362, 104, '#5e3a24', 2);
  const shown = showing ? last.shown : s.shown;
  const hidden = showing ? last.hidden : null;
  if (shown !== null) {
    g.text('FACE UP', 104, 78, { align: 'center', size: 7, color: COLORS.muted });
    g.sprite('cards', `number_${shown}`, 72, 86, { scale: 2 });
    if (showing) {
      const good = last.right === (last.dealer === BOT); // did it go your way?
      g.text(last.right ? '✓' : '✗', 185, 116, { align: 'center', size: 18, color: good ? COLORS.emerald : COLORS.ruby });
    } else g.text('vs', 185, 122, { align: 'center', size: 12, color: COLORS.gold });
    g.text('FACE DOWN', 266, 78, { align: 'center', size: 7, color: COLORS.muted });
    g.sprite('cards', hidden !== null ? `number_${hidden}` : 'back', 234, 86, { scale: 2 });
  } else {
    g.text(myDeal ? 'Pick a card to show, then a card to hide' : s.phase === 'deal' ? 'The bot is dealing…' : '', 185, 122, {
      align: 'center', size: 9, color: COLORS.muted,
    });
  }

  // your hand
  g.panel('panel_night', 4, 182, 362, 84, 4);
  g.text(myDeal ? 'YOUR HAND — 1st click: face up · 2nd click: face down' : 'YOUR CARDS LEFT', 12, 186, { size: 7, color: myDeal ? COLORS.gold : COLORS.muted });
  for (let c = 1; c <= 10; c++) {
    const x = 12 + (c - 1) * 35;
    const has = s.hands[ME].includes(c) || (s.phase === 'call' && s.dealer === ME && (c === s.shown || c === s.hidden));
    const k = picks.indexOf(c);
    const id = `card:${c}`;
    if (!has) {
      g.rect(x, 198, 32, 44, '#1b1233');
      continue;
    }
    const lift = k >= 0 ? 4 : myDeal && g.isHover(id) ? 2 : 0;
    g.sprite('cards', `number_${c}`, x, 198 - lift);
    if (k >= 0) g.text(k === 0 ? 'UP' : 'DOWN', x + 16, 246, { align: 'center', size: 7, color: k === 0 ? COLORS.gold : COLORS.sapphire });
    if (s.phase === 'call' && s.dealer === ME && c === s.shown) g.text('UP', x + 16, 246, { align: 'center', size: 7, color: COLORS.gold });
    if (s.phase === 'call' && s.dealer === ME && c === s.hidden) g.text('DOWN', x + 16, 246, { align: 'center', size: 7, color: COLORS.sapphire });
    if (myDeal) g.hit(id, x, 194, 32, 48);
  }

  // side panel
  const px = 370;
  g.panel('panel_night', px, 30, W - px - 4, 236, 4);
  g.text('YOU', px + 10, 38, { size: 7, color: COLORS.muted });
  g.text(`${s.scores[ME]}`, px + 10, 48, { size: 18, color: COLORS.sapphire });
  g.text('BOT', px + 58, 38, { size: 7, color: COLORS.muted });
  g.text(`${s.scores[BOT]}`, px + 58, 48, { size: 18, color: COLORS.ruby });
  if (showing) {
    const who = last.dealer === ME ? 'The bot' : 'You';
    const good = last.right === (last.dealer === BOT);
    g.text(`${who} called ${last.call.toUpperCase()}`, px + 10, 80, { size: 8, color: COLORS.ink });
    g.text(`${last.right ? 'Right' : 'Wrong'} — ${good ? 'you score!' : 'the bot scores'}`, px + 10, 92, { size: 8, color: good ? COLORS.emerald : COLORS.ruby });
  } else if (myDeal) {
    g.button('deal', 'Deal', px + 10, 84, W - px - 24, { disabled: picks.length !== 2, color: 'red' });
    g.text(picks.length === 0 ? 'choose the face-up card' : picks.length === 1 ? 'now the face-down card' : 'ready to deal', px + 10, 104, { size: 7, color: COLORS.muted });
  } else if (myCall) {
    g.text('Is the hidden card…', px + 10, 80, { size: 8, color: COLORS.ink });
    g.button('higher', 'HIGHER', px + 10, 96, W - px - 24);
    g.button('lower', 'LOWER', px + 10, 116, W - px - 24, { color: 'red' });
  } else if (s.phase === 'call' && s.dealer === ME && !showing) {
    g.text('The bot is deciding…', px + 10, 84, { size: 8, color: COLORS.muted });
  }
  g.text('LAST ROUNDS', px + 10, 146, { size: 7, color: COLORS.muted });
  s.history.slice(-8).reverse().forEach((r, i) => {
    const dealerName = r.dealer === ME ? 'You' : 'Bot';
    g.text(`${dealerName}: ${r.shown} / ${r.hidden} · ${r.call[0].toUpperCase()}${r.right ? '✓' : '✗'}`, px + 10, 158 + i * 11, {
      size: 7, color: (r.right ? r.dealer === BOT : r.dealer === ME) ? COLORS.emerald : COLORS.muted,
    });
  });

  if (over) {
    const w = winner(s);
    standingsPanel(
      g,
      [ME, BOT].sort((a, b) => s.scores[b] - s.scores[a]).map((side) => ({
        name: side === ME ? 'You' : `${level[0].toUpperCase()}${level.slice(1)} bot`,
        detail: `${s.scores[side]} points`,
      })),
      w === 'draw' ? 'A draw!' : w === ME ? 'You win the duel!' : 'The bot wins the duel.',
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

function RoundLog({ state }: { state: GameState }) {
  return (
    <aside className="log">
      <h3>Round log</h3>
      {!state.history.length && <p className="muted">Every deal and call appears here — all of it is public.</p>}
      <ol>
        {[...state.history].reverse().map((r, i) => {
          const n = state.history.length - i;
          const youScored = r.right ? r.dealer === BOT : r.dealer === ME;
          return (
            <li key={n}>
              <em className={youScored ? 'win' : 'tip'}>
                R{n}: {r.dealer === ME ? 'You' : 'Bot'} showed {r.shown}, hid {r.hidden} · {r.dealer === ME ? 'Bot' : 'You'} called {r.call} — {r.right ? 'right' : 'wrong'}
              </em>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
