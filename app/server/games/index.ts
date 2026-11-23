/** Games that can be played at an online table. */
import type { OnlineGame } from './types';
import * as lonely from '../../src/games/lonely-number/online';
import type { GameState as LonelyState } from '../../src/games/lonely-number/logic';
import * as sand from '../../src/games/sand-bid/online';
import * as dice from '../../src/games/dice-tower/online';
import * as bingo from '../../src/games/blind-bingo/online';
import type { GameState as BingoState } from '../../src/games/blind-bingo/logic';
import * as walls from '../../src/games/walls-and-wards/online';
import type { GameState as WallsState } from '../../src/games/walls-and-wards/logic';
import * as turf from '../../src/games/turf-war/online';
import type { GameState as TurfState } from '../../src/games/turf-war/logic';
import * as mancala from '../../src/games/tri-mancala/online';
import type { GameState as MancalaState } from '../../src/games/tri-mancala/logic';
import * as morris from '../../src/games/nine-mens-morris/online';
import * as tigers from '../../src/games/tigers-and-goats/online';
import * as scales from '../../src/games/tipping-scales/online';
import type { GameState as ScalesState } from '../../src/games/tipping-scales/logic';
import * as rumor from '../../src/games/rumor-exchange/online';
import * as doubt from '../../src/games/color-doubt/online';
import * as deadeye from '../../src/games/deadeye-holdem/online';
import * as hilo from '../../src/games/high-low-equations/online';
import * as d_smugglers_gems from '../../src/games/smugglers-gems/online';
import * as d_piggy_bluff from '../../src/games/piggy-bluff/online';
import * as d_six_chambers from '../../src/games/six-chambers/online';
import * as d_high_or_low from '../../src/games/high-or-low/online';
import * as d_ask_and_arrange from '../../src/games/ask-and-arrange/online';
import * as d_hex_sum from '../../src/games/hex-sum/online';
import * as d_blind_five from '../../src/games/blind-five/online';
import * as e_number_forge from '../../src/games/number-forge/online';
import * as e_split_decision from '../../src/games/split-decision/online';

const lonelyNumber: OnlineGame<LonelyState> = {
  id: 'lonely-number',
  minPlayers: 3,
  maxPlayers: 6,
  start: (seats) => lonely.start(seats),
  act: lonely.act,
  view: lonely.view,
  waitingOn: lonely.waitingOn,
  botAction: lonely.botAction,
  pause: lonely.pause,
  over: lonely.over,
  results: lonely.results,
};

const sandBid: OnlineGame<sand.OnlineState> = {
  id: 'sand-bid',
  minPlayers: 3,
  maxPlayers: 6,
  start: sand.start,
  act: sand.act,
  view: sand.view,
  waitingOn: () => [],          // real-time: nobody "has the turn"
  botAction: () => null,        // bots are driven inside the game
  pause: sand.pause,
  over: sand.over,
  results: sand.results,
  realtime: { wakeAt: sand.wakeAt, tick: sand.tick, dropped: sand.dropped, takeover: sand.takeover },
};

const diceTower: OnlineGame<dice.OnlineState> = {
  id: 'dice-tower',
  minPlayers: 3,
  maxPlayers: 6,
  start: dice.start,
  act: dice.act,
  view: dice.view,
  waitingOn: dice.waitingOn,
  botAction: dice.botAction,
  pause: dice.pause,
  over: dice.over,
  results: dice.results,
};

const blindBingo: OnlineGame<BingoState> = {
  id: 'blind-bingo',
  minPlayers: 3,
  maxPlayers: 6,
  start: bingo.start,
  act: bingo.act,
  view: bingo.view,
  waitingOn: bingo.waitingOn,
  botAction: bingo.botAction,
  pause: bingo.pause,
  over: bingo.over,
  results: bingo.results,
};

const wallsAndWards: OnlineGame<WallsState> = {
  id: 'walls-and-wards',
  minPlayers: 2,
  maxPlayers: 4,
  start: walls.start,
  act: walls.act,
  view: walls.view,
  waitingOn: walls.waitingOn,
  botAction: walls.botAction,
  over: walls.over,
  results: walls.results,
};

const turfWar: OnlineGame<TurfState> = {
  id: 'turf-war',
  minPlayers: 2,
  maxPlayers: 4,
  start: turf.start,
  act: turf.act,
  view: turf.view,
  waitingOn: turf.waitingOn,
  botAction: turf.botAction,
  over: turf.over,
  results: turf.results,
};

const triMancala: OnlineGame<MancalaState> = {
  id: 'tri-mancala',
  minPlayers: 2,
  maxPlayers: 4,
  start: mancala.start,
  act: mancala.act,
  view: mancala.view,
  waitingOn: mancala.waitingOn,
  botAction: mancala.botAction,
  over: mancala.over,
  results: mancala.results,
};

const nineMensMorris: OnlineGame<morris.OnlineState> = {
  id: 'nine-mens-morris',
  minPlayers: 2,
  maxPlayers: 2,
  start: morris.start,
  act: morris.act,
  view: morris.view,
  waitingOn: morris.waitingOn,
  botAction: morris.botAction,
  over: morris.over,
  results: morris.results,
};

const tigersAndGoats: OnlineGame<tigers.OnlineState> = {
  id: 'tigers-and-goats',
  minPlayers: 2,
  maxPlayers: 2,
  start: tigers.start,
  act: tigers.act,
  view: tigers.view,
  waitingOn: tigers.waitingOn,
  botAction: tigers.botAction,
  pause: tigers.pause,
  over: tigers.over,
  results: tigers.results,
};

const tippingScales: OnlineGame<ScalesState> = {
  id: 'tipping-scales',
  minPlayers: 3,
  maxPlayers: 7,
  start: scales.start,
  act: scales.act,
  view: scales.view,
  waitingOn: scales.waitingOn,
  botAction: scales.botAction,
  pause: scales.pause,
  over: scales.over,
  results: scales.results,
};

const rumorExchange: OnlineGame<rumor.OnlineState> = {
  id: 'rumor-exchange',
  minPlayers: 2,
  maxPlayers: 6,
  start: rumor.start,
  act: rumor.act,
  view: rumor.view,
  waitingOn: rumor.waitingOn,
  decisionKey: rumor.decisionKey,
  botAction: rumor.botAction,
  over: rumor.over,
  results: rumor.results,
};

const colorDoubt: OnlineGame<doubt.OnlineState> = {
  id: 'color-doubt',
  minPlayers: 3,
  maxPlayers: 6,
  start: doubt.start,
  act: doubt.act,
  view: doubt.view,
  waitingOn: doubt.waitingOn,
  botAction: doubt.botAction,
  pause: doubt.pause,
  over: doubt.over,
  results: doubt.results,
};

const deadeyeHoldem: OnlineGame<deadeye.OnlineState> = {
  id: 'deadeye-holdem',
  minPlayers: 2,
  maxPlayers: 6,
  start: deadeye.start,
  act: deadeye.act,
  view: deadeye.view,
  waitingOn: deadeye.waitingOn,
  botAction: deadeye.botAction,
  pause: deadeye.pause,
  over: deadeye.over,
  results: deadeye.results,
};

const highLowEquations: OnlineGame<hilo.OnlineState> = {
  id: 'high-low-equations',
  minPlayers: 3,
  maxPlayers: 6,
  start: hilo.start,
  act: hilo.act,
  view: hilo.view,
  waitingOn: hilo.waitingOn,
  turnMs: hilo.turnMs,
  botAction: hilo.botAction,
  pause: hilo.pause,
  over: hilo.over,
  results: hilo.results,
};

/** Build a table entry from a game's online module (its exported functions). */
function fromModule(id: string, minPlayers: number, maxPlayers: number, m: Record<string, any>): OnlineGame<any> {
  return {
    id, minPlayers, maxPlayers,
    start: m.start, act: m.act, view: m.view, waitingOn: m.waitingOn, botAction: m.botAction, over: m.over, results: m.results,
    pause: m.pause, turnMs: m.turnMs, decisionKey: m.decisionKey, realtime: m.realtime,
  };
}

/** Group D: memory and private-information games. */
const GROUP_D = [
  fromModule('smugglers-gems', 3, 6, d_smugglers_gems),
  fromModule('piggy-bluff', 3, 6, d_piggy_bluff),
  fromModule('six-chambers', 3, 6, d_six_chambers),
  fromModule('high-or-low', 2, 2, d_high_or_low),
  fromModule('ask-and-arrange', 2, 2, d_ask_and_arrange),
  fromModule('hex-sum', 2, 2, d_hex_sum),
  fromModule('blind-five', 2, 2, d_blind_five),
];

/** Group E: timed races (real-time games). */
const GROUP_E = [
  fromModule('number-forge', 2, 6, e_number_forge),
  fromModule('split-decision', 2, 6, e_split_decision),
];

export const ONLINE_GAMES: Record<string, OnlineGame<any>> = {
  [lonelyNumber.id]: lonelyNumber,
  [sandBid.id]: sandBid,
  [diceTower.id]: diceTower,
  [blindBingo.id]: blindBingo,
  [wallsAndWards.id]: wallsAndWards,
  [turfWar.id]: turfWar,
  [triMancala.id]: triMancala,
  [nineMensMorris.id]: nineMensMorris,
  [tigersAndGoats.id]: tigersAndGoats,
  [tippingScales.id]: tippingScales,
  [rumorExchange.id]: rumorExchange,
  [colorDoubt.id]: colorDoubt,
  [deadeyeHoldem.id]: deadeyeHoldem,
  [highLowEquations.id]: highLowEquations,
  ...Object.fromEntries(GROUP_D.map((g) => [g.id, g])),
  ...Object.fromEntries(GROUP_E.map((g) => [g.id, g])),
};
