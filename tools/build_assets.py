#!/usr/bin/env python3
"""Builds every pixel-art asset for the game collection.

    python3 tools/build_assets.py

Outputs (all regenerated from scratch each run):
  assets/sprites/<category>/<name>.png     1x, the source of truth for the game
  assets/sprites@4x/<category>/<name>.png  4x nearest-neighbour, for docs/previews
  assets/sheets/<category>.png + .json     packed atlas per category (1x)
  assets/palette.json, assets/palette.png  material ramps
  assets/manifest.json                     every sprite, size, category, tags
  assets/preview.html                      visual gallery
"""
from __future__ import annotations

import json
import math
import random
import shutil
from pathlib import Path

from PIL import Image

from pixelkit import RAMPS, Sprite, rgba

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"

REGISTRY: dict[str, dict[str, tuple[Sprite, str]]] = {}


def register(category: str, name: str, sprite: Sprite, desc: str = "") -> Sprite:
    REGISTRY.setdefault(category, {})[name] = (sprite, desc)
    return sprite


# =============================================================== fonts ====
FONT3 = {  # 3x5, card corners & coins
    "0": [".#.", "#.#", "#.#", "#.#", ".#."], "1": [".#.", "##.", ".#.", ".#.", "###"],
    "2": ["##.", "..#", ".#.", "#..", "###"], "3": ["##.", "..#", ".#.", "..#", "##."],
    "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "##.", "..#", "##."],
    "6": [".##", "#..", "##.", "#.#", ".#."], "7": ["###", "..#", ".#.", ".#.", ".#."],
    "8": [".#.", "#.#", ".#.", "#.#", ".#."], "9": [".#.", "#.#", ".##", "..#", "##."],
    "A": [".#.", "#.#", "###", "#.#", "#.#"], "J": ["..#", "..#", "..#", "#.#", ".#."],
    "Q": [".#.", "#.#", "#.#", "##.", ".##"], "K": ["#.#", "##.", "#..", "##.", "#.#"],
    "+": ["...", ".#.", "###", ".#.", "..."], "-": ["...", "...", "###", "...", "..."],
    "x": ["...", "#.#", ".#.", "#.#", "..."], "/": [".#.", "...", "###", "...", ".#."],
    "=": ["...", "###", "...", "###", "..."], "?": ["##.", "..#", ".#.", "...", ".#."],
}
FONT5 = {  # 5x7, card centres
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    "x": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
    "/": [".....", "..#..", ".....", "#####", ".....", "..#..", "....."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
}


def text_width(s: str, font, bold=False) -> int:
    w = len(next(iter(font.values()))[0]) + (1 if bold else 0)
    return len(s) * (w + 1) - 1


def draw_text(sp: Sprite, s: str, x: int, y: int, font, mat: str, tone: int = 0,
              bold=False, flip=False, outline=False):
    cw = len(next(iter(font.values()))[0]) + (1 if bold else 0)
    chars = list(s)
    if flip:
        chars = chars[::-1]
    for i, ch in enumerate(chars):
        sp.glyph(font[ch], x + i * (cw + 1), y, mat, tone=tone, bold=bold, flip=flip, outline=outline)


# ============================================================ UI icons ====
def icon(rows, legend, w=16, h=16) -> Sprite:
    sp = Sprite(w, h)
    sp.ascii(rows, legend)
    return sp


DARK = ("iron", {"tone": 0, "outline": False})

ICONS = {}

ICONS["crown"] = icon([
    "................",
    "................",
    "................",
    "..r....r....r...",
    "..g...ggg...g...",
    "..gg..ggg..gg...",
    "..ggg.ggg.ggg...",
    "..ggggggggggg...",
    "..ggggggggggg...",
    "..ggrgggsggrg...",
    "..ggggggggggg...",
    "..ggggggggggg...",
    "................",
], {"g": "gold", "r": ("ruby", {"mode": "sphere"}), "s": ("sapphire", {"tone": 3})})

ICONS["skull"] = icon([
    "................",
    "................",
    ".....bbbbbb.....",
    "....bbbbbbbb....",
    "...bbbbbbbbbb...",
    "...bbbbbbbbbb...",
    "...bbkkbbkkbb...",
    "...bbkkbbkkbb...",
    "...bbbbkkbbbb...",
    "....bbbbbbbb....",
    ".....bkbbkb.....",
    ".....bbbbbb.....",
], {"b": "ivory", "k": DARK})

ICONS["house"] = icon([
    "................",
    "................",
    ".......rr.......",
    "......rrrr......",
    ".....rrrrrr.....",
    "....rrrrrrrr....",
    "...rrrrrrrrrr...",
    "..rrrrrrrrrrrr..",
    "....pppppppp....",
    "....pyyppddp....",
    "....pyyppddp....",
    "....pppppddp....",
    "....pppppddp....",
], {"p": "parchment", "r": "ruby", "y": ("topaz", {"tone": 3, "outline": False}),
    "d": ("wood", {"outline": False})})

ICONS["exile"] = icon([
    "................",
    "................",
    "............yy..",
    "...........yyyy.",
    "...........yyyy.",
    "............yy..",
    ".......p........",
    "......ppp.......",
    ".....ppppp......",
    "....ppppppp.....",
    "...ppppppppp....",
    "..ppppppppppp...",
    ".ccccccccccccc..",
], {"y": ("gold", {"mode": "sphere"}), "p": "sand", "c": "copper"})

ICONS["eye"] = icon([
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....iiiiii.....",
    "...iiissssiii...",
    "..iiisskkssiii..",
    "..iiisskkssiii..",
    "...iiissssiii...",
    ".....iiiiii.....",
], {"i": "ivory", "s": ("sapphire", {"mode": "sphere", "outline": False}), "k": DARK})

ICONS["swap"] = icon([
    "................",
    "................",
    "................",
    ".........e......",
    ".........ee.....",
    "..eeeeeeeeee....",
    ".........ee.....",
    ".........e......",
    "................",
    "......s.........",
    ".....ss.........",
    "....ssssssssss..",
    ".....ss.........",
    "......s.........",
], {"e": "emerald", "s": "sapphire"})

ICONS["rotate"] = icon([
    "................",
    "................",
    ".....gggggg.....",
    "....gggggggg.g..",
    "...ggg....gggg..",
    "..ggg......ggg..",
    "..gg......gggg..",
    "..gg............",
    "..gg........gg..",
    "..gg........gg..",
    "..ggg......ggg..",
    "...ggg....ggg...",
    "....gggggggg....",
    ".....gggggg.....",
], {"g": "gold"})

ICONS["lock"] = icon([
    "................",
    "................",
    "......aaaa......",
    ".....aaaaaa.....",
    "....aa....aa....",
    "....aa....aa....",
    "....aa....aa....",
    "...gggggggggg...",
    "...gggggggggg...",
    "...ggggkkgggg...",
    "...ggggkkgggg...",
    "...gggggkgggg...",
    "...gggggggggg...",
], {"a": "silver", "g": "gold", "k": DARK})

ICONS["check"] = icon([
    "................",
    "................",
    "................",
    "................",
    "............ee..",
    "...........eee..",
    "..........eee...",
    ".........eee....",
    "..ee....eee.....",
    "..eee..eee......",
    "...eeeeee.......",
    "....eeee........",
    ".....ee.........",
], {"e": "emerald"})

ICONS["cross"] = icon([
    "................",
    "................",
    "................",
    "..rr........rr..",
    "..rrr......rrr..",
    "...rrr....rrr...",
    "....rrr..rrr....",
    ".....rrrrrr.....",
    "......rrrr......",
    ".....rrrrrr.....",
    "....rrr..rrr....",
    "...rrr....rrr...",
    "..rrr......rrr..",
    "..rr........rr..",
], {"r": "ruby"})

ICONS["hourglass"] = icon([
    "................",
    "................",
    "...wwwwwwwwww...",
    "....iiiiiiii....",
    "....iyyyyyyi....",
    ".....iyyyyi.....",
    "......iyyi......",
    ".......yy.......",
    "......iyyi......",
    ".....iiyyii.....",
    "....iiyyyyii....",
    "....iyyyyyyi....",
    "...wwwwwwwwww...",
], {"i": "glass", "y": ("sand", {"outline": False}), "w": "wood"})

ICONS["heart"] = icon([
    "................",
    "................",
    "................",
    "...rrr....rrr...",
    "..rrrrr..rrrrr..",
    "..rrrrrrrrrrrr..",
    "..rrrrrrrrrrrr..",
    "...rrrrrrrrrr...",
    "....rrrrrrrr....",
    ".....rrrrrr.....",
    "......rrrr......",
    ".......rr.......",
], {"r": ("ruby", {"mode": "sphere"})})


def make_star_icon(mat="gold") -> Sprite:
    sp = Sprite(16, 16)
    sp.star(8, 8.6, 6.8, 2.9, mat, mode="sphere")
    return sp


ICONS["star"] = make_star_icon()

ICONS["scroll"] = icon([
    "................",
    "................",
    "..wwwwwwwwwwww..",
    "...pppppppppp...",
    "...pkkkkkkkpp...",
    "...pppppppppp...",
    "...pkkkkkkppp...",
    "...pppppppppp...",
    "...pkkkkkkkpp...",
    "...pppppppppp...",
    "...pkkkkkpppp...",
    "...pppppppppp...",
    "..wwwwwwwwwwww..",
], {"p": ("parchment", {"mode": "flat"}), "k": ("parchment", {"tone": 1, "outline": False}),
    "w": "wood"})

ICONS["bell"] = icon([
    "................",
    "................",
    ".......gg.......",
    "......gggg......",
    ".....gggggg.....",
    "....gggggggg....",
    "....gggggggg....",
    "....gggggggg....",
    "...gggggggggg...",
    "..gggggggggggg..",
    "..gggggggggggg..",
    ".......cc.......",
], {"g": ("gold", {"mode": "sphere"}), "c": "copper"})

ICONS["question"] = icon([
    "................",
    "................",
    ".....ssssss.....",
    "....ssssssss....",
    "....sss..sss....",
    ".........sss....",
    "........sss.....",
    ".......sss......",
    ".......ss.......",
    ".......ss.......",
    "................",
    ".......ss.......",
    ".......ss.......",
], {"s": "sapphire"})


def make_gear() -> Sprite:
    sp = Sprite(16, 16)
    cx = cy = 8
    pts = []
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            tooth = math.cos(a * 8) > 0.35
            if 2.2 < d <= (6.6 if tooth else 5.0):
                pts.append((x, y))
    sp.fill(pts, "silver")
    return sp


ICONS["gear"] = make_gear()

ICONS["player"] = icon([
    "................",
    "................",
    ".....hhhhhh.....",
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",
    "...hhffffffhh...",
    "...hfkffffkfh...",
    "...hffffffffh...",
    "....ffffffff....",
    ".....ffffff.....",
    "....cccccccc....",
    "...cccccccccc...",
    "...cccccccccc...",
], {"h": "hair", "f": ("skin", {"mode": "flat"}), "k": DARK, "c": "sapphire"})

ICONS["sword"] = icon([
    "................",
    "............aa..",
    "...........aaa..",
    "..........aaa...",
    ".........aaa....",
    "........aaa.....",
    ".......aaa......",
    "..g...aaa.......",
    "...g.aaa........",
    "....gaa.........",
    "....ggg.........",
    "...wwggg........",
    "..www...g.......",
    ".ww.............",
], {"a": "silver", "g": "gold", "w": "wood"})

ICONS["shield"] = icon([
    "................",
    "................",
    "..gggggggggggg..",
    "..gssssggssssg..",
    "..gssssggssssg..",
    "..gggggggggggg..",
    "..gssssggssssg..",
    "..gssssggssssg..",
    "...gsssggsssg...",
    "...gsssggsssg...",
    "....gssggssg....",
    ".....gsggsg.....",
    "......gggg......",
    ".......gg.......",
], {"s": ("sapphire", {"mode": "flat"}), "g": "gold"})


def make_prison() -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(2, 2, 12, 12, "night", mode="flat", outline=False)
    for x in (4, 7, 10):
        sp.rect(x, 3, 2, 10, "iron", outline="all")
    sp.rect(2, 2, 12, 2, "stone")
    sp.rect(2, 12, 12, 2, "stone")
    return sp


ICONS["prison"] = make_prison()

ICONS["people"] = icon([
    "................",
    "................",
    "................",
    "...hhh....bbb...",
    "..hhhhh..bbbbb..",
    "..hfffh..bfffb..",
    "..fkfkf..fkfkf..",
    "...fff....fff...",
    "..sssss..rrrrr..",
    ".sssssss.rrrrrrr",
    ".sssssss.rrrrrrr",
], {"h": "hair", "b": "blonde", "f": ("skin", {"mode": "flat"}), "k": DARK,
    "s": "sapphire", "r": "ruby"})

ICONS["trophy"] = icon([
    "................",
    "................",
    "...gggggggggg...",
    ".g.gggggggggg.g.",
    ".gggggggggggggg.",
    "..g.gggggggg.g..",
    "....gggggggg....",
    ".....gggggg.....",
    "......gggg......",
    ".......gg.......",
    ".......gg.......",
    ".....wwwwww.....",
    "....wwwwwwww....",
], {"g": ("gold", {"mode": "sphere"}), "w": "wood"})

for n, sp in ICONS.items():
    register("icons", n, sp)


# ============================================================= suits =======
SUIT5 = {
    "spade":   ["..#..", ".###.", "#####", "..#..", ".###."],
    "heart":   [".#.#.", "#####", "#####", ".###.", "..#.."],
    "diamond": ["..#..", ".###.", "#####", ".###.", "..#.."],
    "club":    ["..#..", ".###.", "#.#.#", "..#..", ".###."],
}
SUIT11 = {
    "spade": [
        ".....#.....", "....###....", "...#####...", "..#######..", ".#########.",
        "###########", "###########", ".###.#.###.", ".....#.....", "....###....",
        "..#######..",
    ],
    "heart": [
        ".###...###.", "#####.#####", "###########", "###########", "###########",
        ".#########.", "..#######..", "...#####...", "....###....", ".....#.....",
        "...........",
    ],
    "diamond": [
        ".....#.....", "....###....", "...#####...", "..#######..", ".#########.",
        "###########", ".#########.", "..#######..", "...#####...", "....###....",
        ".....#.....",
    ],
    "club": [
        "....###....", "...#####...", "...#####...", ".###.#.###.", "###########",
        "###########", ".###.#.###.", ".....#.....", "....###....", "..#######..",
        "...........",
    ],
}
SUIT_MAT = {"spade": "iron", "club": "iron", "heart": "ruby", "diamond": "ruby"}


def mask_part(sp: Sprite, rows, x, y, mat, flip=False, **kw):
    if flip:
        rows = [r[::-1] for r in rows[::-1]]
    pts = [(x + i, y + j) for j, r in enumerate(rows) for i, c in enumerate(r) if c == "#"]
    return sp.fill(pts, mat, **kw)


# ============================================================== cards ======
CW, CH = 32, 44


def card_base(inner="parchment", frame="wood") -> Sprite:
    sp = Sprite(CW, CH)
    sp.rect(1, 1, CW - 2, CH - 2, frame, outline="outer")
    sp.rect(3, 3, CW - 6, CH - 6, inner, mode="inset", outline=False)
    for (x, y) in ((2, 2), (CW - 3, 2), (2, CH - 3), (CW - 3, CH - 3)):
        sp.rect(x, y, 1, 1, "gold", tone=4, outline=False)
    return sp


def card_corners(sp: Sprite, label: str, mat: str, suit: str | None = None, suit_mat=None):
    lw = text_width(label, FONT3)
    draw_text(sp, label, 5, 5, FONT3, mat, tone=1)
    draw_text(sp, label, CW - 5 - lw, CH - 10, FONT3, mat, tone=1, flip=True)
    if suit:
        sm = suit_mat or mat
        mask_part(sp, SUIT5[suit], 4, 11, sm, mode="flat", outline=False)
        mask_part(sp, SUIT5[suit], CW - 9, CH - 16, sm, flip=True, mode="flat", outline=False)


def big_text(sp: Sprite, s: str, mat: str, tone=1, y=None):
    w = text_width(s, FONT5, bold=True)
    x = (CW - w) // 2
    y = (CH - 7) // 2 if y is None else y
    draw_text(sp, s, x, y, FONT5, mat, tone=tone, bold=True)


def card_back() -> Sprite:
    sp = Sprite(CW, CH)
    sp.rect(1, 1, CW - 2, CH - 2, "gold", outline="outer")
    sp.rect(3, 3, CW - 6, CH - 6, "night", mode="inset", outline=False)
    lattice = [(x, y) for y in range(4, CH - 4) for x in range(4, CW - 4)
               if (x + y) % 6 == 0 or (x - y) % 6 == 0]
    sp.fill(lattice, "night", tone=3, outline=False)
    sp.stamp(PIECE, (CW - 16) // 2, (CH - 16) // 2)
    return sp


# ============================================================== items ======
PIECE = icon([
    "................",
    ".......gg.......",
    ".....gg44gg.....",
    "...gg433322gg...",
    "..g4433332221g..",
    "..g4333332221g..",
    "..g4333332211g..",
    "..g3333322211g..",
    "..g3332222111g..",
    "..g3322222111g..",
    "..g3222221111g..",
    "...gg222111gg...",
    ".....gg11gg.....",
    ".......gg.......",
], {"g": "gold",
    "4": ("amethyst", {"tone": 4, "outline": False}), "3": ("amethyst", {"tone": 3, "outline": False}),
    "2": ("amethyst", {"tone": 2, "outline": False}), "1": ("amethyst", {"tone": 1, "outline": False})})
register("items", "piece", PIECE, "The Piece - core currency and life token")


def coin(value: str, mat="gold", size=16) -> Sprite:
    sp = Sprite(size, size)
    c = size / 2
    sp.circle(c, c, c - 1, mat, mode="sphere")
    sp.ring(c, c, c - 3.6, c - 2.6, mat, tone=1, outline=False)
    if value:
        w = text_width(value, FONT3)
        draw_text(sp, value, int(c - w / 2), int(c - 2.5), FONT3, mat, tone=0)
    return sp


for v in ("1", "2", "3", "5", "10"):
    register("coins", f"coin_{v}", coin(v), f"Gold coin worth {v}")
register("coins", "coin_blank", coin(""), "Plain gold coin")
register("coins", "coin_black", coin("", "iron", 12), "Black coin (Piggy Bank)")
register("coins", "coin_white", coin("", "ivory", 12), "White coin (Piggy Bank)")
register("coins", "coin_silver", coin("", "silver", 12), "Small silver coin")


def chip(mat: str | None) -> Sprite:
    sp = Sprite(16, 16)
    if mat:
        sp.circle(8, 8, 7, mat, mode="sphere")
    else:  # rainbow
        cols = ["ruby", "orange", "topaz", "emerald", "sapphire", "amethyst"]
        groups: dict[str, list] = {c: [] for c in cols}
        for y in range(16):
            for x in range(16):
                dx, dy = x + 0.5 - 8, y + 0.5 - 8
                if dx * dx + dy * dy <= 49:
                    a = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                    groups[cols[int(a * 6) % 6]].append((x, y))
        for c, pts in groups.items():
            sp.fill(pts, c, mode="flat", outline="outer")
    notch = []
    for i in range(8):
        a = i * math.pi / 4 + math.pi / 8
        notch.append((int(8 + 6 * math.cos(a)), int(8 + 6 * math.sin(a))))
    sp.fill(notch, "ivory", tone=3, outline=False)
    sp.circle(8, 8, 3.6, "ivory", mode="sphere", outline=False)
    sp.ring(8, 8, 3.6, 4.5, mat or "iron", tone=1, outline=False)
    return sp


for m in ("ruby", "emerald", "sapphire", "topaz", "amethyst", "iron"):
    register("coins", f"chip_{m}", chip(m), f"Betting chip ({m})")
register("coins", "chip_rainbow", chip(None), "Rainbow chip (wild colour)")


PIPS = {
    1: [(7, 7)], 2: [(4, 4), (10, 10)], 3: [(4, 4), (7, 7), (10, 10)],
    4: [(4, 4), (10, 4), (4, 10), (10, 10)], 5: [(4, 4), (10, 4), (7, 7), (4, 10), (10, 10)],
    6: [(4, 4), (10, 4), (4, 7), (10, 7), (4, 10), (10, 10)],
}


def die(n: int | None, body="ivory", pip="iron", pip_tone=0) -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(1, 1, 14, 14, body, round_corners=True)
    if n is None:
        sp.glyph(FONT5["?"], 6, 4, pip, tone=pip_tone)
        return sp
    p = sp.part(pip if n != 1 or body != "ivory" else "ruby", tone=pip_tone, outline=False)
    for (x, y) in PIPS[n]:
        for dx in (0, 1):
            for dy in (0, 1):
                sp.plot(x + dx, y + dy, p)
    return sp


for n in range(1, 7):
    register("dice", f"die_white_{n}", die(n), f"White die showing {n}")
    register("dice", f"die_red_{n}", die(n, "ruby", "ivory", 4), f"Red die showing {n}")
    register("dice", f"die_blue_{n}", die(n, "sapphire", "ivory", 4), f"Blue die showing {n}")
register("dice", "die_hidden", die(None, "night", "amethyst", 4), "Hidden die")


def revolver(loaded: list[int]) -> Sprite:
    sp = Sprite(24, 24)
    sp.circle(12, 12, 11, "iron", mode="sphere")
    for i in range(6):
        a = -math.pi / 2 + i * math.pi / 3
        cx, cy = 12 + 6.2 * math.cos(a), 12 + 6.2 * math.sin(a)
        if i in loaded:
            sp.circle(cx, cy, 2.6, "gold", mode="sphere", outline="all")
            sp.circle(cx, cy, 0.9, "gold", tone=1, outline=False)
        else:
            sp.circle(cx, cy, 2.6, "iron", tone=0, outline=False)
    sp.circle(12, 12, 1.6, "silver", mode="sphere", outline="all")
    return sp


register("items", "revolver_empty", revolver([]), "Six-chamber cylinder, empty")
register("items", "revolver_loaded", revolver([0, 3]), "Six-chamber cylinder with 2 rounds")
register("items", "revolver_chamber_hidden", revolver([]), "Cylinder (chambers unknown)")


def bullet() -> Sprite:
    sp = Sprite(8, 16)
    sp.rect(2, 6, 4, 8, "gold")
    sp.ellipse(4, 5, 2, 3.5, "copper", mode="sphere")
    sp.rect(1, 13, 6, 2, "gold", tone=1)
    return sp


register("items", "bullet", bullet(), "Round")


def scale_item() -> Sprite:
    sp = Sprite(24, 24)
    sp.rect(7, 20, 10, 3, "wood")
    sp.rect(11, 5, 2, 15, "gold")
    sp.rect(2, 5, 20, 2, "gold")
    sp.circle(12, 4.5, 2, "ruby", mode="sphere")
    for x in (3, 20):
        sp.line(x, 7, x - 2, 13, "silver", outline=False)
        sp.line(x, 7, x + 2, 13, "silver", outline=False)
    sp.ellipse(3.5, 14, 3.5, 1.6, "gold", mode="sphere")
    sp.ellipse(20.5, 14, 3.5, 1.6, "gold", mode="sphere")
    return sp


register("items", "balance_scale", scale_item(), "Balance scale (Heavy 13 / Scale games)")


def scale_pan(mat: str) -> Sprite:
    sp = Sprite(24, 16)
    sp.ellipse(12, 10, 11, 4, mat, mode="sphere")
    sp.ellipse(12, 9, 9, 2.2, mat, mode="inset", outline=False)
    sp.rect(11, 0, 2, 6, "silver")
    return sp


for m in ("ruby", "emerald", "sapphire"):
    register("items", f"scale_pan_{m}", scale_pan(m), f"Scale pan ({m})")


def rock(size: int, seed: int) -> Sprite:
    sp = Sprite(size, size)
    rnd = random.Random(seed)
    c = size / 2
    pts = []
    for y in range(size):
        for x in range(size):
            dx, dy = x + 0.5 - c, (y + 0.5 - c) * 1.15
            a = math.atan2(dy, dx)
            r = (c - 1.2) * (0.88 + 0.12 * math.sin(a * 3 + seed))
            if math.hypot(dx, dy) <= r:
                pts.append((x, y))
    sp.fill(pts, "stone", mode="sphere")
    for _ in range(2):
        x, y = rnd.randint(size // 3, 2 * size // 3), rnd.randint(size // 3, 2 * size // 3)
        sp.plot(x, y, sp.part("stone", tone=1, outline=False))
    return sp


register("items", "rock_small", rock(10, 1), "Small rock")
register("items", "rock_medium", rock(12, 2), "Medium rock")
register("items", "rock_large", rock(16, 3), "Large rock")

PIGGY = icon([
    "........................",
    "........................",
    "........................",
    "........................",
    ".....pp.................",
    ".....ppp.pppppppp.......",
    "......pppppkkkkpppp.....",
    ".....ppppppppppppppp....",
    "....pppppppppppppppppp..",
    "...ppkppppppppppppppppt.",
    "..ppppppppppppppppppppt.",
    ".nnnpppppppppppppppppp..",
    ".nnnpppppppppppppppppp..",
    ".nnnpppppppppppppppppp..",
    "..ppppppppppppppppppp...",
    "...pppppppppppppppppp...",
    "....pppppppppppppppp....",
    ".....pppppppppppppp.....",
    ".....pp...pp..pp..pp....",
    ".....pp...pp..pp..pp....",
], {"p": ("pink", {"mode": "sphere"}), "t": "pink",
    "n": ("pink", {"tone": 3, "outline": "all"}), "k": DARK}, 24, 24)
for (x, y) in ((2, 12), (2, 13)):
    PIGGY.plot(x, y, PIGGY.part("pink", tone=1, outline=False))
register("items", "piggy_bank", PIGGY, "Piggy bank")


def wall(horizontal=True) -> Sprite:
    w, h = (16, 4) if horizontal else (4, 16)
    sp = Sprite(w, h)
    sp.rect(0, 0, w, h, "stone", outline=False)
    mortar = []
    if horizontal:
        mortar = [(x, y) for y in range(h) for x in range(w) if (x % 8 == 7 and y < 2) or ((x + 4) % 8 == 7 and y >= 2)]
    else:
        mortar = [(x, y) for y in range(h) for x in range(w) if (y % 8 == 7 and x < 2) or ((y + 4) % 8 == 7 and x >= 2)]
    sp.fill(mortar, "stone", tone=1, outline=False)
    return sp


register("board", "wall_h", wall(True), "Wall segment (horizontal)")
register("board", "wall_v", wall(False), "Wall segment (vertical)")

HAMMER = icon([
    "................",
    "................",
    "..aaaaaaaaa.....",
    "..aaaaaaaaaa....",
    "..aaaaaaaaa.....",
    ".....ww.........",
    "......ww........",
    ".......ww.......",
    "........ww......",
    ".........ww.....",
    "..........ww....",
    "...........ww...",
    "............ww..",
], {"a": "iron", "w": "wood"})
register("items", "wall_breaker", HAMMER, "Wall breaker hammer")


def counter_square(mat) -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(3, 3, 10, 10, mat)
    sp.rect(5, 5, 6, 6, mat, mode="inset", outline=False)
    return sp


def counter_round(mat) -> Sprite:
    sp = Sprite(16, 16)
    sp.circle(8, 8, 5.5, mat, mode="sphere")
    return sp


for m in ("ruby", "sapphire", "emerald", "topaz", "amethyst", "ivory"):
    register("board", f"counter_square_{m}", counter_square(m), f"Square counter ({m})")
    register("board", f"counter_round_{m}", counter_round(m), f"Round counter ({m})")


def shape(kind: str, mat: str) -> Sprite:
    sp = Sprite(16, 16)
    if kind == "triangle":
        sp.poly([(8, 1.5), (14.5, 13.5), (1.5, 13.5)], mat)
    elif kind == "circle":
        sp.circle(8, 8, 6.2, mat, mode="sphere")
    elif kind == "star":
        sp.star(8, 8.6, 6.8, 2.9, mat, mode="sphere")
    elif kind == "square":
        sp.rect(2, 2, 12, 12, mat)
    return sp


register("board", "shape_triangle", shape("triangle", "emerald"), "Bingo shape: triangle")
register("board", "shape_circle", shape("circle", "sapphire"), "Bingo shape: circle")
register("board", "shape_star", shape("star", "gold"), "Bingo shape: star")
register("board", "shape_square", shape("square", "ruby"), "Bingo shape: square")


def push_button() -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(1, 9, 14, 5, "iron")
    sp.ellipse(8, 9, 5.5, 4, "ruby", mode="sphere")
    return sp


register("items", "push_button", push_button(), "Push button (Time Auction)")

KEY = icon([
    "................",
    "................",
    "................",
    "................",
    "..gggg..........",
    ".gggggg.........",
    ".gg..gggggggggg.",
    ".gg..gggggggggg.",
    ".gggggg....g.gg.",
    "..gggg.....g.g..",
], {"g": "gold"})
register("items", "key", KEY, "Key")


def safe() -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(1, 2, 14, 13, "iron")
    sp.rect(3, 4, 10, 9, "iron", mode="inset", outline=False)
    sp.circle(7, 8.5, 2.6, "silver", mode="sphere", outline="all")
    sp.rect(11, 6, 1, 5, "gold", outline=False)
    return sp


register("items", "safe", safe(), "Safe / vault")

CHEST = icon([
    "................",
    "................",
    "................",
    "...wwwwwwwwww...",
    "..wwwwwwwwwwww..",
    "..wwwwwwwwwwww..",
    "..gggggggggggg..",
    "..wwwwwyywwwww..",
    "..wwwwwyywwwww..",
    "..wwwwwwwwwwww..",
    "..wwwwwwwwwwww..",
    "..gggggggggggg..",
], {"w": "wood", "g": ("gold", {"outline": "all"}), "y": ("gold", {"tone": 4, "outline": "all"})})
register("items", "treasure_chest", CHEST, "Treasure chest")


def ingot(mat: str) -> Sprite:
    return icon([
        "................",
        "................",
        "................",
        ".....tttttt.....",
        "....tttttttt....",
        "...tttttttttt...",
        "...gggggggggg...",
        "..gggggggggggg..",
        "..gggggggggggg..",
        ".gggggggggggggg.",
        ".gggggggggggggg.",
        "................",
    ], {"t": (mat, {"tone": 3}), "g": (mat, {"outline": "all"})})


GEM_DIAMOND = icon([
    "................",
    "................",
    "................",
    "....44443333....",
    "...4433332222...",
    "..433333222221..",
    ".44443332222111.",
    "..433332222111..",
    "...3333222211...",
    "....33322211....",
    ".....332211.....",
    "......3211......",
    ".......21.......",
], {"4": ("glass", {"tone": 4}), "3": ("glass", {"tone": 3}),
    "2": ("glass", {"tone": 2}), "1": ("glass", {"tone": 1})})


def gem(mat: str) -> Sprite:  # round cut gem (generic)
    sp = Sprite(16, 16)
    sp.poly([(8, 2), (14, 6), (12, 13), (4, 13), (2, 6)], mat, mode="sphere")
    sp.poly([(8, 4), (11, 6.5), (8, 9), (5, 6.5)], mat, tone=4, outline=False)
    return sp


register("gems", "diamond", GEM_DIAMOND, "Diamond")
register("gems", "gold_ingot", ingot("gold"), "Gold ingot")
register("gems", "silver_ingot", ingot("silver"), "Silver ingot")
register("gems", "copper_ingot", ingot("copper"), "Copper ingot")
for m in ("ruby", "emerald", "sapphire", "amethyst", "topaz"):
    register("gems", f"gem_{m}", gem(m), f"Cut {m}")


def bomb() -> Sprite:
    sp = Sprite(16, 16)
    sp.circle(7, 9.5, 5.6, "iron", mode="sphere")
    sp.rect(9, 3, 3, 2, "silver")
    sp.fill([(12, 2), (13, 1)], "wood", outline=False)
    sp.fill([(14, 0), (13, 0), (15, 1), (14, 2)], "gold", tone=4, outline=False)
    return sp


BOMB = bomb()
register("gems", "bomb", BOMB, "Bomb")

# --------------------------------------------------------- monsters ------
MONSTERS = {
    "pumpkin": icon([
        "................",
        "................",
        ".......ee.......",
        "......ee........",
        "...oooooooooo...",
        "..oooooooooooo..",
        ".oookkooookkooo.",
        ".oookkooookkooo.",
        ".oooooooooooooo.",
        ".ooookooookoooo.",
        ".oooookkkkooooo.",
        "..oooooooooooo..",
        "...oooooooooo...",
    ], {"o": ("orange", {"mode": "sphere"}), "e": "emerald", "k": ("orange", {"tone": 0, "outline": False})}),
    "ghost": icon([
        "................",
        "................",
        ".....iiiiii.....",
        "....iiiiiiii....",
        "...iiiiiiiiii...",
        "...iikkiikkii...",
        "...iikkiikkii...",
        "...iiiiiiiiii...",
        "...iiiikkiiii...",
        "...iiiiiiiiii...",
        "...iiiiiiiiii...",
        "...iiiiiiiiii...",
        "...ii.iii.iii...",
        "...i...i...i....",
    ], {"i": ("ivory", {"mode": "sphere"}), "k": DARK}),
    "bat": icon([
        "................",
        "................",
        "................",
        "................",
        "......a..a......",
        "a.....aaaa.....a",
        "aa...akaaka...aa",
        "aaa..aaaaaa..aaa",
        "aaaaaaaaaaaaaaaa",
        ".aaaaaaaaaaaaaa.",
        "..aa.aaaaaa.aa..",
        "......a..a......",
    ], {"a": "amethyst", "k": ("ruby", {"tone": 4, "outline": False})}),
    "slime": icon([
        "................",
        "................",
        "................",
        "................",
        "................",
        "......ssss......",
        "....ssssssss....",
        "...ssssssssss...",
        "..sssskssksss...",
        "..ssssssssssss..",
        "..ssssssssssss..",
        "...ssssssssss...",
    ], {"s": ("emerald", {"mode": "sphere"}), "k": DARK}),
}
for n, sp in MONSTERS.items():
    register("monsters", n, sp)

# --------------------------------------------------------- tokens --------
EMBLEM_WING = [
    "............",
    "......#####.",
    "....#######.",
    "..#########.",
    ".##########.",
    "..########..",
    ".#########..",
    "...######...",
    "..######....",
    "....###.....",
    "............",
    "............",
]
EMBLEM_CROWN = [
    "............",
    "............",
    "............",
    ".#...##...#.",
    ".##.####.##.",
    ".##########.",
    ".##########.",
    ".##########.",
    "............",
    "............",
    "............",
    "............",
]


def medallion(inner: str, emblem: str) -> Sprite:
    sp = Sprite(24, 24)
    sp.circle(12, 12, 11, "gold", mode="sphere")
    sp.circle(12, 12, 8.4, inner, mode="sphere", outline="all")
    if emblem == "rings":
        sp.ring(9.6, 12, 2.0, 3.4, "gold", outline="all")
        sp.ring(14.4, 12, 2.0, 3.4, "silver", outline="all")
    elif emblem == "wing":
        mask_part(sp, EMBLEM_WING, 6, 6, "ivory", outline="all")
    elif emblem == "crown":
        mask_part(sp, EMBLEM_CROWN, 6, 6, "gold", outline="all")
    elif emblem == "star":
        sp.star(12, 12.6, 5.6, 2.4, "gold", mode="sphere", outline="all")
    elif emblem == "skull":
        sp.stamp(ICONS["skull"], 4, 4)
    return sp


register("tokens", "token_alliance", medallion("sapphire", "rings"), "Token of Alliance")
register("tokens", "token_salvation", medallion("emerald", "wing"), "Token of Salvation")
register("tokens", "token_prize", medallion("ruby", "crown"), "Prize Token (+prize money)")
register("tokens", "token_victory", medallion("amethyst", "star"), "Victory token")
register("tokens", "token_curse", medallion("night", "skull"), "Curse token")

# --------------------------------------------------------- board tiles ---


def tile(mat: str, seed: int, texture=0.18) -> Sprite:
    sp = Sprite(16, 16)
    rnd = random.Random(seed)
    sp.rect(0, 0, 16, 16, mat, outline=False)
    light = [(x, y) for y in range(16) for x in range(16) if rnd.random() < texture]
    dark = [(x, y) for y in range(16) for x in range(16) if rnd.random() < texture * 0.7]
    sp.fill(light, mat, tone=3, outline=False)
    sp.fill(dark, mat, tone=1, outline=False)
    return sp


def grid_cell() -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(0, 0, 16, 16, "parchment", mode="inset", outline=False)
    return sp


register("board", "tile_grass", tile("grass", 11), "Grass tile")
register("board", "tile_sand", tile("sand", 12), "Sand tile")
register("board", "tile_water", tile("water", 13, 0.12), "Water tile")
register("board", "tile_stone", tile("stone", 14), "Stone floor tile")
register("board", "tile_night", tile("night", 15, 0.1), "Night / void tile")
register("board", "tile_cell", grid_cell(), "Empty grid cell")


def tree() -> Sprite:
    sp = Sprite(16, 16)
    sp.rect(7, 10, 2, 5, "wood")
    sp.circle(8, 7, 5.5, "grass", mode="sphere")
    return sp


def manhole() -> Sprite:
    sp = Sprite(16, 16)
    sp.circle(8, 8, 6, "iron", mode="sphere")
    for y in (6, 8, 10):
        sp.rect(5, y, 6, 1, "iron", tone=0, outline=False)
    return sp


register("board", "tree", tree(), "Street tree (blocker)")
register("board", "manhole", manhole(), "Manhole")

# --------------------------------------------------------- portraits ----
FACE = [
    "................",
    "................",
    "................",
    "................",
    "....ffffffff....",
    "...ffffffffff...",
    "...ffkffffkff...",
    "...ffkffffkff...",
    "...ffffffffff...",
    "....ffffmfff....",
    ".....ffffff.....",
    "................",
    "....cccccccc....",
    "...cccccccccc...",
    "..cccccccccccc..",
    "..cccccccccccc..",
]


def portrait(hat_rows, hat_legend, cloth="sapphire", eyes=None, extra=None) -> Sprite:
    sp = Sprite(16, 16)
    sp.ascii(FACE, {"c": cloth, "f": ("skin", {"mode": "flat"}),
                    "m": ("skin", {"tone": 1, "outline": False}), "k": DARK})
    sp.ascii(hat_rows, hat_legend)
    if eyes:
        sp.ascii(eyes[0], eyes[1])
    if extra:
        extra(sp)
    return sp


HAIR_SHORT = [
    "................",
    ".....hhhhhh.....",
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",
    "...hhhhhhhhhh...",
    "...hh......hh...",
]

PORTRAITS = {
    "citizen": portrait(HAIR_SHORT, {"h": "hair"}, cloth="emerald"),
    "officer": portrait([
        "................",
        "....ssssssss....",
        "...ssssggssss...",
        "...ssssssssss...",
        "..iiiiiiiiiiii..",
        "...hh......hh...",
    ], {"s": "sapphire", "g": ("gold", {"tone": 4, "outline": "all"}), "i": "iron", "h": "hair"},
        cloth="sapphire"),
    "terrorist": portrait([
        "................",
        ".....kkkkkk.....",
        "....kkkkkkkk....",
        "...kkkkkkkkkk...",
        "...kkkkkkkkkk...",
        "...kk......kk...",
        "...k........k...",
        "...k........k...",
        "...kkkkkkkkkk...",
        "....kkkkkkkk....",
        ".....kkkkkk.....",
    ], {"k": "iron"}, cloth="ruby",
        eyes=([""] * 6 + [".....r....r....."], {"r": ("ruby", {"tone": 4, "outline": False})})),
    "fanatic": portrait([
        "................",
        "......aaaa......",
        "....aaaaaaaa....",
        "...aaaaaaaaaa...",
        "..aaaaaaaaaaaa..",
        "..aa........aa..",
        "..a..........a..",
        "..a..........a..",
    ], {"a": "amethyst"}, cloth="amethyst",
        eyes=([""] * 6 + ["......y...y.....", "......y...y....."],
              {"y": ("topaz", {"tone": 4, "outline": False})})),
    "researcher": portrait([
        "................",
        ".....hhhhhh.....",
        "....hhhhhhhh....",
        "...hhhhhhhhhh...",
        "...hhhhhhhhhh...",
        "...hh......hh...",
        "...gggg..gggg...",
        "...gggg..gggg...",
    ], {"h": "ivory", "g": ("glass", {"outline": "all"})}, cloth="ivory"),
    "journalist": portrait([
        "................",
        "................",
        ".....wwwwww.....",
        "....wwwwwwww....",
        "..wwwwwwwwwwww..",
        "...hh......hh...",
    ], {"w": "copper", "h": "blonde"}, cloth="copper"),
}
for n, sp in PORTRAITS.items():
    register("portraits", n, sp, f"Role portrait: {n}")

# ------------------------------------------------------------ party ----
# Board pieces for Party mode: eight pawns (each with its own colour and hat),
# a head-only version of each for score cards, the board spaces and the jail.

PAWN_BODY = [
    "................",  # 0
    "................",
    "................",
    "................",
    "................",
    "................",  # 5
    "................",
    "................",
    "......hhhh......",
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",  # 10
    "...hffffffffh...",
    "...ffkffffkff...",
    "...ffkffffkff...",
    "...ffffffffff...",
    "....ffffmfff....",  # 15
    ".....ffffff.....",
    "....cccccccc....",
    "...fccccccccf...",
    "...fccbbbbccf...",
    "....cccccccc....",  # 20
    ".....cc..cc.....",
    ".....ss..ss.....",
    "................",
]

# (cloth, hair, hat rows (from row 0), hat legend)
PAWNS = [
    ("sapphire", "hair", {7: ".....cccccc.....", 8: "....cccccccc....", 9: "...cccccccccc...", 10: "...cccccccccccc."},
     {"c": "sapphire"}),                                                     # cap
    ("ruby", "blonde", {5: ".......pp.......", 6: "......pppp......", 7: ".....rrrrrr.....", 8: "....rrrrrrrr....",
                        9: "...rrrrrrrrrr...", 10: "...wwwwwwwwww..."},
     {"r": "ruby", "w": ("ruby", {"tone": 3, "outline": False}), "p": ("ivory", {"mode": "sphere"})}),  # beanie
    ("emerald", "hair", {10: "...gggggggggggg.", 11: "............gg.."},
     {"g": "emerald"}),                                                      # bandana
    ("gold", "copper", {5: "....y..yy..y....", 6: "....yy.yy.yy....", 7: "....yyyyyyyy....", 8: "....yryyyyry...."},
     {"y": "gold", "r": ("ruby", {"tone": 3, "outline": False})}),          # crown
    ("amethyst", "blonde", {0: ".........a......", 1: "........aa......", 2: ".......aaa......", 3: "......aaaa......",
                            4: "......aaaaa.....", 5: ".....aaayaa.....", 6: ".....aaaaaa.....", 7: "....aaaaaaaa....",
                            8: "...aaaaaaaaaa...", 9: "..aaaaaaaaaaaa.."},
     {"a": "amethyst", "y": ("topaz", {"tone": 4, "outline": False})}),     # wizard hat
    ("orange", "hair", {5: "..v..........v..", 6: "..vv........vv..", 7: "...vv.ssss.vv...", 8: "....vssssssv....",
                        9: "....ssssssss....", 10: "...ssssssssss...", 11: "...s........s..."},
     {"s": "silver", "v": "ivory"}),                                         # horned helmet
    ("pink", "hair", {6: "...h........h...", 7: "...hp......ph...", 8: "...hhhhhhhhhh..."},
     {"h": "hair", "p": ("pink", {"tone": 3, "outline": False})}),          # cat ears
    ("ivory", "blonde", {2: ".....kkkkkk.....", 3: ".....kkkkkk.....", 4: ".....kkkkkk.....", 5: ".....kkkkkk.....",
                         6: ".....rrrrrr.....", 7: ".....kkkkkk.....", 8: "...kkkkkkkkkk..."},
     {"k": "iron", "r": "ruby"}),                                            # top hat
]
PAWN_NAMES = ["cap", "beanie", "bandana", "crown", "wizard", "horns", "cat", "top hat"]


def pawn(i: int, body: bool = True) -> Sprite:
    cloth, hair, hat, legend = PAWNS[i]
    rows = PAWN_BODY if body else PAWN_BODY[:17]
    sp = Sprite(16, len(rows))
    sp.ascii(rows, {"h": hair, "f": ("skin", {"mode": "flat"}), "m": ("skin", {"tone": 1, "outline": False}),
                    "k": DARK, "c": cloth, "b": (cloth, {"tone": 1, "outline": False}), "s": "iron"})
    hat_rows = [hat.get(y, "") for y in range(max(hat) + 1)]
    sp.ascii(hat_rows, legend)
    return sp


for i in range(8):
    register("party", f"pawn_{i}", pawn(i), f"Party pawn {i}: {PAWNS[i][0]} with a {PAWN_NAMES[i]}")
    register("party", f"head_{i}", pawn(i, body=False), f"Party pawn {i}, head only (score cards)")

SPACE_ICONS = {
    "plus": ["..##..", "..##..", "######", "######", "..##..", "..##.."],
    "minus": ["......", "......", "######", "######", "......", "......"],
    "swords": ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", "##...##", "##...##"],
    "bars": ["#######", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#######"],
    "coin": [".###.", "#.#.#", "#.#..", ".###.", "..#.#", "#.#.#", ".###."],
    "star": ["...#...", "...#...", "#######", ".#####.", "..###..", ".##.##.", "##...##"],
}
SPACES = {  # name: (material, icon rows, icon material, tone)
    "blue": ("sapphire", SPACE_ICONS["plus"], "ivory", 4),
    "red": ("ruby", SPACE_ICONS["minus"], "ivory", 4),
    "event": ("amethyst", FONT5["?"], "ivory", 4),
    "duel": ("orange", SPACE_ICONS["swords"], "ivory", 4),
    "prison": ("stone", SPACE_ICONS["bars"], "iron", 0),
    "vault": ("emerald", SPACE_ICONS["coin"], "gold", 3),
    "gate": ("ivory", SPACE_ICONS["star"], "gold", 2),
}


def space(mat: str, icon_rows, icon_mat: str, tone: int) -> Sprite:
    """A round board space, seen from slightly above: a coloured top on a darker rim."""
    sp = Sprite(24, 22)
    sp.ellipse(12, 12, 10, 8, mat, tone=1)
    sp.ellipse(12, 9, 10, 8, mat, mode="bevel")
    w, h = len(icon_rows[0]), len(icon_rows)
    sp.glyph(icon_rows, 12 - w // 2, 9 - h // 2, icon_mat, tone=tone)
    return sp


for n, (mat, rows, im, tone) in SPACES.items():
    register("party", f"space_{n}", space(mat, rows, im, tone), f"Party board space: {n}")


def jail_house() -> Sprite:
    sp = Sprite(30, 28)
    sp.poly([(1, 10), (15, 1), (29, 10)], "ruby")          # roof
    sp.rect(3, 10, 24, 17, "stone")                         # walls
    sp.rect(8, 13, 14, 10, "iron", mode="inset", outline=False)  # window
    sp.glyph(["#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#", "#.#.#.#"],
             11, 14, "silver", tone=3)
    return sp


register("party", "jail_house", jail_house(), "Party: the little jail by the jail spaces")


def watchtower() -> Sprite:
    sp = Sprite(22, 40)
    sp.rect(5, 14, 12, 25, "wood")                          # legs/body
    sp.line(6, 16, 15, 36, "wood", tone=1, outline=False)
    sp.line(15, 16, 6, 36, "wood", tone=1, outline=False)
    sp.rect(2, 7, 18, 8, "wood")                            # cabin
    sp.rect(5, 9, 12, 4, "glass", outline=False)
    sp.poly([(1, 7), (11, 0), (21, 7)], "iron")             # roof
    return sp


register("party", "watchtower", watchtower(), "Party: a yard watchtower")


# --------------------------------------------------------- UI chrome ----


def panel() -> Sprite:
    sp = Sprite(24, 24)
    sp.rect(1, 1, 22, 22, "wood")
    sp.rect(3, 3, 18, 18, "parchment", mode="inset", outline=False)
    for (x, y) in ((1, 1), (21, 1), (1, 21), (21, 21)):
        sp.rect(x, y, 2, 2, "gold", outline=False)
    return sp


def panel_dark() -> Sprite:
    sp = Sprite(24, 24)
    sp.rect(1, 1, 22, 22, "gold")
    sp.rect(3, 3, 18, 18, "night", mode="inset", outline=False)
    return sp


def button(mat, pressed=False) -> Sprite:
    sp = Sprite(32, 14)
    y = 2 if pressed else 1
    if not pressed:
        sp.rect(1, 3, 30, 10, mat, tone=1, outline="outer")
    sp.rect(1, y, 30, 10, mat, outline="outer")
    return sp


def ribbon() -> Sprite:
    sp = Sprite(48, 14)
    sp.poly([(0, 3), (6, 3), (6, 12), (0, 12), (3, 7.5)], "ruby", tone=1)
    sp.poly([(48, 3), (42, 3), (42, 12), (48, 12), (45, 7.5)], "ruby", tone=1)
    sp.rect(4, 1, 40, 10, "ruby")
    return sp


def frame_slot() -> Sprite:
    sp = Sprite(20, 20)
    sp.rect(1, 1, 18, 18, "gold")
    sp.rect(3, 3, 14, 14, "night", mode="inset", outline=False)
    return sp


register("ui", "panel_parchment", panel(), "9-slice panel (slice 4px)")
register("ui", "panel_night", panel_dark(), "9-slice dark panel (slice 4px)")
register("ui", "button_blue", button("sapphire"), "Button")
register("ui", "button_blue_pressed", button("sapphire", True), "Button pressed")
register("ui", "button_red", button("ruby"), "Danger button")
register("ui", "button_red_pressed", button("ruby", True), "Danger button pressed")
register("ui", "button_disabled", button("stone"), "Disabled button")
register("ui", "ribbon", ribbon(), "Title ribbon (9-slice middle)")
register("ui", "slot_frame", frame_slot(), "Inventory / item slot")

# ================================================================ cards ===
register("cards", "back", card_back(), "Card back")
register("cards", "blank", card_base(), "Blank card front")

for n in range(0, 11):
    sp = card_base()
    card_corners(sp, str(n), "iron")
    big_text(sp, str(n), "iron")
    register("cards", f"number_{n}", sp, f"Number card {n}")

for sym, name in (("+", "plus"), ("-", "minus"), ("x", "times"), ("/", "divide"), ("=", "equals")):
    sp = card_base("ivory")
    big_text(sp, sym, "sapphire", tone=1)
    register("cards", f"op_{name}", sp, f"Operator card {sym}")

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
for suit in ("spade", "heart", "diamond", "club"):
    for rank in RANKS:
        sp = card_base()
        mat = SUIT_MAT[suit]
        card_corners(sp, rank, mat, suit)
        if rank in ("J", "Q", "K"):
            emblem = {"K": ICONS["crown"], "J": ICONS["sword"], "Q": ICONS["crown"]}[rank]
            recolor = {"gold": "silver", "ruby": "amethyst"} if rank == "Q" else None
            sp.stamp(emblem, 8, 13, recolor=recolor)
            mask_part(sp, SUIT5[suit], 14, 30, mat, mode="flat", outline=False)
        else:
            mask_part(sp, SUIT11[suit], 11, 16, mat, mode="sphere" if mat == "ruby" else "bevel",
                      outline=False)
        register("cards", f"{suit}_{rank}", sp, f"{rank} of {suit}s")

GEM_CARDS = [("diamond", GEM_DIAMOND, "glass", [5, 6]), ("gold", ingot("gold"), "gold", [4, 5]),
             ("silver", ingot("silver"), "silver", [2, 3, 4]), ("copper", ingot("copper"), "copper", [1, 2])]
for name, art, mat, values in GEM_CARDS:
    for v in values:
        sp = card_base()
        card_corners(sp, str(v), mat if mat != "glass" else "sapphire")
        sp.stamp(art, 8, 9)
        big_text(sp, str(v), mat if mat != "glass" else "sapphire", y=26)
        register("cards", f"gem_{name}_{v}", sp, f"Gem card: {name} {v}")
for v in (4, 6):
    sp = card_base("night", "iron")
    card_corners(sp, f"-{v}", "ruby")
    sp.stamp(BOMB, 8, 9)
    big_text(sp, f"-{v}", "ruby", tone=3, y=26)
    register("cards", f"gem_bomb_{v}", sp, f"Bomb card -{v}")

for col in ("ruby", "sapphire", "emerald", "topaz", "amethyst"):
    sp = card_base(col)
    sp.stamp(gem(col), 8, 14)
    register("cards", f"color_{col}", sp, f"Colour card ({col})")

TEAM = {"terrorist": "ruby", "fanatic": "amethyst", "officer": "sapphire",
        "citizen": "emerald", "researcher": "ivory", "journalist": "copper"}
for role, team in TEAM.items():
    sp = card_base()
    sp.rect(5, 6, 22, 22, team, mode="inset", outline=False)
    sp.stamp(PORTRAITS[role], 8, 9)
    sp.rect(5, 31, 22, 7, team, outline=False)
    register("cards", f"role_{role}", sp, f"Hidden-role card: {role}")

for shape_name in ("triangle", "circle", "star"):
    sp = card_base()
    sp.stamp(REGISTRY["board"][f"shape_{shape_name}"][0], 8, 14)
    register("cards", f"shape_{shape_name}", sp, f"Shape card: {shape_name}")


# ============================================================== export ====
def pack(sprites: dict[str, tuple[Sprite, str]], max_w=256, pad=1):
    x = y = row_h = 0
    frames = {}
    for name, (sp, _) in sprites.items():
        if x + sp.w + pad > max_w:
            x, y, row_h = 0, y + row_h + pad, 0
        frames[name] = {"x": x, "y": y, "w": sp.w, "h": sp.h}
        x += sp.w + pad
        row_h = max(row_h, sp.h)
    return frames, max_w, y + row_h


def export():
    for d in ("sprites", "sprites@4x", "sheets"):
        shutil.rmtree(OUT / d, ignore_errors=True)
    manifest = {"version": 1, "scale_note": "Sprites are authored at 1x; scale with nearest-neighbour only.",
                "categories": {}}
    for cat, sprites in REGISTRY.items():
        (OUT / "sprites" / cat).mkdir(parents=True, exist_ok=True)
        (OUT / "sprites@4x" / cat).mkdir(parents=True, exist_ok=True)
        (OUT / "sheets").mkdir(parents=True, exist_ok=True)
        frames, sw, sh = pack(sprites)
        sheet = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        entries = []
        for name, (sp, desc) in sprites.items():
            img = sp.render()
            img.save(OUT / "sprites" / cat / f"{name}.png")
            sp.render(4).save(OUT / "sprites@4x" / cat / f"{name}.png")
            f = frames[name]
            sheet.paste(img, (f["x"], f["y"]))
            entries.append({"name": name, "w": sp.w, "h": sp.h, "desc": desc,
                            "path": f"sprites/{cat}/{name}.png"})
        sheet.save(OUT / "sheets" / f"{cat}.png")
        (OUT / "sheets" / f"{cat}.json").write_text(json.dumps(
            {"image": f"{cat}.png", "size": {"w": sw, "h": sh}, "frames": frames}, indent=1))
        manifest["categories"][cat] = entries

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (OUT / "palette.json").write_text(json.dumps(RAMPS, indent=1))
    pal = Image.new("RGBA", (5 * 8, len(RAMPS) * 8))
    for j, (name, ramp) in enumerate(RAMPS.items()):
        for i, c in enumerate(ramp):
            for yy in range(8):
                for xx in range(8):
                    pal.putpixel((i * 8 + xx, j * 8 + yy), rgba(c))
    pal.save(OUT / "palette.png")
    write_preview(manifest)
    write_inventory(manifest)
    contact_sheet(ROOT / "docs" / "contact-sheet.png")
    total = sum(len(v) for v in REGISTRY.values())
    print(f"built {total} sprites in {len(REGISTRY)} categories")


def write_preview(manifest):
    sections = []
    for cat, entries in manifest["categories"].items():
        tiles = "".join(
            f'<figure><img src="{e["path"]}" width="{e["w"]*3}" height="{e["h"]*3}" alt="{e["name"]}">'
            f'<figcaption>{e["name"]}</figcaption></figure>' for e in entries)
        sections.append(f'<section><h2>{cat} <small>{len(entries)}</small></h2><div class="grid">{tiles}</div></section>')
    swatches = "".join(
        f'<div class="ramp"><span>{n}</span>' + "".join(f'<i style="background:{c}" title="{c}"></i>' for c in r) + "</div>"
        for n, r in RAMPS.items())
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asset Gallery</title>
<style>
:root {{ --bg:#1b1430; --panel:#241944; --ink:#f1e4c3; --muted:#a6a2ad; --gold:#f5cd5b; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:14px/1.4 ui-monospace,Menlo,monospace; padding:24px 16px; }}
h1 {{ color:var(--gold); margin:0 0 4px; }} p {{ color:var(--muted); margin:0 0 24px; }}
h2 {{ text-transform:uppercase; letter-spacing:.08em; color:var(--gold); font-size:13px; border-bottom:1px solid #372a66; padding-bottom:6px; }}
h2 small {{ color:var(--muted); }}
.grid {{ display:flex; flex-wrap:wrap; gap:10px; }}
figure {{ margin:0; background:var(--panel); border:1px solid #372a66; border-radius:6px; padding:8px; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:72px; }}
img {{ image-rendering:pixelated; image-rendering:crisp-edges; }}
figcaption {{ font-size:10px; color:var(--muted); max-width:110px; text-align:center; word-break:break-all; }}
.ramp {{ display:flex; align-items:center; gap:2px; margin:2px 0; }} .ramp span {{ width:90px; color:var(--muted); font-size:11px; }}
.ramp i {{ width:22px; height:16px; display:inline-block; }}
</style></head><body>
<h1>Asset Gallery</h1><p>All sprites are generated by tools/build_assets.py. Shown at 3x.</p>
<section><h2>palette</h2>{swatches}</section>
{''.join(sections)}
</body></html>"""
    (OUT / "preview.html").write_text(html)


def write_inventory(manifest):
    lines = ["# Asset inventory", "",
             "_Auto-generated by `tools/build_assets.py`. Do not edit by hand._", ""]
    total = sum(len(v) for v in manifest["categories"].values())
    lines += [f"**{total} sprites** in {len(manifest['categories'])} categories. "
              "Paths are relative to `assets/`.", ""]
    for cat, entries in manifest["categories"].items():
        lines += [f"## {cat} ({len(entries)})", "", "| Sprite | Size | Notes |", "|---|---|---|"]
        for e in entries:
            lines.append(f"| `{e['path']}` | {e['w']}x{e['h']} | {e['desc']} |")
        lines.append("")
    (ROOT / "docs" / "asset-inventory.md").write_text("\n".join(lines))


def contact_sheet(path: Path, scale=3):
    """Single PNG of everything, for quick visual review."""
    rows = []
    for cat, sprites in REGISTRY.items():
        frames, w, h = pack(sprites, max_w=400, pad=3)
        img = Image.new("RGBA", (w, h), rgba("#2a2140"))
        for name, (sp, _) in sprites.items():
            f = frames[name]
            r = sp.render()
            img.alpha_composite(r, (f["x"], f["y"]))
        rows.append(img)
    W = max(r.width for r in rows)
    H = sum(r.height + 6 for r in rows)
    out = Image.new("RGBA", (W, H), rgba("#140f24"))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height + 6
    out.resize((W * scale, H * scale), Image.NEAREST).save(path)


if __name__ == "__main__":
    import sys
    export()
