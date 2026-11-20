import { useEffect, useState } from 'react';
import { loadAll } from './engine/atlas';
import { GAMES } from './games/registry';
import { LonelyNumber, RULES as LONELY_RULES } from './games/lonely-number/LonelyNumber';
import { SandBid, RULES as SAND_RULES } from './games/sand-bid/SandBid';
import { DiceTower, RULES as DICE_RULES } from './games/dice-tower/DiceTower';
import { TippingScales, RULES as SCALES_RULES } from './games/tipping-scales/TippingScales';
import { Hub } from './ui/Hub';
import { Panel } from './ui/Panel';

const GAME_VIEWS: Record<string, { rules: string[]; View: (p: { botCount: number }) => JSX.Element }> = {
  'lonely-number': { rules: LONELY_RULES, View: LonelyNumber },
  'sand-bid': { rules: SAND_RULES, View: SandBid },
  'dice-tower': { rules: DICE_RULES, View: DiceTower },
  'tipping-scales': { rules: SCALES_RULES, View: TippingScales },
};

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(true);
  const [bots, setBots] = useState(3);

  useEffect(() => {
    loadAll().then(() => setReady(true)).catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="center">Could not load assets: {error}</p>;
  if (!ready) return <p className="center muted">Loading…</p>;
  if (!current) return <Hub onPlay={(id) => { setCurrent(id); setShowRules(true); }} />;

  const info = GAMES.find((g) => g.id === current)!;
  const { rules, View } = GAME_VIEWS[current];
  return (
    <div className="game-screen">
      <nav className="game-nav">
        <button className="link" onClick={() => setCurrent(null)}>← All games</button>
        <h1>{info.name}</h1>
        <label className="muted">
          Opponents{' '}
          <select value={bots} onChange={(e) => setBots(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="link" onClick={() => setShowRules((v) => !v)}>{showRules ? 'Hide rules' : 'Rules'}</button>
      </nav>
      {showRules && (
        <Panel kind="parchment" className="rules">
          <ol>{rules.map((r) => <li key={r}>{r}</li>)}</ol>
        </Panel>
      )}
      <View key={`${current}-${bots}`} botCount={bots} />
    </div>
  );
}
