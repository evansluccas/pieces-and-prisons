import { useEffect, useState } from 'react';
import { loadAll } from './engine/atlas';
import { GAMES } from './games/registry';
import { LonelyNumber, RULES as LONELY_RULES } from './games/lonely-number/LonelyNumber';
import { SandBid, RULES as SAND_RULES } from './games/sand-bid/SandBid';
import { DiceTower, RULES as DICE_RULES } from './games/dice-tower/DiceTower';
import { TippingScales, RULES as SCALES_RULES } from './games/tipping-scales/TippingScales';
import { SixChambers, RULES as CHAMBER_RULES } from './games/six-chambers/SixChambers';
import { WallsAndWards, RULES as WALL_RULES } from './games/walls-and-wards/WallsAndWards';
import { PiggyBluff, RULES as PIGGY_RULES } from './games/piggy-bluff/PiggyBluff';
import { BlindBingo, RULES as BINGO_RULES } from './games/blind-bingo/BlindBingo';
import { SmugglersGems, RULES as GEM_RULES } from './games/smugglers-gems/SmugglersGems';
import { BOT_SPEED, SPEEDS, Speed, setSpeed } from './games/shared/pace';
import { ColorDoubt, RULES as DOUBT_RULES } from './games/color-doubt/ColorDoubt';
import { NumberForge, RULES as FORGE_RULES } from './games/number-forge/NumberForge';
import { RumorExchange, RULES as RUMOR_RULES } from './games/rumor-exchange/RumorExchange';
import { CipherLock, RULES as CIPHER_RULES } from './games/cipher-lock/CipherLock';
import { FenceLoop, RULES as FENCE_RULES } from './games/fence-loop/FenceLoop';
import { SecondGlance, RULES as GLANCE_RULES } from './games/second-glance/SecondGlance';
import { DeadeyeHoldem, RULES as DEADEYE_RULES } from './games/deadeye-holdem/DeadeyeHoldem';
import { SplitDecision, RULES as SPLIT_RULES } from './games/split-decision/SplitDecision';
import { PieceTogether, RULES as PIECE_RULES } from './games/piece-together/PieceTogether';
import { MirrorPieces, RULES as MIRROR_RULES } from './games/mirror-pieces/MirrorPieces';
import { NineMensMorris, RULES as MORRIS_RULES } from './games/nine-mens-morris/NineMensMorris';
import { HexSum, RULES as HEX_RULES } from './games/hex-sum/HexSum';
import { HighOrLow, RULES as HILO_RULES } from './games/high-or-low/HighOrLow';
import { TigersAndGoats, RULES as TIGER_RULES } from './games/tigers-and-goats/TigersAndGoats';
import { AskAndArrange, RULES as ASK_RULES } from './games/ask-and-arrange/AskAndArrange';
import { KnightsTour, RULES as KNIGHT_RULES } from './games/knights-tour/KnightsTour';
import { BlindFive, RULES as BLIND_FIVE_RULES } from './games/blind-five/BlindFive';
import { MagicSquares, RULES as MAGIC_RULES } from './games/magic-squares/MagicSquares';
import { HighLowEquations, RULES as HLE_RULES } from './games/high-low-equations/HighLowEquations';
import { TurfWar, RULES as TURF_RULES } from './games/turf-war/TurfWar';
import { Hub } from './ui/Hub';
import { Panel } from './ui/Panel';

const GAME_VIEWS: Record<string, { rules: string[]; View: (p: { botCount: number }) => JSX.Element }> = {
  'lonely-number': { rules: LONELY_RULES, View: LonelyNumber },
  'sand-bid': { rules: SAND_RULES, View: SandBid },
  'dice-tower': { rules: DICE_RULES, View: DiceTower },
  'tipping-scales': { rules: SCALES_RULES, View: TippingScales },
  'six-chambers': { rules: CHAMBER_RULES, View: SixChambers },
  'walls-and-wards': { rules: WALL_RULES, View: WallsAndWards },
  'piggy-bluff': { rules: PIGGY_RULES, View: PiggyBluff },
  'blind-bingo': { rules: BINGO_RULES, View: BlindBingo },
  'smugglers-gems': { rules: GEM_RULES, View: SmugglersGems },
  'color-doubt': { rules: DOUBT_RULES, View: ColorDoubt },
  'number-forge': { rules: FORGE_RULES, View: NumberForge },
  'rumor-exchange': { rules: RUMOR_RULES, View: RumorExchange },
  'cipher-lock': { rules: CIPHER_RULES, View: CipherLock },
  'fence-loop': { rules: FENCE_RULES, View: FenceLoop },
  'second-glance': { rules: GLANCE_RULES, View: SecondGlance },
  'deadeye-holdem': { rules: DEADEYE_RULES, View: DeadeyeHoldem },
  'split-decision': { rules: SPLIT_RULES, View: SplitDecision },
  'piece-together': { rules: PIECE_RULES, View: PieceTogether },
  'mirror-pieces': { rules: MIRROR_RULES, View: MirrorPieces },
  'nine-mens-morris': { rules: MORRIS_RULES, View: NineMensMorris },
  'hex-sum': { rules: HEX_RULES, View: HexSum },
  'high-or-low': { rules: HILO_RULES, View: HighOrLow },
  'tigers-and-goats': { rules: TIGER_RULES, View: TigersAndGoats },
  'ask-and-arrange': { rules: ASK_RULES, View: AskAndArrange },
  'knights-tour': { rules: KNIGHT_RULES, View: KnightsTour },
  'blind-five': { rules: BLIND_FIVE_RULES, View: BlindFive },
  'magic-squares': { rules: MAGIC_RULES, View: MagicSquares },
  'high-low-equations': { rules: HLE_RULES, View: HighLowEquations },
  'turf-war': { rules: TURF_RULES, View: TurfWar },
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
