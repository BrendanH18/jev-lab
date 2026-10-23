#!/usr/bin/env python3
"""Draw the sample pictures used by the Claims demo, Autopilot, and the Workbench.

    python3 scripts/draw_samples.py        # writes static/img/samples/*.png

The pictures are simple illustrations drawn with the standard library, so the repository holds
no third-party photos. They are deliberately plain: real photos are a better test of the model.
Output is deterministic; rerun after changing a scene and commit the PNGs with the script.
"""

from __future__ import annotations

import math
import random
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "img" / "samples"
W, H = 640, 480
SS = 2  # supersampling factor for smooth edges


class Canvas:
    def __init__(self, w: int, h: int, color):
        self.w, self.h = w * SS, h * SS
        self.px = bytearray(bytes(color) * (self.w * self.h))

    def _span(self, y: int, x0: float, x1: float, color, alpha: float) -> None:
        a = max(0, int(math.ceil(x0 - 0.5)))
        b = min(self.w - 1, int(math.floor(x1 - 0.5)))
        if b < a:
            return
        row = y * self.w * 3
        if alpha >= 1:
            self.px[row + a * 3:row + (b + 1) * 3] = bytes(color) * (b - a + 1)
            return
        for x in range(a, b + 1):
            i = row + x * 3
            for c in range(3):
                self.px[i + c] = int(self.px[i + c] * (1 - alpha) + color[c] * alpha)

    def polygon(self, points, color, alpha: float = 1.0) -> None:
        pts = [(x * SS, y * SS) for x, y in points]
        ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(self.h, int(max(ys)) + 1)):
            sy = y + 0.5
            xs = []
            for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
                if (y0 <= sy < y1) or (y1 <= sy < y0):
                    xs.append(x0 + (sy - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                self._span(y, xs[i], xs[i + 1], color, alpha)

    def rect(self, x0, y0, x1, y1, color, alpha: float = 1.0) -> None:
        self.polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], color, alpha)

    def ellipse(self, cx, cy, rx, ry, color, angle: float = 0.0, alpha: float = 1.0, n: int = 28) -> None:
        ca, sa = math.cos(angle), math.sin(angle)
        pts = []
        for i in range(n):
            t = 2 * math.pi * i / n
            x, y = rx * math.cos(t), ry * math.sin(t)
            pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
        self.polygon(pts, color, alpha)

    def line(self, x0, y0, x1, y1, width, color, alpha: float = 1.0) -> None:
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy) or 1
        nx, ny = -dy / length * width / 2, dx / length * width / 2
        self.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], color, alpha)

    def vgradient(self, y0, y1, top, bottom) -> None:
        for y in range(int(y0), int(y1)):
            t = (y - y0) / max(1, y1 - y0 - 1)
            self.rect(0, y, W, y + 1, tuple(int(top[c] + (bottom[c] - top[c]) * t) for c in range(3)))

    def png(self) -> bytes:
        w, h = self.w // SS, self.h // SS
        rows = []
        for y in range(h):
            row = bytearray(b"\x00")
            for x in range(w):
                acc = [0, 0, 0]
                for dy in range(SS):
                    base = ((y * SS + dy) * self.w + x * SS) * 3
                    for dx in range(SS):
                        i = base + dx * 3
                        acc[0] += self.px[i]
                        acc[1] += self.px[i + 1]
                        acc[2] += self.px[i + 2]
                n = SS * SS
                row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
            rows.append(bytes(row))

        def chunk(kind: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

        header = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
                + chunk(b"IEND", b""))


# --- shared scenery ---------------------------------------------------------------------------

WALL_TOP, WALL_BOTTOM = (236, 231, 222), (214, 206, 193)
WOOD_TOP, WOOD_BOTTOM = (171, 124, 82), (139, 96, 60)
KRAFT, KRAFT_DARK, KRAFT_LIGHT = (196, 160, 112), (160, 124, 80), (214, 184, 140)
BEAN, BEAN_DARK = (92, 56, 34), (58, 34, 20)


def counter(c: Canvas, rng: random.Random, horizon: int = 300) -> None:
    c.vgradient(0, horizon, WALL_TOP, WALL_BOTTOM)
    c.vgradient(horizon, H, WOOD_TOP, WOOD_BOTTOM)
    c.rect(0, horizon - 3, W, horizon + 2, (120, 84, 52))
    for _ in range(26):  # wood grain
        y = rng.uniform(horizon + 8, H)
        c.line(0, y, W, y + rng.uniform(-6, 6), rng.uniform(0.6, 1.6), (118, 80, 48), alpha=0.35)


def bean(c: Canvas, x: float, y: float, rng: random.Random, scale: float = 1.0) -> None:
    angle = rng.uniform(0, math.pi)
    rx, ry = 7.5 * scale, 5.2 * scale
    c.ellipse(x + 1.5, y + 2, rx, ry, (90, 62, 40), angle, alpha=0.35)  # shadow
    c.ellipse(x, y, rx, ry, BEAN if rng.random() < 0.7 else (110, 68, 40), angle)
    ca, sa = math.cos(angle), math.sin(angle)
    c.line(x - rx * 0.7 * ca, y - rx * 0.7 * sa, x + rx * 0.7 * ca, y + rx * 0.7 * sa, 1.4 * scale, BEAN_DARK)


def coffee_bag(c: Canvas, x: int, y: int, w: int = 190, h: int = 250) -> None:
    """A kraft stand-up pouch with a folded, sealed top and a round label."""
    c.ellipse(x + w / 2 + 8, y + h + 4, w / 2 + 18, 14, (95, 64, 40), alpha=0.45)  # contact shadow
    c.polygon([(x, y + 40), (x + w, y + 40), (x + w + 8, y + h), (x - 8, y + h)], KRAFT)
    c.polygon([(x + w * 0.72, y + 40), (x + w, y + 40), (x + w + 8, y + h), (x + w * 0.76, y + h)], KRAFT_DARK, alpha=0.45)
    c.rect(x - 2, y, x + w + 2, y + 44, KRAFT_LIGHT)  # folded top
    c.rect(x - 2, y + 30, x + w + 2, y + 36, (150, 112, 70))  # heat seal
    for i in range(12):
        c.line(x + 4 + i * (w - 8) / 11, y + 4, x + 4 + i * (w - 8) / 11, y + 26, 1.0, (180, 146, 100), alpha=0.6)
    cx, cy = x + w / 2, y + 130
    c.ellipse(cx, cy, 58, 58, (247, 243, 235))
    c.ellipse(cx, cy, 52, 52, (38, 70, 88))
    c.ellipse(cx, cy - 4, 18, 26, (247, 243, 235), angle=0.5)
    c.line(cx - 10, cy - 24, cx + 8, cy + 16, 3, (38, 70, 88))
    c.rect(cx - 50, cy + 72, cx + 50, cy + 80, (120, 88, 56), alpha=0.6)  # printed lines
    c.rect(cx - 36, cy + 88, cx + 36, cy + 94, (120, 88, 56), alpha=0.5)


# --- scenes -----------------------------------------------------------------------------------


def torn_bag(rng: random.Random) -> Canvas:
    c = Canvas(W, H, WALL_TOP)
    counter(c, rng)
    x, y = 220, 150
    coffee_bag(c, x, y)
    # The seal is ripped open across the top right: a jagged dark gap with torn flaps.
    tear = [(x + 70, y + 26), (x + 92, y + 46), (x + 108, y + 32), (x + 126, y + 58), (x + 146, y + 40),
            (x + 166, y + 66), (x + 196, y + 52), (x + 198, y + 92), (x + 170, y + 104), (x + 150, y + 86),
            (x + 128, y + 108), (x + 104, y + 88), (x + 84, y + 98)]
    c.polygon(tear, (52, 34, 22))
    c.polygon([(x + 150, y + 86), (x + 170, y + 104), (x + 214, y + 82), (x + 206, y + 66)], KRAFT_LIGHT)
    c.polygon([(x + 84, y + 98), (x + 104, y + 88), (x + 92, y + 124), (x + 74, y + 118)], KRAFT_DARK)
    for _ in range(14):  # beans visible inside the gap
        bean(c, rng.uniform(x + 98, x + 180), rng.uniform(y + 66, y + 98), rng, 0.9)
    for _ in range(70):  # spilled down the side and across the counter
        side = rng.random()
        if side < 0.35:
            bx, by = rng.uniform(x + 196, x + 250), rng.uniform(y + 120, y + 250)
        else:
            bx, by = rng.gauss(x + 260, 70), rng.uniform(y + 245, H - 30)
        bean(c, bx, by, rng)
    return c


def intact_bag(rng: random.Random) -> Canvas:
    c = Canvas(W, H, WALL_TOP)
    counter(c, rng)
    coffee_bag(c, 220, 150)
    c.ellipse(500, 420, 46, 12, (95, 64, 40), alpha=0.4)  # a mug beside it, for scale
    c.rect(462, 340, 538, 418, (232, 228, 220))
    c.ellipse(500, 340, 38, 9, (70, 44, 28))
    c.ellipse(548, 378, 18, 22, (232, 228, 220))
    c.ellipse(548, 378, 10, 14, (190, 168, 140))
    return c


def crushed_box(rng: random.Random) -> Canvas:
    c = Canvas(W, H, WALL_TOP)
    counter(c, rng, horizon=270)
    card, side, top = (196, 156, 104), (168, 128, 82), (214, 178, 128)
    c.ellipse(330, 425, 210, 24, (95, 64, 40), alpha=0.45)
    front = [(150, 210), (420, 210), (420, 420), (150, 420)]
    right = [(420, 210), (520, 150), (520, 350), (420, 420)]
    lid = [(150, 210), (250, 150), (520, 150), (420, 210)]
    c.polygon(front, card)
    c.polygon(right, side)
    c.polygon(lid, top)
    c.polygon([(270, 210), (300, 210), (400, 150), (370, 150)], (150, 128, 96), alpha=0.85)  # tape
    c.rect(270, 210, 300, 290, (150, 128, 96), alpha=0.85)
    # Crushed front-right corner: the edge caves in, with creases and torn card.
    dent = [(330, 210), (420, 210), (470, 180), (452, 250), (420, 300), (396, 262), (360, 236)]
    c.polygon(dent, (122, 88, 54))
    c.polygon([(360, 236), (396, 262), (420, 300), (404, 312), (376, 280), (346, 252)], (146, 108, 68))
    c.polygon([(420, 210), (470, 180), (452, 250)], (98, 70, 44))
    creases = [(330, 210, 360, 236), (360, 236, 420, 300), (420, 300, 452, 250), (470, 180, 420, 210),
               (396, 262, 452, 250), (376, 280, 430, 330)]
    for x0, y0, x1, y1 in creases:
        c.line(x0, y0, x1, y1, 2.2, (84, 58, 36))
    c.polygon([(420, 300), (436, 312), (424, 330), (414, 316)], (232, 214, 186))  # torn flap
    c.rect(180, 320, 300, 390, (247, 243, 235))  # shipping label
    for i in range(5):
        c.rect(192, 332 + i * 11, 288 - (i % 2) * 30, 337 + i * 11, (120, 120, 120))
    return c


def grinder_ok(rng: random.Random) -> Canvas:
    c = Canvas(W, H, WALL_TOP)
    counter(c, rng, horizon=320)
    body, body_dark, steel = (54, 58, 64), (36, 39, 44), (178, 182, 188)
    cx = 320
    c.ellipse(cx + 10, 452, 120, 16, (90, 62, 40), alpha=0.45)
    c.rect(cx - 105, 400, cx + 105, 448, body_dark)  # base
    c.polygon([(cx - 80, 220), (cx + 80, 220), (cx + 95, 404), (cx - 95, 404)], body)
    c.polygon([(cx + 40, 220), (cx + 80, 220), (cx + 95, 404), (cx + 52, 404)], body_dark, alpha=0.5)
    c.rect(cx - 60, 330, cx + 60, 392, (28, 30, 34))  # grounds bin
    c.rect(cx - 56, 334, cx + 56, 346, (70, 74, 80))
    c.ellipse(cx + 66, 280, 13, 13, steel)  # dial
    c.ellipse(cx + 66, 280, 7, 7, (120, 124, 130))
    c.rect(cx - 52, 206, cx + 52, 224, steel)  # collar
    # Clear, intact hopper with beans inside.
    hopper = [(cx - 52, 206), (cx + 52, 206), (cx + 92, 70), (cx - 92, 70)]
    c.polygon(hopper, (210, 220, 226), alpha=0.55)
    for _ in range(120):
        t = rng.uniform(0, 1)
        y = 200 - t * 100
        half = 50 + t * 34
        bean(c, rng.uniform(cx - half + 8, cx + half - 8), y, rng, 0.85)
    c.polygon(hopper, (240, 246, 250), alpha=0.18)
    c.line(cx - 92, 70, cx - 52, 206, 3, (150, 160, 168))
    c.line(cx + 92, 70, cx + 52, 206, 3, (150, 160, 168))
    c.line(cx - 70, 92, cx - 44, 186, 5, (255, 255, 255), alpha=0.45)  # glare
    c.rect(cx - 96, 56, cx + 96, 72, (40, 42, 46))  # lid
    c.ellipse(cx, 56, 22, 6, (60, 62, 66))
    return c


SCENES = {"torn-bag": torn_bag, "intact-bag": intact_bag, "crushed-box": crushed_box, "grinder-ok": grinder_ok}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw in SCENES.items():
        data = draw(random.Random(name)).png()
        (OUT / ("%s.png" % name)).write_bytes(data)
        print("wrote %s (%d KB)" % ((OUT / ("%s.png" % name)).relative_to(ROOT), len(data) // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
