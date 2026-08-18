"""Generates the extension icons (a glassy gradient blob) with stdlib only."""
import math, struct, zlib, os

OUT = os.path.dirname(os.path.abspath(__file__))


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def render(size):
    px = bytearray()
    r = size / 2
    top, bottom = (124, 198, 255), (180, 139, 255)
    for y in range(size):
        px.append(0)  # PNG filter byte: none
        for x in range(size):
            dx, dy = x - r + 0.5, y - r + 0.5
            dist = math.hypot(dx, dy)
            edge = r - 0.5
            # squircle-ish falloff for a soft anti-aliased rim
            alpha = max(0.0, min(1.0, (edge - dist) * max(1.0, size / 16)))
            base = lerp(top, bottom, y / max(1, size - 1))
            # specular sweep across the upper-left
            spec = max(0.0, 1 - math.hypot(dx + r * 0.35, dy + r * 0.4) / (r * 1.1))
            col = tuple(min(255, round(c + spec * 90)) for c in base)
            # inner rim light
            rim = max(0.0, 1 - abs(dist - edge * 0.94) / (edge * 0.12))
            col = tuple(min(255, round(c + rim * 70)) for c in col)
            px.extend(col)
            px.append(round(alpha * 255))
    return bytes(px)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size):
    raw = render(size)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, len(png), "bytes")


for s in (16, 48, 128):
    write_png(os.path.join(OUT, f"icon{s}.png"), s)
