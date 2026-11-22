import { GAMES, STAGE_LABEL, Stage } from '../games/registry';
import { Panel, Sprite } from './Panel';

export function Hub({ onPlay }: { onPlay: (id: string) => void }) {
  const stages: Stage[] = ['prison', 'main', 'exile', 'final', 'hidden'];
  return (
    <div className="hub">
      <header className="hub-head">
        <Sprite cat="items" name="piece" size={56} />
        <div>
          <h1>Pieces &amp; Prisons</h1>
          <p className="muted">Strategy, deduction and bluffing games. Earn Pieces. Stay out of prison.</p>
        </div>
      </header>
      {stages.map((stage) => (
        <section key={stage}>
          <h2>{STAGE_LABEL[stage]}</h2>
          <div className="game-grid">
            {/* playable games first, then what's coming, each in list order */}
            {GAMES.filter((g) => g.stage === stage).sort((a, b) => Number(b.playable) - Number(a.playable)).map((g) => (
              <button
                key={g.id}
                className={`game-card ${g.playable ? '' : 'locked'}`}
                disabled={!g.playable}
                onClick={() => onPlay(g.id)}
              >
                <Panel kind={g.playable ? 'parchment' : 'night'} className="game-card-inner">
                  <Sprite cat={g.icon[0]} name={g.icon[1]} size={g.icon[0] === 'cards' ? 66 : 48} />
                  <div className="game-card-text">
                    <strong>{g.name}</strong>
                    <span>{g.tagline}</span>
                    <small>{g.players} players · {g.playable ? 'Play now' : 'Coming soon'}</small>
                  </div>
                </Panel>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
