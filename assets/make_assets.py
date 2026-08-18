"""Generates the two images the page used to build at runtime, stdlib only.

Both used to be drawn into a canvas and turned into data URLs on every single
new tab — about 28 ms of blocking main-thread work per tab, plus a fresh decode
per tab because a data URL is a new resource every time. As files they are
decoded once and shared across every open tab by Chrome's image cache.

  refract-map.png  the SVG displacement map behind the glass edge refraction.
                   256 instead of the old 512: feDisplacementMap shifts by
                   scale*(ch/255 - 0.5), so at the default scale of 42 the
                   quantisation error is 0.33 px worst case, i.e. sub-pixel.
                   Written as RGB — feDisplacementMap only reads R and G.

  grain.png        the film-grain tile, unchanged at 220 so it still lines up
                   with `background-size: 220px` in base.css. Written as 8-bit
                   GREYSCALE rather than RGBA: the pixels were always r=g=b,
                   and one channel instead of four is a straight 4x saving on
                   a source that cannot be compressed (it is random noise).

Run:  python assets/make_assets.py
"""
import math, os, random, struct, zlib

OUT = os.path.dirname(os.path.abspath(__file__))

# Fixed seed so rebuilding produces a byte-identical file rather than churning
# 48 KB of noise through git every time someone runs this.
GRAIN_SEED = 0x1F5C

BAND, POWER = 0.14, 2.0          # must match the look the canvas version had


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def filter_scanlines(rows, bpp):
    """Per-row adaptive filtering, picked by the standard minimum-sum-of-
    absolute-differences heuristic. The refraction map is a smooth gradient
    whose rows barely differ, so `Up` reduces most of it to runs of zero and
    the file drops several-fold. Noise is incompressible either way, but the
    heuristic costs nothing and correctly settles on `None` there."""
    out = bytearray()
    prev = bytes(len(rows[0]))
    for row in rows:
        best, best_score = None, None
        for ftype in range(5):
            cand = bytearray(len(row))
            for i, x in enumerate(row):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                if ftype == 0:   cand[i] = x
                elif ftype == 1: cand[i] = (x - a) & 0xFF
                elif ftype == 2: cand[i] = (x - b) & 0xFF
                elif ftype == 3: cand[i] = (x - ((a + b) >> 1)) & 0xFF
                else:            cand[i] = (x - _paeth(a, b, c)) & 0xFF
            # signed-byte magnitude, the heuristic libpng uses
            score = sum(v if v < 128 else 256 - v for v in cand)
            if best_score is None or score < best_score:
                best, best_score, best_type = cand, score, ftype
        out.append(best_type)
        out.extend(best)
        prev = row
    return bytes(out)


def write_png(path, width, height, rows, color_type, bit_depth=8):
    bpp = {0: 1, 2: 3, 6: 4}[color_type]
    raw = filter_scanlines(rows, bpp)
    ihdr = struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", os.path.basename(path), len(png), "bytes")


def refraction_map(n=256, band=BAND, power=POWER):
    """Red encodes horizontal sampling offset, green vertical (128 = no shift).

    Near a panel edge the sample bends outward, which is what makes the
    backdrop stretch and bloom like thick glass rather than frosted plastic.
    """
    # The red channel depends only on x, so build one row of it up front.
    reds = []
    for x in range(n):
        u = x / (n - 1)
        dx_edge = min(u, 1 - u)
        fx = pow(1 - dx_edge / band, power) if dx_edge < band else 0.0
        reds.append(round(128 + (1 if u < 0.5 else -1) * fx * 127))

    rows = []
    for y in range(n):
        v = y / (n - 1)
        dy_edge = min(v, 1 - v)
        fy = pow(1 - dy_edge / band, power) if dy_edge < band else 0.0
        g = round(128 + (1 if v < 0.5 else -1) * fy * 127)
        row = bytearray()
        for r in reds:
            row.extend((r, g, 128))
        rows.append(bytes(row))
    return rows


def grain(n=220, seed=GRAIN_SEED):
    rng = random.Random(seed)
    return [bytes(rng.randrange(256) for _ in range(n)) for _ in range(n)]


write_png(os.path.join(OUT, "refract-map.png"), 256, 256, refraction_map(256), 2)
write_png(os.path.join(OUT, "grain.png"), 220, 220, grain(220), 0)
