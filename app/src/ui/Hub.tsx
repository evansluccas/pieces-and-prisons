import { useState } from 'react';
import { MINI_INFO } from '../games/party/minis';
import { RulesDialog } from './RulesDialog';
import { GAMES, STAGE_LABEL, Stage } from '../games/registry';
import { AccountPanel } from './AccountPanel';
import { ONLINE_IDS } from './Online';
import { Panel, Sprite } from './Panel';

type Mode = 'games' | 'party';
const MODE_KEY = 'pp-hub-mode';
const savedMode = (): Mode => {
  try { return localStorage.getItem(MODE_KEY) === 'party' ? 'party' : 'games'; } catch { return 'games'; }
};

export function Hub({ onPlay, onOnline, onParty, onPage }: { onPlay: (id: string) => void; onOnline: () => void; onParty: () => void; onPage: (page: 'matches' | 'leaders') => void }) {
  const stages: Stage[] = ['prison', 'main', 'exile', 'final', 'hidden'];
  const [mode, setMode] = useState<Mode>(savedMode);
  const choose = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* private window: just don't remember */ }
  };
  return (
    <div className="hub">
      <header className="hub-head">
        <Sprite cat="items" name="piece" size={56} />
        <div>
          <h1>Pieces &amp; Prisons</h1>
          <p className="muted">Strategy, deduction and bluffing games. Earn Pieces. Stay out of prison.</p>
        </div>
      </header>
      <AccountPanel onOnline={onOnline} onMatches={() => onPage('matches')} />
      <p className="hub-links">
        <button className="link" onClick={() => onPage('leaders')}>Leaderboards</button>
      </p>
      <div className="mode-switch" role="tablist" aria-label="Game mode">
        <button role="tab" aria-selected={mode === 'games'} className={mode === 'games' ? 'on' : ''} onClick={() => choose('games')}>Mini-games</button>
        <button role="tab" aria-selected={mode === 'party'} className={mode === 'party' ? 'on' : ''} onClick={() => choose('party')}>Party</button>
      </div>
      {mode === 'party' ? <PartyPanel onParty={onParty} onPractice={onPlay} /> : stages.map((stage) => (
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
                    <small>{g.players} players · {g.playable ? 'Play now' : 'Coming soon'}{ONLINE_IDS.includes(g.id) ? ' · Online' : ''}</small>
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

function PartyPanel({ onParty, onPractice }: { onParty: () => void; onPractice: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const mini = MINI_INFO.find((m) => m.id === open);
  return (
    <Panel className="party-panel">
      <div className="party-head">
        <Sprite cat="icons" name="prison" size={48} />
        <div>
          <h2>Party</h2>
          <p>A board game for <b>2, 4, 6 or 8 players</b> (bots fill empty seats). Roll the die, move around the yard and collect Pieces — whoever has the fewest at the end goes to prison.</p>
        </div>
      </div>
      <ul className="party-rules">
        <li><b>8 rounds.</b> Everyone starts with 10 Pieces and takes one roll per round.</li>
        <li><b>Spaces:</b> blue +3 · red −3 · <b>?</b> a random event · <b>VS</b> challenge a rival to a duel for 5 Pieces · <b>JAIL</b> pay 5 or miss your next roll · <b>$</b> empty the vault · passing <b>GO</b> pays 5.</li>
        <li>Pieces lost on red spaces, fines and jail go into the <b>vault</b>.</li>
        <li><b>After every round, a mini-game:</b> everyone for themselves, or team blue against team red. Puzzles, races, bluffs and bids from the Mini-games collection — shortened to a minute or two.</li>
        <li>The player with the most mini-game wins gets a bonus of 10 Pieces at the end.</li>
      </ul>
      <button className="btn go" onClick={onParty}>Play a party online</button>
      <p className="muted small">Sign in or pick a guest name above first. New to it? The host can start the party with a practice mini-game that’s worth nothing.</p>
      <h3>The mini-games</h3>
      <p className="muted small">Read the rules here, or practise any of them against bots before you play.</p>
      <ul className="party-minis">
        {MINI_INFO.map((m) => (
          <li key={m.id}>
            <b>{m.label}</b>
            <small>{m.blurb}</small>
            <small>{m.duel && !m.round ? 'Duels only' : m.round && !m.duel ? 'After rounds' : 'After rounds and in duels'} · {m.min === m.max ? m.min : `${Math.max(m.min, 2)}–${m.max}`} players</small>
            <button className="link" onClick={() => setOpen(m.id)}>Rules · practice</button>
          </li>
        ))}
      </ul>
      {mini && (
        <RulesDialog gameId={mini.id} title={mini.label} note={mini.blurb} onClose={() => setOpen(null)} onPractice={() => onPractice(mini.id)} />
      )}
    </Panel>
  );
}
