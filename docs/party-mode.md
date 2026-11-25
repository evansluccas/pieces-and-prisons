# Party mode

A board game for **2, 4, 6 or 8 players** that strings the collection's games together as mini-games. Online only; bots fill empty seats.

## How a party plays

- **Practice round** (a lobby choice for the host, on at first): before round 1 everyone plays one mini-game together, just to learn it. Nothing is won or lost, and it doesn't count as a mini-game win.
- **8 rounds.** Everyone starts with **10 Pieces**. Each round, every player rolls one die (1–6) in turn and moves around a loop of 28 spaces.
- **Spaces**
  | Space | Effect |
  |---|---|
  | GO | passing or landing on it pays 5 |
  | Blue `+3` | gain 3 |
  | Red `−3` | lose 3 (into the vault) |
  | `?` event | one of: find Pieces, pickpocket a rival, tax day (everyone pays 1 into the vault), swap places with a rival, a tailwind (3 more spaces), a fine |
  | `VS` duel | pick a rival for a 1-on-1 mini-game; the winner takes 5 Pieces from the loser |
  | JAIL | pay 5 into the vault; if you can't, you miss your next roll |
  | `$` vault | take everything in the vault (it starts with 5) |
- **After each round, a mini-game** for the whole table: everyone for themselves (prizes 8 / 5 / 3 / 1) or, with 4+ players, about a third of the time **team blue vs team red** (each member of the winning team +5; a draw +2 each).
- **End:** the player with the most mini-game wins gets **+10**. Most Pieces wins; **the last player goes to prison**.

## Mini-games

Every mini-game is a real game from the collection, run by its own online rules inside the party and cut short so it takes a minute or two:

| Mini-game | Used for | Shortened to |
|---|---|---|
| Cipher Lock, Magic Squares, Knight's Tour, Second Glance, Fence Loop, Mirror Pieces, Piece Together | rounds and duels | one puzzle, 60–150 s limit |
| Split Decision | rounds and duels | 3 questions |
| Number Forge | rounds (2–6 players) and duels | 1 round |
| Dice Tower | rounds (3–6 players) | 1 round |
| Lonely Number | rounds (3–6 players) | 2 rounds |
| Tipping Scales | rounds | 3 rounds |
| High or Low | duels | 4 rounds |

The last three mini-games played aren't picked again. A duel between two bots is played out at once on the server, so nobody waits on it.

## Learning the mini-games

- **On the home screen**, the Party panel lists every mini-game with its short version, when it's used and for how many players. *Rules · practice* opens its full rules, with a **Practice against bots** button that starts the game solo.
- **At the table**, the card announcing each mini-game has a **Rules** button, and so does the bar above a mini-game while you play it. The rules open over the game, with a note on how the Party shortens it.
- The announcement card stays up for 15 s so there's time to read; it starts as soon as every player has pressed **Ready**.

## Clocks

- Board decisions (roll, pick a rival): 30 s, then the server does it for you.
- Before each mini-game a 15 s card says which one and who's playing, with its rules a click away (when every player presses Ready it starts at once); after it, a 7 s card shows the payout.
- Inside a mini-game its own clocks apply (45 s per move for turn-based ones unless the game sets its own).
- Worst case, a party takes about 20–25 minutes.

## On screen

- The board is a running track in the prison yard, filling the whole game screen: GO at the top, play clockwise, jails and watchtowers in the corners.
- Each seat has its own **pawn** — a colour and a hat (cap, beanie, bandana, crown, wizard hat, horned helmet, cat ears, top hat) — drawn in `tools/build_assets.py` (category `party`, with a head-only version for the score cards).
- Score cards sit along the top and bottom: place, Pieces, mini-game wins, and JAIL when a player will miss a roll. The player whose turn it is has a gold frame and a bobbing arrow over their pawn.
- A roll shows the die tumbling, then the pawn hops space by space along its path. The middle of the yard shows the round, the vault, whose turn it is and the latest event.

## Code

| Path | What |
|---|---|
| `app/src/games/party/logic.ts` | Board rules as pure functions (tested in `logic.test.ts`) |
| `app/src/games/party/minis.ts` | The mini-game list (names, blurbs, who they fit), shared by the server and the page |
| `app/server/games/party.ts` | The party at a table: board, practice round, mini-games run inside it (and how each is shortened), bots, clocks |
| `app/server/games/catalog.ts` | The online games; `index.ts` adds the party on top of them |
| `app/src/games/party/PartyOnline.tsx` | The board screen; a mini-game you play shows its own online screen, with your moves sent through the party |
| `app/src/ui/RulesDialog.tsx` | The rules over the page, for the hub and the table |
| `app/server/party.test.ts` | Table sizes, turns and time-outs, intro → mini-game, bot duels, the practice round and its lobby choice, a whole 8-player party recorded |

The hub's **Mini-games / Party** switch (remembered in the browser) picks which mode the home screen shows.
