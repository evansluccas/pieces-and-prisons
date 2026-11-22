# Pieces & Prisons

A collection of strategy, deduction and bluffing party games inspired by Korean "brain survival" game shows. Players earn **Pieces**, avoid **prison**, and outplay each other one match at a time.

> **Status:** 17 games are playable against bots (or, for the exile puzzles, against ghost times). More are being added before online multiplayer.
>
> - **Prison matches:** Lonely Number, Sand Bid, Dice Tower, Tipping Scales, Six Chambers, Walls & Wards (with the wall breaker), Piggy Bluff, Deadeye Hold'em
> - **Main matches:** Blind Bingo, Smuggler's Gems, Split Decision, Color Doubt, Number Forge, Rumor Exchange
> - **Exile puzzles:** Cipher Lock, Fence Loop, Second Glance

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
npm test         # game-logic unit tests
```

| Path | What |
|---|---|
| `app/src/engine/` | Sprite-sheet loader, the `PixelStage` canvas (integer scaling and click areas), and `Gfx` drawing helpers |
| `app/src/games/registry.ts` | Every game in the hub, and which ones are playable |
| `app/src/games/<game>/logic.ts` | Rules as pure, unit-tested functions |
| `app/src/games/<game>/bots.ts` | Computer opponents |
| `app/src/ui/` | Hub and DOM panels drawn with the UI sprites |

Each game keeps its rules in pure TypeScript, separate from rendering. That way the bots, the tests and a future online mode can all share the same rules.

## Rebuild the assets

```bash
pip install pillow
python3 tools/build_assets.py
```

## Note on originality

Every game here is an original implementation of a general mechanic: auctions, bluffing, deduction, area control, and so on. All art is original.

This project is not affiliated with, endorsed by, or using material from any TV show, streaming service or game studio. The research notes in `docs/` describe mechanics in our own words for design reference only.
