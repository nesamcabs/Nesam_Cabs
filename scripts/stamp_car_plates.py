"""
Writes each vehicle category's name on the yellow number plate of its car image.

    python stamp_car_plates.py <input folder> <output folder> [--names names.json]

Every image in the input folder (png, jpg, webp) is copied to the output folder with the name written on the plate.
The originals are never changed. The name is the file name without its extension, in capitals, unless names.json says
otherwise, for example:  { "wagon-r.webp": "HATCHBACK", "innova.webp": "MPV XL" }

An image with no yellow plate is copied unchanged and listed at the end.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def find_plate(rgba: np.ndarray):
    """The biggest roughly rectangular patch of plate-yellow, as (x, y, w, h), or None."""
    h, w = rgba.shape[:2]
    r, g, b, a = (rgba[..., i].astype(int) for i in range(4))
    mask = (a > 200) & (r > 200) & (g > 140) & (g < 228) & (b < 95) & (r - b > 130) & (r >= g)
    if mask.sum() > 0.25 * w * h:  # a yellow car, not a plate
        return None
    seen = np.zeros_like(mask)
    min_area = max(60, w * h * 0.00015)
    best = None
    for sy, sx in np.argwhere(mask):
        if seen[sy, sx]:
            continue
        stack = [(sy, sx)]
        seen[sy, sx] = True
        x0 = x1 = sx
        y0 = y1 = sy
        area = 0
        while stack:
            y, x = stack.pop()
            area += 1
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        aspect, fill = bw / bh, area / (bw * bh)
        if area >= min_area and 1.5 <= aspect <= 7 and fill >= 0.5 and (best is None or area > best[4]):
            best = (int(x0), int(y0), int(bw), int(bh), area)
    return best[:4] if best else None


def layout(text: str, plate_w: int, plate_h: int, scale: int):
    """Picks one or two lines and the biggest font size that fits the plate."""
    words = text.split()
    options = [[text]]
    if len(words) > 1:
        mid = (len(words) + 1) // 2
        options.append([" ".join(words[:mid]), " ".join(words[mid:])])
    best = None
    for lines in options:
        size = int(min(plate_h * 0.62, plate_h * 0.8 / len(lines)) * scale)
        while size > 6:
            font = load_font(size)
            widest = max(font.getlength(line) for line in lines)
            if widest <= plate_w * 0.86 * scale:
                break
            size -= 1
        if best is None or size > best[0] * 1.15:
            best = (size, lines)
    return best


def stamp(img: Image.Image, text: str):
    rgba = np.array(img.convert("RGBA"))
    plate = find_plate(rgba)
    if plate is None:
        return img, False
    x, y, w, h = plate
    scale = 6  # draw large, then shrink: smooth edges at any size
    size, lines = layout(text, w, h, scale)
    font = load_font(size)
    layer = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    line_h = size * 1.08
    top = h * scale / 2 - (len(lines) - 1) * line_h / 2
    for i, line in enumerate(lines):
        draw.text((w * scale / 2, top + i * line_h), line, font=font, fill=(28, 28, 28, 255), anchor="mm")
    layer = layer.resize((w, h), Image.LANCZOS)
    out = img.convert("RGBA")
    out.alpha_composite(layer, (x, y))
    return out, True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--names", help="JSON file: { 'file name': 'TEXT FOR THE PLATE' }")
    args = ap.parse_args()
    names = json.loads(Path(args.names).read_text(encoding="utf-8")) if args.names else {}
    src, dst = Path(args.input), Path(args.output)
    dst.mkdir(parents=True, exist_ok=True)
    missing = []
    for path in sorted(src.iterdir()):
        if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        text = str(names.get(path.name) or path.stem.replace("-", " ").replace("_", " ")).strip().upper()
        img = Image.open(path)
        out, ok = stamp(img, text)
        target = dst / path.name
        if path.suffix.lower() in (".jpg", ".jpeg"):
            out.convert("RGB").save(target, quality=92)
        elif path.suffix.lower() == ".webp":
            out.save(target, quality=90)
        else:
            out.save(target)
        print(("stamped  " if ok else "NO PLATE ") + f"{path.name}  ->  {text if ok else '(unchanged)'}")
        if not ok:
            missing.append(path.name)
    if missing:
        print("\nNo yellow number plate found in: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
