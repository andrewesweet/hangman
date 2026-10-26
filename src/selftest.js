"use strict";
/* ?selftest: the engine rules once, then a smoke pass per skin. Runs on throwaway storage.
   Logs "SELFTEST PASS (n/n)" or each failure, and sets <html data-selftest="pass|fail">. */
Hangman.selftest = function(){
  const results = [];
  /* thunk form, so one broken helper fails its own case instead of aborting the run */
  const t = (name, fn, expected) => {
    let got, ok = false;
    try { got = fn(); ok = expected === undefined ? got === true : JSON.stringify(got) === JSON.stringify(expected); }
    catch (e) { got = String(e && e.stack || e); }
    results.push({name, ok, got, expected});
  };
  Hangman.selftest.pure(t);
  Hangman.selftest.skins(t);
  const failed = results.filter(r => !r.ok);
  failed.forEach(r => console.error("SELFTEST FAIL: " + r.name, "got", r.got, "expected", r.expected === undefined ? true : r.expected));
  console.log("SELFTEST " + (failed.length ? "FAIL" : "PASS") + " (" + (results.length - failed.length) + "/" + results.length + ")");
  document.documentElement.dataset.selftest = failed.length ? "fail" : "pass";
  return failed.length === 0;
};

Hangman.selftest.pure = function(t){
  const P = Hangman.pure, H = Hangman.host;
  const set = (...l) => new Set(l);
  /* letter counts, from hand counts in prototypes A, B and C */
  t("count ignores spaces", () => P.letterCount("SWEET PEA"), 8);
  t("count ignores digits", () => P.letterCount("MAMBO NO 5"), 7);
  t("count apostrophe", () => P.letterCount("IT WASN'T ME"), 9);
  t("count long title", () => P.letterCount("CANDLE IN THE WIND 1997"), 15);
  t("count brackets", () => P.letterCount("BLUE (DA BA DEE)"), 11);
  t("count question mark", () => P.letterCount("WHERE IS THE LOVE?"), 14);

  /* word data adapter */
  const fx = P.parseWords({version: 1, categories: [
    {id: "birds", name: "Birds", words: [
      {answer: "owl", hint: "Hoots", difficulty: "easy"}, {answer: "GREAT TIT", hint: "Garden regular", difficulty: "hard"},
      {answer: "123", hint: "no letters", difficulty: "easy"}, {answer: "KINGFISHER", hint: "River jewel", difficulty: "bogus"}, null, {answer: 5}]},
    {id: "empty", name: "Empty", words: []}, {id: "nowords", name: "No words"},
    {name: "No id", words: [{answer: "ROBIN", hint: "Red", difficulty: "easy"}]},
    {id: "plants", words: [{answer: "OAK", hint: "Acorns", difficulty: "medium"}]}]});
  t("adapter keeps only playable categories", () => fx.cats, [{id: "birds", name: "Birds"}, {id: "plants", name: "plants"}]);
  t("adapter upper-cases and drops letterless answers", () => fx.entries.map(e => e.answer), ["OWL", "GREAT TIT", "KINGFISHER", "OAK"]);
  t("adapter defaults a bad difficulty to medium", () => fx.entries[2].difficulty, "medium");
  t("entry carries category and fields", () => fx.entries[3], {answer: "OAK", hint: "Acorns", difficulty: "medium", cat: "plants", catName: "plants"});
  t("absent data gives nothing", () => [P.parseWords(null).cats.length, P.parseWords({version: 1}).entries.length], [0, 0]);

  /* filtering and picking */
  const all = {min: 3, max: 14, phrases: true, cats: ["birds", "plants"]};
  const answers = s => P.filterEntries(fx.entries, Object.assign({}, all, s)).map(e => e.answer);
  t("filter: all on", () => answers({}), ["OWL", "GREAT TIT", "KINGFISHER", "OAK"]);
  t("filter: phrases off", () => answers({phrases: false}), ["OWL", "KINGFISHER", "OAK"]);
  t("filter: length counts letters only", () => answers({min: 4, max: 9}), ["GREAT TIT"]);
  t("filter: 10-letter edge inclusive", () => answers({min: 10, max: 10}), ["KINGFISHER"]);
  t("filter: category off", () => answers({cats: ["plants"]}), ["OAK"]);
  t("pick: empty gives null", () => P.pickEntry([], "X"), null);
  t("pick: avoids an immediate repeat", () => P.pickEntry([{answer: "A"}, {answer: "B"}], "A", () => 0).answer, "B");
  t("pick: single entry repeats", () => P.pickEntry([{answer: "A"}], "A").answer, "A");
  t("solved", () => P.isSolved("TEA", set("T", "E", "A")), true);
  t("not solved", () => P.isSolved("TEA", set("T", "E")), false);
  t("solved ignores digits and punctuation", () => P.isSolved("MAMBO NO 5", set("M", "A", "B", "O", "N")), true);

  /* scoring, from prototype C's hand-computed values */
  const pts = o => P.pointsFor(Object.assign({letters: 5, diff: "easy", flawless: false, comboBefore: 0, quick: false}, o));
  t("points: easy, medium, hard", () => [pts({}), pts({diff: "medium"}), pts({diff: "hard"})], [50, 75, 100]);
  t("points: flawless bonus grows with the combo", () => pts({flawless: true, comboBefore: 2}), 125);
  t("points: quick bonus", () => pts({quick: true}), 100);

  /* daily puzzle */
  t("daily index is fixed per date", () => [P.dailyIndex("2026-01-01", 200), P.dailyIndex("2026-05-06", 200), P.dailyIndex("2026-10-27", 200)], [78, 132, 112]);
  t("daily index in range on every day of a year", () => {
    const d = new Date(2026, 0, 1);
    for (let i = 0; i < 366; i++, d.setDate(d.getDate() + 1)) { const k = P.dailyIndex(P.todayStr(d), 37); if (!(k >= 0 && k < 37)) return P.todayStr(d); }
    return "ok";
  }, "ok");
  t("daily word ignores the filters", () => {
    const w = H.words;
    return P.dailyEntry(w.entries, w.cats, "2026-10-26") === P.dailyEntry(w.entries, w.cats, "2026-10-26") && !!P.dailyEntry(w.entries, w.cats, "2026-10-26");
  });

  /* settings and stats clean-up */
  const cats = [{id: "food-and-drink", name: "Food and drink"}, {id: "birds", name: "Birds"}, {id: "uk-number-ones", name: "UK number ones"}];
  const ids = cats.map(c => c.id);
  t("bad settings reset to defaults", () => P.cleanSettings("junk", cats), {min: 3, max: 14, phrases: true, cats: ids, lives: 6, muted: false, quick: false});
  t("settings clamp: lives 4-10, lengths 3-14", () => { const s = P.cleanSettings({min: 1, max: 99, lives: 99}, cats); return [s.min, s.max, s.lives, P.cleanSettings({lives: 2}, cats).lives]; }, [3, 14, 10, 4]);
  t("settings swap an inverted range", () => { const s = P.cleanSettings({min: 9, max: 4}, cats); return [s.min, s.max]; }, [4, 9]);
  t("settings drop unknown categories, none left means all", () => [P.cleanSettings({cats: ["birds", "myth"]}, cats).cats, P.cleanSettings({cats: ["myth"]}, cats).cats], [["birds"], ids]);
  t("settings map old category ids and names", () => P.cleanSettings({cats: ["food", "music", "birds"]}, cats).cats.sort(), ids.slice().sort());
  t("bad stats reset", () => P.cleanStats("junk", cats).played, 0);
  t("stats map old category keys", () => P.cleanStats({winsPerCat: {"food and drink": 3, food: 1, birds: 2, gone: 4}}, cats).winsPerCat, {"food-and-drink": 4, birds: 2});
  t("stats keep only known badges", () => P.cleanStats({badges: {a: {flawless: 5, nope: 1}, b: [1], c: "x"}}, cats).badges, {a: {flawless: 5}, b: {}, c: {}});
  t("stats bad daily date dropped", () => P.cleanStats({dailyLast: "yesterday"}, cats).dailyLast, "");

  /* first-run migration from the prototypes' keys */
  const fill = data => { const s = P.makeStore(P.memoryBackend()); for (const k in data) s.backend.setItem(k, typeof data[k] === "string" ? data[k] : JSON.stringify(data[k])); return s; };
  const A = {settings: {min: 4, max: 8, phrases: false, cats: ["food", "birds"], lives: 9, muted: true},
    stats: {streak: 1, best: 2, played: 3, won: 2, winsPerCat: {food: 2}, badges: ["first-win", "flawless"]}};
  const B = {settings: {minLen: 5, maxLen: 9, phrases: true, cats: ["birds"], lives: 7, muted: false},
    stats: {streak: 4, best: 6, dailyStreak: 2, dailyLast: "2026-10-25", games: 10, wins: 8, winsPerCat: {birds: 8}, badges: ["first", "ten"], treats: 40}};
  const C = {settings: {min: 6, max: 10, phrases: true, cats: {"food and drink": false, birds: true}, lives: 5, quick: true, mute: true},
    stats: {streak: 2, bestStreak: 3, wins: {"food and drink": 1, birds: 2}, played: 5, best: 640, badges: {"hat-trick": 1700000000000}}};
  const store3 = fill({"hangman-a:settings": A.settings, "hangman-a:stats": A.stats, "hangman-b:settings": B.settings,
    "hangman-b:stats": B.stats, "hangman-c:settings": C.settings, "hangman-c:stats": C.stats});
  t("migration prefers B's settings, keeps C's quick bonus", () => P.cleanSettings(P.legacySettings(store3, cats), cats),
    {min: 5, max: 9, phrases: true, cats: ["birds"], lives: 7, muted: false, quick: true});
  t("migration prefers B's streaks, merges every album", () => {
    const s = P.cleanStats(P.legacyStats(store3), cats);
    return [s.streak, s.best, s.played, s.won, s.dailyStreak, s.treats, s.bestScore, s.winsPerCat, Object.keys(s.badges.a), Object.keys(s.badges.b), Object.keys(s.badges.c)];
  }, [4, 6, 10, 8, 2, 40, 640, {birds: 8}, ["first-win", "flawless"], ["first", "ten"], ["hat-trick"]]);
  const storeA = fill({"hangman-a:settings": A.settings, "hangman-a:stats": A.stats});
  t("migration from A alone maps old category ids", () => [P.cleanSettings(P.legacySettings(storeA, cats), cats).cats, P.cleanStats(P.legacyStats(storeA), cats).winsPerCat],
    [["food-and-drink", "birds"], {"food-and-drink": 2}]);
  const storeC = fill({"hangman-c:settings": C.settings, "hangman-c:stats": C.stats});
  t("migration from C alone", () => {
    const s = P.cleanSettings(P.legacySettings(storeC, cats), cats), st = P.cleanStats(P.legacyStats(storeC), cats);
    return [s.cats, s.lives, s.muted, s.quick, st.won, st.best, st.bestScore];
  }, [["birds", "uk-number-ones"], 5, true, true, 3, 3, 640]);
  const junk = fill({"hangman-a:settings": "{oops", "hangman-b:settings": "[1,2]", "hangman-b:stats": "null", "hangman-c:stats": "\"str\"", "hangman-a:stats": "{\"streak\":\"x\",\"badges\":7}"});
  t("malformed old data never breaks the game", () => [P.cleanSettings(P.legacySettings(junk, cats), cats).lives, P.cleanStats(P.legacyStats(junk), cats).streak], [6, 0]);
  t("no old data gives defaults", () => [P.legacySettings(fill({}), cats), P.legacyStats(fill({}))], [null, null]);
  t("corrupt storage reads as nothing", () => fill({k: "{oops"}).get("k"), null);
  t("one words block on the page", () => document.querySelectorAll("#hangman-words").length, 1);
  t("embedded words match the shared schema", () => {
    const d = JSON.parse(document.getElementById("hangman-words").textContent);
    return d.version === 1 && d.categories.length > 0 && d.categories.every(c => typeof c.id === "string" && typeof c.name === "string" &&
      c.words.length > 0 && c.words.every(x => typeof x.answer === "string" && x.answer === x.answer.toUpperCase() &&
      /[A-Z]/.test(x.answer) && typeof x.hint === "string" && x.hint && ["easy", "medium", "hard"].includes(x.difficulty)));
  });
};

Hangman.selftest.skins = function(t){
  const P = Hangman.pure, H = Hangman.host, start = H.skinId, ids = Object.keys(H.skins);
  H.setSettings({muted: true}); /* no AudioContext without a gesture */
  const freshWord = () => { H.setMode("free"); H.begin(); return H.game; };
  const letters = g => [...new Set(g.entry.answer)].filter(P.isLetter);
  const misses = g => [...P.LETTERS].filter(L => !g.entry.answer.includes(L));
  const key = L => H.keysEl.querySelector('[data-l="' + L + '"]');
  const rows = () => { const m = new Map(); for (const b of H.keysEl.children) { const y = Math.round(b.getBoundingClientRect().top); m.set(y, (m.get(y) || "") + b.dataset.l); } return [...m.values()]; };

  /* the shared rules, played through the first skin */
  H.switchSkin(ids[0]);
  let g = freshWord();
  t("a word is in play", () => !!g.entry && !g.over);
  let s0 = Object.assign({}, H.stats), run0 = H.run.score;
  letters(g).forEach(H.guess);
  t("a flawless win scores letters plus the combo bonus", () => [g.won, H.run.score - run0, H.run.combo > 0],
    [true, P.pointsFor({letters: P.letterCount(g.entry.answer), diff: g.entry.difficulty, flawless: true, comboBefore: H.run.combo - 1, quick: false}), true]);
  t("a win counts played, won, streak and category", () => [H.stats.played - s0.played, H.stats.won - s0.won, H.stats.streak - s0.streak, H.stats.winsPerCat[g.entry.cat] > 0], [1, 1, 1, true]);
  g = freshWord(); H.hint(); letters(g).forEach(H.guess);
  t("a hint voids the flawless bonus and resets the combo", () => [g.won, H.run.combo], [true, 0]);
  g = freshWord(); s0 = Object.assign({}, H.stats);
  misses(g).slice(0, g.lives).forEach(H.guess);
  t("a loss ends the streak", () => [g.over, g.won, H.stats.streak, H.stats.played - s0.played], [true, false, 0, 1]);
  t("after a loss the next word starts a fresh run", () => { freshWord(); return H.run.score; }, 0);
  H.setMode("daily");
  g = H.game;
  t("daily mode plays the day's word", () => g.mode === "daily" && g.entry === P.dailyEntry(H.words.entries, H.words.cats, P.todayStr()));
  t("daily mode refuses another word", () => [H.newGame({auto: true}), H.game === g], [false, true]);
  H.setSettings(Object.assign({}, H.settings, {lives: 4}));
  const streak = H.stats.streak;
  misses(g).slice(0, g.lives).forEach(H.guess);
  t("a lost daily puzzle keeps the streak", () => [g.over, H.stats.streak], [true, streak]);
  H.setMode("free");
  t("lives come from settings, 4-10", () => [H.game.lives, (H.setSettings(Object.assign({}, H.settings, {lives: 12})), H.settings.lives)], [4, 10]);
  t("closing settings unchanged keeps the word", () => { const w = H.game; H.editSettings(); return H.doneSettings() === false && H.game === w; });
  t("closing settings after a filter change starts a new word", () => { const w = H.game; H.editSettings(); H.settings.lives = 6; return H.doneSettings() === true && H.game !== w && H.game.lives === 6; });

  for (const id of ids) {
    H.switchSkin(id);
    const meta = H.skins[id].meta, host = H.skin;
    g = freshWord();
    t(id + ": renders a word and 26 keys", () => [H.root.children.length > 0, H.keysEl && H.keysEl.children.length, !!g.entry], [true, 26, true]);
    t(id + ": keyboard rows read QWERTY", rows, ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]);
    t(id + ": no horizontal scroll", () => document.scrollingElement.scrollWidth <= innerWidth);
    if (meta.fit) t(id + ": game fits one screen without scrolling", () => document.scrollingElement.scrollHeight <= innerHeight &&
      document.getElementById(meta.fit).getBoundingClientRect().bottom <= innerHeight);
    t(id + ": badge album matches the engine's rules", () => host.badgeIds.slice().sort(), Object.keys(P.BADGE_RULES[id]).sort());
    const hit = letters(g)[0], miss = misses(g)[0];
    H.guess(hit); H.guess(miss);
    t(id + ": right and wrong guesses mark the keys", () => [key(hit).classList.contains("right"), key(miss).classList.contains("wrong"), key(hit).disabled, key(miss).disabled], [true, true, true, true]);
    const before = Object.assign({}, H.stats);
    letters(g).forEach(H.guess);
    t(id + ": win", () => [g.won, H.stats.won - before.won, H.keysEl.querySelectorAll(".key:not(:disabled)").length], [true, 1, 0]);
    g = freshWord();
    misses(g).slice(0, g.lives).forEach(H.guess);
    t(id + ": loss", () => [g.over, g.won, H.stats.streak], [true, false, 0]);
    if (host.selftest) host.selftest((name, fn, expected) => t(id + ": " + name, fn, expected));
    /* switching keeps the word in play, the settings and the stats */
    g = freshWord(); H.guess(letters(g)[0]); H.guess(misses(g)[0]);
    const next = ids[(ids.indexOf(id) + 1) % ids.length], keep = JSON.stringify([H.settings, H.stats]);
    H.switchSkin(next);
    t(id + " to " + next + ": word, settings and stats carry over", () => [H.game === g, JSON.stringify([H.settings, H.stats]) === keep,
      key(letters(g)[0]).classList.contains("right"), key(misses(g)[0]).classList.contains("wrong")], [true, true, true, true]);
    t(id + " to " + next + ": skin is remembered", () => H.store.get(P.KEYS.skin), next);
  }
  H.switchSkin(start);
  H.setSettings(Object.assign({}, H.settings, {lives: 6}));
  freshWord();
};
