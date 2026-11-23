import { useEffect, useState } from 'react';
import { GAMES } from '../games/registry';
import { LeaderRow, MatchSummary, Offline, records } from '../net/account';
import { Panel } from './Panel';

const gameName = (id: string) => (id === 'party' ? 'Party' : GAMES.find((g) => g.id === id)?.name ?? id);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const placeText = (p: number | null) => (p === null ? '—' : p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : `${p}th`);

/** Loading / failure lines shared by both screens. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load().then((d) => live && setData(d), (e) => live && setError(e instanceof Offline ? 'The game server is offline.' : e instanceof Error ? e.message : 'Something went wrong.'));
    return () => {
      live = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

/** Your finished online matches, newest first. */
export function MyMatches({ onExit }: { onExit: () => void }) {
  const { data, error } = useLoad(records.matches, []);
  return (
    <div className="records">
      <nav className="game-nav"><button className="link" onClick={onExit}>← All games</button><h1>My matches</h1></nav>
      {error && <Panel><p>{error}</p></Panel>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.length && <Panel><p>No finished online matches yet. Play one from <i>Play online</i> and it will show up here.</p></Panel>}
      {data && data.length > 0 && (
        <ol className="match-list">
          {data.map((m: MatchSummary) => (
            <li key={m.id}>
              <Panel>
                <div className="match-head">
                  <b>{gameName(m.gameId)}</b>
                  <span className={m.place === 1 ? 'win' : 'muted'}>{placeText(m.place)}{m.detail ? ` · ${m.detail}` : ''}</span>
                  <span className="muted small">{when(m.finishedAt)}</span>
                </div>
                <ol className="match-players">
                  {m.players.map((p, i) => (
                    <li key={i} className={p.you ? 'you' : ''}>
                      {placeText(p.place)} {p.name}{p.bot ? <span className="muted"> (bot)</span> : null}
                      {p.detail ? <span className="muted"> — {p.detail}</span> : null}
                    </li>
                  ))}
                </ol>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The top players for one game, or for all games together. */
export function Leaderboards({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<string>('');
  const { data, error } = useLoad(() => records.leaderboard(game || null), [game]);
  return (
    <div className="records">
      <nav className="game-nav">
        <button className="link" onClick={onExit}>← All games</button>
        <h1>Leaderboards</h1>
        <label className="muted">
          Game{' '}
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">All games</option>
            <option value="party">Party</option>
            {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </nav>
      <Panel>
        <p className="muted small">Online matches only. Most wins first, then the best win rate, then the most games played.</p>
        {error && <p>{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && !data.length && <p>No finished matches yet{game ? ` of ${gameName(game)}` : ''}.</p>}
        {data && data.length > 0 && (
          <table className="leaderboard">
            <thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Played</th><th>Win rate</th><th>Avg place</th></tr></thead>
            <tbody>
              {data.map((r: LeaderRow) => (
                <tr key={r.rank} className={r.you ? 'you' : ''}>
                  <td>{r.rank}</td><td>{r.name}</td><td>{r.wins}</td><td>{r.played}</td>
                  <td>{Math.round(r.winRate * 100)}%</td><td>{r.avgPlace.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
