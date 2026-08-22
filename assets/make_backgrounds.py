"""Builds the packaged backgrounds in assets/bg/ from their originals.

    python assets/make_backgrounds.py --images DIR --videos DIR

Like make_assets.py and make_icons.py, this is a build-time script: it never
ships, and the extension only ever reads its output. The originals are not in
the repository — they are 15 MB of stills and 47 MB of clips, and the whole
point of this script is that none of that has to be.

What it does and why each step exists:

  * Stills are centre-cropped to 16:9 before being resized. They are drawn with
    `background-size: cover`, so on a 16:9 screen everything outside that crop
    is decoded and then thrown away. One source here is a 2268x4032 portrait:
    scaled to cover a 1080p screen it is 1920x3413, of which 2333 rows are off
    screen. Cropping first is the difference between 25 MB of decoded image and
    7.9 MB.

  * 1920x1080, not the original. Decoded cost is width x height x 4 bytes and
    has nothing to do with file size — the 8301x5534 still in this set is
    900 KB on disk and 175 MB decoded, the largest of the five in memory and
    the smallest on disk.

  * AVIF q65 for the full-size stills. Measured against WebP q80 on this set:
    2099 KB -> 1620 KB, and decode is 0.69x - faster, not slower, which is the
    opposite of what you would expect and was worth measuring rather than
    assuming. The wallpaper decode is on the new-tab critical path, so that
    halved decode (lake: 114ms -> 57ms) matters as much as the bytes. Chrome
    has decoded AVIF since 85 and the manifest floor is 116.

    Thumbnails stay WebP: at ~3 KB the container overhead of AVIF cancels the
    gain, and eight of them decode in single-digit milliseconds either way.

  * Clips are re-encoded at CRF 26 with their audio dropped. One source is
    16.1 Mbps, which is broadcast-grade for something that plays silently
    behind a blur — and the <video> is muted and looping, so every audio byte
    is dead weight in a package every user downloads.

  * Thumbnails are separate files, not the full images scaled down in CSS. The
    picker shows every background at once; pointing it at the full-size files
    would decode all of them to draw a grid of 64px swatches.
"""
import argparse, io, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "bg")
THUMBS = os.path.join(OUT, "thumbs")

W, H = 1920, 1080
THUMB_W, THUMB_H = 192, 108          # 3x the 64px swatch, for hidpi
STILL_Q, THUMB_Q = 65, 72       # AVIF for stills, WebP for thumbs
# AV1 rather than H.264. Measured on all three clips, re-encoded from the
# originals and scored with SSIM against them: 15.21 MB of H.264 CRF 26 becomes
# 4.70 MB of AV1 CRF 40, and the SSIM goes UP on every clip (0.9334->0.9351,
# 0.9835->0.9852, 0.9767->0.9780). Smaller and better, not a trade.
#
# The cost is decode: H.264 has universal hardware decode, AV1 needs roughly
# Intel 11th gen / RTX 30 / RDNA2 and falls back to software below that, which
# costs CPU and battery. Contained here because a live wallpaper is opt-in and
# pauses when the tab is hidden. VP9 CRF 36 is the hedge at 8.29 MB with much
# wider hardware support - swap CODEC/CRF and the container to webm.
CODEC = "libsvtav1"
CRF = "40"
PRESET = "6"

# id -> (source filename, display name, credit). The source names are kept so
# the provenance of a shipped file is answerable from the repository alone.
STILLS = [
    ("galaxy",   "pexels-alisson-silva-63703124-8150782.jpg",        "Galaxy",      "Alisson Silva / Pexels"),
    ("milkyway", "pexels-anjan-karki-2392943-13237926.jpg",          "Milky Way",   "Anjan Karki / Pexels"),
    ("lake",     "pexels-eberhardgross-534164.jpg",                  "Alpine Lake", "eberhard grossgasteiger / Pexels"),
    ("meadow",   "pexels-pexels-user-poliakova-1619458514-35658798.jpg", "Meadow",  "Poliakova / Pexels"),
    ("smoke",    "pexels-thales13-38821096.jpg",                     "Ember",       "Thales / Pexels"),
]
CLIPS = [
    ("dusklake", "10339-865412856.mp4",   "Still Water", "Pixabay"),
    ("blossom",  "113004-696349232.mp4",  "Blossom",     "Pixabay"),
    ("rain",     "28236-368501609.mp4",   "Rain",        "Pixabay"),
]


def crop_169(im):
    w, h = im.size
    target = W / H
    if w / h > target:
        nw, nh = round(h * target), h
    else:
        nw, nh = w, round(w / target)
    left, top = (w - nw) // 2, (h - nh) // 2
    return im.crop((left, top, left + nw, top + nh))


def build_stills(src_dir):
    from PIL import Image
    total = 0
    for bid, fname, name, _credit in STILLS:
        path = os.path.join(src_dir, fname)
        if not os.path.exists(path):
            sys.exit(f"missing still: {path}")
        im = Image.open(path).convert("RGB")
        full = crop_169(im).resize((W, H), Image.LANCZOS)
        dst = os.path.join(OUT, f"{bid}.avif")
        full.save(dst, "AVIF", quality=STILL_Q)
        full.resize((THUMB_W, THUMB_H), Image.LANCZOS).save(
            os.path.join(THUMBS, f"{bid}.webp"), "WEBP", quality=THUMB_Q, method=6)
        kb = os.path.getsize(dst) / 1024
        total += kb
        print(f"  {name:<12} {bid}.webp  {kb:6.0f} KB")
    return total


def build_clips(src_dir):
    import av
    total = 0
    for bid, fname, name, _credit in CLIPS:
        path = os.path.join(src_dir, fname)
        if not os.path.exists(path):
            sys.exit(f"missing clip: {path}")
        dst = os.path.join(OUT, f"{bid}.mp4")

        with av.open(path) as inp, av.open(dst, "w", options={"movflags": "+faststart"}) as out:
            vin = inp.streams.video[0]
            vout = out.add_stream(CODEC, rate=vin.average_rate)
            vout.width = vin.codec_context.width
            vout.height = vin.codec_context.height
            vout.pix_fmt = "yuv420p"
            # No audio stream is added, which is how the audio gets dropped.
            vout.options = {"crf": CRF, "preset": PRESET}
            for frame in inp.decode(video=0):
                for pkt in vout.encode(frame):
                    out.mux(pkt)
            for pkt in vout.encode():
                out.mux(pkt)

        # First frame as the picker thumbnail, so a clip looks like what it is.
        from PIL import Image
        with av.open(dst) as c:
            frame = next(c.decode(video=0)).to_image()
        crop_169(frame).resize((THUMB_W, THUMB_H), Image.LANCZOS).save(
            os.path.join(THUMBS, f"{bid}.webp"), "WEBP", quality=THUMB_Q, method=6)

        was = os.path.getsize(path) / 1024 / 1024
        now = os.path.getsize(dst) / 1024 / 1024
        total += now
        print(f"  {name:<12} {bid}.mp4   {now:5.1f} MB  (was {was:.1f} MB)")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="folder holding the source stills")
    ap.add_argument("--videos", required=True, help="folder holding the source clips")
    ap.add_argument("--skip-clips", action="store_true", help="stills only (clips are slow)")
    a = ap.parse_args()

    os.makedirs(THUMBS, exist_ok=True)
    print("stills:")
    kb = build_stills(a.images)
    print(f"  {'':<12} subtotal {kb/1024:.2f} MB")
    if not a.skip_clips:
        print("clips:")
        mb = build_clips(a.videos)
        print(f"  {'':<12} subtotal {mb:.2f} MB")


if __name__ == "__main__":
    main()
