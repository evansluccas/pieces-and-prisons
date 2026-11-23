import { useEffect, useMemo, useState } from 'react';
import type { GameMessage } from '../net/table';
import { RaceView, clock } from '../games/shared/race';

/**
 * The side panel for a puzzle race: the round, the clock, who has finished
 * and the running totals; between rounds a Ready button, at the end the
 * final order. Every puzzle's online screen shows it next to its board.
 */
export function RaceBoard({ game, send, onAgain, unit = 'solved' }: {
  game: GameMessage;
  send: (msg: Record<string, unknown>) => void;
  onAgain: () => void;
  /** What a point means, for the totals column ("solved", "found"...). */
  unit?: string;
}) {
  const v = game.view as RaceView;
  const [, tick] = useState(0);
  // time left, counted down locally from what the server said
  const arrived = useMemo(() => performance.now(), [game]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const left = v.leftMs === null ? null : Math.max(0, v.leftMs - (performance.now() - arrived));
  const pauseLeft = game.pauseUntil ? Math.max(0, Math.ceil((game.pauseUntil - Date.now()) / 1000)) : null;

  const stageLine =
    v.stage === 'study' ? `Study — solving starts in ${Math.ceil((left ?? 0) / 1000)} s`
    : v.stage === 'solve' ? (v.me?.finished ? 'Finished — waiting for the others' : `Time left ${clock(left ?? 0)}`)
    : v.stage === 'result' ? `Round over${pauseLeft !== null ? ` — next in ${pauseLeft} s` : ''}`
    : 'Race over';

  return (
    <aside className="log race-board">
      <h3>Round {Math.min(v.round + 1, v.rounds)} of {v.rounds}</h3>
      <p className={v.stage === 'solve' && !v.me?.finished && (left ?? 0) < 30_000 ? 'tip' : 'muted'}>{stageLine}</p>
      {v.me?.penaltyMs ? <p className="muted">Penalties this round: +{clock(v.me.penaltyMs)}</p> : null}
      <ol>
        {v.board.map((r) => (
          <li key={r.name} className={r.you ? 'you' : ''}>
            <b>{r.name}</b>{r.bot ? <span className="muted"> (bot)</span> : null}
            <em className={r.round?.finished ? 'win' : r.round ? 'tip' : ''}>
              {r.round ? `${r.round.finished ? clock(r.round.ms) : 'not finished'}${r.round.detail ? ` · ${r.round.detail}` : ''}`
                : v.stage === 'study' ? 'studying…' : v.stage === 'solve' ? 'solving…' : ''}
            </em>
            <em>{r.points} {unit} · {clock(r.ms)} in all</em>
          </li>
        ))}
      </ol>
      {v.stage === 'result' && <button className="btn" onClick={() => send({ type: 'ready' })}>Ready</button>}
      {v.stage === 'over' && (
        <>
          <p className="win">{v.board[0]?.you ? 'You win the race!' : `${v.board[0]?.name} wins the race.`}</p>
          <button className="btn" onClick={onAgain}>Play again</button>
        </>
      )}
    </aside>
  );
}
