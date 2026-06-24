"""One-off: generate Juile's logo — a blue, pixelated, gradient, black-weight 'J'
on a dark rounded tile. Writes web/logo.png (256) and web/juile.ico (multi-size).
Run once with the project venv; safe to delete afterward."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WEB = Path(__file__).resolve().parent / "web"
SIZE = 256
GRID = 26                      # logical pixels across -> chunky blocks
NAVY = (10, 24, 48, 255)       # tile background (matches app --bg)


def load_black_font(px):
    # Prefer a genuinely black/heavy weight; fall back through bold faces.
    for name in ("ariblk.ttf", "seguibl.ttf", "segoeuib.ttf", "arialbd.ttf", "Inter-Black.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except Exception:
            continue
    try:
        return ImageFont.truetype("arial.ttf", px)
    except Exception:
        return ImageFont.load_default()


def glyph_mask(letter="J"):
    """Render the letter big and centered, then return a GRID×GRID 1-bit-ish mask."""
    hi = 512
    img = Image.new("L", (hi, hi), 0)
    d = ImageDraw.Draw(img)
    font = load_black_font(int(hi * 0.92))
    # measure + center (slightly raised; J descends well)
    box = d.textbbox((0, 0), letter, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (hi - w) / 2 - box[0]
    y = (hi - h) / 2 - box[1] - hi * 0.02
    d.text((x, y), letter, fill=255, font=font)
    # pixelate: shrink to GRID with NEAREST so blocks are crisp
    small = img.resize((GRID, GRID), Image.NEAREST)
    return small.point(lambda v: 255 if v > 90 else 0)


def gradient(size):
    """Vertical blue -> deep blue -> near-black gradient (top to bottom)."""
    top, mid, bot = (123, 200, 255), (37, 120, 255), (8, 22, 60)
    g = Image.new("RGB", (size, size))
    px = g.load()
    for yy in range(size):
        t = yy / (size - 1)
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(top[i] + (mid[i] - top[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * k) for i in range(3))
        for xx in range(size):
            px[xx, yy] = c
    return g


def rounded_tile(size, radius, color):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return tile


def build():
    cell = SIZE // GRID
    inner = cell * GRID
    mask = glyph_mask("J")
    grad = gradient(inner)

    # blocky letter: paint each filled grid cell with the gradient, leave a thin gap
    letter = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    gpx = grad.load()
    ld = ImageDraw.Draw(letter)
    gap = max(1, cell // 12)
    for gy in range(GRID):
        for gx in range(GRID):
            if mask.getpixel((gx, gy)):
                cx, cy = gx * cell, gy * cell
                r, g, b = gpx[min(inner - 1, cx + cell // 2), min(inner - 1, cy + cell // 2)]
                ld.rectangle([cx + gap, cy + gap, cx + cell - gap, cy + cell - gap],
                             fill=(r, g, b, 255))

    tile = rounded_tile(SIZE, SIZE // 5, NAVY)
    off = (SIZE - inner) // 2
    tile.alpha_composite(letter, (off, off))

    WEB.mkdir(exist_ok=True)
    tile.save(WEB / "logo.png")
    # transparent (no tile) variant for in-app marks on glass
    glass = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glass.alpha_composite(letter, (off, off))
    glass.save(WEB / "logo_glyph.png")
    tile.save(WEB / "juile.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", WEB / "logo.png", WEB / "logo_glyph.png", WEB / "juile.ico")


if __name__ == "__main__":
    build()
