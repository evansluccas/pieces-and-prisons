import { useEffect, useState } from 'react';
import { loadRules } from '../games/loaders';
import { Panel } from './Panel';

interface Props {
  gameId: string;
  title: string;
  /** How the game is played here, if it differs from the full game (e.g. the Party's short version). */
  note?: string;
  onClose: () => void;
  /** Offer to try the game against bots (only where leaving the page is fine). */
  onPractice?: () => void;
}

/** A game's rules over the page. Closes with the button, Escape, or a click outside. */
export function RulesDialog({ gameId, title, note, onClose, onPractice }: Props) {
  const [rules, setRules] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    loadRules(gameId).then((r) => live && setRules(r), () => live && setRules([]));
    return () => {
      live = false;
    };
  }, [gameId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="rules-dialog" role="dialog" aria-modal="true" aria-label={`${title} rules`} onClick={onClose}>
      <div className="rules-dialog-box" onClick={(e) => e.stopPropagation()}>
        <Panel kind="parchment" className="rules">
          <h2>{title}</h2>
          {note && <p className="rules-note"><b>In the Party:</b> {note}</p>}
          {rules === null ? <p>Loading…</p> : <ol>{rules.map((r) => <li key={r}>{r}</li>)}</ol>}
          <div className="rules-actions">
            {onPractice && <button className="btn" onClick={onPractice}>Practice against bots</button>}
            <button className="btn go" onClick={onClose} autoFocus>Close</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
