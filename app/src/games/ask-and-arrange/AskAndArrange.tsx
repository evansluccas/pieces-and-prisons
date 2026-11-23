import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { Rng, seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { topBar } from '../shared/draw';
import { Level, botTurn, randomRow } from './bots';
import {
  COST, GameState, N, Question, Row, Side, answerText, arrange, ask, correct, guess, isRow, mustGuess, newGame, questionText, shortText,
  validQuestion, winner,
} from './logic';

const W = 480;
const H = 270;
const ME: Side = 0;
const BOT: Side = 1;
const LEVELS: { id: Level; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'asks random questions' },
  { id: 'normal', label: 'Normal', note: 'asks useful questions' },
  { id: 'hard', label: 'Hard', note: 'squeezes every token' },
];
const KINDS: { kind: Question['kind']; label: string }[] = [
  { kind: 'slot', label: 'Card in slot' },
  { kind: 'sum', label: 'Sum of slots' },
  { kind: 'compare', label: 'Slot vs slot' },
  { kind: 'before', label: 'Card order' },
];

export const RULES = [
  'FINAL DUEL — each of you secretly arranges the cards 1–8 in a row of 8 slots.',
  'You each have 10 TOKENS. Take turns asking ONE question about the other row — answers are always TRUE:',
  'What card is in slot A? (3) · What do slots A–B add up to, 2 to 4 slots? (3) · Is slot A higher than slot B? (1) · Is card X left of card Y? (1)',
  'Use the NOTES grid to cross off what you rule out. Whenever you like — and when your tokens run out — GUESS the whole row; after that you stop asking.',
  'Most slots right wins; ties go to whoever spent fewer tokens.',
];

type Note = 0 | 1 | 2;
interface Draft { kind: Question['kind']; a: number | null; b: number | null }

/** Everything the screen keeps while you play: your setup row, the question being built, your guess and notes. */
export interface Ui { mine: (number | null)[]; draft: Draft; guessing: boolean; guessRow: (number | null)[]; notes: Note[][] }

export const freshUi = (): Ui => ({
  mine: Array(N).fill(null),
  draft: { kind: 'compare', a: null, b: null },
  guessing: false,
  guessRow: Array(N).fill(null),
  notes: Array.from({ length: N }, () => Array<Note>(N).fill(0)),
});

/** A move the screen makes: solo applies it at once, online sends it to the table. */
export type Move = { type: 'arrange'; row: Row } | { type: 'ask'; q: Question } | { type: 'guess'; row: Row };

/**
 * One click on the stage (solo and online share this). `s` is drawn with you
 * as side 0. Returns the screen's new state and, if the click made one, a move.
 */
export function stageClick(id: string, s: GameState, ui: Ui, rng: Rng): { ui: Ui; move?: Move } {
  const { mine, draft, guessRow } = ui;
  const out = (u: Partial<Ui>, move?: Move) => ({ ui: { ...ui, ...u }, move });
  if (id.startsWith('note:')) {
    const [r, c] = id.slice(5).split(',').map(Number);
    return out({ notes: ui.notes.map((row, i) => (i === r ? row.map((v, j) => (j === c ? (((v + 1) % 3) as Note) : v)) : row)) });
  }
  // setup: build your own row
  if (s.phase === 'setup') {
    if (id.startsWith('pal:')) {
      const c = Number(id.slice(4));
      const at = mine.indexOf(null);
      if (at >= 0 && !mine.includes(c)) return out({ mine: mine.map((x, i) => (i === at ? c : x)) });
    }
    if (id.startsWith('mine:')) return out({ mine: mine.map((x, i) => (i === Number(id.slice(5)) ? null : x)) });
    if (id === 'shuffle') return out({ mine: randomRow(rng) });
    if (id === 'clearRow') return out({ mine: Array(N).fill(null) });
    if (id === 'ready' && isRow(mine as Row)) return out({}, { type: 'arrange', row: mine as Row });
    return out({});
  }
  if (s.phase !== 'ask' || s.turn !== ME || s.guesses[ME] !== null) return out({});
  if (ui.guessing) {
    if (id.startsWith('pal:')) {
      const c = Number(id.slice(4));
      const at = guessRow.indexOf(null);
      if (at >= 0 && !guessRow.includes(c)) return out({ guessRow: guessRow.map((x, i) => (i === at ? c : x)) });
    }
    if (id.startsWith('their:')) return out({ guessRow: guessRow.map((x, i) => (i === Number(id.slice(6)) ? null : x)) });
    if (id === 'back' && !mustGuess(s, ME)) return out({ guessing: false });
    if (id === 'submit' && isRow(guessRow as Row)) return out({ guessing: false }, { type: 'guess', row: guessRow as Row });
    return out({});
  }
  if (id.startsWith('kind:')) return out({ draft: { kind: id.slice(5) as Question['kind'], a: null, b: null } });
  if (id.startsWith('pa:')) return out({ draft: { ...draft, a: Number(id.slice(3)) } });
  if (id.startsWith('pb:')) return out({ draft: { ...draft, b: Number(id.slice(3)) } });
  if (id === 'ask') {
    const q = draftQuestion(draft);
    if (q && s.tokens[ME] >= COST[q.kind]) return out({ draft: { ...draft, a: null, b: null } }, { type: 'ask', q });
  }
  if (id === 'guessNow') return out({ guessing: true });
  return out({});
}

function draftQuestion(d: Draft): Question | null {
  if (d.a === null) return null;
  if (d.kind === 'slot') return { kind: 'slot', a: d.a };
  if (d.b === null) return null;
  const q: Question =
    d.kind === 'sum' ? { kind: 'sum', a: Math.min(d.a, d.b), b: Math.max(d.a, d.b) }
      : d.kind === 'compare' ? { kind: 'compare', a: d.a, b: d.b }
        : { kind: 'before', x: d.a, y: d.b };
  return validQuestion(q) ? q : null;
}

export function AskAndArrange() {
  const [level, setLevel] = useState<Level | null>(null);
  const [rng] = useState(() => seededRng(Date.now() & 0xffff));
  const [s, setS] = useState<GameState>(() => newGame(randomRow(rng)));
  const [ui, setUi] = useState<Ui>(freshUi);

  // the bot's turn
  useEffect(() => {
    if (!level || s.phase !== 'ask' || s.turn !== BOT) return;
    const t = setTimeout(() => setS((st) => {
      if (st.phase !== 'ask' || st.turn !== BOT) return st;
      const a = botTurn(st, BOT, level, rng);
      return a.kind === 'ask' ? ask(st, BOT, a.q) : guess(st, BOT, a.row);
    }), pace(1000));
    return () => clearTimeout(t);
  }, [s.phase, s.turn, s.asked.length, s.guesses[BOT], level]);

  // out of tokens: straight to guessing
  useEffect(() => {
    if (s.phase === 'ask' && s.turn === ME && s.guesses[ME] === null && mustGuess(s, ME)) setUi((u) => ({ ...u, guessing: true }));
  }, [s.phase, s.turn, s.tokens[ME]]);

  const onHit = (id: string) => {
    if (id.startsWith('level:')) {
      setLevel(id.slice(6) as Level);
      setS(newGame(randomRow(rng)));
      return setUi({ ...freshUi(), draft: ui.draft });
    }
    if (id === 'again') return setLevel(null);
    const r = stageClick(id, s, ui, rng);
    setUi(r.ui);
    if (r.move?.type === 'arrange') setS(arrange(s, r.move.row));
    if (r.move?.type === 'ask') setS(ask(s, ME, r.move.q));
    if (r.move?.type === 'guess') setS(guess(s, ME, r.move.row));
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (level ? drawScene(g, s, level, ui) : drawIntro(g))}
        onHit={onHit}
      />
      <AskLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'FINAL DUEL', color: COLORS.amethyst }], 'ASK & ARRANGE');
  g.panel('panel_parchment', 110, 50, 260, 170, 4);
  g.sprite('icons', 'question', 232, 58);
  g.text('Ten tokens. True answers. One row to crack.', 240, 82, { align: 'center', size: 9, color: '#3a2216', shadow: false });
  g.text('Choose your opponent', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  LEVELS.forEach((l, i) => {
    const y = 116 + i * 28;
    g.button(`level:${l.id}`, l.label, 128, y, 70, { color: l.id === 'hard' ? 'red' : 'blue' });
    g.text(l.note, 206, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

const SLOT_X = (i: number) => 12 + i * 36;

function cardAt(g: Gfx, c: number | null, x: number, y: number, back = false) {
  if (back) g.sprite('cards', 'back', x, y);
  else if (c !== null) g.sprite('cards', `number_${c}`, x, y);
  else {
    g.rect(x, y, 32, 44, '#1b1233');
    g.frame(x, y, 32, 44, '#3d3175');
  }
}

/** Online play: the opponent's name (instead of "bot"), the move clock, and whether your row is locked in while they arrange. */
export interface OnlineHud { opponent: string; clock?: string; locked?: boolean }

export function drawScene(g: Gfx, s: GameState, level: Level | null, ui: Ui, hud?: OnlineHud) {
  const { mine, draft, guessing, guessRow, notes } = ui;
  const over = s.phase === 'gameOver';
  const myTurn = s.phase === 'ask' && s.turn === ME && s.guesses[ME] === null;
  const rival = hud?.opponent ?? 'bot';
  const RIVAL = rival.toUpperCase();
  const locked = s.phase === 'setup' && !!hud?.locked;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: s.phase === 'setup' ? (locked ? 'ROW LOCKED IN' : 'ARRANGE YOUR ROW') : over ? 'REVEAL' : myTurn ? 'YOUR TURN' : s.turn === BOT ? `${RIVAL.slice(0, 14)} ASKING…` : '', color: COLORS.gold },
    { text: `your tokens ${s.tokens[ME]}`, color: COLORS.sapphire },
    { text: `${rival.slice(0, 12)} tokens ${s.tokens[BOT]}`, color: COLORS.ruby },
    ...(hud?.clock ? [{ text: hud.clock, color: COLORS.ruby }] : []),
  ], 'ASK & ARRANGE');

  // the bot's row (top)
  g.panel('panel_night', 4, 30, 296, 70, 4);
  g.text(guessing ? `YOUR GUESS OF ${hud ? RIVAL.slice(0, 12) + '’S' : 'THE BOT’S'} ROW — click a slot to take a card back` : `${RIVAL}’S ROW`, 10, 34, { size: 7, color: guessing ? COLORS.gold : COLORS.muted });
  for (let i = 0; i < N; i++) {
    const x = SLOT_X(i);
    g.text(`${i + 1}`, x + 16, 44, { align: 'center', size: 7, color: COLORS.muted });
    if (over) {
      cardAt(g, s.rows[BOT][i], x, 52);
      const gs = s.guesses[ME]?.[i];
      if (gs !== undefined) g.text(`you: ${gs}`, x + 16, 97 - 2, { align: 'center', size: 6, color: gs === s.rows[BOT][i] ? COLORS.emerald : COLORS.ruby });
    } else if (guessing || s.guesses[ME]) {
      const row = s.guesses[ME] ?? guessRow;
      cardAt(g, row[i], x, 52);
      if (guessing) g.hit(`their:${i}`, x, 52, 32, 44);
    } else cardAt(g, null, x, 52, true);
  }

  // middle: setup palette / question builder / guess palette
  g.panel('panel_night', 4, 102, 296, 86, 4);
  const palette = (used: (number | null)[], y: number) => {
    for (let c = 1; c <= N; c++) {
      const x = SLOT_X(c - 1);
      const gone = used.includes(c);
      if (gone) g.rect(x, y, 32, 44, '#1b1233');
      else {
        g.sprite('cards', `number_${c}`, x, y - (g.isHover(`pal:${c}`) ? 2 : 0));
        g.hit(`pal:${c}`, x, y, 32, 44);
      }
    }
  };
  if (locked) {
    g.text(`Your row is locked in — waiting for ${rival} to arrange theirs…`, 10, 140, { size: 8, color: COLORS.muted });
  } else if (s.phase === 'setup') {
    g.text('Click cards in the order you want them (left to right)', 10, 106, { size: 7, color: COLORS.muted });
    palette(mine, 118);
    g.button('shuffle', 'Shuffle', 10, 168, 70);
    g.button('clearRow', 'Clear', 86, 168, 60, { disabled: !mine.some((x) => x !== null) });
    g.button('ready', 'Lock it in', 200, 168, 90, { color: 'red', disabled: !isRow(mine as Row) });
  } else if (guessing) {
    g.text(`Click cards to fill ${hud ? `${rival}’s` : 'the bot’s'} row, slot 1 first`, 10, 106, { size: 7, color: COLORS.muted });
    palette(guessRow, 118);
    if (!mustGuess(s, ME)) g.button('back', 'Back to questions', 10, 168, 110);
    else g.text('Out of tokens — time to guess', 10, 172, { size: 7, color: COLORS.ruby });
    g.button('submit', 'Submit guess', 196, 168, 94, { color: 'red', disabled: !isRow(guessRow as Row) });
  } else if (myTurn) {
    KINDS.forEach((k, i) => {
      const can = s.tokens[ME] >= COST[k.kind];
      g.button(`kind:${k.kind}`, `${k.label} (${COST[k.kind]})`, 8 + i * 73, 106, 70, { color: draft.kind === k.kind ? 'red' : 'blue', disabled: !can });
    });
    const cards = draft.kind === 'before';
    const lbl = draft.kind === 'slot' ? ['slot'] : draft.kind === 'sum' ? ['from', 'to'] : cards ? ['card', 'card'] : ['slot', 'vs slot'];
    lbl.forEach((name, row) => {
      const y = 124 + row * 16;
      g.text(name, 10, y + 3, { size: 7, color: COLORS.muted });
      for (let k = 0; k < N; k++) {
        const v = cards ? k + 1 : k;
        const on = (row === 0 ? draft.a : draft.b) === v;
        g.button(`${row === 0 ? 'pa' : 'pb'}:${v}`, `${k + 1}`, 52 + k * 22, y, 20, { color: on ? 'red' : 'blue' });
      }
    });
    const q = draftQuestion(draft);
    g.text(q ? questionText(q) : draft.kind === 'sum' ? 'pick 2 to 4 slots in a row' : 'pick your question', 10, 160, { size: 8, color: q ? COLORS.ink : COLORS.muted });
    g.button('ask', q ? `Ask (${COST[q.kind]})` : 'Ask', 10, 172, 70, { color: 'red', disabled: !q || s.tokens[ME] < COST[q.kind] });
    g.button('guessNow', 'Guess the row now', 176, 172, 116);
  } else if (over) {
    // the result sits between the two revealed rows, so both stay visible
    const w = winner(s);
    g.text(w === 'draw' ? 'A DRAW' : w === ME ? 'YOU WIN THE DUEL!' : hud ? `${RIVAL.slice(0, 14)} WINS THE DUEL` : 'THE BOT WINS THE DUEL', 152, 108, {
      align: 'center', size: 11, color: w === ME ? COLORS.emerald : w === 'draw' ? COLORS.gold : COLORS.ruby,
    });
    g.text(`You: ${correct(s, ME)}/8 slots right · ${s.config.tokens - s.tokens[ME]} tokens used`, 152, 126, { align: 'center', size: 8, color: COLORS.sapphire });
    g.text(`${hud ? rival : `${level![0].toUpperCase()}${level!.slice(1)} bot`}: ${correct(s, BOT)}/8 right · ${s.config.tokens - s.tokens[BOT]} tokens used`, 152, 138, { align: 'center', size: 8, color: COLORS.ruby });
    g.text(`green = your right guesses up top · red = what ${hud ? rival : 'the bot'} got right below`, 152, 152, { align: 'center', size: 6, color: COLORS.muted });
    g.button('again', 'Play again', 112, 166, 80);
  } else {
    g.text(s.guesses[ME] ? `Your guess is in — ${hud ? rival : 'the bot'} is still asking…` : `${hud ? rival : 'The bot'} is thinking about your row…`, 10, 140, { size: 8, color: COLORS.muted });
  }

  // your row (bottom)
  g.panel('panel_night', 4, 190, 296, 76, 4);
  g.text(s.phase === 'setup' && !locked ? 'YOUR ROW — click a card to take it back' : 'YOUR ROW (secret)', 10, 194, { size: 7, color: COLORS.muted });
  for (let i = 0; i < N; i++) {
    const x = SLOT_X(i);
    const c = s.phase === 'setup' && !locked ? mine[i] : s.rows[ME][i] ?? null;
    cardAt(g, c, x, 204);
    if (s.phase === 'setup' && !locked && c !== null) g.hit(`mine:${i}`, x, 204, 32, 44);
    if (over && s.guesses[BOT]) {
      const bg = s.guesses[BOT]![i];
      g.text(`${hud ? rival.slice(0, 5) : 'bot'}: ${bg}`, x + 16, 252, { align: 'center', size: 6, color: bg === s.rows[ME][i] ? COLORS.ruby : COLORS.muted });
    }
  }
  const lastBot = [...s.asked].reverse().find((a) => a.by === BOT);
  if (lastBot && !over) g.text(`${hud ? rival.slice(0, 12) : 'Bot'} asked: ${questionText(lastBot.q)} → ${answerText(lastBot.answer)}`, 10, 252, { size: 7, color: COLORS.ruby });

  // notes + your answers
  const nx = 304;
  g.panel('panel_night', nx, 30, W - nx - 4, 236, 4);
  g.text('NOTES: slot × card (click)', nx + 6, 34, { size: 7, color: COLORS.muted });
  const cs = 15;
  const gx = nx + 20;
  for (let c = 0; c < N; c++) g.text(`${c + 1}`, gx + c * cs + cs / 2, 44, { align: 'center', size: 7, color: COLORS.ink });
  for (let r = 0; r < N; r++) {
    const y = 54 + r * cs;
    g.text(`${r + 1}`, nx + 8, y + 3, { size: 7, color: COLORS.gold });
    for (let c = 0; c < N; c++) {
      const x = gx + c * cs;
      const id = `note:${r},${c}`;
      const v = notes[r][c];
      g.rect(x + 1, y, cs - 2, cs - 2, g.isHover(id) ? '#3a2d6e' : '#231a45');
      if (v === 1) g.text('✗', x + cs / 2, y + 2, { align: 'center', size: 8, color: COLORS.ruby });
      if (v === 2) g.text('✓', x + cs / 2, y + 2, { align: 'center', size: 8, color: COLORS.emerald });
      if (s.phase !== 'setup') g.hit(id, x + 1, y, cs - 2, cs - 2);
    }
  }
  g.text('YOUR ANSWERS', nx + 6, 178, { size: 7, color: COLORS.muted });
  s.asked.filter((a) => a.by === ME).slice(-7).forEach((a, i) => {
    g.text(shortText(a.q, a.answer), nx + 6, 188 + i * 10, {
      size: 6, color: COLORS.ink,
    });
  });

}

// ---------------------------------------------------------------- log (DOM)

export function AskLog({ state, opponent }: { state: GameState; opponent?: string }) {
  const rival = opponent ?? 'Bot';
  return (
    <aside className="log">
      <h3>Questions</h3>
      {!state.asked.length && <p className="muted">Every question and its true answer, yours and {opponent ? `${opponent}’s` : 'the bot’s'}.</p>}
      <ol>
        {[...state.asked].reverse().map((a, i) => (
          <li key={state.asked.length - i}>
            <em className={a.by === ME ? 'win' : 'tip'}>
              {a.by === ME ? 'You' : rival}: {questionText(a.q)} → {answerText(a.answer)}
            </em>
          </li>
        ))}
      </ol>
      {state.phase === 'gameOver' && (
        <p className="muted">
          {rival}’s row: {state.rows[BOT].join(' ')} · your guess: {state.guesses[ME]?.join(' ')} · your row: {state.rows[ME].join(' ')} · {opponent ? `${opponent}’s` : 'bot’s'} guess: {state.guesses[BOT]?.join(' ')}
        </p>
      )}
    </aside>
  );
}
