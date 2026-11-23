import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { Clue, Code, DEFAULT_CONFIG, Difficulty, GameState, L, clock, clueText, codeText, newGame, nextLock, standings, tryCode } from './logic';

export const W = 480;
export const H = 270;
const GHOSTS = ['Hana', 'Jun', 'Seo', 'Mira', 'Taeo'];
const DIFFS: { id: Difficulty; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'letters A–F' },
  { id: 'normal', label: 'Normal', note: 'letters A–H' },
  { id: 'hard', label: 'Hard', note: 'letters A–J, trickier clues' },
];

export const RULES = [
  'EXILE PUZZLE — no opponents at the table: you race the clock. The others race the same locks; their times appear as you go.',
  'Each lock has a secret code of 4 DIFFERENT letters, in any order. The clues allow exactly one code — every clue is needed.',
  'Type or click letters to fill the four slots, then Try it (Enter). A wrong try adds 30 seconds.',
  'Use the NOTES grid like scrap paper: click a cell to cross a letter out of a slot (✗), mark it as certain (✓), or clear it.',
  'Three locks in a row. Lowest total time wins; the slowest is exiled.',
];

// Dev-only: ?quick plays a single easy lock.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

export type Note = 0 | 1 | 2; // blank, crossed out, certain

export const emptyNotes = (letters: number): Note[][] => Array.from({ length: 4 }, () => Array<Note>(letters).fill(0));

/** What you are typing and your scrap-paper notes. */
export interface LockInput { entry: number[]; notes: Note[][] }

/**
 * A click (or key) on the lock, shared by solo and online play: the new entry
 * and notes, plus the code to try when it was "Try it" with four letters in.
 */
export function lockClick(id: string, input: LockInput, letters: number): LockInput & { attempt?: Code } {
  const { entry, notes } = input;
  if (id.startsWith('key:')) {
    const i = Number(id.slice(4));
    const ok = Number.isInteger(i) && i >= 0 && i < letters && entry.length < 4 && !entry.includes(i);
    return { entry: ok ? [...entry, i] : entry, notes };
  }
  if (id === 'del') return { entry: entry.slice(0, -1), notes };
  if (id === 'clear') return { entry: [], notes };
  if (id === 'try') return entry.length === 4 ? { entry: [], notes, attempt: entry } : input;
  if (id.startsWith('note:')) {
    const [slot, letter] = id.slice(5).split(',').map(Number);
    return { entry, notes: notes.map((row, r) => (r === slot ? row.map((v, c) => (c === letter ? (((v + 1) % 3) as Note) : v)) : row)) };
  }
  return input;
}

/** Which lock control a key stands for (letters, Backspace, Enter, Escape), if any. */
export function keyHit(key: string, letters: number): string | null {
  const i = key.toUpperCase().charCodeAt(0) - 65;
  if (key.length === 1 && i >= 0 && i < letters) return `key:${i}`;
  if (key === 'Backspace') return 'del';
  if (key === 'Enter') return 'try';
  if (key === 'Escape') return 'clear';
  return null;
}

function setup(difficulty: Difficulty, ghostCount: number) {
  const rng = seededRng(Date.now() & 0xffff);
  return newGame(rng, difficulty, GHOSTS.slice(0, Math.max(1, ghostCount)), QUICK ? { ...DEFAULT_CONFIG, locks: 1 } : DEFAULT_CONFIG);
}

export function CipherLock({ botCount = 3 }: { botCount?: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [entry, setEntry] = useState<number[]>([]);
  const [notes, setNotes] = useState<Note[][]>([]);
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  const lockStart = useRef(performance.now());
  const s = state;

  // a new lock: restart the clock, clear the entry and notes
  useEffect(() => {
    if (!s || s.phase !== 'solve') return;
    lockStart.current = performance.now();
    setEntry([]);
    setNotes(emptyNotes(s.puzzle.letters));
    setFlash(null);
  }, [s?.lock, s?.phase === 'solve', s?.puzzle]);

  const start = (d: Difficulty) => setState(setup(d, botCount));
  const elapsed = () => performance.now() - lockStart.current;

  // entry, notes and tries, the same way online play does them
  const press = (id: string) => {
    if (!s || s.phase !== 'solve') return;
    const r = lockClick(id, { entry, notes }, s.puzzle.letters);
    setEntry(r.entry);
    setNotes(r.notes);
    if (!r.attempt) return;
    const next = tryCode(s, r.attempt, elapsed());
    if (next.phase === 'solve') setFlash({ text: `${codeText(r.attempt)} is wrong — +30s`, at: performance.now() });
    setState(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!s || s.phase !== 'solve' || e.target instanceof HTMLSelectElement) return;
      const id = keyHit(e.key, s.puzzle.letters);
      if (!id) return;
      press(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onHit = (id: string) => {
    if (id.startsWith('diff:')) return start(id.slice(5) as Difficulty);
    if (!s) return;
    if (id === 'again') return setState(null);
    if (id === 'next') return setState(nextLock(s));
    press(id);
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => (s ? drawScene(g, s, entry, notes, s.phase === 'solve' ? elapsed() : 0, flash) : drawIntro(g))}
        onHit={onHit}
      />
      <LockLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawIntro(g: Gfx) {
  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: 'EXILE PUZZLE', color: COLORS.amethyst }], 'CIPHER LOCK');
  g.panel('panel_parchment', 120, 50, 240, 170, 4);
  g.sprite('icons', 'lock', 232, 60, { scale: 1 });
  g.text('Crack three locks, fast.', 240, 82, { align: 'center', size: 10, color: '#3a2216', shadow: false });
  g.text('Choose a difficulty', 240, 98, { align: 'center', size: 8, color: '#5e3a24', shadow: false });
  DIFFS.forEach((d, i) => {
    const y = 120 + i * 30;
    g.button(`diff:${d.id}`, d.label, 150, y, 80, { color: d.id === 'hard' ? 'red' : 'blue' });
    g.text(d.note, 240, y + 3, { size: 8, color: '#5e3a24', shadow: false });
  });
}

function drawScene(g: Gfx, s: GameState, entry: number[], notes: Note[][], now: number, flash: { text: string; at: number } | null) {
  const solving = s.phase === 'solve';
  const p = solving ? s.puzzle : s.results[s.results.length - 1].puzzle;
  const penalty = s.wrong.length * s.config.penaltyMs;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `LOCK ${s.lock + 1}/${s.config.locks}`, color: COLORS.gold },
    { text: solving ? `${clock(now + penalty)}${penalty ? ` (incl. +${penalty / 1000}s)` : ''}` : 'open!', color: COLORS.ink },
    { text: s.difficulty.toUpperCase(), color: COLORS.muted },
  ], 'CIPHER LOCK');

  drawClues(g, p.clues, p.letters);
  drawNotes(g, notes, p.letters, solving);

  // tries and other players' times
  g.panel('panel_night', 298, 132, 178, 72, 4);
  if (solving) drawWrong(g, s.wrong);
  else {
    const r = s.results[s.results.length - 1];
    g.text(`LOCK ${s.results.length} TIMES`, 306, 138, { size: 7, color: COLORS.muted });
    const rows = [{ name: 'You', ms: r.timeMs }, ...s.ghosts.map((gh) => ({ name: gh.name, ms: gh.times[s.results.length - 1] }))].sort((a, b) => a.ms - b.ms);
    rows.slice(0, 5).forEach((row, i) => {
      g.text(`${i + 1}. ${row.name}`, 306, 150 + i * 10, { size: 8, color: row.name === 'You' ? COLORS.gold : COLORS.ink });
      g.text(clock(row.ms), 468, 150 + i * 10, { align: 'right', size: 8, color: COLORS.ink });
    });
  }

  // entry
  g.panel('panel_night', 4, 208, W - 8, 58, 4);
  if (solving) drawEntry(g, p.letters, entry, flash);
  else if (s.phase === 'solved') {
    const r = s.results[s.results.length - 1];
    g.text(`OPEN! The code was ${codeText(r.puzzle.code)}`, 12, 216, { size: 11, color: COLORS.emerald });
    g.text(`Your time ${clock(r.timeMs)}${r.wrong ? ` (${r.wrong} wrong ${r.wrong === 1 ? 'try' : 'tries'}, +${r.wrong * 30}s)` : ''}`, 12, 234, {
      size: 8, color: COLORS.ink,
    });
    g.button('next', s.results.length >= s.config.locks ? 'Final result' : 'Next lock', 388, 244, 80);
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    const youLast = order[order.length - 1].name === 'You';
    standingsPanel(
      g,
      order.map((row) => ({ name: row.name, detail: clock(row.ms) })),
      order[0].name === 'You' ? 'Fastest — you win the exile match!' : youLast ? 'Slowest — you are exiled.' : `${order[0].name} was fastest. You survive.`,
    );
  }
}

/** The clue list on the left. */
export function drawClues(g: Gfx, clues: Clue[], n: number) {
  g.panel('panel_parchment', 4, 30, 292, 174, 4);
  g.text(`CLUES — letters ${L(0)}–${L(n - 1)}, four different, one answer`, 12, 36, { size: 7, color: '#5e3a24', shadow: false });
  let y = 48;
  clues.forEach((c, i) => {
    g.text(`${i + 1}.`, 12, y, { size: 8, color: '#86192f', shadow: false });
    const lines = wrapInk(g, clueText(c), 24, y, 264);
    y += lines * 10 + 3;
  });
}

/** The notes grid (top right); cells are clickable while `active`. */
export function drawNotes(g: Gfx, notes: Note[][], n: number, active: boolean) {
  const gx = 302;
  const cw = Math.floor((172 - 22) / n);
  g.panel('panel_night', 298, 30, 178, 98, 4);
  g.text('NOTES (click: ✗ / ✓ / clear)', gx + 4, 35, { size: 7, color: COLORS.muted });
  for (let c = 0; c < n; c++) g.text(L(c), gx + 22 + c * cw + cw / 2, 46, { align: 'center', size: 8, color: COLORS.ink });
  for (let r = 0; r < 4; r++) {
    const ry = 57 + r * 17;
    g.text(`${r + 1}`, gx + 8, ry + 3, { size: 8, color: COLORS.gold });
    for (let c = 0; c < n; c++) {
      const x = gx + 22 + c * cw;
      const v = notes[r]?.[c] ?? 0;
      const id = `note:${r},${c}`;
      g.rect(x + 1, ry, cw - 2, 15, g.isHover(id) ? '#3a2d6e' : '#231a45');
      if (v === 1) g.text('✗', x + cw / 2, ry + 3, { align: 'center', size: 9, color: COLORS.ruby });
      if (v === 2) g.text('✓', x + cw / 2, ry + 3, { align: 'center', size: 9, color: COLORS.emerald });
      if (active) g.hit(id, x + 1, ry, cw - 2, 15);
    }
  }
}

/** Your wrong tries, inside the small panel at 298,132. */
export function drawWrong(g: Gfx, wrong: Code[]) {
  g.text('YOUR WRONG TRIES', 306, 138, { size: 7, color: COLORS.muted });
  if (!wrong.length) g.text('none yet', 306, 150, { size: 8, color: COLORS.muted });
  wrong.slice(-5).forEach((w, i) => g.text(`${codeText(w)}  ✗`, 306 + (i % 2) * 80, 150 + Math.floor(i / 2) * 12, { size: 9, color: COLORS.ruby }));
}

/** The four slots and the keypad, inside the bottom panel. */
export function drawEntry(g: Gfx, n: number, entry: number[], flash: { text: string; at: number } | null, busy = false) {
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 26;
    g.rect(x, 214, 22, 26, '#1b1233');
    g.frame(x, 214, 22, 26, k === entry.length ? COLORS.gold : '#4a3a8a');
    if (entry[k] !== undefined) g.text(L(entry[k]), x + 11, 219, { align: 'center', size: 14, color: COLORS.gold });
  }
  for (let c = 0; c < n; c++) {
    const used = entry.includes(c);
    g.button(`key:${c}`, L(c), 122 + c * 22, 214, 20, { disabled: used || entry.length >= 4 });
  }
  g.button('del', 'Del', 122, 234, 40, { disabled: !entry.length });
  g.button('try', 'Try it (Enter)', 168, 234, 80, { disabled: entry.length !== 4 || busy, color: 'red' });
  if (flash && performance.now() - flash.at < 2500) g.text(flash.text, 256, 238, { size: 8, color: COLORS.ruby });
  else g.text(busy ? 'trying…' : 'or type the letters', 256, 238, { size: 7, color: COLORS.muted });
}

/** Clue text on parchment (dark ink, no shadow). */
function wrapInk(g: Gfx, text: string, x: number, y: number, maxW: number): number {
  g.ctx.font = '8px "DotGothic16", monospace';
  let line = '';
  let row = 0;
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (g.ctx.measureText(test).width > maxW && line) {
      g.text(line, x, y + row * 10, { size: 8, color: '#3a2216', shadow: false });
      line = w;
      row++;
    } else line = test;
  }
  if (line) g.text(line, x, y + row * 10, { size: 8, color: '#3a2216', shadow: false });
  return row + 1;
}

// ---------------------------------------------------------------- log (DOM)

function LockLog({ state }: { state: GameState | null }) {
  return (
    <aside className="log">
      <h3>Lock log</h3>
      {!state?.results.length && <p className="muted">Each lock’s code, your time and everyone else’s appear here.</p>}
      <ol>
        {(state?.results ?? []).map((r, i) => (
          <li key={i}>
            <b>Lock {i + 1}</b> · {codeText(r.puzzle.code)}
            <em className="win">You {clock(r.timeMs)}{r.wrong ? ` (${r.wrong} wrong)` : ''}</em>
            <em>{state!.ghosts.map((gh) => `${gh.name} ${clock(gh.times[i])}`).join(' · ')}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
