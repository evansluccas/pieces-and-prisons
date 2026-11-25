/** A game's screen and rules. Each game's code loads only when it's opened (smaller first download). */
export interface GameModule { rules: string[]; View: (p: { botCount: number }) => JSX.Element }
export const GAME_VIEWS: Record<string, () => Promise<GameModule>> = {
  'lonely-number': () => import('./lonely-number/LonelyNumber').then((m) => ({ rules: m.RULES, View: m.LonelyNumber })),
  'sand-bid': () => import('./sand-bid/SandBid').then((m) => ({ rules: m.RULES, View: m.SandBid })),
  'dice-tower': () => import('./dice-tower/DiceTower').then((m) => ({ rules: m.RULES, View: m.DiceTower })),
  'tipping-scales': () => import('./tipping-scales/TippingScales').then((m) => ({ rules: m.RULES, View: m.TippingScales })),
  'six-chambers': () => import('./six-chambers/SixChambers').then((m) => ({ rules: m.RULES, View: m.SixChambers })),
  'walls-and-wards': () => import('./walls-and-wards/WallsAndWards').then((m) => ({ rules: m.RULES, View: m.WallsAndWards })),
  'piggy-bluff': () => import('./piggy-bluff/PiggyBluff').then((m) => ({ rules: m.RULES, View: m.PiggyBluff })),
  'blind-bingo': () => import('./blind-bingo/BlindBingo').then((m) => ({ rules: m.RULES, View: m.BlindBingo })),
  'smugglers-gems': () => import('./smugglers-gems/SmugglersGems').then((m) => ({ rules: m.RULES, View: m.SmugglersGems })),
  'color-doubt': () => import('./color-doubt/ColorDoubt').then((m) => ({ rules: m.RULES, View: m.ColorDoubt })),
  'number-forge': () => import('./number-forge/NumberForge').then((m) => ({ rules: m.RULES, View: m.NumberForge })),
  'rumor-exchange': () => import('./rumor-exchange/RumorExchange').then((m) => ({ rules: m.RULES, View: m.RumorExchange })),
  'cipher-lock': () => import('./cipher-lock/CipherLock').then((m) => ({ rules: m.RULES, View: m.CipherLock })),
  'fence-loop': () => import('./fence-loop/FenceLoop').then((m) => ({ rules: m.RULES, View: m.FenceLoop })),
  'second-glance': () => import('./second-glance/SecondGlance').then((m) => ({ rules: m.RULES, View: m.SecondGlance })),
  'deadeye-holdem': () => import('./deadeye-holdem/DeadeyeHoldem').then((m) => ({ rules: m.RULES, View: m.DeadeyeHoldem })),
  'split-decision': () => import('./split-decision/SplitDecision').then((m) => ({ rules: m.RULES, View: m.SplitDecision })),
  'piece-together': () => import('./piece-together/PieceTogether').then((m) => ({ rules: m.RULES, View: m.PieceTogether })),
  'mirror-pieces': () => import('./mirror-pieces/MirrorPieces').then((m) => ({ rules: m.RULES, View: m.MirrorPieces })),
  'nine-mens-morris': () => import('./nine-mens-morris/NineMensMorris').then((m) => ({ rules: m.RULES, View: m.NineMensMorris })),
  'hex-sum': () => import('./hex-sum/HexSum').then((m) => ({ rules: m.RULES, View: m.HexSum })),
  'high-or-low': () => import('./high-or-low/HighOrLow').then((m) => ({ rules: m.RULES, View: m.HighOrLow })),
  'tigers-and-goats': () => import('./tigers-and-goats/TigersAndGoats').then((m) => ({ rules: m.RULES, View: m.TigersAndGoats })),
  'ask-and-arrange': () => import('./ask-and-arrange/AskAndArrange').then((m) => ({ rules: m.RULES, View: m.AskAndArrange })),
  'knights-tour': () => import('./knights-tour/KnightsTour').then((m) => ({ rules: m.RULES, View: m.KnightsTour })),
  'blind-five': () => import('./blind-five/BlindFive').then((m) => ({ rules: m.RULES, View: m.BlindFive })),
  'magic-squares': () => import('./magic-squares/MagicSquares').then((m) => ({ rules: m.RULES, View: m.MagicSquares })),
  'high-low-equations': () => import('./high-low-equations/HighLowEquations').then((m) => ({ rules: m.RULES, View: m.HighLowEquations })),
  'turf-war': () => import('./turf-war/TurfWar').then((m) => ({ rules: m.RULES, View: m.TurfWar })),
  'tri-mancala': () => import('./tri-mancala/TriMancala').then((m) => ({ rules: m.RULES, View: m.TriMancala })),
};

/** A game's rules, loading its code if needed. */
export const loadRules = (id: string): Promise<string[]> => (GAME_VIEWS[id] ? GAME_VIEWS[id]().then((m) => m.rules) : Promise.resolve([]));
