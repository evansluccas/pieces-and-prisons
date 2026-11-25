# Art style guide

## Direction

These are warm, readable pixel-art sprites in the spirit of two kinds of games:

- **Classic Korean fantasy MMOs** like *Ragnarok Online*: soft, cozy colour ramps, chibi proportions, friendly item icons.
- **Modern HD pixel tactics games** like *Sword of Convallaria*: jewel tones, gold trims, crisp silhouettes, a darker "night" UI.

We take only the **general look** from these games. Every sprite here is an original design, and none is copied or traced from either game.

## Rules

1. **Authored at 1x, scaled by whole numbers only.** Always render with nearest-neighbour scaling (`image-rendering: pixelated`). Never use a fractional scale.
2. **Grid sizes**
   - Icons, items, coins, dice and tiles: 16x16
   - Big items and tokens: 24x24
   - Cards: 32x44
   - Buttons: 32x14
   - Party pawns: 16x24 (head-only versions 16x17); board spaces: 24x22 (a coloured top on a darker rim); buildings: 30x28 and 22x40
3. **Material ramps.** Every colour comes from a five-tone material ramp in `assets/palette.json`:
   - `0` is the outline
   - `1` is the shadow
   - `2` is the base
   - `3` is the light
   - `4` is the highlight

   Never add a colour that isn't in a ramp. If you need a new one, add a new ramp.
4. **Sel-out outlines.** A sprite's outline uses the darkest tone of its own material, never pure black. This keeps sprites soft on both light and dark backgrounds.
5. **Light comes from the top-left.** Pick a shading mode to match the shape:
   - `bevel` for raised shapes
   - `inset` for slots and panels
   - `sphere` for coins, gems and domes
   - `flat` for engravings and text
6. **Readability first.** Every game piece must be identifiable at 1x. Colour carries meaning too:
   - ruby = danger or red team
   - sapphire = safe or blue team
   - emerald = success
   - gold = currency
   - amethyst = the Piece and anything rare
7. **Signature object.** The **Piece** is the core currency: an amethyst hex crystal set in gold. It appears on card backs and in the UI.

## Fonts

Two pixel fonts live in `tools/build_assets.py`:
- `FONT3` is 3x5, used for card corners and coins.
- `FONT5` is 5x7, used bold for card centres.

Both cover digits, A/J/Q/K, the operators `+ - x / =`, and `?`.

## Pipeline

```bash
python3 tools/build_assets.py
```

This regenerates everything under `assets/`, plus [asset-inventory.md](asset-inventory.md) and [contact-sheet.png](contact-sheet.png).

To add a sprite:
1. Draw it in `build_assets.py`, as an ASCII map with a legend or with shape helpers.
2. Call `register(category, name, sprite, description)`.
3. Rebuild.

The game client should load `assets/sheets/<category>.png` together with its JSON atlas.
