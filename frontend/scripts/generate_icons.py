#!/usr/bin/env python3
"""Generate the PWA icons for the ArbiBot Web dashboard.

Build-time helper only (needs Pillow); the generated PNGs are committed so the
normal build has no extra dependencies:

    python3 frontend/scripts/generate_icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"

BG_TOP = (13, 18, 32)
BG_BOTTOM = (8, 11, 18)
ACCENT = (91, 140, 255)
POS = (41, 209, 131)
NEG = (255, 93, 115)
EDGE = (44, 58, 99)


def vertical_gradient(size: int) -> Image.Image:
    image = Image.new("RGB", (1, size))
    for y in range(size):
        ratio = y / max(size - 1, 1)
        image.putpixel(
            (0, y),
            tuple(
                round(BG_TOP[channel] + (BG_BOTTOM[channel] - BG_TOP[channel]) * ratio)
                for channel in range(3)
            ),
        )
    return image.resize((size, size), Image.BICUBIC).convert("RGBA")


def hexagon(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float, color, width: int) -> None:
    points = [
        (
            cx + radius * math.cos(math.radians(60 * index - 90)),
            cy + radius * math.sin(math.radians(60 * index - 90)),
        )
        for index in range(6)
    ]
    draw.polygon(points, outline=color, width=width)


def bars(draw: ImageDraw.ImageDraw, cx: float, cy: float, unit: float) -> None:
    """Two diverging price bars either side of the centre (buy low / sell high)."""
    width = unit * 0.30
    gap = unit * 0.16
    left_top = cy - unit * 0.62
    left_bottom = cy + unit * 0.30
    right_top = cy - unit * 0.30
    right_bottom = cy + unit * 0.62
    draw.rounded_rectangle(
        [cx - gap - width, left_top, cx - gap, left_bottom], radius=width / 2, fill=POS
    )
    draw.rounded_rectangle(
        [cx + gap, right_top, cx + gap + width, right_bottom], radius=width / 2, fill=NEG
    )
    # Arrow head on the right bar hinting at the exit leg.
    draw.polygon(
        [
            (cx + gap + width / 2, right_top - unit * 0.30),
            (cx + gap - unit * 0.06, right_top + unit * 0.08),
            (cx + gap + width + unit * 0.06, right_top + unit * 0.08),
        ],
        fill=NEG,
    )


def draw_icon(size: int, *, radius_ratio: float = 0.22, bleed: bool = False) -> Image.Image:
    scale = size / 512
    image = vertical_gradient(size)

    # Rounded corners for the "any" purpose icons; full bleed for maskable.
    if not bleed:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
        )
        image.putalpha(mask)

    draw = ImageDraw.Draw(image)
    cx = cy = size / 2
    hexagon(draw, cx, cy, size * 0.335, ACCENT, max(2, int(9 * scale)))
    hexagon(draw, cx, cy, size * 0.395, EDGE, max(1, int(3 * scale)))
    bars(draw, cx, cy, size * 0.30)

    # Subtle accent dot in each corner of the hexagon for a "network" feel.
    for angle in (30, 150, 270):
        px = cx + size * 0.335 * math.cos(math.radians(angle))
        py = cy + size * 0.335 * math.sin(math.radians(angle))
        r = max(2, int(7 * scale))
        draw.ellipse([px - r, py - r, px + r, py + r], fill=ACCENT)

    return image


def apple_icon(size: int = 180) -> Image.Image:
    image = draw_icon(size)
    # iOS does not like transparency in the touch icon.
    flat = Image.new("RGB", (size, size), BG_TOP)
    flat.paste(image, (0, 0), image)
    return flat


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512).save(OUT / "icon-512.png")
    draw_icon(512, radius_ratio=0.0, bleed=True).save(OUT / "icon-maskable-512.png")
    apple_icon().save(OUT / "apple-touch-icon.png")
    print("wrote:", ", ".join(sorted(path.name for path in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
