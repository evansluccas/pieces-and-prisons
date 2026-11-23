/** Every game that can be played at an online table: the catalog, plus the Party board that plays them. */
import type { OnlineGame } from './types';
import { CATALOG } from './catalog';
import { partyGame } from './party';

export const ONLINE_GAMES: Record<string, OnlineGame<any>> = {
  ...CATALOG,
  party: partyGame(CATALOG),
};
