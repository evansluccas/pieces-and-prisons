/** Games that can be played at an online table. */
import type { OnlineGame } from './types';
import * as lonely from '../../src/games/lonely-number/online';
import type { GameState as LonelyState } from '../../src/games/lonely-number/logic';

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

export const ONLINE_GAMES: Record<string, OnlineGame<any>> = {
  [lonelyNumber.id]: lonelyNumber,
};
