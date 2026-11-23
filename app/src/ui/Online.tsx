import { FormEvent, LazyExoticComponent, ReactElement, Suspense, lazy, useEffect, useState } from 'react';
import { GAMES } from '../games/registry';
import { GameMessage, RoomView, useTable } from '../net/table';
import { Me, account } from '../net/account';
import { Panel, Sprite } from './Panel';

export interface OnlineGameProps {
  game: GameMessage;
  room: RoomView;
  send: (msg: Record<string, unknown>) => void;
  /** "Play again" on the final screen: back to the lobby. */
  onAgain: () => void;
  /** The server's latest refusal (e.g. "That loop doesn't fit every number"), with when it arrived — so a board can say why. */
  error: { text: string; at: number } | null;
}

/** Games that can be played at an online table, and the view that plays them. */
const ONLINE_VIEWS: Record<string, LazyExoticComponent<(p: OnlineGameProps) => ReactElement>> = {
  'lonely-number': lazy(() => import('../games/lonely-number/LonelyNumberOnline').then((m) => ({ default: m.LonelyNumberOnline }))),
  'sand-bid': lazy(() => import('../games/sand-bid/SandBidOnline').then((m) => ({ default: m.SandBidOnline }))),
  'dice-tower': lazy(() => import('../games/dice-tower/DiceTowerOnline').then((m) => ({ default: m.DiceTowerOnline }))),
  'blind-bingo': lazy(() => import('../games/blind-bingo/BlindBingoOnline').then((m) => ({ default: m.BlindBingoOnline }))),
  'walls-and-wards': lazy(() => import('../games/walls-and-wards/WallsAndWardsOnline').then((m) => ({ default: m.WallsAndWardsOnline }))),
  'turf-war': lazy(() => import('../games/turf-war/TurfWarOnline').then((m) => ({ default: m.TurfWarOnline }))),
  'tri-mancala': lazy(() => import('../games/tri-mancala/TriMancalaOnline').then((m) => ({ default: m.TriMancalaOnline }))),
  'nine-mens-morris': lazy(() => import('../games/nine-mens-morris/NineMensMorrisOnline').then((m) => ({ default: m.NineMensMorrisOnline }))),
  'tigers-and-goats': lazy(() => import('../games/tigers-and-goats/TigersAndGoatsOnline').then((m) => ({ default: m.TigersAndGoatsOnline }))),
  'tipping-scales': lazy(() => import('../games/tipping-scales/TippingScalesOnline').then((m) => ({ default: m.TippingScalesOnline }))),
  'rumor-exchange': lazy(() => import('../games/rumor-exchange/RumorExchangeOnline').then((m) => ({ default: m.RumorExchangeOnline }))),
  'color-doubt': lazy(() => import('../games/color-doubt/ColorDoubtOnline').then((m) => ({ default: m.ColorDoubtOnline }))),
  'deadeye-holdem': lazy(() => import('../games/deadeye-holdem/DeadeyeHoldemOnline').then((m) => ({ default: m.DeadeyeHoldemOnline }))),
  'high-low-equations': lazy(() => import('../games/high-low-equations/HighLowEquationsOnline').then((m) => ({ default: m.HighLowEquationsOnline }))),
  'smugglers-gems': lazy(() => import('../games/smugglers-gems/SmugglersGemsOnline').then((m) => ({ default: m.SmugglersGemsOnline }))),
  'piggy-bluff': lazy(() => import('../games/piggy-bluff/PiggyBluffOnline').then((m) => ({ default: m.PiggyBluffOnline }))),
  'six-chambers': lazy(() => import('../games/six-chambers/SixChambersOnline').then((m) => ({ default: m.SixChambersOnline }))),
  'high-or-low': lazy(() => import('../games/high-or-low/HighOrLowOnline').then((m) => ({ default: m.HighOrLowOnline }))),
  'ask-and-arrange': lazy(() => import('../games/ask-and-arrange/AskAndArrangeOnline').then((m) => ({ default: m.AskAndArrangeOnline }))),
  'hex-sum': lazy(() => import('../games/hex-sum/HexSumOnline').then((m) => ({ default: m.HexSumOnline }))),
  'blind-five': lazy(() => import('../games/blind-five/BlindFiveOnline').then((m) => ({ default: m.BlindFiveOnline }))),
  'number-forge': lazy(() => import('../games/number-forge/NumberForgeOnline').then((m) => ({ default: m.NumberForgeOnline }))),
  'split-decision': lazy(() => import('../games/split-decision/SplitDecisionOnline').then((m) => ({ default: m.SplitDecisionOnline }))),
  'second-glance': lazy(() => import('../games/second-glance/SecondGlanceOnline').then((m) => ({ default: m.SecondGlanceOnline }))),
  'piece-together': lazy(() => import('../games/piece-together/PieceTogetherOnline').then((m) => ({ default: m.PieceTogetherOnline }))),
  'mirror-pieces': lazy(() => import('../games/mirror-pieces/MirrorPiecesOnline').then((m) => ({ default: m.MirrorPiecesOnline }))),
  'fence-loop': lazy(() => import('../games/fence-loop/FenceLoopOnline').then((m) => ({ default: m.FenceLoopOnline }))),
  'cipher-lock': lazy(() => import('../games/cipher-lock/CipherLockOnline').then((m) => ({ default: m.CipherLockOnline }))),
  'knights-tour': lazy(() => import('../games/knights-tour/KnightsTourOnline').then((m) => ({ default: m.KnightsTourOnline }))),
  'magic-squares': lazy(() => import('../games/magic-squares/MagicSquaresOnline').then((m) => ({ default: m.MagicSquaresOnline }))),
};
export const ONLINE_IDS = Object.keys(ONLINE_VIEWS);

export function Online({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    account.me().then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return <p className="center muted">Loading…</p>;
  if (!me) {
    return (
      <div className="online">
        <nav className="game-nav"><button className="link" onClick={onExit}>← All games</button><h1>Online tables</h1></nav>
        <Panel><p>Sign in or pick a guest name on the main screen to play online.</p></Panel>
      </div>
    );
  }
  return <Tables me={me} onExit={onExit} />;
}

function Tables({ me, onExit }: { me: Me; onExit: () => void }) {
  const { link, room, game, error, send, clearError } = useTable();
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) send({ type: 'join', code: code.trim() });
  };
  const leave = () => send({ type: 'leave' });
  const title = room ? GAMES.find((g) => g.id === room.gameId)?.name ?? room.gameId : 'Online tables';
  const View = room ? ONLINE_VIEWS[room.gameId] : null;
  const inGame = room && room.status !== 'lobby' && game && View;

  return (
    <div className="online">
      <nav className="game-nav">
        <button className="link" onClick={onExit}>← All games</button>
        <h1>{title}</h1>
        {room && <span className="muted">Table <b className="code">{room.code}</b></span>}
        <span className={`link-dot ${link}`} title={link === 'open' ? 'Connected' : 'Reconnecting…'}>{link === 'open' ? 'online' : 'reconnecting…'}</span>
        <span className="muted">as {me.name}</span>
        {room && <button className="link" onClick={leave}>Leave table</button>}
      </nav>
      {error && <p className="online-error" role="alert">{error.text}</p>}

      {inGame ? (
        <Suspense fallback={<p className="center muted">Loading…</p>}>
          <View game={game} room={room} send={send} error={error} onAgain={() => (room.host ? send({ type: 'again' }) : undefined)} />
        </Suspense>
      ) : room ? (
        <Lobby room={room} send={send} />
      ) : (
        <div className="online-start">
          <Panel>
            <h2>Start a table</h2>
            <p className="muted">You get a code to share; friends join with it. Empty seats can be filled with bots.</p>
            <div className="online-games">
              {GAMES.filter((g) => ONLINE_IDS.includes(g.id)).map((g) => (
                <button key={g.id} className="btn online-game" onClick={() => send({ type: 'create', gameId: g.id })}>
                  <Sprite cat={g.icon[0]} name={g.icon[1]} size={32} />
                  <span>{g.name}<small>{g.players} players</small></span>
                </button>
              ))}
            </div>
            <p className="muted small">More games come online one by one.</p>
          </Panel>
          <Panel>
            <h2>Join a table</h2>
            <form className="account-form" onSubmit={join}>
              <input aria-label="Table code" placeholder="CODE" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button className="btn" disabled={code.trim().length !== 4}>Join</button>
            </form>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Lobby({ room, send }: { room: RoomView; send: (m: Record<string, unknown>) => void }) {
  const short = room.seats.length < room.minPlayers;
  const full = room.seats.length >= room.maxPlayers;
  return (
    <Panel className="lobby">
      {room.status === 'over' && room.results && (
        <div className="lobby-results">
          <h2>Final result</h2>
          <ol>
            {room.results.map((r) => (
              <li key={r.name} className={r.you ? 'you' : ''}>{r.place}. {r.name} — {r.detail}</li>
            ))}
          </ol>
        </div>
      )}
      <p>
        Share the code <b className="code big">{room.code}</b> — friends choose <i>Join a table</i> and type it in.
      </p>
      <h2>Seats ({room.seats.length}/{room.maxPlayers})</h2>
      <ul className="seats">
        {room.seats.map((s, i) => (
          <li key={i}>
            <span>
              {s.name}
              {s.you && <span className="muted"> (you)</span>}
              {s.host && <span className="tag">host</span>}
              {s.bot && <span className="tag bot">bot</span>}
              {!s.connected && <span className="tag off">away</span>}
            </span>
            <span>
              {room.host && !s.you && room.status === 'lobby' && (
                <button className="link" onClick={() => send({ type: 'removeSeat', seat: i })}>remove</button>
              )}
              {!s.you && !s.bot && (
                <button
                  className="link report"
                  title="Report this player's name"
                  onClick={() => window.confirm(`Report the name “${s.name}”?`) && send({ type: 'report', seat: i })}
                >report</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {room.host ? (
        <div className="lobby-actions">
          {room.status === 'over' ? (
            <button className="btn" onClick={() => send({ type: 'again' })}>Set up another game</button>
          ) : (
            <>
              <button className="btn" disabled={full} onClick={() => send({ type: 'addBot' })}>Add a bot</button>
              <button className="btn go" disabled={short} onClick={() => send({ type: 'start' })}>Start game</button>
              {short && <span className="muted">Needs at least {room.minPlayers} players — add bots to fill seats.</span>}
            </>
          )}
        </div>
      ) : (
        <p className="muted">{room.status === 'over' ? 'Waiting for the host to set up another game…' : 'Waiting for the host to start…'}</p>
      )}
    </Panel>
  );
}
