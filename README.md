# Hangman

An offline hangman game in a single self-contained HTML file, published with GitHub Pages. [`play.html`](play.html) is the game: one engine with three looks, "Pen & paper", "Piggy Paradise" and "Arcade run", which you switch between in Settings. The look you used last is remembered, and settings, streaks and stats are shared by all three. [`index.html`](index.html) links to each look, and the old `prototypes/a.html`, `b.html` and `c.html` addresses redirect to the matching look.

## Building

`play.html` is built from `src/` and [`words/words.json`](words/words.json), using the Python standard library only:

```sh
python3 tools/build.py
```

Commit the rebuilt `play.html` with any change to `src/` or the words. To check that the committed file matches a fresh build, run:

```sh
python3 tools/build.py --check
```

It exits non-zero with `play.html is out of date` when the two differ.

The source is split as follows:

- `src/shell.html` is the page around the game. It holds the `<!-- words:begin -->`/`<!-- words:end -->` pair that the build fills with the word list, as described in [`words/README.md`](words/README.md).
- `src/engine.js` owns everything the looks share: picking words, the rules, hints, scoring, badges, daily mode, settings, stats and their storage, and the on-screen and physical keyboards.
- `src/skins/<look>.html`, `.css` and `.js` hold each look's scene, animations, sounds and copy. A look draws what the engine tells it and never keeps its own rules or storage.
- `src/selftest.js` holds the checks behind `play.html?selftest`. They test the engine rules once and then play each look through a right guess, a wrong guess, a win, a loss and a switch to the next look. They run on throwaway storage and print `SELFTEST PASS (n/n)` to the console.
