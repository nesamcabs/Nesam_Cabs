"""
Writes each vehicle category's name on the yellow number plate of its car image, with a clean finished look
(soft yellow gradient, thin dark border, a little gloss, spaced and slightly embossed lettering).

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
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]
SCALE = 8  # everything is drawn this many times larger, then shrunk: smooth edges at any size


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def yellow_mask(rgba: np.ndarray) -> np.ndarray:
    r, g, b, a = (rgba[..., i].astype(int) for i in range(4))
    return (a > 200) & (r > 200) & (g > 140) & (g < 228) & (b < 95) & (r - b > 130) & (r >= g)


def find_plate(rgba: np.ndarray):
    """The biggest roughly rectangular patch of plate-yellow, as (x, y, w, h), or None."""
    h, w = rgba.shape[:2]
    mask = yellow_mask(rgba)
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


def tracked_width(font, text: str, tracking: float) -> float:
    return sum(font.getlength(c) for c in text) + tracking * (len(text) - 1)


def draw_tracked(draw, cx: float, cy: float, text: str, font, tracking: float, fill):
    """Draws text centred on (cx, cy) with a little extra space between the letters."""
    x = cx - tracked_width(font, text, tracking) / 2
    for c in text:
        draw.text((x, cy), c, font=font, fill=fill, anchor="lm")
        x += font.getlength(c) + tracking


def layout(text: str, inner_w: float, inner_h: float):
    """One or two lines, and the biggest font size (in drawing pixels) that fits."""
    words = text.split()
    options = [[text]]
    if len(words) > 1:
        mid = (len(words) + 1) // 2
        options.append([" ".join(words[:mid]), " ".join(words[mid:])])
    best = None
    for lines in options:
        size = int(min(inner_h * 0.9 / len(lines), inner_h))
        while size > 8:
            font = load_font(size)
            tracking = size * 0.07
            if max(tracked_width(font, line, tracking) for line in lines) <= inner_w:
                break
            size -= 1
        if best is None or size > best[0] * 1.15:
            best = (size, lines)
    return best


def plate_layer(w: int, h: int, text: str) -> Image.Image:
    """The finished plate, w x h pixels, RGBA: matte taxi-yellow face, thin black border, blue IND strip, embossed name."""
    W, H = w * SCALE, h * SCALE
    t = np.linspace(0, 1, H)[:, None]
    top, bottom = np.array([252, 211, 58]), np.array([243, 181, 8])
    face = (top[None, :] * (1 - t) + bottom[None, :] * t)[:, None, :].repeat(W, axis=1)
    gloss = np.clip(1 - np.linspace(0, 1, H) / 0.38, 0, 1)[:, None, None] * 0.10  # a faint sheen, not a mirror
    face = face * (1 - gloss) + 255 * gloss
    img = Image.fromarray(np.dstack([face, np.full((H, W), 255)]).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(img)
    r_out = H * 0.11

    # bevelled edge: a darker rim, then a light line just inside it
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=r_out, outline=(150, 108, 0, 255), width=max(2, int(H * 0.035)))
    draw.line([(r_out, H * 0.05), (W - r_out, H * 0.05)], fill=(255, 238, 150, 120), width=max(1, int(H * 0.018)))

    # thin black border
    inset = H * 0.09
    bw = max(2, int(H * 0.032))
    draw.rounded_rectangle([inset, inset, W - inset - 1, H - inset - 1], radius=H * 0.07, outline=(24, 24, 24, 255), width=bw)

    # blue IND strip, as on a registered plate
    sx0, sx1 = inset + bw, inset + bw + W * 0.115
    draw.rectangle([sx0, inset + bw, sx1, H - inset - bw - 1], fill=(26, 70, 160, 255))
    cx, cy, rr = (sx0 + sx1) / 2, H * 0.38, W * 0.032
    draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(255, 255, 255, 235), width=max(2, int(H * 0.018)))
    ind = load_font(int(H * 0.17))
    draw.text(((sx0 + sx1) / 2, H * 0.66), "IND", font=ind, fill=(255, 255, 255, 240), anchor="mm")

    # the name, centred in the space right of the strip
    area_x0, area_x1 = sx1 + W * 0.02, W - inset - bw - W * 0.02
    size, lines = layout(text, (area_x1 - area_x0) * 0.94, H * 0.5)
    font = load_font(size)
    tracking = size * 0.07
    line_h = size * 1.12
    mid_x = (area_x0 + area_x1) / 2
    top_y = H / 2 - (len(lines) - 1) * line_h / 2
    lift = max(2, size * 0.04)
    for i, line in enumerate(lines):
        y = top_y + i * line_h
        draw_tracked(draw, mid_x + lift, y + lift, line, font, tracking, (255, 244, 190, 150))  # light edge: embossed
        draw_tracked(draw, mid_x, y, line, font, tracking, (20, 20, 20, 255))
    return img.resize((w, h), Image.LANCZOS)


def stamp(img: Image.Image, text: str):
    rgba = np.array(img.convert("RGBA"))
    plate = find_plate(rgba)
    if plate is None:
        return img, False
    x, y, w, h = plate
    pad = 2  # catch the plate's soft edge
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(rgba.shape[1], x + w + pad), min(rgba.shape[0], y + h + pad)
    bw, bh = x1 - x0, y1 - y0

    # Only the plate's own pixels are painted: its edges (and any slant) stay exactly as in the picture.
    region = yellow_mask(rgba[y0:y1, x0:x1])
    mask = Image.fromarray((region * 255).astype(np.uint8), "L")
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))

    layer = plate_layer(bw, bh, text)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    out = img.convert("RGBA")
    out.alpha_composite(layer, (x0, y0))
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
        out, ok = stamp(Image.open(path), text)
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
