import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../lonely-number/bots';
import { standingsPanel, starCount, topBar } from '../shared/draw';
import { Persona, botBid } from './bots';
import { DEFAULT_CONFIG, GameState, formatMs, newGame, nextRound, resolveRound, standings } from './logic';

const W = 480;
const H = 270;
const ME = 'you';
const COUNTDOWN_MS = 3000;
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'steady', portrait: 'officer' },
  { name: 'Jun', persona: 'spiker', portrait: 'journalist' },
  { name: 'Seo', persona: 'wild', portrait: 'fanatic' },
  { name: 'Mira', persona: 'steady', portrait: 'researcher' },
  { name: 'Taeo', persona: 'spiker', portrait: 'terrorist' },
];

export const RULES = [
  'Everyone starts with the same secret bank of time: 3:00.',
  'Each round, press and HOLD the button (mouse or Space) through the 3-second countdown. Let go during the countdown to sit the round out for free.',
  'After the countdown the clock runs. Let go whenever you like: the time you held is your bid, and it is spent whether you win or not.',
  'The longest hold wins the round and earns 1 star. Only the winner is announced — nobody learns how long anyone held.',
  'After 11 rounds the most stars wins (ties: more time left). Last place goes to prison.',
];

// Dev-only: ?quick plays a 2-round match with a 20-second bank.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

type Stage = 'ready' | 'countdown' | 'running' | 'shown';
interface Live {
  stage: Stage;
  at: number;              // when the current stage started
  holding: boolean;
  myBid: number | null;    // ms held this round (0 = sat out)
  botBids: Record<string, number>;
}

function setup(botCount: number) {
  const bots = BOTS.slice(0, botCount);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    QUICK ? { rounds: 2, bankMs: 20_000 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng: seededRng(Date.now() & 0xffff) };
}

const freshLive = (): Live => ({ stage: 'ready', at: performance.now(), holding: false, myBid: null, botBids: {} });

export function SandBid({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [, rerender] = useState(0);
  const live = useRef<Live>(freshLive());
  const gameRef = useRef(game);
  gameRef.current = game;

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));
  const me = (s: GameState) => s.players.find((p) => p.id === ME)!;

  const finishRound = useCallback((myBid: number) => {
    const L = live.current;
    const next = resolveRound(gameRef.current.state, { [ME]: myBid, ...L.botBids });
    live.current = { ...L, stage: 'shown', at: performance.now(), holding: false, myBid };
    setGame((g) => ({ ...g, state: next }));
  }, []);

  const rollBotBids = (): Record<string, number> => {
    const { state, bots, rng } = gameRef.current;
    const leader = Math.max(...state.players.map((p) => p.tokens));
    const bids: Record<string, number> = {};
    state.players.forEach((p, i) => {
      if (!p.isBot) return;
      bids[p.id] = botBid(
        { bankMs: p.bankMs, roundsLeft: state.config.rounds - state.round + 1, myTokens: p.tokens, leaderTokens: leader },
        bots[i - 1].persona, rng,
      );
    });
    return bids;
  };

  const press = useCallback(() => {
    const { state } = gameRef.current;
    if (state.phase !== 'bidding' || live.current.stage !== 'ready' || me(state).bankMs <= 0) return;
    live.current = { stage: 'countdown', at: performance.now(), holding: true, myBid: null, botBids: rollBotBids() };
    rerender((n) => n + 1);
  }, []);

  /** Empty bank: the round still happens, you just can't bid. */
  const sitOut = () => {
    live.current = { ...live.current, botBids: rollBotBids() };
    finishRound(0);
  };

  const release = useCallback(() => {
    const L = live.current;
    if (!L.holding) return;
    if (L.stage === 'countdown') return finishRound(0);
    if (L.stage === 'running') {
      const bank = me(gameRef.current.state).bankMs;
      finishRound(Math.min(bank, performance.now() - L.at));
    }
  }, [finishRound]);

  // countdown → running, and auto-release when the bank runs dry
  useEffect(() => {
    const id = setInterval(() => {
      const L = live.current;
      const now = performance.now();
      if (L.stage === 'countdown' && now - L.at >= COUNTDOWN_MS) {
        live.current = { ...L, stage: 'running', at: now };
        rerender((n) => n + 1);
      } else if (L.stage === 'running' && L.holding) {
        const bank = me(gameRef.current.state).bankMs;
        if (now - L.at >= bank) finishRound(bank);
      }
    }, 20);
    return () => clearInterval(id);
  }, [finishRound]);

  // keyboard: hold Space
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [press, release]);

  const onHit = (id: string) => {
    if (id === 'hold') press();
    else if (id === 'sit-out') sitOut();
    else if (id === 'next') {
      live.current = freshLive();
      setGame((g) => ({ ...g, state: nextRound(g.state) }));
    } else if (id === 'again') {
      live.current = freshLive();
      setGame(setup(botCount));
    }
  };

  return (
    <div className="game-layout">
      <PixelStage width={W} height={H} draw={(g) => drawScene(g, game.state, live.current, meta)} onHit={onHit} onRelease={release} />
      <BidLog state={game.state} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawScene(g: Gfx, s: GameState, L: Live, meta: Record<string, string>) {
  const now = g.time;
  const since = now - L.at;
  const last = s.history[s.history.length - 1];
  const showResult = s.phase === 'result' || s.phase === 'gameOver';
  const mine = s.players.find((p) => p.id === ME)!;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold }], 'SAND BID');

  // opponents
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    const won = showResult && last?.winner === p.id;
    g.panel('panel_parchment', cx - slot / 2 + 4, 30, slot - 8, 66, 4);
    if (won) g.frame(cx - slot / 2 + 3, 29, slot - 6, 68, Math.floor(since / 200) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.sprite('portraits', meta[p.id], cx - 16, 34, { scale: 2 });
    g.text(p.name, cx, 68, { align: 'center', color: '#3a2216', shadow: false });
    starCount(g, cx, 80, p.tokens, '#5e3a24');
    if (won) g.text('WIN', cx + slot / 2 - 12, 36, { align: 'right', color: '#86192f', shadow: false, size: 8 });
  });

  // centre: hourglass + button + clock
  const bx = W / 2 - 32;
  const by = 104;
  const pressed = L.holding;
  g.sprite('icons', 'hourglass', 96, 106, { scale: 3 });
  if (L.stage === 'running' && L.holding) drawFallingSand(g, 96 + 24, 106 + 22, now);
  g.sprite('items', 'push_button', bx, by + (pressed ? 4 : 0), { scale: 4 });
  if (s.phase === 'bidding' && L.stage === 'ready' && mine.bankMs > 0) {
    g.hit('hold', bx, by, 64, 64);
    if (Math.floor(now / 500) % 2 === 0) g.frame(bx - 3, by + 30, 70, 37, COLORS.gold);
  }

  let msg = '';
  let sub = '';
  if (s.phase === 'bidding') {
    if (L.stage === 'ready') {
      msg = mine.bankMs > 0 ? 'Press and HOLD to bid' : 'Your bank is empty';
      sub = mine.bankMs > 0 ? 'mouse or Space · let go during the countdown to sit out' : 'You sit out — the others still bid';
      if (mine.bankMs <= 0) g.button('sit-out', 'Sit out', 396, 236, 72);
    } else if (L.stage === 'countdown') {
      const n = Math.ceil((COUNTDOWN_MS - since) / 1000);
      msg = `${Math.max(1, n)}…`;
      sub = 'keep holding — let go now to sit this round out';
    } else if (L.stage === 'running') {
      msg = 'Bidding… let go to lock in your bid';
      sub = '';
    }
  } else if (showResult && last) {
    const w = s.players.find((p) => p.id === last.winner);
    msg = w ? (w.id === ME ? 'You win the round! +1★' : `${w.name} wins the round`) : 'Tie — nobody wins this round';
    const myHold = last.bids[ME];
    sub = myHold > 0 ? `You held ${formatMs(myHold)}` : 'You sat this round out';
  }
  if (msg) g.text(msg, W / 2, 172, { align: 'center', size: 11, color: COLORS.gold });
  if (sub) g.text(sub, W / 2, 186, { align: 'center', size: 8, color: COLORS.muted });

  // right side: your live clock
  const held = L.stage === 'running' && L.holding ? Math.min(since, mine.bankMs) : 0;
  g.text('HOLDING', 344, 112, { color: COLORS.muted, size: 8 });
  g.text(formatMs(held), 344, 124, { size: 14, color: L.holding && L.stage === 'running' ? COLORS.ruby : COLORS.ink });

  // player panel
  g.panel('panel_night', 4, 198, W - 8, 68, 4);
  g.sprite('portraits', meta[ME], 14, 206, { scale: 2 });
  g.text('You', 30, 240, { align: 'center' });
  starCount(g, 30, 252, mine.tokens, COLORS.ink);

  const bankLeft = Math.max(0, mine.bankMs - held);
  g.text('YOUR BANK', 64, 208, { color: COLORS.muted, size: 8 });
  g.text(formatMs(bankLeft), 64, 220, { size: 16, color: bankLeft < 15_000 ? COLORS.ruby : COLORS.gold });
  const barW = 220;
  g.rect(64, 244, barW, 8, '#241944');
  g.rect(64, 244, Math.round((barW * bankLeft) / s.config.bankMs), 8, '#d1b06a');
  g.frame(63, 243, barW + 2, 10, '#5e3a24');
  g.text('Rivals’ banks are secret', 64, 254, { color: COLORS.muted, size: 7, shadow: false });

  if (s.phase === 'result') g.button('next', s.round >= s.config.rounds ? 'Final result' : 'Next round', 396, 236, 72);
  if (s.phase === 'gameOver') {
    const order = standings(s);
    standingsPanel(
      g,
      order.map((p) => ({ name: p.name, detail: `${p.tokens}★  ${formatMs(p.bankMs)} left` })),
      order[0].id === ME ? 'You win the match!' : `${order[0].name} wins the match.`,
    );
  }
}

function drawFallingSand(g: Gfx, x: number, y: number, now: number) {
  for (let i = 0; i < 4; i++) {
    const yy = y + ((now / 40 + i * 4) % 14);
    g.rect(x, Math.round(yy), 1, 1, '#ecd398');
  }
}

// ---------------------------------------------------------------- log (DOM)

function BidLog({ state }: { state: GameState }) {
  const over = state.phase === 'gameOver';
  const name = (id: string | null) => (id ? state.players.find((p) => p.id === id)?.name ?? id : 'nobody');
  return (
    <aside className="log">
      <h3>Round log</h3>
      <p className="muted">{over ? 'Match over — every hold is now revealed.' : 'Only winners are announced. All holds are revealed when the match ends.'}</p>
      <ol reversed>
        {[...state.history].reverse().map((r) => (
          <li key={r.round}>
            <b>R{r.round}</b> <span className={r.winner === ME ? 'win' : ''}>{r.winner ? `${name(r.winner)} wins` : 'tie'}</span>
            <em>
              {over
                ? state.players.map((p) => `${p.name} ${(r.bids[p.id] / 1000).toFixed(2)}s`).join(' · ')
                : r.bids[ME] > 0 ? `you held ${formatMs(r.bids[ME])}` : 'you sat out'}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
