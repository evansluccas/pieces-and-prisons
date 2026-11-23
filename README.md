# Pieces & Prisons

A collection of strategy, deduction and bluffing party games inspired by Korean "brain survival" game shows. Players earn **Pieces**, avoid **prison**, and outplay each other one match at a time.

> **Status:** all 30 games are playable against bots (or, for the solo puzzles, against ghost times). Online multiplayer comes next.
>
> - **Prison matches:** Lonely Number, Sand Bid, Dice Tower, Tipping Scales, Six Chambers, Walls & Wards, Piggy Bluff, Deadeye Hold'em
> - **Main matches:** Blind Bingo, Smuggler's Gems, Split Decision, Rumor Exchange, High-Low Equations, Turf War, Tri-Mancala, Color Doubt, Number Forge
> - **Exile puzzles:** Second Glance, Piece Together, Mirror Pieces, Fence Loop, Cipher Lock
> - **Final duels:** Nine Men's Morris, Hex Sum, High or Low, Tigers & Goats, Ask & Arrange
> - **Hidden stages:** Knight's Tour, Blind Five, Magic Squares

![Contact sheet of all sprites](docs/contact-sheet.png)

## What's here

| Path | What |
|---|---|
| `assets/sprites/` | 231 pixel-art sprites at 1x, one PNG each, grouped by category |
| `assets/sprites@4x/` | The same sprites upscaled 4x for docs and previews |
| `assets/sheets/` | Packed sprite sheet plus JSON atlas for each category (for the game client) |
| `assets/manifest.json` | Every sprite with its size and description |
| `assets/palette.json` | The material colour ramps |
| `assets/preview.html` | Visual gallery (open it locally) |
| `tools/pixelkit.py` | A small pixel-art engine: parts, auto-shading, sel-out outlines |
| `tools/build_assets.py` | Every sprite definition; rebuilds all of the above |
| `docs/game-catalog.md` | Research notes: game mechanics and rules to adapt |
| `docs/art-style-guide.md` | Art direction and rules |
| `docs/asset-inventory.md` | Auto-generated list of every sprite |

## Asset categories

- **Cards** (95): a full 52-card deck, number cards 0–10, operator cards, gem and bomb cards, colour cards, hidden-role cards, shape cards, and a card back.
- **Coins and chips** (16): gold coins worth 1/2/3/5/10, black, white and silver coins, and betting chips in 6 colours plus a rainbow chip.
- **Dice** (19): white, red and blue dice with faces 1–6, plus a hidden die.
- **Items** (18): the Piece, a revolver cylinder, a bullet, a balance scale and scale pans, rocks, a piggy bank, a wall breaker, a push button, a key, a safe and a treasure chest.
- **Board** (26): wall segments, square and round counters, bingo shapes, terrain tiles, a tree and a manhole.
- **Gems** (10): a diamond, gold, silver and copper ingots, 5 cut gems, and a bomb.
- **Tokens** (5): Alliance, Salvation, Prize, Victory and Curse medallions.
- **Portraits** (6): chibi role portraits.
- **Icons** (23): UI icons such as crown, skull, prison, house, exile, eye, swap, timer, lock and more.
- **Monsters** (4) and **UI** (9): panels, buttons, a ribbon and an item slot.

## Run the app

The app is React + TypeScript + Canvas, built with Vite. The game board draws onto a low-resolution canvas that is scaled up by whole numbers, so the pixels stay crisp.

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run server   # game server for online play, http://localhost:8787 (needs Node 24+)
npm test         # game-logic and server tests
```

Solo play needs only `npm run dev`. For accounts and online tables, run `npm run server` as well; Vite forwards `/api` to it.

| Path | What |
|---|---|
| `app/src/engine/` | Sprite-sheet loader, the `PixelStage` canvas (integer scaling and click areas), and `Gfx` drawing helpers |
| `app/src/games/registry.ts` | Every game in the hub, and which ones are playable |
| `app/src/games/<game>/logic.ts` | Rules as pure, unit-tested functions |
| `app/src/games/<game>/bots.ts` | Computer opponents |
| `app/src/ui/` | Hub and DOM panels drawn with the UI sprites |
| `app/server/` | Game server: SQLite database (`db.ts`), accounts and guests (`auth.ts`), HTTP API (`app.ts`), online tables (`rooms.ts`, `ws.ts`) |
| `app/server/games/` | Which games can be played online, and how each plugs into a table |

Each game keeps its rules in pure TypeScript, separate from rendering. That way the bots, the tests and a future online mode can all share the same rules.

### Online tables

Signed-in players (accounts or guests) choose **Play online**, start a table and share its four-letter code. The host fills empty seats with bots and starts the game. The server runs the real rules and sends each player only what they may see, so nobody can peek at hidden cards from their browser.

- Each decision has a time limit (60 seconds unless a game sets its own); if it runs out, a bot makes that move.
- Losing connection keeps your seat; opening Play online again puts you back. In the lobby the seat waits 45 seconds for you. Leaving mid-game hands your seat to a bot.
- Finished tables are saved to the database (`matches`, `match_players`).

Games go online one at a time: so far **Lonely Number**, **Dice Tower**, **Blind Bingo**, **Walls & Wards**, **Turf War**, **Tri-Mancala**, **Nine Men's Morris** and **Tigers & Goats** (turn-based) and **Sand Bid** (real-time: the server times every hold, forgiving up to 1.5 s of connection lag but never crediting a hold longer than it saw). Each game adds an `online.ts` (its actions and per-player view) and an online view. What's next is in [docs/online-plan.md](docs/online-plan.md).

### Accounts

Players never give personal details. An **account** is a username and a password; a **guest** is just a name, and can later add a username and password to keep their history. Because no email is stored, a forgotten password can't be recovered.

Passwords are stored as salted scrypt hashes, and sessions use a random token in an HttpOnly cookie (only its hash is kept in the database). The database is one SQLite file at `app/data/pieces.db` (set `DB_PATH` to move it); it isn't committed.

## Rebuild the assets

```bash
pip install pillow
python3 tools/build_assets.py
```

## Note on originality

Every game here is an original implementation of a general mechanic: auctions, bluffing, deduction, area control, and so on. All art is original.

This project is not affiliated with, endorsed by, or using material from any TV show, streaming service or game studio. The research notes in `docs/` describe mechanics in our own words for design reference only.
