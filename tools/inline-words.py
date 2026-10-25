#!/usr/bin/env python3
"""Inline words/words.json into hangman HTML files, or validate it.

Usage:
  python3 tools/inline-words.py FILE.html [FILE.html ...]
  python3 tools/inline-words.py --check
  python3 tools/inline-words.py --selftest
"""
import contextlib
import io
import json
import os
import re
import string
import sys
import tempfile

WORDS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "words", "words.json")
BEGIN, END = "<!-- words:begin -->", "<!-- words:end -->"
MUSIC = "uk-number-ones"
CATEGORY_IDS = ["animals", "mythology", "plants", "gemstones", "birds", "food-and-drink", "geography", MUSIC]
MIN_WORDS = {cid: 180 for cid in CATEGORY_IDS} | {MUSIC: 400}
DIFFICULTIES = {"easy", "medium", "hard"}
ANSWER_CHARS = set(string.ascii_uppercase + string.digits + string.punctuation + " ")
MUSIC_HINT = re.compile(r".+, (199\d|200\d)")


def hint_leaks(answer, hint):
    """True if a hint word starts with the first five letters (or all, if shorter) of an answer word of 4+ letters."""
    hint_words = re.findall(r"[a-z]+", hint.lower())
    for word in re.findall(r"[A-Z]{4,}", answer):
        stem = word[:5].lower()
        if any(h.startswith(stem) for h in hint_words):
            return True
    return False


def validate(data):
    """Return a list of problems with the word data; empty means valid."""
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("categories"), list):
        return ['top level must be {"version": 1, "categories": [...]}']
    errors = []
    ids = [c.get("id") if isinstance(c, dict) else None for c in data["categories"]]
    if sorted(map(str, ids)) != sorted(CATEGORY_IDS):
        errors.append(f"category ids must be exactly {CATEGORY_IDS}, got {ids}")
    for cat in data["categories"]:
        if not isinstance(cat, dict):
            continue
        cid = cat.get("id")
        if not isinstance(cat.get("name"), str) or not cat["name"].strip():
            errors.append(f"{cid}: missing name")
        words = cat.get("words")
        if not isinstance(words, list):
            errors.append(f"{cid}: words must be a list")
            continue
        if len(words) < MIN_WORDS.get(cid, 0):
            errors.append(f"{cid}: {len(words)} words, need at least {MIN_WORDS[cid]}")
        seen = set()
        for i, w in enumerate(words):
            where = f"{cid}[{i}]"
            if not isinstance(w, dict) or set(w) != {"answer", "hint", "difficulty"}:
                errors.append(f"{where}: needs exactly answer, hint and difficulty")
                continue
            answer, hint, difficulty = w["answer"], w["hint"], w["difficulty"]
            if not isinstance(answer, str) or not isinstance(hint, str):
                errors.append(f"{where}: answer and hint must be strings")
                continue
            where = f"{cid}[{i}] {answer!r}"
            letters = sum(c in string.ascii_uppercase for c in answer)
            if not set(answer) <= ANSWER_CHARS or answer != " ".join(answer.split()) or letters == 0:
                errors.append(f"{where}: answer must be A-Z, digits, punctuation and single spaces")
            if cid != MUSIC and not 3 <= letters <= 14:
                errors.append(f"{where}: {letters} letters, need 3-14")
            if answer in seen:
                errors.append(f"{where}: duplicate answer")
            seen.add(answer)
            if not isinstance(difficulty, str) or difficulty not in DIFFICULTIES:
                errors.append(f"{where}: difficulty {difficulty!r} not one of easy, medium, hard")
            if not hint.strip() or "\n" in hint or "\r" in hint:
                errors.append(f"{where}: hint must be one non-empty line")
            elif cid == MUSIC and not MUSIC_HINT.fullmatch(hint):
                errors.append(f"{where}: music hint must be 'Artist, YEAR' with a year 1990-2009")
            elif cid != MUSIC and hint_leaks(answer, hint):
                errors.append(f"{where}: hint {hint!r} gives away the answer")
    return errors


def block(data):
    # "<\/" keeps the JSON valid while stopping a "</script>" inside a string from closing the tag.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f'{BEGIN}<script id="hangman-words" type="application/json">{payload}</script>{END}'


def inline(paths, data):
    """Replace the words block in every file, or write none of them and return 1."""
    errors = validate(data)
    pages = {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if text.count(BEGIN) != 1 or text.count(END) != 1 or text.index(BEGIN) > text.index(END):
            errors.append(f"{path}: needs exactly one {BEGIN} ... {END} pair")
            continue
        head, rest = text.split(BEGIN)
        pages[path] = head + block(data) + rest.split(END)[1]
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        print("refused: no files written", file=sys.stderr)
        return 1
    for path, text in pages.items():
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    return 0


def selftest():
    good = {"version": 1, "categories": [
        {"id": cid, "name": cid.title(), "words": [
            {"answer": f"WORD {chr(65 + i // 26)}{chr(65 + i % 26)}X", "hint": "A clue",
             "difficulty": "easy"} for i in range(MIN_WORDS[cid])]}
        for cid in CATEGORY_IDS]}
    for w in good["categories"][-1]["words"]:
        w["hint"] = "Some Band, 1995"
    assert validate(good) == [], validate(good)

    bad = json.loads(json.dumps(good))
    bad["categories"][0]["words"][0]["difficulty"] = "tricky"
    bad["categories"][1]["words"][1]["answer"] = "lower"
    bad["categories"][2]["words"][2]["answer"] = bad["categories"][2]["words"][3]["answer"]
    bad["categories"][3]["words"][0]["hint"] = "Wordy clue"
    bad["categories"][-1]["words"][0]["hint"] = "Some Band 95"
    errors = validate(bad)
    assert any("gives away" in e for e in errors), errors
    assert any("music hint" in e for e in errors), errors
    assert any("tricky" in e for e in errors), errors
    assert any("lower" in e for e in errors), errors
    assert any("duplicate" in e for e in errors), errors
    assert validate({"version": 1, "categories": []}) != []

    with tempfile.TemporaryDirectory() as tmp:
        def page(name, body):
            path = os.path.join(tmp, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
            return path

        one = page("one.html", "<p>a</p>\n<!-- words:begin -->old<!-- words:end -->\n<p>b</p>\n")
        assert inline([one], good) == 0
        with open(one, encoding="utf-8") as f:
            out = f.read()
        assert out.startswith("<p>a</p>\n<!-- words:begin --><script id=\"hangman-words\" type=\"application/json\">")
        assert out.endswith("</script><!-- words:end -->\n<p>b</p>\n")
        start = out.index('application/json">') + len('application/json">')
        assert json.loads(out[start:out.index("</script>")]) == good
        assert inline([one], good) == 0
        with open(one, encoding="utf-8") as f:
            assert f.read() == out, "inlining twice must be idempotent"

        zero = page("zero.html", "<p>no markers</p>")
        two = page("two.html", "<!-- words:begin --><!-- words:end --><!-- words:begin --><!-- words:end -->")
        fresh = page("fresh.html", "<!-- words:begin --><!-- words:end -->")
        for refused in (zero, two):
            with open(refused, encoding="utf-8") as f:
                before = f.read()
            with contextlib.redirect_stderr(io.StringIO()) as err:
                assert inline([fresh, refused], good) != 0
            assert refused in err.getvalue() and "no files written" in err.getvalue()
            with open(refused, encoding="utf-8") as f:
                assert f.read() == before
            with open(fresh, encoding="utf-8") as f:
                assert f.read() == "<!-- words:begin --><!-- words:end -->", "no partial writes"
        with contextlib.redirect_stderr(io.StringIO()):
            assert inline([fresh], bad) != 0, "invalid data must not be inlined"
        with open(fresh, encoding="utf-8") as f:
            assert f.read() == "<!-- words:begin --><!-- words:end -->"
    print("selftest: ok")
    return 0


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    if argv == ["--check"]:
        with open(WORDS_PATH, encoding="utf-8") as f:
            errors = validate(json.load(f))
        for e in errors:
            print(e, file=sys.stderr)
        return 1 if errors else 0
    if not argv or any(a.startswith("-") for a in argv):
        print(__doc__, file=sys.stderr)
        return 2
    with open(WORDS_PATH, encoding="utf-8") as f:
        return inline(argv, json.load(f))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
