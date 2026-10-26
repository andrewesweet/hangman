#!/usr/bin/env python3
"""Build play.html, the whole game in one offline file, from src/ and words/words.json.

Usage:
  python3 tools/build.py            write play.html
  python3 tools/build.py --check    fail if play.html differs from a fresh build
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "play.html")
SKINS = ["a", "b", "c"]
SKINS_MARK = "<!-- build:skins -->"

sys.dont_write_bytecode = True  # keep tools/ free of __pycache__
_spec = importlib.util.spec_from_file_location("inline_words", os.path.join(ROOT, "tools", "inline-words.py"))
assert _spec and _spec.loader
words = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(words)


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as f:
        return f.read()


def guarded(name, text, closer):
    """Inline text may not contain the tag that would end its own element early."""
    if closer in text.lower():
        raise SystemExit(f"{name}: contains {closer!r}, which would end the inlined block early")
    return text


def build():
    with open(words.WORDS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    errors = words.validate(data)
    if errors:
        raise SystemExit("words/words.json is invalid:\n" + "\n".join(errors))
    shell = read("shell.html")
    if shell.count(words.BEGIN) != 1 or shell.count(words.END) != 1 or shell.count(SKINS_MARK) != 1:
        raise SystemExit(f"src/shell.html needs exactly one words block and one {SKINS_MARK}")
    scripts = ["engine.js", "selftest.js"] + [os.path.join("skins", s + ".js") for s in SKINS]
    js = {name: guarded(name, read(name), "</script") for name in scripts}
    parts = [f"<script>\n{js['engine.js']}{js['selftest.js']}</script>"]
    for s in SKINS:
        css = guarded(f"skins/{s}.css", read("skins", s + ".css"), "</style")
        html = guarded(f"skins/{s}.html", read("skins", s + ".html"), "</template")
        parts.append(f'<template id="skin-{s}"><style>\n{css}</style>\n{html}</template>\n'
                     f"<script>\n{js[os.path.join('skins', s + '.js')]}</script>")
    head, rest = shell.split(words.BEGIN)
    page = head + words.block(data) + rest.split(words.END)[1]
    return page.replace(SKINS_MARK, "\n".join(parts))


def main(argv):
    if argv not in ([], ["--check"]):
        print(__doc__, file=sys.stderr)
        return 2
    page = build()
    if argv == ["--check"]:
        try:
            with open(OUT, encoding="utf-8") as f:
                current = f.read()
        except FileNotFoundError:
            current = None
        if current != page:
            print("play.html is out of date: run python3 tools/build.py", file=sys.stderr)
            return 1
        return 0
    with open(OUT + ".tmp", "w", encoding="utf-8") as f:
        f.write(page)
    os.replace(OUT + ".tmp", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
