import { useEffect, useState } from 'react';
import { loadAll } from './engine/atlas';
import { GAMES } from './games/registry';
import { BOT_SPEED, SPEEDS, Speed, setSpeed } from './games/shared/pace';
import { Hub } from './ui/Hub';
import { Online } from './ui/Online';
import { Leaderboards, MyMatches } from './ui/Records';
import { Panel } from './ui/Panel';

/** A game's screen and rules. Each game's code loads only when it's opened (smaller first download). */
interface GameModule { rules: string[]; View: (p: { botCount: number }) => JSX.Element }
const GAME_VIEWS: Record<string, () => Promise<GameModule>> = {
  'lonely-number': () => import('./games/lonely-number/LonelyNumber').then((m) => ({ rules: m.RULES, View: m.LonelyNumber })),
  'sand-bid': () => import('./games/sand-bid/SandBid').then((m) => ({ rules: m.RULES, View: m.SandBid })),
  'dice-tower': () => import('./games/dice-tower/DiceTower').then((m) => ({ rules: m.RULES, View: m.DiceTower })),
  'tipping-scales': () => import('./games/tipping-scales/TippingScales').then((m) => ({ rules: m.RULES, View: m.TippingScales })),
  'six-chambers': () => import('./games/six-chambers/SixChambers').then((m) => ({ rules: m.RULES, View: m.SixChambers })),
  'walls-and-wards': () => import('./games/walls-and-wards/WallsAndWards').then((m) => ({ rules: m.RULES, View: m.WallsAndWards })),
  'piggy-bluff': () => import('./games/piggy-bluff/PiggyBluff').then((m) => ({ rules: m.RULES, View: m.PiggyBluff })),
  'blind-bingo': () => import('./games/blind-bingo/BlindBingo').then((m) => ({ rules: m.RULES, View: m.BlindBingo })),
  'smugglers-gems': () => import('./games/smugglers-gems/SmugglersGems').then((m) => ({ rules: m.RULES, View: m.SmugglersGems })),
  'color-doubt': () => import('./games/color-doubt/ColorDoubt').then((m) => ({ rules: m.RULES, View: m.ColorDoubt })),
  'number-forge': () => import('./games/number-forge/NumberForge').then((m) => ({ rules: m.RULES, View: m.NumberForge })),
  'rumor-exchange': () => import('./games/rumor-exchange/RumorExchange').then((m) => ({ rules: m.RULES, View: m.RumorExchange })),
  'cipher-lock': () => import('./games/cipher-lock/CipherLock').then((m) => ({ rules: m.RULES, View: m.CipherLock })),
  'fence-loop': () => import('./games/fence-loop/FenceLoop').then((m) => ({ rules: m.RULES, View: m.FenceLoop })),
  'second-glance': () => import('./games/second-glance/SecondGlance').then((m) => ({ rules: m.RULES, View: m.SecondGlance })),
  'deadeye-holdem': () => import('./games/deadeye-holdem/DeadeyeHoldem').then((m) => ({ rules: m.RULES, View: m.DeadeyeHoldem })),
  'split-decision': () => import('./games/split-decision/SplitDecision').then((m) => ({ rules: m.RULES, View: m.SplitDecision })),
  'piece-together': () => import('./games/piece-together/PieceTogether').then((m) => ({ rules: m.RULES, View: m.PieceTogether })),
  'mirror-pieces': () => import('./games/mirror-pieces/MirrorPieces').then((m) => ({ rules: m.RULES, View: m.MirrorPieces })),
  'nine-mens-morris': () => import('./games/nine-mens-morris/NineMensMorris').then((m) => ({ rules: m.RULES, View: m.NineMensMorris })),
  'hex-sum': () => import('./games/hex-sum/HexSum').then((m) => ({ rules: m.RULES, View: m.HexSum })),
  'high-or-low': () => import('./games/high-or-low/HighOrLow').then((m) => ({ rules: m.RULES, View: m.HighOrLow })),
  'tigers-and-goats': () => import('./games/tigers-and-goats/TigersAndGoats').then((m) => ({ rules: m.RULES, View: m.TigersAndGoats })),
  'ask-and-arrange': () => import('./games/ask-and-arrange/AskAndArrange').then((m) => ({ rules: m.RULES, View: m.AskAndArrange })),
  'knights-tour': () => import('./games/knights-tour/KnightsTour').then((m) => ({ rules: m.RULES, View: m.KnightsTour })),
  'blind-five': () => import('./games/blind-five/BlindFive').then((m) => ({ rules: m.RULES, View: m.BlindFive })),
  'magic-squares': () => import('./games/magic-squares/MagicSquares').then((m) => ({ rules: m.RULES, View: m.MagicSquares })),
  'high-low-equations': () => import('./games/high-low-equations/HighLowEquations').then((m) => ({ rules: m.RULES, View: m.HighLowEquations })),
  'turf-war': () => import('./games/turf-war/TurfWar').then((m) => ({ rules: m.RULES, View: m.TurfWar })),
  'tri-mancala': () => import('./games/tri-mancala/TriMancala').then((m) => ({ rules: m.RULES, View: m.TriMancala })),
};

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(true);
  const [bots, setBots] = useState(3);
  const [speed, setSpeedState] = useState<Speed>(() => {
    try {
      return (localStorage.getItem('speed') as Speed) || BOT_SPEED;
    } catch {
      return BOT_SPEED;
    }
  });
  // the Speed setting only applies to games whose moves play out one at a time
  setSpeed(current && GAMES.find((g) => g.id === current)?.paced ? speed : BOT_SPEED);
  const changeSpeed = (v: Speed) => {
    setSpeedState(v);
    try {
      localStorage.setItem('speed', v);
    } catch {
      /* private mode: keep it for this visit only */
    }
  };

  useEffect(() => {
    loadAll().then(() => setReady(true)).catch((e) => setError(String(e)));
  }, []);

  // fetch the chosen game's code
  const [loaded, setLoaded] = useState<{ id: string; mod: GameModule } | null>(null);
  useEffect(() => {
    const load = current ? GAME_VIEWS[current] : undefined;
    if (!current || !load || loaded?.id === current) return;
    let live = true;
    load().then((mod) => live && setLoaded({ id: current, mod }), (e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="center">Could not load assets: {error}</p>;
  if (!ready) return <p className="center muted">Loading…</p>;
  if (current === 'online') return <Online onExit={() => setCurrent(null)} />;
  if (current === 'matches') return <MyMatches onExit={() => setCurrent(null)} />;
  if (current === 'leaders') return <Leaderboards onExit={() => setCurrent(null)} />;
  if (!current) return <Hub onPlay={(id) => { setCurrent(id); setShowRules(true); }} onOnline={() => setCurrent('online')} onPage={setCurrent} />;

  const info = GAMES.find((g) => g.id === current)!;
  if (loaded?.id !== current) return <p className="center muted">Loading {info.name}…</p>;
  const { rules, View } = loaded.mod;
  return (
    <div className="game-screen">
      <nav className="game-nav">
        <button className="link" onClick={() => setCurrent(null)}>← All games</button>
        <h1>{info.name}</h1>
        {/* duels are always one against one */}
        {info.players !== '2' && <label className="muted">
          Opponents{' '}
          <select value={bots} onChange={(e) => setBots(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>}
        {info.paced && <label className="muted">
          Speed{' '}
          <select value={speed} onChange={(e) => changeSpeed(e.target.value as Speed)}>
            {SPEEDS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>}
        <button className="link" onClick={() => setShowRules((v) => !v)}>{showRules ? 'Hide rules' : 'Rules'}</button>
      </nav>
      {showRules && (
        <Panel kind="parchment" className="rules">
          <ol>{rules.map((r) => <li key={r}>{r}</li>)}</ol>
        </Panel>
      )}
      {info.memory && (
        <p className="memory-note">Memory game — nothing is written down. Each move is shown once; the full log opens when the match ends.</p>
      )}
      <View key={`${current}-${bots}`} botCount={bots} />
    </div>
  );
}
