"""
Builds one car picture per vehicle category in the PeopleTaxi style: a white car, the PeopleTaxi logo on the front door,
and a yellow number plate on the front bumper with the category name written on it.

    python make_category_cars.py <output folder>

The cars come from the generic vehicle pictures in People_Taxi/public/website-images/vehicles. The plate and the
logo are drawn in perspective so they follow the angle of the car. Real photos of the exact models are better when you
have them: stamp_car_plates.py writes the category name on the plate of any real photo.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from stamp_car_plates import plate_layer  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CARS = ROOT / "People_Taxi" / "public" / "website-images" / "vehicles"
LOGO = ROOT / "People_Taxi" / "public" / "brand" / "peopletaxi-transparent.png"

# file name, base picture, name on the plate, plate corners and logo corners (top-left, top-right, bottom-right, bottom-left)
CATEGORIES = [
    dict(file="hatchback.png", base="hatchback.png", name="HATCHBACK",
         plate=[(225, 687), (395, 710), (395, 756), (225, 733)],
         logo=[(955, 530), (1145, 520), (1145, 578), (955, 592)]),
    dict(file="sedan.png", base="sedan.png", name="SEDAN",
         plate=[(215, 676), (390, 698), (390, 742), (215, 720)],
         logo=[(930, 540), (1110, 528), (1110, 584), (930, 598)]),
    dict(file="suv-6-1.png", base="suv.png", name="SUV 6+1",
         plate=[(225, 650), (400, 672), (400, 722), (225, 700)],
         logo=[(985, 530), (1150, 515), (1150, 568), (985, 585)]),
    dict(file="suv-7-1.png", base="mpv.png", name="SUV 7+1",
         plate=[(170, 668), (345, 688), (345, 734), (170, 714)],
         logo=[(885, 520), (1075, 508), (1075, 566), (885, 578)]),
    dict(file="innova.png", base="mpv.png", name="INNOVA",
         plate=[(170, 668), (345, 688), (345, 734), (170, 714)],
         logo=[(885, 520), (1075, 508), (1075, 566), (885, 578)]),
    dict(file="innova-crysta.png", base="suv.png", name="INNOVA CRYSTA",
         plate=[(225, 650), (400, 672), (400, 722), (225, 700)],
         logo=[(985, 530), (1150, 515), (1150, 568), (985, 585)]),
]
PLATE_W, PLATE_H = 156, 46  # level plate size in picture pixels
SS = 3  # warp at this many times the size, then shrink: smooth edges


def coeffs(dst, src):
    """Perspective coefficients mapping output (dst) points back to the flat picture (src) points."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs.extend([u, v])
    return np.linalg.solve(np.array(rows, float), np.array(rhs, float)).tolist()


def grow(quad, k):
    """The same quad, scaled by k around its centre."""
    cx = sum(p[0] for p in quad) / 4
    cy = sum(p[1] for p in quad) / 4
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in quad]


def taper(quad, k=0.97, far=0.9):
    """A smaller plate that narrows toward the far (right) end, as a plate does on a car seen at an angle."""
    q = grow(quad, k)
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = q
    mid = (try_ + bry) / 2
    q[1] = (trx, mid + (try_ - mid) * far)
    q[2] = (brx, mid + (bry - mid) * far)
    return q


def place(canvas: Image.Image, flat: Image.Image, quad, shadow: float = 0.0):
    """Draws the flat RGBA picture onto the canvas so it fills the 4-corner quad, in perspective."""
    xs, ys = [p[0] for p in quad], [p[1] for p in quad]
    pad = 6
    x0, y0 = int(min(xs)) - pad, int(min(ys)) - pad
    bw, bh = int(max(xs)) - x0 + pad, int(max(ys)) - y0 + pad
    big = [((x - x0) * SS, (y - y0) * SS) for x, y in quad]
    w, h = flat.size
    c = coeffs(big, [(0, 0), (w, 0), (w, h), (0, h)])
    warped = flat.transform((bw * SS, bh * SS), Image.PERSPECTIVE, c, Image.BICUBIC)
    warped = warped.resize((bw, bh), Image.LANCZOS)
    if shadow:
        a = warped.getchannel("A").filter(ImageFilter.GaussianBlur(2.2)).point(lambda v: int(v * shadow))
        dark = Image.new("RGBA", warped.size, (20, 20, 20, 0))
        dark.putalpha(a)
        canvas.alpha_composite(dark, (x0 + 1, y0 + 4))
    canvas.alpha_composite(warped, (x0, y0))


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("car-images-with-plate")
    out.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO).convert("RGBA")
    for c in CATEGORIES:
        car = Image.open(CARS / c["base"]).convert("RGBA")
        # logo on the door
        lw = 900
        place(car, logo.resize((lw, round(lw * logo.height / logo.width)), Image.LANCZOS), grow(c["logo"], 1.2))
        # plate on the bumper
        # A straight, level plate (as on the reference car): same size everywhere, centred where the slanted guide was.
        cx = sum(p[0] for p in c["plate"]) / 4
        cy = sum(p[1] for p in c["plate"]) / 4
        pw, ph = PLATE_W, PLATE_H
        quad = [(cx - pw / 2, cy - ph / 2), (cx + pw / 2, cy - ph / 2), (cx + pw / 2, cy + ph / 2), (cx - pw / 2, cy + ph / 2)]
        place(car, plate_layer(pw * 6, ph * 6, c["name"]), quad, shadow=0.4)
        car.save(out / c["file"])
        print(f"{c['file']:<20} {c['name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
