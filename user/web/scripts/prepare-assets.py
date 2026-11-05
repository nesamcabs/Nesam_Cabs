"""Builds the web-sized brand, vehicle and illustration files in public/ and the
icon set in src/assets/icons from output/nesam-visual-assets (the NESAM asset
collection). Re-run after the collection changes:  python scripts/prepare-assets.py
"""
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parents[1] / "output" / "nesam-visual-assets"
PUB = ROOT / "public"
ICONS = ROOT / "src" / "assets" / "icons"

VEHICLE_WIDTH = 560
ILLUSTRATION_WIDTH = 640

# The illustrations the customer pages use (others in the collection are for other panels).
ILLUSTRATIONS = [
    "welcome", "phone-verification", "profile-setup", "book-journey", "choose-vehicle", "booking-confirmed",
    "driver-arriving", "journey-progress", "trip-completed", "no-trips", "no-notifications", "no-saved-places",
    "no-offers", "no-payments", "support", "account-review", "offline", "error",
]


def trim(img: Image.Image, pad_ratio: float = 0.03) -> Image.Image:
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not box:
        return img
    pad = int(max(box[2] - box[0], box[3] - box[1]) * pad_ratio)
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def resized(img: Image.Image, width: int) -> Image.Image:
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def white_to_alpha(img: Image.Image) -> Image.Image:
    """The supplied logo sits on white; turn the white into transparency so it works on any surface."""
    px = img.convert("RGB")
    out = Image.new("RGBA", px.size)
    src, dst = px.load(), out.load()
    for y in range(px.height):
        for x in range(px.width):
            r, g, b = src[x, y]
            alpha = 255 - min(r, g, b)
            if alpha == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            k = 255.0 / alpha
            dst[x, y] = tuple(max(0, min(255, round(255 - (255 - c) * k))) for c in (r, g, b)) + (alpha,)
    return out


def main() -> None:
    (PUB / "vehicles").mkdir(parents=True, exist_ok=True)
    (PUB / "art").mkdir(parents=True, exist_ok=True)
    (PUB / "brand").mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)

    for f in sorted((SRC / "vehicles").glob("*.png")):
        img = resized(trim(Image.open(f).convert("RGBA")), VEHICLE_WIDTH)
        img.save(PUB / "vehicles" / f"{f.stem}.webp", "WEBP", quality=88, method=6)

    for name in ILLUSTRATIONS:
        f = SRC / "illustrations" / "customer" / f"{name}.png"
        img = resized(trim(Image.open(f).convert("RGBA"), 0.02), ILLUSTRATION_WIDTH)
        img.save(PUB / "art" / f"{name}.webp", "WEBP", quality=86, method=6)

    logo = white_to_alpha(Image.open(SRC / "brand" / "original-logo.png"))
    logo = trim(logo, 0.04)
    side = max(logo.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2))
    square.resize((512, 512), Image.LANCZOS).save(PUB / "brand" / "logo.png", optimize=True)
    # Opaque square for the favicon / home-screen icon.
    icon = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    small = square.resize((424, 424), Image.LANCZOS)
    icon.alpha_composite(small, (44, 44))
    icon.convert("RGB").save(PUB / "brand" / "icon-512.png", optimize=True)
    icon.resize((192, 192), Image.LANCZOS).convert("RGB").save(PUB / "brand" / "icon-192.png", optimize=True)
    icon.resize((48, 48), Image.LANCZOS).convert("RGB").save(PUB / "favicon.png", optimize=True)

    for folder in ("shared", "customer"):
        for f in (SRC / "icons" / folder).glob("*.svg"):
            shutil.copyfile(f, ICONS / f.name)

    print("vehicles:", len(list((PUB / "vehicles").glob("*"))), "art:", len(list((PUB / "art").glob("*"))), "icons:", len(list(ICONS.glob("*.svg"))))


if __name__ == "__main__":
    main()
