# Online plan

How Pieces & Prisons moves from solo play to online tables: what's done, what each game needs, and what's left on the server before we can host it. Tick items off as they land.

**Status (2026-11-25):** all 30 games online, plus **Party mode** (a board game that runs them as mini-games — see [party-mode.md](party-mode.md)) · live at https://pieces-and-prisons.fly.dev (Fly.io, Amsterdam). How the platform fits together: [architecture.md](architecture.md).

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
3. **Register** it in `app/server/games/catalog.ts`. To use it in Party mode too, add it to `MINIS` in `app/server/games/party.ts` with a short version.
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
| [x] Smuggler's Gems | only your own card; a swap shows its cards to the two sides only, once; peeks reach only the peeker |
| [x] Piggy Bluff | coin colours and bank contents never sent (not even to the adder); rival choices show only as "decided" |
| [x] Six Chambers | chamber layout sent only when the cylinder fires; private peeks and secret swaps reach only the mover; 40 s turns |
| [x] High or Low | duel; the face-down card goes only to the dealer; 8 s reveal pause; first dealer drawn at random |
| [x] Ask & Arrange | duel; both arrange at once; the rival row and guess stay hidden until the end; 90 s decisions |
| [x] Hex Sum | duel; the server times the 30 s study phase, then sends only flipped numbers |
| [x] Blind Five | duel; no message names the owner of a face-down stone (not even your own); per-seat bot memory |
| [x] Number Forge | real-time race; the server's arrival order decides who claims a forge; 60 s rounds; remaining answers hidden until a round ends |
| [x] Split Decision | real-time; 30 s server clock per question, answer times measured by the server (1.5 s lag allowance); the right answer and others' picks hidden until it closes; the card grid sent only during the 8 s study |
| [x] Second Glance | race; the server times the 10 s study; the original scene and the changes are never sent while spotting; marks count at time-out |
| [x] Piece Together | race; any complete legal fill is accepted (checked on the server); the original cut stays hidden; 4 min |
| [x] Mirror Pieces | race; the server checks the exact mirror image and that every piece is turned, never flipped; 3 min |
| [x] Fence Loop | race; the answer loop is never sent; the server checks the submitted loop; 6 min |
| [x] Cipher Lock | race; the code is never sent before the round ends; wrong tries +30 s and private; 2–6 min per lock |
| [x] Knight's Tour | race; the server checks the tour; hints go through the server (+30 s, only to the asker); 4/6/8 min |
| [x] Magic Squares | race; the solution is never sent; the server checks the square; hints +30 s, only to the asker; 3/7/12 min |

### A. Simultaneous secret choices — done
Both are online (see *Done*).

### B. Turn-based with hidden hands — done
All three are online (see *Done*).

### C. Open-information boards — done
All five are online (see *Done*).

### D. Memory and private-information games — done
All seven are online (see *Done*). Each view sends only what the solo screen shows at that moment, and each game's tests check that the secrets appear nowhere in what a player receives.

### E. Timed races — done
Both are online (see *Done*). They run on the real-time engine: the server owns every clock and decides arrival order and answer times.

### F. Solo puzzles — done, as puzzle races
All seven are online as **puzzle races** (`app/src/games/shared/race.ts`, scoreboard `app/src/ui/RaceBoard.tsx`): everyone gets the same puzzle each round (3 rounds, normal difficulty, as in solo); the server makes the puzzles, keeps the answers, checks every submission and times everyone from when the round opens, adding solo's 30 s penalties for wrong tries and hints. Each round has a time limit; whoever is still working scores "not finished". Ranking: most solved (Second Glance: most changes found), then lowest total time. Bots finish when the solo ghost rivals would. A race works alone too (1–6 players).

Note: hiding the answer stops anyone reading it from the network, but a puzzle whose clues are public (Cipher Lock, Fence Loop, Magic Squares, Knight's Tour) can still be solved by a program — the same as in any online puzzle race.

## 4. Rules for memory games

Solo memory games already hide the log and deduction aids. Online adds a new risk: anything the server sends can be read in the browser's network tab. So for games marked `memory`:

- The view sends only what the solo screen shows **at that moment**. Once something is meant to be forgotten (a peeked card, the memorise-phase numbers, your own face-down stones), it is no longer in the view.
- Tests must check that past secrets are absent from later views, not just hidden on screen.

## 5. Server work still to do

Not tied to one game. Ordered by when they're needed.

**Also done along the way**
- [x] Countdowns use the server's clock (a wrong computer clock no longer skews them).
- [x] Game screens get the server's refusal reason, and the puzzle races show it ("That loop doesn't fit every number…").
- [x] The app loads each game only when it's opened: the first download fell from 558 kB to 179 kB.
- [x] Online pages are up to 1500 px wide, so game screens scale to 2x on laptops and 3x on 1920-wide screens.

**Before more games**
- [x] **Per-game clocks**: a game may set `turnMs(state)` for the current decision (Split Decision needs 30 s; duels may want longer). Otherwise 60 s.
- [x] **Reload in the lobby**: the seat is kept, marked away, for 45 s (`LOBBY_GRACE_MS`); the hub offers *Rejoin table*. If the game starts meanwhile, you keep the seat in the game.
- [x] **README**: the list of online games is current (keep it so).

**Before hosting**
- [x] **Upgrade development tools**: Vite 8, Vitest 5, tsx 4.23 — `npm audit` finds 0 vulnerabilities.
- [x] **Choose hosting**: Fly.io — one always-on machine, a 1 GB volume for SQLite (daily snapshots), HTTPS. See README → *Hosting on Fly.io*.
- [x] **Production server mode**: `npm start` serves `dist/` from the game server, Secure cookies, `DB_PATH`, the real client address behind the proxy (`CLIENT_IP_HEADER`), `/api/health`, clean shutdown. `Dockerfile` + `fly.toml` added.
- [x] **First deploy**: live at https://pieces-and-prisons.fly.dev — one machine in Amsterdam, health check passing, database on an encrypted 1 GB volume, server running as an unprivileged user.
- [x] **Tables survive a restart**: every table is saved when the server stops (and every 30 s), and picked up again when it starts; players are warned, their pages reconnect on their own and they're back in their seats. Move clocks and pauses start afresh; real-time games carry on from their own times. (`server/persist.ts`, `Rooms.snapshot/restore`)
- [x] **Load check** (`npx tsx server/loadcheck.ts [tables] [seconds]`): 150 tables over all 30 games, everyone answering instantly — about 260 MB of memory and 37% of one Mac core; 50 tables about 22%. Fly's shared core is perhaps 2–4× slower, so the 512 MB machine handles roughly 50 very busy tables (more with real players, who take seconds per move). The Ask & Arrange bot was the one hot spot (up to 222 ms per move) and now judges questions on a sample: same strength, ~6× faster. If the site grows, move to a `performance-1x` machine.

**After hosting**
- [x] **My matches** screen (from the account panel): your finished online matches, newest first, with everyone's place.
- [x] **Leaderboards** (link on the main page): per game or all games together; most wins, then win rate, then games played. Only real players count.
- [x] **Name filter and reporting**: slurs, abuse and staff-like names are refused for guests and accounts (`server/names.ts`); players can report a name from a table's seat list, and `server/admin.ts` lists reports, resolves them and renames players.

## 6. Suggested next steps

1. ~~Per-game clocks and the lobby-reload fix~~ — done.
2. ~~Group C boards~~ — done.
3. ~~Groups A and B~~ — done.
4. ~~Development tool upgrades, hosting, first deploy~~ — done: https://pieces-and-prisons.fly.dev
5. ~~Groups D and E~~ — done.
6. ~~Group F~~ — done as puzzle races. Every game is online.
7. ~~Party mode~~ — done: a board for 2/4/6/8 players with the games as mini-games ([party-mode.md](party-mode.md)).
