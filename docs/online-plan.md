# Online plan

How Pieces & Prisons moves from solo play to online tables: what's done, what each game needs, and what's left on the server before we can host it. Tick items off as they land.

**Status (2026-11-23):** 14 of 30 games online · accounts, guests and tables working locally · not hosted yet.

---

## 1. What's already in place

- [x] SQLite database: users, sessions, finished matches (`app/server/db.ts`)
- [x] Accounts (username + password) and guests (name only); a guest can upgrade and keep their history. No email, no recovery.
- [x] Online tables: 4-letter codes, lobby, host controls, bots in empty seats
- [x] The server runs the rules and sends each seat only what it may see
- [x] A time limit per decision (60 s unless the game sets its own with `turnMs`); a bot moves when it runs out. A game can name its decisions (`decisionKey`) so moves within one decision don't restart the clock
- [x] Reconnect keeps your seat; leaving mid-game hands the seat to a bot
- [x] A reload in the lobby keeps your seat (shown as away) for 45 s
- [x] Rejoin prompt on the hub
- [x] Turn-based and real-time games both supported (`realtime` adapter)
- [x] Finished tables saved to `matches` / `match_players`

## 2. Converting a game — the checklist

Every game goes through the same steps. A game counts as **online** only when all are done.

1. **`<game>/online.ts`** — `start`, `act` (validates every move), `waitingOn`, `botAction`, `pause`, `over`, `results`, and `view`.
2. **Hide everything the seat mustn't see** in `view`: rival hands, secret choices, bids, and — for memory games — anything the player is meant to *remember* rather than read (see §4). The viewer is renamed `'you'` so the solo drawing code works unchanged.
3. **Register** it in `app/server/games/index.ts`.
4. **Server tests** (`app/server/<game>.test.ts`): what each seat can and can't see, invalid moves refused, and a whole match played to the end and recorded.
5. **Online view** (`<Game>Online.tsx`) reusing the solo `drawScene` with a small `OnlineHud` (move clock, countdown, *Ready* button), registered in `app/src/ui/Online.tsx`.
6. **Browser check**: one round with a scripted second player, confirming in its network messages that nothing secret leaks.
7. **README**: add it to the list of online games.

## 3. Game-by-game order

Grouped by how much work each needs. Within a group, the order is a suggestion — pick whichever you like next.

### Done
| Game | Kind |
|---|---|
| [x] Lonely Number | simultaneous secret choices |
| [x] Sand Bid | real-time (server-timed holds) |
| [x] Dice Tower | turn-based draft + simultaneous bets |
| [x] Blind Bingo | simultaneous choices and bids |
| [x] Walls & Wards | open board, turn-based, 2–4 players |
| [x] Turf War | open board, 2–4 players; each viewer is player 0 (always blue) |
| [x] Tri-Mancala | open board, 2–4 players; the ring is turned so your pits are at the bottom |
| [x] Nine Men's Morris | duel; the second seat sees the sides swapped (you are always blue) |
| [x] Tigers & Goats | duel of two games with sides swapped, Ready between games |
| [x] Tipping Scales | simultaneous card + chip; rival plays hidden until all are in |
| [x] Rumor Exchange | simultaneous orders; rules, rumors and rival holdings hidden until the end; a rumor doesn't restart the clock (`decisionKey`) |
| [x] Color Doubt | bids in turn, backing at once; rival hands face down until the reveal |
| [x] Deadeye Hold'em | the deck and rival hole cards are never sent before a showdown; snipes hidden until all are in |
| [x] High-Low Equations | the deck and rival hidden cards stay hidden; declaring gets 90 s (`turnMs`) |

### A. Simultaneous secret choices — done
Both are online (see *Done*).

### B. Turn-based with hidden hands — done
All three are online (see *Done*).

### C. Open-information boards — done
All five are online (see *Done*).

### D. Memory and private-information games — need the most care (see §4)
| Game | Notes |
|---|---|
| [ ] Smuggler's Gems | blind swaps; only your own card, once, as solo shows it |
| [ ] Piggy Bluff | only the adder knows the colours they added |
| [ ] Six Chambers | private peeks must reach only the peeker |
| [ ] High or Low | duel; one card shown, one hidden |
| [ ] Ask & Arrange | duel; answers go only to the asker |
| [ ] Hex Sum | duel; numbers shown only during the memorise phase |
| [ ] Blind Five | duel; the client must **not** be told which face-down stones are yours |

### E. Timed races — need per-game clocks on the server (see §5)
| Game | Notes |
|---|---|
| [ ] Number Forge | everyone forges at once; first valid claim wins, decided by server time |
| [ ] Split Decision | 30-second answer clock; ties broken by answer time |

### F. Solo puzzles — format to decide first
Second Glance, Piece Together, Mirror Pieces, Fence Loop, Cipher Lock, Knight's Tour, Magic Squares.

These have no opponents. Online they'd be a **puzzle race**: everyone gets the same puzzle, fastest correct solve ranks first. One generic "race" adapter could serve all seven. **Decision needed** before starting: race, or leave them solo-only.

## 4. Rules for memory games

Solo memory games already hide the log and deduction aids. Online adds a new risk: anything the server sends can be read in the browser's network tab. So for games marked `memory`:

- The view sends only what the solo screen shows **at that moment**. Once something is meant to be forgotten (a peeked card, the memorise-phase numbers, your own face-down stones), it is no longer in the view.
- Tests must check that past secrets are absent from later views, not just hidden on screen.

## 5. Server work still to do

Not tied to one game. Ordered by when they're needed.

**Before more games**
- [x] **Per-game clocks**: a game may set `turnMs(state)` for the current decision (Split Decision needs 30 s; duels may want longer). Otherwise 60 s.
- [x] **Reload in the lobby**: the seat is kept, marked away, for 45 s (`LOBBY_GRACE_MS`); the hub offers *Rejoin table*. If the game starts meanwhile, you keep the seat in the game.
- [ ] **README**: keep the list of online games current (ongoing).

**Before hosting**
- [ ] **Upgrade development tools** flagged by `npm audit` (Vite, Vitest, esbuild, tsx). Only dev tools are affected, but clear it before going public.
- [ ] **Choose hosting** (deferred so far). Needs: one Node 24 process serving the built app, `/api` and `/ws`; HTTPS; a persistent disk for the SQLite file; a daily backup of it.
- [ ] **Production server mode**: serve `dist/` from the game server, secure cookies over HTTPS, set `DB_PATH`.
- [ ] **Tables survive a restart** — today they live in memory and are lost on deploy. At minimum, warn players and finish/record what we can; later, save running tables.
- [ ] **Load check**: a scripted run with many tables and bots at once.

**After hosting**
- [ ] **My matches** screen: matches are recorded but not shown anywhere yet.
- [ ] **Leaderboards** per game (from `match_players`).
- [ ] Guest name filter / reporting, if the site becomes public.

## 6. Suggested next steps

1. ~~Per-game clocks and the lobby-reload fix~~ — done.
2. ~~Group C boards~~ — done.
3. ~~Groups A and B~~ — done.
4. Development tool upgrades + hosting decision → first public deploy.
5. Group D, then E.
6. Decide on group F.
