#!/usr/bin/env python3
"""Build play.html, the whole game in one offline file, from src/ and words/words.json,
along with the service worker sw.js and the home-screen icons in icons/.

Usage:
  python3 tools/build.py            write play.html, sw.js and icons/
  python3 tools/build.py --check    fail if any of them differs from a fresh build
  python3 tools/build.py --selftest check the icon and service worker generators
"""
import hashlib
import importlib.util
import json
import math
import os
import struct
import sys
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "src")
SKINS = ["a", "b", "c"]
SKINS_MARK = "<!-- build:skins -->"
MANIFEST = os.path.join(ROOT, "manifest.webmanifest")
ICONS = {"icons/apple-touch-icon.png": 180, "icons/icon-192.png": 192, "icons/icon-512.png": 512}
PAPER, INK = (0xfd, 0xe3, 0xee), (0xd6, 0x45, 0x7b)
# The icon on a 100-unit square: gallows and stick figure as round-capped strokes, then the head.
STROKES = [((20, 82), (54, 82)), ((30, 82), (30, 18)), ((30, 18), (70, 18)), ((70, 18), (70, 30)),
           ((70, 48), (70, 66)), ((70, 54), (61, 61)), ((70, 54), (79, 61)), ((70, 66), (63, 75)), ((70, 66), (77, 75))]
HEAD, HEAD_R, PEN = (70, 39), 9, 6

sys.dont_write_bytecode = True  # keep tools/ free of __pycache__
_spec = importlib.util.spec_from_file_location("inline_words", os.path.join(ROOT, "tools", "inline-words.py"))
assert _spec and _spec.loader
inline_words = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inline_words)


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as f:
        return f.read()


def guarded(name, text, closer):
    """Inline text may not contain the tag that would end its own element early."""
    if closer in text.lower():
        raise SystemExit(f"{name}: contains {closer!r}, which would end the inlined block early")
    return text


def build():
    with open(inline_words.WORDS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    errors = inline_words.validate(data)
    if errors:
        raise SystemExit("words/words.json is invalid:\n" + "\n".join(errors))
    shell = read("shell.html")
    if shell.count(inline_words.BEGIN) != 1 or shell.count(inline_words.END) != 1 or shell.count(SKINS_MARK) != 1:
        raise SystemExit(f"src/shell.html needs exactly one words block and one {SKINS_MARK}")
    scripts = ["engine.js", "selftest.js"] + [os.path.join("skins", s + ".js") for s in SKINS]
    js = {name: guarded(name, read(name), "</script") for name in scripts}
    parts = [f"<script>\n{js['engine.js']}{js['selftest.js']}</script>"]
    for s in SKINS:
        css = guarded(f"skins/{s}.css", read("skins", s + ".css"), "</style")
        html = guarded(f"skins/{s}.html", read("skins", s + ".html"), "</template")
        parts.append(f'<template id="skin-{s}"><style>\n{css}</style>\n{html}</template>\n'
                     f"<script>\n{js[os.path.join('skins', s + '.js')]}</script>")
    head, rest = shell.split(inline_words.BEGIN)
    page = head + inline_words.block(data) + rest.split(inline_words.END)[1]
    return page.replace(SKINS_MARK, "\n".join(parts))


def selftest():
    icon = png_pixels(png(*icon_rows(100)))
    assert icon[0] == struct.pack(">IIBBBBB", 100, 100, 8, 2, 0, 0, 0), icon[0]
    pixel = lambda x, y: icon[1][y * 301 + 1 + x * 3:y * 301 + 4 + x * 3]
    assert pixel(2, 2) == bytes.fromhex("fde3ee"), "corner is the page pink"
    assert pixel(30, 50) == bytes.fromhex("d6457b"), "middle of the post is ink"
    w, h, rows = 2, 1, b"\0\1\2\3\4\5\6"
    loose = png(w, h, rows)[:33] + chunk(b"IDAT", zlib.compress(rows, 1)) + chunk(b"IEND", b"")
    assert same_png(png(w, h, rows), loose), "zlib level does not count as a change"
    assert not same_png(png(w, h, rows), png(w, h, b"\0\1\2\3\4\5\7"))
    assert not same_png(png(w, h, rows), b"not a png")
    one, two = outputs("<p>one</p>"), outputs("<p>two</p>")
    assert one["sw.js"].startswith(b'const CACHE = "hangman-') and one["sw.js"] != two["sw.js"], "a new page renames the cache"
    assert one["sw.js"] == outputs("<p>one</p>")["sw.js"]
    print("selftest: ok")
    return 0


def icon_rows(size):
    """PNG scanlines (filter byte, then RGB) of the icon at size x size, anti-aliased by distance to each stroke."""
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            x, y = (px + .5) * 100 / size, (py + .5) * 100 / size
            d = abs(math.dist((x, y), HEAD) - HEAD_R)
            for (ax, ay), (bx, by) in STROKES:
                t = max(0, min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
                d = min(d, math.dist((x, y), (ax + t * (bx - ax), ay + t * (by - ay))))
            ink = max(0, min(1, (PEN / 2 - d) * size / 100 + .5))
            rows += bytes(round(p + (i - p) * ink) for p, i in zip(PAPER, INK))
    return size, size, bytes(rows)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png(w, h, rows):
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def png_pixels(data):
    """IHDR and the decompressed image data of a PNG."""
    pos, ihdr, idat = 8, b"", b""
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        if kind == b"IHDR":
            ihdr = data[pos + 8:pos + 8 + n]
        elif kind == b"IDAT":
            idat += data[pos + 8:pos + 8 + n]
        pos += 12 + n
    return ihdr, zlib.decompress(idat)


def same_png(a, b):
    """Compare pixels, not bytes, so another zlib build compressing differently is not a change."""
    try:
        return png_pixels(a) == png_pixels(b)
    except (struct.error, zlib.error):
        return False


def outputs(page):
    """Every generated file, keyed by its path from the repository root."""
    files = {"play.html": page.encode("utf-8")}
    digest = hashlib.sha256(files["play.html"])
    with open(MANIFEST, "rb") as f:
        digest.update(f.read())
    for path, size in ICONS.items():
        w, h, rows = icon_rows(size)
        files[path] = png(w, h, rows)
        digest.update(rows)
    files["sw.js"] = f'const CACHE = "hangman-{digest.hexdigest()[:12]}";\n{read("sw.js")}'.encode("utf-8")
    return files


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    if argv not in ([], ["--check"]):
        print(__doc__, file=sys.stderr)
        return 2
    check, stale = argv == ["--check"], []
    for path, data in outputs(build()).items():
        full = os.path.join(ROOT, path)
        try:
            with open(full, "rb") as f:
                current = f.read()
        except FileNotFoundError:
            current = None
        if current == data or (current and path.endswith(".png") and same_png(current, data)):
            continue
        if check:
            stale.append(path)
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full + ".tmp", "wb") as f:
            f.write(data)
        os.replace(full + ".tmp", full)
    for path in stale:
        print(f"{path} is out of date: run python3 tools/build.py", file=sys.stderr)
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
