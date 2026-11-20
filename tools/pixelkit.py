"""pixelkit — a tiny pixel-art engine.

Sprites are built from *parts*. Each part has a material (a 5-tone colour ramp)
and a shading mode. At render time every pixel is lit automatically:

  bevel   light top/left edge, dark bottom/right edge, base inside (raised)
  inset   the opposite of bevel (sunken panels)
  sphere  soft radial lighting from the top-left (coins, gems, dice domes)
  flat    a single tone (details, engravings, text)

Outlines are "sel-out": the ring around a part uses the darkest tone of that
part's own material instead of pure black, which is the warm, soft look of
classic 2000s Korean MMO sprites and modern HD pixel tactics games.

Tone index: 0 outline/darkest, 1 shadow, 2 base, 3 light, 4 highlight.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from PIL import Image

RAMPS: dict[str, list[str]] = {
    "gold":      ["#3d220d", "#9a5b16", "#d9952a", "#f5cd5b", "#fff3b0"],
    "silver":    ["#2a2c3d", "#5f6680", "#9aa2bd", "#d3d9ea", "#ffffff"],
    "copper":    ["#3f1c12", "#87401f", "#c46a38", "#e89a5e", "#f9cfa3"],
    "ruby":      ["#3a0c1c", "#86192f", "#cf3446", "#f2687a", "#ffc1c8"],
    "emerald":   ["#0d2e22", "#1b6a43", "#2fa864", "#6edd8c", "#c9f7d2"],
    "sapphire":  ["#0f1a40", "#22408e", "#3a72d0", "#70adf2", "#c8e8ff"],
    "amethyst":  ["#26103c", "#552781", "#8c4cc2", "#bf89ea", "#efd8ff"],
    "topaz":     ["#3f2a05", "#8f6a0e", "#d6b021", "#f4dd5e", "#fff8c2"],
    "parchment": ["#4f3a2a", "#a08262", "#d8c29c", "#f1e4c3", "#fffaf0"],
    "wood":      ["#2e1a10", "#5e3a24", "#8f5d38", "#bf8752", "#e3b27a"],
    "stone":     ["#25232c", "#4c4955", "#76727f", "#a6a2ad", "#d6d2da"],
    "iron":      ["#0f0e14", "#25242f", "#3f3e50", "#646380", "#9998b4"],
    "ivory":     ["#4a4034", "#8c7f6c", "#cfc4ae", "#eee6d4", "#ffffff"],
    "pink":      ["#52203a", "#9e4569", "#df7b9d", "#f6afc6", "#ffe3ee"],
    "skin":      ["#4f2b22", "#9c5f48", "#e0a283", "#f7d0b2", "#fff1e2"],
    "orange":    ["#4a1d0c", "#973f18", "#de7528", "#f6a650", "#ffdca5"],
    "glass":     ["#1c3048", "#3f6b94", "#7fb2dc", "#bfe3f7", "#ffffff"],
    "grass":     ["#12301c", "#2a6232", "#4f9a3e", "#86c656", "#c8ec8a"],
    "sand":      ["#4d3b1f", "#96773f", "#d1b06a", "#ecd398", "#fff1c9"],
    "water":     ["#0e2140", "#1d4b80", "#2f7cbf", "#64b3e6", "#bfe8ff"],
    "night":     ["#120c22", "#241944", "#372a66", "#51408f", "#7d6bb8"],
    "hair":      ["#24130c", "#4d2a18", "#7a4426", "#a8683a", "#d49a5e"],
    "blonde":    ["#4a3210", "#9a6e22", "#d9a83e", "#f2d27a", "#fff0bf"],
}

N4 = ((0, -1), (-1, 0), (1, 0), (0, 1))


def rgba(hex_colour: str) -> tuple[int, int, int, int]:
    h = hex_colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255


@dataclass
class Part:
    mat: str
    mode: str = "bevel"        # bevel | inset | sphere | flat
    outline: str | bool = "outer"  # "outer" (vs transparent), "all" (also over lower parts), False
    tone: int | None = None    # forces a single tone


class Sprite:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.pid = [[0] * w for _ in range(h)]
        self.parts: list[Part | None] = [None]
        self.pixel_tone: dict[tuple[int, int], int] = {}

    # ------------------------------------------------------------- parts ---
    def part(self, mat: str, mode: str = "bevel", outline: str | bool = "outer",
             tone: int | None = None) -> int:
        if mat not in RAMPS:
            raise KeyError(mat)
        self.parts.append(Part(mat, "flat" if tone is not None else mode, outline, tone))
        return len(self.parts) - 1

    def plot(self, x: int, y: int, pid: int, tone: int | None = None) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.pid[y][x] = pid
            if tone is not None:
                self.pixel_tone[(x, y)] = tone
            else:
                self.pixel_tone.pop((x, y), None)

    def erase(self, x: int, y: int) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.pid[y][x] = 0
            self.pixel_tone.pop((x, y), None)

    def fill(self, pts, mat: str, **kw) -> int:
        p = self.part(mat, **kw)
        for x, y in pts:
            self.plot(x, y, p)
        return p

    # ------------------------------------------------------------ shapes ---
    def rect(self, x, y, w, h, mat, round_corners=False, **kw) -> int:
        pts = []
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                corner = xx in (x, x + w - 1) and yy in (y, y + h - 1)
                if round_corners and corner:
                    continue
                pts.append((xx, yy))
        return self.fill(pts, mat, **kw)

    def circle(self, cx, cy, r, mat, **kw) -> int:
        pts = [(x, y) for y in range(self.h) for x in range(self.w)
               if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r]
        return self.fill(pts, mat, **kw)

    def ellipse(self, cx, cy, rx, ry, mat, **kw) -> int:
        pts = [(x, y) for y in range(self.h) for x in range(self.w)
               if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1]
        return self.fill(pts, mat, **kw)

    def ring(self, cx, cy, r_in, r_out, mat, **kw) -> int:
        pts = []
        for y in range(self.h):
            for x in range(self.w):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if r_in <= d <= r_out:
                    pts.append((x, y))
        return self.fill(pts, mat, **kw)

    def poly(self, points, mat, **kw) -> int:
        def inside(px, py):
            hit = False
            j = len(points) - 1
            for i in range(len(points)):
                xi, yi = points[i]
                xj, yj = points[j]
                if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                    hit = not hit
                j = i
            return hit
        pts = [(x, y) for y in range(self.h) for x in range(self.w) if inside(x + 0.5, y + 0.5)]
        return self.fill(pts, mat, **kw)

    def star(self, cx, cy, r_out, r_in, mat, n=5, rot=-math.pi / 2, **kw) -> int:
        pts = []
        for i in range(n * 2):
            r = r_out if i % 2 == 0 else r_in
            a = rot + i * math.pi / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        return self.poly(pts, mat, **kw)

    def line(self, x0, y0, x1, y1, mat, width=1, **kw) -> int:
        pts = set()
        steps = max(abs(x1 - x0), abs(y1 - y0)) or 1
        for i in range(steps + 1):
            x = round(x0 + (x1 - x0) * i / steps)
            y = round(y0 + (y1 - y0) * i / steps)
            for dx in range(width):
                for dy in range(width):
                    pts.add((x + dx, y + dy))
        return self.fill(sorted(pts), mat, **kw)

    def ascii(self, rows: list[str], legend: dict, ox: int = 0, oy: int = 0) -> dict[str, int]:
        """Draw a character map. legend: char -> (mat, opts dict). Parts are
        created in legend order, so later entries sit 'above' earlier ones."""
        ids = {}
        for ch, spec in legend.items():
            mat, opts = (spec, {}) if isinstance(spec, str) else spec
            ids[ch] = self.part(mat, **opts)
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in ids:
                    self.plot(ox + x, oy + y, ids[ch])
        return ids

    def glyph(self, rows: list[str], x: int, y: int, mat: str, tone: int = 0,
              outline: str | bool = False, flip: bool = False, bold: bool = False) -> int:
        if flip:
            rows = [r[::-1] for r in rows[::-1]]
        p = self.part(mat, tone=tone, outline=outline)
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == "#":
                    self.plot(x + i, y + j, p)
                    if bold:
                        self.plot(x + i + 1, y + j, p)
        return p

    def stamp(self, other: "Sprite", ox: int, oy: int, outline: str | bool | None = "all",
              recolor: dict[str, str] | None = None) -> None:
        """Copy another sprite's parts onto this one (new part ids, same look)."""
        remap = {0: 0}
        for i, part in enumerate(other.parts):
            if part is None:
                continue
            out = part.outline
            if out == "outer" and outline is not None:
                out = outline
            mat = (recolor or {}).get(part.mat, part.mat)
            self.parts.append(Part(mat, part.mode, out, part.tone))
            remap[i] = len(self.parts) - 1
        for y in range(other.h):
            for x in range(other.w):
                q = other.pid[y][x]
                if q:
                    self.plot(ox + x, oy + y, remap[q], other.pixel_tone.get((x, y)))

    # ------------------------------------------------------------ render ---
    def _bboxes(self):
        boxes: dict[int, list[int]] = {}
        for y in range(self.h):
            for x in range(self.w):
                q = self.pid[y][x]
                if q:
                    b = boxes.setdefault(q, [x, y, x, y])
                    b[0], b[1] = min(b[0], x), min(b[1], y)
                    b[2], b[3] = max(b[2], x), max(b[3], y)
        return boxes

    def _same(self, x, y, q):
        return 0 <= x < self.w and 0 <= y < self.h and self.pid[y][x] == q

    def tone_at(self, x, y, boxes) -> int:
        q = self.pid[y][x]
        part = self.parts[q]
        if (x, y) in self.pixel_tone:
            return self.pixel_tone[(x, y)]
        if part.tone is not None:
            return part.tone
        up, left = self._same(x, y - 1, q), self._same(x - 1, y, q)
        down, right = self._same(x, y + 1, q), self._same(x + 1, y, q)
        if part.mode == "flat":
            return 2
        if part.mode in ("bevel", "inset"):
            lit = not up or not left
            dark = not down or not right
            if part.mode == "inset":
                lit, dark = dark, lit
            if lit and not dark:
                return 4 if (not up and not left) else 3
            if dark and not lit:
                return 1
            return 2
        if part.mode == "sphere":
            x0, y0, x1, y1 = boxes[q]
            cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
            rx, ry = max((x1 - x0 + 1) / 2, 1), max((y1 - y0 + 1) / 2, 1)
            nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            r = min(math.hypot(nx, ny), 1.0)
            light = -(nx * 0.55 + ny * 0.75)
            v = light * 0.85 + (1 - r) * 0.45
            if not down or not right:
                return 1
            if v > 0.78:
                return 4
            if v > 0.25:
                return 3
            if v > -0.25:
                return 2
            return 1
        return 2

    def render(self, scale: int = 1) -> Image.Image:
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = img.load()
        boxes = self._bboxes()
        for y in range(self.h):
            for x in range(self.w):
                q = self.pid[y][x]
                # outline ring of any higher part that wants one
                ring_part = 0
                for dx, dy in N4:
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.w and 0 <= ny < self.h):
                        continue
                    n = self.pid[ny][nx]
                    if n and n > q and n != q:
                        o = self.parts[n].outline
                        if (o == "all") or (o == "outer" and q == 0):
                            ring_part = max(ring_part, n)
                if ring_part:
                    px[x, y] = rgba(RAMPS[self.parts[ring_part].mat][0])
                    continue
                if q == 0:
                    continue
                t = self.tone_at(x, y, boxes)
                px[x, y] = rgba(RAMPS[self.parts[q].mat][t])
        if scale != 1:
            img = img.resize((self.w * scale, self.h * scale), Image.NEAREST)
        return img
