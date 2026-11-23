import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../shared/rng';
import { pace } from '../shared/pace';
import { standingsPanel, starCount, topBar } from '../shared/draw';
import { Persona, botAdd, botClaim, botRespond } from './bots';
import {
  Color, DEFAULT_CONFIG, GameState, MAX_CLAIM, add, claim, newGame, proceed, respond, responders, standings,
} from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const BOT_DELAY = 800;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'steady', portrait: 'officer' },
  { name: 'Jun', persona: 'trickster', portrait: 'journalist' },
  { name: 'Seo', persona: 'skeptic', portrait: 'fanatic' },
  { name: 'Mira', persona: 'steady', portrait: 'researcher' },
  { name: 'Taeo', persona: 'trickster', portrait: 'terrorist' },
];
const COLOR_NAME: Record<Color, string> = { black: 'BLACK', white: 'WHITE' };

export const RULES = [
  'A piggy bank starts with 1 black and 1 white coin.',
  'ADD: whoever holds the bank secretly drops in 1–3 coins. Everyone sees HOW MANY went in — only the adder knows the colours. Then they pass the bank to another player.',
  'CLAIM: the receiver must announce how many coins of the asked colour are inside (black, then white, then black…). You only know the coins you added yourself.',
  'DOUBT: everyone else secretly picks Doubt or Believe. If nobody doubts, nothing is scored and the bank keeps filling. If anyone doubts, it is opened: wrong claim → each doubter +1, claimer −1. Correct claim → claimer +1, each doubter −1. Then it resets to 1 black + 1 white.',
  'MEMORY: nothing is counted for you. Each drop is announced once (“Jun dropped 2 coins”) — keep your own tally of the bank and of what you put in. First to 5 points wins (or most points after 24 claims). Lowest score goes to prison.',
];

// Dev-only: ?quick plays to 2 points.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

function setup(botCount: number) {
  const bots = BOTS.slice(0, Math.max(2, botCount));
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    QUICK ? { ...DEFAULT_CONFIG, target: 2 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng: seededRng(Date.now() & 0xffff) };
}

export interface Draft { black: number; white: number; to: string | null; count: number }
export const freshDraft = (): Draft => ({ black: 1, white: 0, to: null, count: 0 });

export type PiggyAction =
  | { type: 'add'; black: number; white: number; to: string }
  | { type: 'claim'; count: number }
  | { type: 'respond'; doubt: boolean };

/** What a click does (solo and online share this): the new draft, and a move once one is chosen. */
export function piggyClick(id: string, s: GameState, draft: Draft): { draft: Draft; action?: PiggyAction } {
  if (s.phase === 'add' && s.holder === ME) {
    const room = draft.black + draft.white < s.config.maxAdd;
    if (id === 'b+' && room) return { draft: { ...draft, black: draft.black + 1 } };
    if (id === 'b-' && draft.black > 0) return { draft: { ...draft, black: draft.black - 1 } };
    if (id === 'w+' && room) return { draft: { ...draft, white: draft.white + 1 } };
    if (id === 'w-' && draft.white > 0) return { draft: { ...draft, white: draft.white - 1 } };
    if (id.startsWith('to:')) return { draft: { ...draft, to: id.slice(3) } };
    if (id === 'pass' && draft.to && draft.black + draft.white > 0) {
      return { draft: freshDraft(), action: { type: 'add', black: draft.black, white: draft.white, to: draft.to } };
    }
  } else if (s.phase === 'claim' && s.receiver === ME) {
    if (id === 'n-' && draft.count > 0) return { draft: { ...draft, count: draft.count - 1 } };
    if (id === 'n+' && draft.count < MAX_CLAIM) return { draft: { ...draft, count: draft.count + 1 } };
    if (id === 'announce') return { draft, action: { type: 'claim', count: draft.count } };
  } else if (s.phase === 'doubt' && s.receiver !== ME && !(ME in s.responses)) {
    if (id === 'doubt') return { draft, action: { type: 'respond', doubt: true } };
    if (id === 'believe') return { draft, action: { type: 'respond', doubt: false } };
  }
  return { draft };
}

export const PORTRAITS = ['citizen', 'officer', 'journalist', 'fanatic', 'researcher', 'terrorist'];

/**
 * Online play: the move clock, a hint line, the label on the "next" button,
 * and the latest drop (online views never carry the coins' colours).
 */
export interface OnlineHud { clock?: string; sub?: string; nextLabel?: string; drop?: { player: string; count: number } | null }

export function PiggyBluff({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const s = game.state;
  const persona = (id: string) => game.bots[Number(id.slice(3))].persona;

  // bots: add & pass, claim, and decide doubts (with pauses you can follow)
  useEffect(() => {
    let job: (() => GameState) | null = null;
    if (s.phase === 'add' && s.holder !== ME) {
      job = () => {
        const m = botAdd(s, s.holder, persona(s.holder), game.rng);
        return add(s, s.holder, m.coins, m.to);
      };
    } else if (s.phase === 'claim' && s.receiver !== ME) {
      job = () => claim(s, s.receiver!, botClaim(s, s.receiver!, game.rng));
    } else if (s.phase === 'doubt' && responders(s).some((id) => id !== ME && !(id in s.responses))) {
      job = () => {
        let next = s;
        for (const id of responders(s)) {
          if (id === ME || id in next.responses || next.phase !== 'doubt') continue;
          next = respond(next, id, botRespond(next, id, persona(id), game.rng));
        }
        return next;
      };
    }
    if (!job) return;
    const t = setTimeout(() => setGame((g) => ({ ...g, state: job!() })), pace(BOT_DELAY));
    return () => clearTimeout(t);
  });

  // when it becomes my turn to count, start the picker at 1 (the starting coin)
  useEffect(() => {
    if (s.phase === 'claim' && s.receiver === ME) setDraft((d) => ({ ...d, count: 1 }));
  }, [s.phase, s.receiver]);

  const set = (next: GameState) => setGame((g) => ({ ...g, state: next }));

  const onHit = (id: string) => {
    if (id === 'again') {
      setDraft(freshDraft());
      return setGame(setup(botCount));
    }
    if (id === 'next') return set(proceed(s));
    const r = piggyClick(id, s, draft);
    setDraft(r.draft);
    if (r.action?.type === 'add') set(add(s, ME, { black: r.action.black, white: r.action.white }, r.action.to));
    if (r.action?.type === 'claim') set(claim(s, ME, r.action.count));
    if (r.action?.type === 'respond') set(respond(s, ME, r.action.doubt));
  };

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, s, meta, draft)} onHit={onHit} />
      <ClaimLog state={s} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

const nameOf = (s: GameState, id: string | null) => (id === ME ? 'You' : s.players.find((p) => p.id === id)?.name ?? '');

export function drawScene(g: Gfx, s: GameState, meta: Record<string, string>, draft: Draft, hud?: OnlineHud) {
  const me = s.players.find((p) => p.id === ME)!;
  const last = s.history[s.history.length - 1];
  const passing = s.phase === 'add' && s.holder === ME;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [
    { text: `CLAIM ${Math.min(s.claims + 1, s.config.maxClaims)}/${s.config.maxClaims}`, color: COLORS.gold },
    hud?.clock ? { text: hud.clock, color: COLORS.ruby } : { text: `first to ${s.config.target} points`, color: COLORS.muted },
  ], 'PIGGY BLUFF');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    const x0 = Math.round(cx - slot / 2 + 4);
    const w = Math.round(slot - 8);
    const chosen = passing && draft.to === p.id;
    g.panel('panel_parchment', x0, 30, w, 66, 4);
    if (chosen || (passing && g.isHover(`to:${p.id}`))) g.frame(x0 - 1, 29, w + 2, 68, chosen ? COLORS.gold : '#fff3b0', 2);
    g.sprite('portraits', meta[p.id], cx - 16, 34, { scale: 2 });
    g.text(p.name, cx, 67, { align: 'center', color: '#3a2216', shadow: false });
    starCount(g, cx, 78, p.points, p.points < 0 ? '#86192f' : '#5e3a24');
    g.text(status(s, p.id), cx, 87, { align: 'center', size: 7, color: '#86192f', shadow: false });
    if (passing) g.hit(`to:${p.id}`, x0, 30, w, 66);
  });

  // centre: bank and the current claim
  const bx = 120;
  const shaking = s.phase === 'claim' || s.phase === 'doubt';
  const jiggle = shaking ? (Math.floor(g.time / 120) % 2 ? 1 : 0) : 0;
  g.sprite('items', 'piggy_bank', bx + jiggle, 100, { scale: 3 });
  // only the latest drop is announced — keep your own tally
  const latest = s.additions[s.additions.length - 1];
  const drop = hud ? hud.drop : latest && { player: latest.player, count: latest.black + latest.white };
  if (drop && s.phase !== 'reveal') {
    const n = drop.count;
    g.text(`${nameOf(s, drop.player)} dropped ${n} coin${n === 1 ? '' : 's'}`, bx + 36, 172, { align: 'center', size: 8, color: COLORS.ink });
  } else if (s.phase !== 'reveal' && !drop) {
    g.text('fresh bank: 1 black + 1 white', bx + 36, 172, { align: 'center', size: 8, color: COLORS.muted });
  }
  g.text('NEXT ASK', 230, 104, { size: 7, color: COLORS.muted });
  g.sprite('coins', `coin_${s.color}`, 230, 114, { scale: 2 });
  g.text(COLOR_NAME[s.color], 258, 118, { size: 10, color: COLORS.gold });

  if (s.claim !== null && (s.phase === 'doubt' || s.phase === 'reveal')) {
    g.panel('panel_parchment', 230, 138, 238, 30, 4);
    g.text(`${nameOf(s, s.receiver)}: “${s.claim} ${COLOR_NAME[s.color].toLowerCase()} coin${s.claim === 1 ? '' : 's'} inside”`, 240, 148, {
      size: 9, color: '#3a2216', shadow: false,
    });
  }

  // message
  let msg = '';
  let sub = '';
  if (s.phase === 'add') {
    msg = passing ? 'Drop 1–3 coins in, then pick who must count' : `${nameOf(s, s.holder)} is adding coins…`;
    sub = passing ? 'colours are secret — the number of coins is not' : '';
  } else if (s.phase === 'claim') {
    msg = s.receiver === ME ? `How many ${s.color} coins are inside?` : `${nameOf(s, s.receiver)} is counting…`;
  } else if (s.phase === 'doubt') {
    msg = s.receiver === ME ? 'Waiting for the others to doubt or believe…' : 'Doubt or believe?';
  } else if (s.phase === 'reveal' && last) {
    if (!last.opened) msg = 'Everyone believed — the bank keeps its coins';
    else {
      const ppl = last.doubters.map((d) => nameOf(s, d)).join(' & ');
      msg = last.correct ? `Correct! ${nameOf(s, last.claimer)} +1 · ${ppl} −1` : `Wrong! ${ppl} +1 · ${nameOf(s, last.claimer)} −1`;
    }
  }
  if (msg) g.text(msg, 230, 176, { size: 9, color: COLORS.gold });
  if (sub) g.text(sub, 230, 187, { size: 7, color: COLORS.muted });

  // your panel
  g.panel('panel_night', 4, 196, W - 8, 70, 4);
  g.sprite('portraits', meta[ME], 12, 202, { scale: 2 });
  g.text('You', 28, 236, { align: 'center' });
  starCount(g, 28, 248, me.points, me.points < 0 ? COLORS.ruby : COLORS.ink);
  const x = 56;

  if (passing) {
    coinStepper(g, 'black', draft.black, 'b', x, 204);
    coinStepper(g, 'white', draft.white, 'w', x, 228);
    g.text(`${draft.black + draft.white}/${s.config.maxAdd} coins`, x + 104, 208, { size: 8, color: COLORS.muted });
    g.text(draft.to ? `to ${nameOf(s, draft.to)}` : 'click a player ↑', x + 104, 222, { size: 8, color: draft.to ? COLORS.gold : COLORS.muted });
    g.button('pass', 'Drop & pass', 392, 244, 80, { disabled: !draft.to || draft.black + draft.white === 0 });
  } else if (s.phase === 'claim' && s.receiver === ME) {
    g.text(`How many ${s.color} coins? Count from memory.`, x, 204, { size: 8, color: COLORS.muted });
    g.sprite('coins', `coin_${s.color}`, x, 218, { scale: 2 });
    g.button('n-', '−', x + 28, 222, 16);
    g.text(`${draft.count}`, x + 56, 223, { align: 'center', size: 12, color: COLORS.gold });
    g.button('n+', '+', x + 68, 222, 16);
    g.button('announce', `Say ${draft.count}`, 392, 244, 80);
  } else if (s.phase === 'doubt' && s.receiver !== ME) {
    if (!(ME in s.responses)) {
      g.text(`${nameOf(s, s.receiver)} says ${s.claim} ${s.color}. Does that match your tally?`, x, 210, { size: 8, color: COLORS.ink });
      g.button('doubt', 'Doubt', 392, 214, 80, { color: 'red' });
      g.button('believe', 'Believe', 392, 236, 80);
    } else {
      g.text(`You chose to ${s.responses[ME] ? 'DOUBT' : 'believe'} — waiting…`, x, 214, { size: 9, color: COLORS.gold });
    }
  } else if (s.phase === 'reveal' && last) {
    if (last.actual) {
      g.text('INSIDE THE BANK', x, 202, { size: 7, color: COLORS.muted });
      let cx = x;
      for (let i = 0; i < last.actual.black; i++) g.sprite('coins', 'coin_black', (cx += 13), 212);
      cx += 8;
      for (let i = 0; i < last.actual.white; i++) g.sprite('coins', 'coin_white', (cx += 13), 212);
      g.text(`${last.actual.black} black · ${last.actual.white} white — asked: ${last.color}, said ${last.claim}`, x, 232, {
        size: 8, color: COLORS.ink,
      });
    } else {
      g.text('Nobody doubted, so nobody looks inside.', x, 214, { size: 8, color: COLORS.muted });
    }
    if (hud?.sub) g.text(hud.sub, 392, 236, { size: 6, color: COLORS.muted });
    g.button('next', hud?.nextLabel ?? (s.players.some((p) => p.points >= s.config.target) || s.claims >= s.config.maxClaims ? 'Final result' : 'Continue'), 392, 244, 80);
  } else {
    g.text(s.phase === 'add' ? `${nameOf(s, s.holder)} holds the bank` : '', x, 214, { size: 8, color: COLORS.muted });
  }

  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.points} pts  ${p.wrongClaims} wrong` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

function status(s: GameState, id: string): string {
  if (s.phase === 'add' && s.holder === id) return 'adding coins…';
  if (s.phase === 'claim' && s.receiver === id) return 'counting…';
  if (s.phase === 'doubt') {
    if (s.receiver === id) return `said ${s.claim}`;
    return id in s.responses ? 'decided' : 'thinking…';
  }
  if (s.phase === 'reveal') {
    const last = s.history[s.history.length - 1];
    if (last.claimer === id) return `said ${last.claim} ${last.correct === null ? '' : last.correct ? '✓' : '✗'}`;
    return last.doubters.includes(id) ? 'DOUBTED' : 'believed';
  }
  return '';
}

function coinStepper(g: Gfx, color: Color, n: number, key: string, x: number, y: number) {
  g.sprite('coins', `coin_${color}`, x, y, { scale: 2 });
  g.button(`${key}-`, '−', x + 28, y + 4, 16);
  g.text(`${n}`, x + 54, y + 7, { align: 'center', size: 10, color: COLORS.gold });
  g.button(`${key}+`, '+', x + 64, y + 4, 16);
}

// ---------------------------------------------------------------- log (DOM)

export function ClaimLog({ state }: { state: GameState }) {
  const name = (id: string) => nameOf(state, id);
  return (
    <aside className="log">
      <h3>Claim log</h3>
      {state.phase !== 'gameOver' ? (
        <p className="sealed">Sealed until the match ends — keeping count is part of the game.</p>
      ) : (
        <p className="muted">Every claim and how it ended.</p>
      )}
      {state.phase === 'gameOver' && <ol>
        {[...state.history].reverse().map((r) => (
          <li key={r.n}>
            <b>#{r.n}</b> {name(r.claimer)}: {r.claim} {r.color}
            <em className={r.opened ? (r.correct ? 'win' : 'tip') : ''}>
              {r.opened
                ? `${r.doubters.map(name).join(' & ')} doubted — there were ${r.actual![r.color]} → ${r.correct ? 'correct' : 'wrong'}`
                : 'everyone believed'}
            </em>
          </li>
        ))}
      </ol>}
    </aside>
  );
}
