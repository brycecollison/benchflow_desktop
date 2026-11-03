"""Regenerate packaging/icon.ico (the exe and installer icon):  python packaging/make_icon.py

A rounded teal tile with a white "B", drawn with Pillow (already a dependency). The frontend's
own favicon is frontend/public/favicon.svg - this is the Windows file-icon copy of the same idea.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 256
TEAL = (13, 148, 136, 255)
OUT = Path(__file__).resolve().parent / "icon.ico"


def tile(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = size // 5
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=TEAL)
    path = None
    for candidate in ("arialbd.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            path = ImageFont.truetype(candidate, int(size * 0.62))
            break
        except OSError:
            continue
    letter = "B"
    if path is None:
        draw.text((size * 0.28, size * 0.16), letter, fill="white")
    else:
        box = draw.textbbox((0, 0), letter, font=path)
        draw.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]),
                  letter, font=path, fill="white")
    return img


img = tile(SIZE)
img.save(OUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
