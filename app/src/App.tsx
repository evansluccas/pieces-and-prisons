import { useEffect, useState } from 'react';
import { loadAll } from './engine/atlas';
import { GAMES } from './games/registry';
import { BOT_SPEED, SPEEDS, Speed, setSpeed } from './games/shared/pace';
import { Hub } from './ui/Hub';
import { GAME_VIEWS, GameModule } from './games/loaders';
import { Online } from './ui/Online';
import { Leaderboards, MyMatches } from './ui/Records';
import { Panel } from './ui/Panel';

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
  if (current === 'party') return <Online mode="party" onExit={() => setCurrent(null)} />;
  if (current === 'matches') return <MyMatches onExit={() => setCurrent(null)} />;
  if (current === 'leaders') return <Leaderboards onExit={() => setCurrent(null)} />;
  if (!current) return <Hub onPlay={(id) => { setCurrent(id); setShowRules(true); }} onOnline={() => setCurrent('online')} onParty={() => setCurrent('party')} onPage={setCurrent} />;

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
