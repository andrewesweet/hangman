# Hangman

An offline hangman word game published as a single self-contained HTML page: one engine that owns the rules, and three selectable looks that draw it.

## Language

**Engine**:
The shared core of the game (`src/engine.js`). It owns the words, the rules, settings, stats, storage and the keyboards, and never draws anything itself.
_Avoid_: core, model

**Skin**:
One of the three selectable looks ("Pen & paper", "Piggy Paradise", "Arcade run"). A skin draws the scene, plays the sounds and carries its own copy; it keeps no rules, settings or stats. The settings screen and the README call a skin a look.
_Avoid_: theme, template, scene

**Category**:
A named group of guessable words with a stable id (for example flowers, gemstones, birds). Settings choose which categories are in play, and at least one must stay on.
_Avoid_: topic, pack

**Entry**:
One guessable word taken from the shared word schema: an answer, an optional hint, a difficulty and the category it belongs to.
_Avoid_: word, question

**Answer**:
The word or phrase a round is built on. Only A–Z letters are guessable; every other character shows from the start.
_Avoid_: solution

**Hint**:
Optional clue text carried by an entry. Revealing one flags the round, which costs the flawless bonus.

**Lives**:
How many wrong guesses a round allows, set in settings between 4 and 10. The round is lost when misses reach lives.
_Avoid_: health, attempts

**Hit**:
A guessed letter that appears in the answer.

**Miss**:
A guessed letter that does not appear in the answer. Every miss advances the skin's scene and counts against lives.

**Flawless**:
A round won with no misses and no hint used. It earns a score bonus that grows with the current win combo.
_Avoid_: perfect

**Streak**:
Consecutive wins in free play, tracked with its best value. Daily wins have their own daily streak; a lost daily puzzle leaves the free-play streak intact.

**Daily puzzle**:
The one deterministic word for the date, the same for everyone. It ignores the word filters and can be won once per day.
_Avoid_: challenge of the day

**Badge**:
An award a skin gives out for game facts such as wins, streaks or categories played. Each skin keeps its own badge album and names its own badges.
