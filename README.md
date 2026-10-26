# Hangman

An offline hangman game in a single self-contained HTML file, published with GitHub Pages. [`play.html`](play.html) is the game: one engine with three looks, "Pen & paper", "Piggy Paradise" and "Arcade run", which you switch between in Settings. The look you used last is remembered, and settings, streaks and stats are shared by all three. [`index.html`](index.html) links to each look, and the old `prototypes/a.html`, `b.html` and `c.html` addresses redirect to the matching look.

## Installing to the home screen

On an iPhone, open [`play.html`](https://andrewesweet.github.io/hangman/play.html) in Safari, tap Share, then Add to Home Screen. The game then opens full screen from its own icon and plays with no connection, because the first online visit stores `play.html`, the [manifest](manifest.webmanifest) and the icons through the service worker in `sw.js`. A new version downloads in the background on the next visit made online and shows the next time the game is opened, which on iPhone means after closing it from the app switcher.

## Building

`play.html` is built from `src/` and [`words/words.json`](words/words.json), using the Python standard library only. The same build writes `sw.js` and the PNG icons in `icons/`:

```sh
python3 tools/build.py
```

Commit the rebuilt `play.html` and `sw.js` with any change to `src/`, the words or the manifest; `sw.js` names its cache after a hash of the files it stores, which is how an update reaches installed copies. To check that the committed files match a fresh build, run:

```sh
python3 tools/build.py --check
```

It exits non-zero and names each stale file, for example `play.html is out of date`. Icons count as stale only when their pixels change, not their compressed bytes. `python3 tools/build.py --selftest` checks the icon and service worker generators.

The source is split as follows:

- `src/shell.html` is the page around the game. It holds the `<!-- words:begin -->`/`<!-- words:end -->` pair that the build fills with the word list, as described in [`words/README.md`](words/README.md).
- `src/engine.js` owns everything the looks share: picking words, the rules, hints, scoring, badges, daily mode, settings, stats and their storage, and the on-screen and physical keyboards.
- `src/skins/<look>.html`, `.css` and `.js` hold each look's scene, animations, sounds and copy. A look draws what the engine tells it and never keeps its own rules, settings or stats; the only thing a look stores itself is scene detail such as how many hay landings Piggy Paradise has already shown.
- `src/sw.js` is the service worker, minus the `CACHE` line the build adds.
- `src/selftest.js` holds the checks behind `play.html?selftest`. They test the engine rules once and then play each look through a right guess, a wrong guess, a win, a loss and a switch to the next look. They run on throwaway storage and print `SELFTEST PASS (n/n)` to the console.
