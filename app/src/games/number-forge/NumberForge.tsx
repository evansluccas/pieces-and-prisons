import { useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { standingsPanel, topBar } from '../shared/draw';
import { Persona, botMove, botThinkMs } from './bots';
import {
  Claim, DEFAULT_CONFIG, GameState, LETTERS, Op, ROWS, Tile, close, equationText, forge, letters, newGame, nextRound,
  standings, timeUp, winningOrder,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOTS: { name: string; persona: Persona }[] = [
  { name: 'Hana', persona: 'steady' },
  { name: 'Jun', persona: 'quick' },
  { name: 'Seo', persona: 'sloppy' },
  { name: 'Mira', persona: 'steady' },
  { name: 'Taeo', persona: 'sloppy' },
];
const OP_INK: Record<Op, string> = { '+': COLORS.emerald, '−': COLORS.sapphire, '×': COLORS.ruby, '÷': COLORS.gold };

export const RULES = [
  'Ten tiles sit in a pyramid, lettered A–J. Each has a number and an operator. Each round a TARGET is revealed and everyone races at the same time.',
  'FORGE: pick three different tiles in any order. The equation is 1st number, then the 2nd tile’s operator and number, then the 3rd tile’s — worked out LEFT TO RIGHT. The first tile’s operator is ignored, and division must come out whole.',
  'A correct forge scores +1 and claims those three tiles — they can’t score again in another order. A wrong forge, or tiles already claimed, costs −1. Nobody is told how many answers exist.',
  'CLOSE THE FORGE when you think every answer has been found: right +3 and the round ends; wrong −1 and the race goes on. A round lasts at most 60 seconds.',
  'Click tiles or type the letters (A–J), Enter to forge, Backspace to undo. 6 rounds; most points wins, lowest goes to prison.',
];

// Dev-only: ?quick plays 2 short rounds.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(1, botCount));
  const rng = seededRng(Date.now() & 0xffff);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    rng,
    QUICK ? { ...DEFAULT_CONFIG, rounds: 2, roundMs: 30_000 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng };
}

export type ForgeAction = { type: 'forge'; order: number[] } | { type: 'close' };

/** What a click does (solo and online share this): the new pick, and a move once one is made. */
export function forgeClick(id: string, s: GameState, pick: number[]): { pick: number[]; action?: ForgeAction } {
  if (s.phase !== 'play') return { pick };
  if (id.startsWith('tile:')) {
    const i = Number(id.slice(5));
    return { pick: pick.includes(i) ? pick.filter((x) => x !== i) : pick.length < 3 ? [...pick, i] : pick };
  }
  if (id === 'forge') return pick.length === 3 ? { pick: [], action: { type: 'forge', order: pick } } : { pick };
  if (id === 'back') return { pick: pick.slice(0, -1) };
  if (id === 'clear') return { pick: [] };
  if (id === 'close') return { pick, action: { type: 'close' } };
  return { pick };
}

/** Typing: A–J pick tiles, Enter forges, Backspace undoes, Escape clears (null = not ours). */
export function keyHit(key: string): string | null {
  const i = LETTERS.indexOf(key.toUpperCase());
  if (key.length === 1 && i >= 0) return `tile:${i}`;
  if (key === 'Enter') return 'forge';
  if (key === 'Backspace') return 'back';
  if (key === 'Escape') return 'clear';
  return null;
}

export function NumberForge({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [pick, setPickState] = useState<number[]>([]);
  // the latest pick, so fast typing never works from a stale one
  const pickRef = useRef<number[]>([]);
  const setPick = (p: number[]) => {
    pickRef.current = p;
    setPickState(p);
  };
  const roundStart = useRef(performance.now());
  const nextAt = useRef<Record<string, number>>({});
  const s = game.state;
  const elapsed = () => performance.now() - roundStart.current;

  // a fresh round: restart the clock and give every bot its first thinking time
  useEffect(() => {
    if (s.phase !== 'play') return;
    roundStart.current = performance.now();
    nextAt.current = Object.fromEntries(game.bots.map((b, i) => [`bot${i}`, botThinkMs(s, b.persona, game.rng)]));
    setPick([]);
  }, [s.round, s.phase === 'play']);

  // the race: check the clock and the bots a few times a second
  useEffect(() => {
    if (s.phase !== 'play') return;
    const t = setInterval(() => {
      const now = elapsed();
      setGame((g) => {
        let st = g.state;
        if (st.phase !== 'play') return g;
        if (now >= st.config.roundMs) return { ...g, state: timeUp(st) };
        g.bots.forEach((b, i) => {
          const id = `bot${i}`;
          if (st.phase !== 'play' || now < nextAt.current[id]) return;
          const m = botMove(st, b.persona, g.rng);
          if (m.kind === 'forge') st = forge(st, id, m.order, now);
          else if (m.kind === 'close') st = close(st, id, now);
          nextAt.current[id] = now + botThinkMs(st, b.persona, g.rng);
        });
        return st === g.state ? g : { ...g, state: st };
      });
    }, 200);
    return () => clearInterval(t);
  }, [s.phase, s.round]);

  const act = (fn: (st: GameState) => GameState) => setGame((g) => (g.state.phase === 'play' ? { ...g, state: fn(g.state) } : g));

  const onHit = (id: string) => {
    if (id === 'again') return setGame(setup(botCount));
    if (id === 'next') return setGame((g) => ({ ...g, state: nextRound(g.state, g.rng) }));
    const r = forgeClick(id, s, pickRef.current);
    setPick(r.pick);
    const a = r.action;
    if (a?.type === 'forge') act((st) => forge(st, ME, a.order, elapsed()));
    if (a?.type === 'close') act((st) => close(st, ME, elapsed()));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.phase !== 'play' || e.target instanceof HTMLSelectElement) return;
      const id = keyHit(e.key);
      if (!id) return;
      onHit(id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, pick, s.phase === 'play' ? elapsed() : 0)} onHit={onHit} />
      <ForgeLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, id: string) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? id);

const TW = 44;
const TH = 38;
function tilePos(i: number) {
  const r = ROWS.findIndex((row) => row.includes(i));
  const k = ROWS[r].indexOf(i);
  const rowW = ROWS[r].length * (TW + 4) - 4;
  return { x: Math.round(128 - rowW / 2 + k * (TW + 4)), y: 34 + r * (TH + 4) };
}

function claimText(s: GameState, c: Claim, tiles: Tile[] = s.tiles): string {
  const who = nameOf(s, c.player);
  if (c.kind === 'close') return c.ok ? `${who} closed the forge! +3` : `${who} tried to close too early −1`;
  const eq = `${letters(c.order!)}: ${equationText(tiles, c.order!)} = ${c.value ?? '✗'}`;
  if (c.ok) return `${who} forged ${eq}  +1`;
  return `${who}: ${eq} — ${c.repeat ? 'already claimed' : 'wrong'} −1`;
}

/** Extras for an online table: who the bench's latest line is about, a waiting note, and the Ready button. */
export interface OnlineHud { latest?: Claim; pending?: string; sub?: string; nextLabel?: string }

/** `now` = ms since the round started. */
export function drawScene(g: Gfx, s: GameState, pick: number[], now: number, hud?: OnlineHud) {
  const playing = s.phase === 'play';
  const last = s.history[s.history.length - 1];
  const tiles = playing ? s.tiles : last?.tiles ?? s.tiles;
  const target = playing ? s.target : last?.target ?? s.target;
  const claims = playing ? s.claims : last?.claims ?? [];
  const left = Math.max(0, s.config.roundMs - now);

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold },
    { text: playing ? `${Math.ceil(left / 1000)}s left` : 'round over', color: playing && left < 10_000 ? COLORS.ruby : COLORS.muted },
  ], 'NUMBER FORGE');
  if (playing) {
    g.rect(150, 12, 120, 4, '#2a1f4d');
    g.rect(150, 12, Math.round(120 * (left / s.config.roundMs)), 4, left < 10_000 ? COLORS.ruby : COLORS.gold);
  }

  // pyramid
  tiles.forEach((t, i) => {
    const { x, y } = tilePos(i);
    const id = `tile:${i}`;
    const sel = pick.indexOf(i);
    const hover = playing && g.isHover(id);
    g.panel('panel_night', x, y - (hover ? 1 : 0), TW, TH, 4);
    g.rect(x + 3, y + 3 - (hover ? 1 : 0), TW - 6, 3, OP_INK[t.op]);
    g.text(LETTERS[i], x + 5, y + 7, { size: 7, color: COLORS.muted });
    g.text(t.op, x + TW - 6, y + 6, { align: 'right', size: 10, color: OP_INK[t.op] });
    g.text(`${t.n}`, x + TW / 2, y + 15 - (hover ? 1 : 0), { align: 'center', size: 16, color: COLORS.ink });
    if (sel >= 0) {
      g.frame(x - 1, y - 1, TW + 2, TH + 2, COLORS.gold, 2);
      g.text(`${sel + 1}`, x + 5, y + TH - 11, { size: 8, color: COLORS.gold });
    }
    if (playing) g.hit(id, x, y, TW, TH);
  });
  g.text('first tile’s operator is ignored · left to right', 128, 202, { align: 'center', size: 7, color: COLORS.muted });

  // target
  g.panel('panel_parchment', 262, 30, 214, 46, 4);
  g.text('TARGET', 272, 36, { size: 8, color: '#5e3a24', shadow: false });
  g.text(`${target}`, 369, 40, { align: 'center', size: 24, color: '#86192f', shadow: false });

  // scores
  g.panel('panel_night', 262, 80, 214, 44, 4);
  const order = [...s.players].sort((a, b) => b.points - a.points);
  order.forEach((p, i) => {
    const x = 270 + (i % 3) * 68;
    const y = 86 + Math.floor(i / 3) * 18;
    g.text(nameOf(s, p.id), x, y, { size: 8, color: p.id === ME ? COLORS.gold : COLORS.ink });
    g.text(`${p.points}`, x + 58, y, { align: 'right', size: 9, color: p.points < 0 ? COLORS.ruby : COLORS.ink });
  });

  // claimed answers
  g.panel('panel_night', 262, 128, 214, 76, 4);
  if (playing) {
    const found = claims.filter((c) => c.kind === 'forge' && c.ok);
    g.text(`CLAIMED (${found.length})`, 270, 134, { size: 7, color: COLORS.muted });
    found.slice(-5).forEach((c, i) => {
      g.text(`${letters(c.order!)}  ${equationText(tiles, c.order!)}`, 270, 144 + i * 11, { size: 8, color: COLORS.emerald });
      g.text(nameOf(s, c.player), 468, 144 + i * 11, { align: 'right', size: 7, color: COLORS.muted });
    });
  } else if (last) {
    g.text(`ALL ANSWERS (${last.answers.length})`, 270, 134, { size: 7, color: COLORS.muted });
    last.answers.slice(0, 5).forEach((set, i) => {
      const o = winningOrder(last.tiles, set, last.target);
      const by = last.claims.find((c) => c.ok && c.kind === 'forge' && [...c.order!].sort().join() === [...set].sort().join());
      g.text(`${letters(o)}  ${equationText(last.tiles, o)}`, 270, 144 + i * 11, { size: 8, color: by ? COLORS.emerald : COLORS.muted });
      g.text(by ? nameOf(s, by.player) : 'missed', 468, 144 + i * 11, { align: 'right', size: 7, color: by ? COLORS.ink : COLORS.ruby });
    });
  }

  // your bench
  g.panel('panel_night', 4, 210, W - 8, 56, 4);
  if (playing) {
    const slots = [0, 1, 2].map((k) => pick[k]);
    const eq = slots
      .map((i, k) => (i === undefined ? (k === 0 ? '_' : '? _') : k === 0 ? `${tiles[i].n}` : `${tiles[i].op} ${tiles[i].n}`))
      .join('  ');
    g.text(`${slots.map((i) => (i === undefined ? '·' : LETTERS[i])).join(' ')}`, 14, 218, { size: 8, color: COLORS.muted });
    g.text(`${eq}  = ${target}?`, 14, 230, { size: 12, color: COLORS.gold });
    g.button('forge', 'Forge! (Enter)', 236, 216, 82, { disabled: pick.length !== 3 });
    g.button('clear', 'Clear', 236, 234, 82, { disabled: !pick.length });
    g.button('close', 'Close the forge (+3/−1)', 324, 216, 144, { color: 'red' });
    const latest = hud?.latest ?? claims[claims.length - 1];
    if (hud?.pending) g.text(hud.pending, 324, 238, { size: 7, color: COLORS.muted });
    else if (latest) {
      const ok = latest.ok;
      g.text(claimText(s, latest, tiles), 324, 238, { size: 7, color: ok ? COLORS.emerald : COLORS.ruby });
    }
  } else if (last) {
    const why = last.end === 'closed' ? claimText(s, last.claims[last.claims.length - 1], last.tiles) : 'Time is up!';
    g.text(why, 14, 220, { size: 10, color: COLORS.gold });
    const mine = last.claims.filter((c) => c.player === ME);
    const pts = mine.reduce((n, c) => n + (c.ok ? (c.kind === 'close' ? s.config.closeBonus : 1) : -1), 0);
    g.text(`Your round: ${pts >= 0 ? '+' : ''}${pts}`, 14, 238, { size: 9, color: pts < 0 ? COLORS.ruby : COLORS.ink });
    if (s.phase === 'result') g.button('next', hud?.nextLabel ?? (s.round >= s.config.rounds ? 'Final result' : 'Next round'), 388, 244, 80);
    if (s.phase === 'result' && hud?.sub) g.text(hud.sub, 468, 234, { align: 'right', size: 6, color: COLORS.muted });
  }

  if (s.phase === 'gameOver') {
    const ranked = standings(s);
    standingsPanel(
      g,
      ranked.map((p) => ({ name: p.name, detail: `${p.points} pts  ${p.correct} forged` })),
      ranked[0].id === ME ? 'You win the match!' : `${ranked[0].name} wins the match.`,
    );
  }
}

// ---------------------------------------------------------------- log (DOM)

export function ForgeLog({ state }: { state: GameState }) {
  const rounds = [
    ...(state.phase === 'play' ? [{ round: state.round, target: state.target, tiles: state.tiles, claims: state.claims }] : []),
    ...[...state.history].reverse().map((r) => ({ round: r.round, target: r.target, tiles: r.tiles, claims: r.claims })),
  ];
  return (
    <aside className="log">
      <h3>Forge log</h3>
      {rounds.every((r) => !r.claims.length) && <p className="muted">Every forge and close appears here, with the time it took.</p>}
      <ol>
        {rounds.map((r) => (
          <li key={r.round}>
            <b>Round {r.round}</b> · target {r.target}
            {[...r.claims].reverse().map((c, i) => (
              <em key={i} className={c.ok ? 'win' : 'tip'}>
                {(c.at / 1000).toFixed(1)}s · {claimText(state, c, r.tiles)}
              </em>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  );
}
