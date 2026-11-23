/** Games that can be played at an online table. */
import type { OnlineGame } from './types';
import * as lonely from '../../src/games/lonely-number/online';
import type { GameState as LonelyState } from '../../src/games/lonely-number/logic';
import * as sand from '../../src/games/sand-bid/online';

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

export const ONLINE_GAMES: Record<string, OnlineGame<any>> = {
  [lonelyNumber.id]: lonelyNumber,
  [sandBid.id]: sandBid,
};
