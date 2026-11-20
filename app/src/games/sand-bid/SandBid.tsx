import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import { COLORS, Gfx } from '../../engine/gfx';
import { seededRng } from '../lonely-number/bots';
import { standingsPanel, starCount, topBar } from '../shared/draw';
import { Persona, botBid } from './bots';
import { DEFAULT_CONFIG, GameState, formatMs, newGame, nextRound, resolveRound, standings } from './logic';
import { COUNTDOWN_MS, LiveRound, bidsOf, clockMs, openRound, press, release, tick } from './round';

const W = 480;
const H = 270;
const ME = 'you';
const BOTS: { name: string; persona: Persona; portrait: string }[] = [
  { name: 'Hana', persona: 'steady', portrait: 'officer' },
  { name: 'Jun', persona: 'spiker', portrait: 'journalist' },
  { name: 'Seo', persona: 'wild', portrait: 'fanatic' },
  { name: 'Mira', persona: 'steady', portrait: 'researcher' },
  { name: 'Taeo', persona: 'spiker', portrait: 'terrorist' },
];

export const RULES = [
  'Everyone starts with the same secret bank of time: 3:00.',
  'Each round, press and HOLD the button (mouse or Space). When everyone is holding, a 3-second countdown starts. Let go during the countdown to sit the round out for free.',
  'Then the round clock runs. Let go whenever you like: the time you held is your bid, and it is spent whether you win or not.',
  'The round lasts until the LAST player lets go, so the clock shows the winning hold. Who let go when stays secret.',
  'Longest hold wins 1 star. Empty bank? You sit out automatically. After 11 rounds the most stars wins (ties: more time left). Last place goes to prison.',
];

// Dev-only: ?quick plays a 2-round match with a 20-second bank.
const QUICK = import.meta.env.DEV && new URLSearchParams(location.search).has('quick');

/** A bot's secret plan for this round: when to let go. */
interface BotPlan { bid: number; sitOutAt: number }

function setup(botCount: number) {
  const bots = BOTS.slice(0, botCount);
  const state = newGame(
    [{ id: ME, name: 'You', isBot: false }, ...bots.map((b, i) => ({ id: `bot${i}`, name: b.name, isBot: true }))],
    QUICK ? { rounds: 2, bankMs: 20_000 } : DEFAULT_CONFIG,
  );
  return { state, bots, rng: seededRng(Date.now() & 0xffff) };
}

type Game = ReturnType<typeof setup>;

/** Open a round: bots plan secretly and press right away. */
function startRound(game: Game): { round: LiveRound; plans: Record<string, BotPlan> } {
  const { state, bots, rng } = game;
  const now = performance.now();
  const banks = Object.fromEntries(state.players.map((p) => [p.id, p.bankMs]));
  const leader = Math.max(...state.players.map((p) => p.tokens));
  let round = openRound(banks);
  const plans: Record<string, BotPlan> = {};
  state.players.forEach((p, i) => {
    if (!p.isBot || p.bankMs <= 0) return;
    const bid = botBid(
      { bankMs: p.bankMs, roundsLeft: state.config.rounds - state.round + 1, myTokens: p.tokens, leaderTokens: leader },
      bots[i - 1].persona, rng,
    );
    plans[p.id] = { bid, sitOutAt: 600 + rng() * 2000 };
    round = press(round, p.id, now);
  });
  return { round, plans };
}

export function SandBid({ botCount = 3 }: { botCount?: number }) {
  const [game, setGame] = useState(() => setup(botCount));
  const [, rerender] = useState(0);
  const gameRef = useRef(game);
  gameRef.current = game;
  const live = useRef<ReturnType<typeof startRound> | null>(null) as React.MutableRefObject<ReturnType<typeof startRound>>;
  if (!live.current) live.current = startRound(game);
  const resolved = useRef(false);

  const meta: Record<string, string> = { [ME]: 'citizen' };
  game.bots.forEach((b, i) => (meta[`bot${i}`] = b.portrait));

  const beginRound = useCallback((g: Game) => {
    live.current = startRound(g);
    resolved.current = false;
  }, []);

  const onPress = useCallback(() => {
    if (gameRef.current.state.phase !== 'bidding') return;
    live.current = { ...live.current, round: press(live.current.round, ME, performance.now()) };
    rerender((n) => n + 1);
  }, []);

  const onRelease = useCallback(() => {
    live.current = { ...live.current, round: release(live.current.round, ME, performance.now()) };
    rerender((n) => n + 1);
  }, []);

  // The round driver: time, bot releases, and resolving once the last player lets go.
  useEffect(() => {
    const id = setInterval(() => {
      const { state } = gameRef.current;
      if (state.phase !== 'bidding' || resolved.current) return;
      const now = performance.now();
      let { round } = live.current;
      const { plans } = live.current;
      round = tick(round, now);
      for (const [bot, plan] of Object.entries(plans)) {
        if (round.holders[bot]?.status !== 'holding') continue;
        if (round.stage === 'countdown' && plan.bid === 0 && now - round.countdownAt! >= plan.sitOutAt) {
          round = release(round, bot, now);
        } else if (round.stage === 'running' && now - round.runAt! >= plan.bid) {
          round = release(round, bot, round.runAt! + plan.bid); // exact planned time
        }
      }
      live.current = { plans, round };
      if (round.stage === 'over') {
        resolved.current = true;
        setGame((g) => ({ ...g, state: resolveRound(g.state, bidsOf(round)) }));
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  // keyboard: hold Space
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) onPress();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      onRelease();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onPress, onRelease]);

  const onHit = (id: string) => {
    if (id === 'hold') onPress();
    else if (id === 'next') {
      const next = { ...game, state: nextRound(game.state) };
      if (next.state.phase === 'bidding') beginRound(next);
      setGame(next);
    } else if (id === 'again') {
      const fresh = setup(botCount);
      beginRound(fresh);
      setGame(fresh);
    }
  };

  return (
    <div className="game-layout">
      <PixelStage
        width={W}
        height={H}
        draw={(g) => drawScene(g, game.state, live.current.round, meta)}
        onHit={onHit}
        onRelease={onRelease}
      />
      <BidLog state={game.state} />
    </div>
  );
}

// ---------------------------------------------------------------- drawing

function drawScene(g: Gfx, s: GameState, r: LiveRound, meta: Record<string, string>) {
  const now = g.time;
  const last = s.history[s.history.length - 1];
  const showResult = s.phase === 'result' || s.phase === 'gameOver';
  const mine = s.players.find((p) => p.id === ME)!;
  const me = r.holders[ME];
  const bidding = s.phase === 'bidding';
  const running = bidding && r.stage === 'running';
  const myLiveHold = running && me.status === 'holding' ? Math.min(now - r.runAt!, mine.bankMs) : 0;

  g.tile('board', 'tile_night', 0, 0, W, H);
  topBar(g, [{ text: `ROUND ${s.round}/${s.config.rounds}`, color: COLORS.gold }], 'SAND BID');

  // opponents (their holding status is secret)
  const opponents = s.players.filter((p) => p.id !== ME);
  const slot = (W - 8) / opponents.length;
  opponents.forEach((p, i) => {
    const cx = Math.round(4 + slot * i + slot / 2);
    const won = showResult && last?.winner === p.id;
    g.panel('panel_parchment', cx - slot / 2 + 4, 30, slot - 8, 66, 4);
    if (won) g.frame(cx - slot / 2 + 3, 29, slot - 6, 68, Math.floor(now / 200) % 2 ? COLORS.gold : '#fff3b0', 2);
    g.sprite('portraits', meta[p.id], cx - 16, 34, { scale: 2 });
    g.text(p.name, cx, 68, { align: 'center', color: '#3a2216', shadow: false });
    starCount(g, cx, 80, p.tokens, '#5e3a24');
    if (won) g.text('WIN', cx + slot / 2 - 12, 36, { align: 'right', color: '#86192f', shadow: false, size: 8 });
    if (p.bankMs <= 0) g.text('EMPTY', cx - slot / 2 + 12, 36, { color: '#86192f', shadow: false, size: 7 });
  });

  // centre: hourglass, button, round clock
  const bx = W / 2 - 32;
  const by = 104;
  const pressed = me.status === 'holding';
  g.sprite('icons', 'hourglass', 96, 106, { scale: 3 });
  if (running) drawFallingSand(g, 120, 128, now);
  g.sprite('items', 'push_button', bx, by + (pressed ? 4 : 0), { scale: 4, alpha: me.status === 'out' ? 0.4 : 1 });
  if (bidding && r.stage === 'gathering' && me.status === 'waiting') {
    g.hit('hold', bx, by, 64, 64);
    if (Math.floor(now / 500) % 2 === 0) g.frame(bx - 3, by + 30, 70, 37, COLORS.gold);
  }

  const clock = bidding ? clockMs(r, now) : last ? Math.max(0, ...Object.values(last.bids)) : 0;
  g.text('ROUND CLOCK', 344, 112, { color: COLORS.muted, size: 8 });
  g.text(formatMs(clock), 344, 124, { size: 14, color: running ? COLORS.ruby : COLORS.ink });

  let msg = '';
  let sub = '';
  if (bidding) {
    if (me.status === 'out') {
      msg = 'Your bank is empty';
      sub = r.stage === 'running' ? 'Watching the others bid…' : 'You sit this round out — the others still play';
    } else if (r.stage === 'gathering') {
      msg = 'Press and HOLD to get ready';
      sub = 'mouse or Space · the countdown starts when everyone is holding';
    } else if (r.stage === 'countdown') {
      msg = `${Math.max(1, Math.ceil((COUNTDOWN_MS - (now - r.countdownAt!)) / 1000))}…`;
      sub = me.status === 'holding' ? 'keep holding — let go now to sit this round out' : 'You let go — sitting this round out';
    } else if (r.stage === 'running') {
      if (me.status === 'holding') {
        msg = 'Holding… let go to lock in your bid';
      } else {
        msg = 'Waiting for the others to let go…';
        sub = me.bid > 0 ? `You let go at ${formatMs(me.bid)}` : 'You sat this round out';
      }
    }
  } else if (showResult && last) {
    const w = s.players.find((p) => p.id === last.winner);
    msg = w ? (w.id === ME ? 'You win the round! +1★' : `${w.name} wins the round`) : 'Tie — nobody wins this round';
    const mineBid = last.bids[ME];
    sub = `clock stopped at ${formatMs(clock)}  ·  ${mineBid > 0 ? `you held ${formatMs(mineBid)}` : 'you sat out'}`;
  }
  if (msg) g.text(msg, W / 2, 172, { align: 'center', size: 11, color: COLORS.gold });
  if (sub) g.text(sub, W / 2, 186, { align: 'center', size: 8, color: COLORS.muted });

  // player panel
  g.panel('panel_night', 4, 198, W - 8, 68, 4);
  g.sprite('portraits', meta[ME], 14, 206, { scale: 2 });
  g.text('You', 30, 240, { align: 'center' });
  starCount(g, 30, 252, mine.tokens, COLORS.ink);

  const bankLeft = Math.max(0, mine.bankMs - myLiveHold);
  g.text('YOUR BANK', 64, 208, { color: COLORS.muted, size: 8 });
  g.text(formatMs(bankLeft), 64, 220, { size: 16, color: bankLeft < 15_000 ? COLORS.ruby : COLORS.gold });
  const barW = 220;
  g.rect(64, 244, barW, 8, '#241944');
  g.rect(64, 244, Math.round((barW * bankLeft) / s.config.bankMs), 8, '#d1b06a');
  g.frame(63, 243, barW + 2, 10, '#5e3a24');
  g.text('Rivals’ banks are secret', 64, 254, { color: COLORS.muted, size: 7, shadow: false });

  g.text('YOUR HOLD', 300, 208, { color: COLORS.muted, size: 8 });
  const shownHold = me.status === 'holding' ? myLiveHold : bidding ? me.bid : last?.bids[ME] ?? 0;
  g.text(formatMs(shownHold), 300, 220, { size: 12, color: me.status === 'holding' && running ? COLORS.ruby : COLORS.ink });

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
      <p className="muted">
        {over ? 'Match over — every hold is now revealed.' : 'The clock shows the winning hold. Everyone else’s hold is revealed when the match ends.'}
      </p>
      <ol reversed>
        {[...state.history].reverse().map((r) => {
          const longest = Math.max(0, ...Object.values(r.bids));
          return (
            <li key={r.round}>
              <b>R{r.round}</b> <span className={r.winner === ME ? 'win' : ''}>{r.winner === ME ? 'You win' : r.winner ? `${name(r.winner)} wins` : 'tie'}</span>
              {' '}· clock {formatMs(longest)}
              <em>
                {over
                  ? state.players.map((p) => `${p.name} ${(r.bids[p.id] / 1000).toFixed(2)}s`).join(' · ')
                  : r.bids[ME] > 0 ? `you held ${formatMs(r.bids[ME])}` : 'you sat out'}
              </em>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
