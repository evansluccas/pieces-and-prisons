/** Games that can be played at an online table. */
import type { OnlineGame } from './types';
import * as lonely from '../../src/games/lonely-number/online';
import type { GameState as LonelyState } from '../../src/games/lonely-number/logic';
import * as sand from '../../src/games/sand-bid/online';
import * as dice from '../../src/games/dice-tower/online';
import * as bingo from '../../src/games/blind-bingo/online';
import type { GameState as BingoState } from '../../src/games/blind-bingo/logic';

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

export const ONLINE_GAMES: Record<string, OnlineGame<any>> = {
  [lonelyNumber.id]: lonelyNumber,
  [sandBid.id]: sandBid,
  [diceTower.id]: diceTower,
  [blindBingo.id]: blindBingo,
};
