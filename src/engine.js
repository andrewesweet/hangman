"use strict";
/* ============================================================
   Shared hangman engine. It owns the words, the rules, settings,
   stats and storage, the on-screen and physical keyboards, the
   settings form and the skin host. Skins only draw and play sounds.

   A skin registers with Hangman.skin(id, meta, factory). The factory
   gets (ctx, root) and returns:
     start(game, {resumed})  draw a fresh or resumed game
     guessed(result)         react to one guess
     finished(outcome)       react to the win or loss
     sync()                  redraw settings-driven bits (lives, sound, streak)
     toast(text)             show a short message
     modalOpen(), closeModal(), enter()   optional, for the physical keyboard
     selftest(t)             optional scene checks for ?selftest
   ============================================================ */
const Hangman = (() => {
  const LETTERS = "QWERTYUIOPASDFGHJKLZXCVBNM";
  const KEYS = {settings: "hangman:settings", stats: "hangman:stats", skin: "hangman:skin"};
  const DEFAULT_SKIN = "b";
  const DAILY_ONLY = "Daily puzzle is one word a day — try Free play for more!";
  const KEEP_ONE = "Keep at least one category!";
  /* Prototype A renamed these category ids when the words moved to the shared schema. */
  const OLD_CAT_IDS = {food: "food-and-drink", music: "uk-number-ones"};

  /* ---------------- pure rules ---------------- */
  const isLetter = ch => ch >= "A" && ch <= "Z";
  function letterCount(text){ let n = 0; for (const ch of text) if (isLetter(ch)) n++; return n; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* Shared word schema to playable categories and entries, in data order.
     Malformed words and categories with no guessable word are dropped. */
  function parseWords(raw){
    const cats = [], entries = [];
    for (const c of raw && Array.isArray(raw.categories) ? raw.categories : []) {
      if (!c || typeof c.id !== "string" || !c.id) continue;
      const name = typeof c.name === "string" && c.name ? c.name : c.id, mine = [];
      for (const w of Array.isArray(c.words) ? c.words : []) {
        if (!w || typeof w.answer !== "string") continue;
        const answer = w.answer.trim().toUpperCase();
        if (!letterCount(answer)) continue;
        mine.push({answer, hint: typeof w.hint === "string" ? w.hint : "",
          difficulty: ["easy", "medium", "hard"].includes(w.difficulty) ? w.difficulty : "medium", cat: c.id, catName: name});
      }
      if (!mine.length) continue;
      cats.push({id: c.id, name});
      entries.push(...mine);
    }
    return {cats, entries};
  }
  function filterEntries(entries, s){
    return entries.filter(e => {
      const n = letterCount(e.answer);
      return s.cats.includes(e.cat) && n >= s.min && n <= s.max && (s.phrases || !e.answer.includes(" "));
    });
  }
  /* Random entry, avoiding an immediate repeat when there is a choice. */
  function pickEntry(list, avoid, rand){
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const i = Math.floor((rand || Math.random)() * list.length);
    return list[i].answer === avoid ? list[(i + 1) % list.length] : list[i];
  }
  function isSolved(answer, guessed){ for (const ch of answer) if (isLetter(ch) && !guessed.has(ch)) return false; return true; }
  /* Score: letters x difficulty, a flawless bonus that grows with the combo, +50 for a quick round. */
  function pointsFor(o){
    const per = o.diff === "hard" ? 20 : o.diff === "medium" ? 15 : 10;
    return o.letters * per + (o.flawless ? 25 * (o.comboBefore + 1) : 0) + (o.quick ? 50 : 0);
  }
  /* Deterministic daily index from a YYYY-MM-DD string. */
  function dailyIndex(dateStr, n){
    if (n <= 0) return 0;
    let h = 0;
    for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
    h ^= 0x9e3779b9; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
    return (h >>> 0) % n; /* the xor leaves a signed int; prototype B indexed below zero on about half of all days */
  }
  function todayStr(d){
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function yesterdayStr(){ const d = new Date(); d.setDate(d.getDate() - 1); return todayStr(d); }
  /* The daily word ignores the player's filters, so everyone gets the same one. */
  function dailyEntry(entries, cats, dateStr){
    const pool = filterEntries(entries, {min: 3, max: 14, phrases: true, cats: cats.map(c => c.id)});
    const list = pool.length ? pool : entries;
    return list.length ? list[dailyIndex(dateStr, list.length)] : null;
  }

  /* Badge rules per album; each skin keeps its own names and copy. f holds the game facts and stats. */
  const flawless = f => f.won && f.misses === 0 && !f.hintUsed;
  const catsWon = s => Object.keys(s.winsPerCat).filter(k => s.winsPerCat[k] > 0).length;
  const BADGE_RULES = {
    a: {
      "first-win": f => f.stats.won >= 1, "flawless": flawless, "close-call": f => f.won && f.lives - f.misses === 1,
      "streak-3": f => f.stats.best >= 3, "streak-5": f => f.stats.best >= 5, "streak-10": f => f.stats.best >= 10,
      "explorer": f => catsWon(f.stats) >= 3, "collector": f => f.cats.length > 0 && f.cats.every(c => f.stats.winsPerCat[c.id] > 0),
      "regular": f => f.stats.played >= 10, "veteran": f => f.stats.played >= 50
    },
    b: {
      first: f => f.stats.won >= 1, streak3: f => f.stats.streak >= 3, streak5: f => f.stats.streak >= 5,
      daily: f => f.won && f.mode === "daily", daily3: f => f.stats.dailyStreak >= 3, nomiss: flawless,
      comeback: f => f.won && f.lives - f.misses === 1, explorer: f => catsWon(f.stats) >= 4,
      hintwin: f => f.won && f.hintUsed, veg10: f => f.hits >= 10, ten: f => f.stats.played >= 10
    },
    c: {
      "first-win": f => f.stats.won >= 1, "clean-sheet": flawless, "hat-trick": f => f.stats.streak >= 3,
      "five-alive": f => f.stats.streak >= 5, "comeback": f => f.won && f.misses >= 3, "explorer": f => catsWon(f.stats) >= 5,
      "scholar": f => f.won && f.difficulty === "hard" && !f.hintUsed, "quick": f => f.quick,
      "scorer-500": f => f.score >= 500, "ever-present": f => f.stats.played >= 25
    }
  };
  /* Award every badge whose rule now holds; returns the new ids per album. */
  function earnBadges(stats, f){
    const fresh = {};
    for (const album in BADGE_RULES) {
      fresh[album] = [];
      for (const id in BADGE_RULES[album]) {
        if (stats.badges[album][id]) continue;
        let ok = false;
        try { ok = !!BADGE_RULES[album][id](Object.assign({stats}, f)); } catch (e) {}
        if (ok) { stats.badges[album][id] = Date.now(); fresh[album].push(id); }
      }
    }
    return fresh;
  }

  /* ---------------- storage ---------------- */
  function memoryBackend(){ const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v))}; }
  function makeStore(backend){
    return {
      backend,
      get(k){ try { const raw = backend.getItem(k); return raw == null ? null : JSON.parse(raw); } catch (e) { return null; } },
      set(k, v){ try { backend.setItem(k, JSON.stringify(v)); } catch (e) {} }
    };
  }
  const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
  const count = v => Math.max(0, Math.floor(Number(v)) || 0);
  /* Known category id for a stored key: current ids, A's old ids, or C's old lower-case names. */
  function catId(key, cats){
    if (cats.some(c => c.id === key)) return key;
    if (OLD_CAT_IDS[key]) return OLD_CAT_IDS[key];
    const c = cats.find(c => c.name.toLowerCase() === key);
    return c ? c.id : null;
  }
  function cleanSettings(v, cats){
    const o = isObj(v) ? v : {}, ids = cats.map(c => c.id);
    let min = clamp(Number(o.min) || 3, 3, 14), max = clamp(Number(o.max) || 14, 3, 14);
    if (min > max) [min, max] = [max, min];
    let picked = Array.isArray(o.cats) ? [...new Set(o.cats.map(k => catId(k, cats)))].filter(Boolean) : ids.slice();
    if (!picked.length) picked = ids.slice();
    return {min: Math.round(min), max: Math.round(max), phrases: o.phrases !== false, cats: picked,
      lives: Math.round(clamp(Number(o.lives) || 6, 4, 10)), muted: o.muted === true, quick: o.quick === true};
  }
  function cleanStats(v, cats){
    const o = isObj(v) ? v : {}, wins = {}, badges = {};
    for (const [k, n] of Object.entries(isObj(o.winsPerCat) ? o.winsPerCat : {})) {
      const id = catId(k, cats);
      if (id && count(n)) wins[id] = (wins[id] || 0) + count(n);
    }
    for (const album in BADGE_RULES) {
      badges[album] = {};
      const got = isObj(o.badges) && isObj(o.badges[album]) ? o.badges[album] : {};
      for (const id in BADGE_RULES[album]) if (Number(got[id]) > 0) badges[album][id] = Number(got[id]);
    }
    return {played: count(o.played), won: count(o.won), streak: count(o.streak), best: count(o.best),
      dailyStreak: count(o.dailyStreak), dailyLast: /^\d{4}-\d\d-\d\d$/.test(o.dailyLast) ? o.dailyLast : "",
      treats: count(o.treats), bestScore: count(o.bestScore), winsPerCat: wins, badges};
  }
  /* First run of the shared game: carry over a prototype's settings, preferring B, then A, then C. */
  function legacySettings(store, cats){
    const a = store.get("hangman-a:settings"), b = store.get("hangman-b:settings"), c = store.get("hangman-c:settings");
    const quick = isObj(c) ? c.quick : false;
    if (isObj(b)) return {min: b.minLen, max: b.maxLen, phrases: b.phrases, cats: b.cats, lives: b.lives, muted: b.muted, quick};
    if (isObj(a)) return Object.assign({}, a, {quick});
    if (isObj(c)) return {min: c.min, max: c.max, phrases: c.phrases, lives: c.lives, quick, muted: c.mute,
      cats: isObj(c.cats) ? cats.filter(k => (k.id in c.cats ? c.cats[k.id] : c.cats[k.name.toLowerCase()]) !== false).map(k => k.id) : undefined};
    return null;
  }
  const badgeMap = list => Array.isArray(list) ? Object.fromEntries(list.filter(id => typeof id === "string").map(id => [id, 1])) : {};
  /* Streaks and totals come from one prototype (B, then A, then C); badges, the daily streak and best score from their own. */
  function legacyStats(store){
    const a = store.get("hangman-a:stats"), b = store.get("hangman-b:stats"), c = store.get("hangman-c:stats");
    const A = isObj(a) ? a : null, B = isObj(b) ? b : null, C = isObj(c) ? c : null;
    if (!A && !B && !C) return null;
    const cWins = C && isObj(C.wins) ? C.wins : {};
    const base = B ? {streak: B.streak, best: B.best, played: B.games, won: B.wins, winsPerCat: B.winsPerCat}
      : A ? {streak: A.streak, best: A.best, played: A.played, won: A.won, winsPerCat: A.winsPerCat}
      : {streak: C.streak, best: C.bestStreak, played: C.played, won: Object.values(cWins).reduce((s, n) => s + count(n), 0), winsPerCat: cWins};
    return Object.assign(base, {
      dailyStreak: B && B.dailyStreak, dailyLast: B && B.dailyLast, treats: B && B.treats, bestScore: C && C.best,
      badges: {a: badgeMap(A && A.badges), b: badgeMap(B && B.badges), c: C && isObj(C.badges) ? C.badges : {}}
    });
  }

  /* ---------------- state ---------------- */
  let store = null, words = {cats: [], entries: []}, settings = null, stats = null;
  let run = {score: 0, combo: 0}, runOver = false, mode = "free", game = null, lastAnswer = "";
  const skins = {};
  let skin = null, skinId = "", root = null, life = null, keysEl = null, form = null, snapshot = null;

  function readWordData(){ try { return JSON.parse(document.getElementById("hangman-words").textContent); } catch (e) { return null; } }
  function load(){
    settings = cleanSettings(store.get(KEYS.settings) || legacySettings(store, words.cats), words.cats);
    stats = cleanStats(store.get(KEYS.stats) || legacyStats(store), words.cats);
    saveSettings(); saveStats();
  }
  const saveSettings = () => store.set(KEYS.settings, settings);
  const saveStats = () => store.set(KEYS.stats, stats);
  const facts = extra => Object.assign({won: false, misses: game.misses, lives: game.lives, hintUsed: game.hintUsed, hits: game.hits,
    difficulty: game.entry.difficulty, mode: game.mode, quick: false, score: run.score, cats: words.cats}, extra);

  /* Start a word. Skipping an unfinished word breaks the combo; the word after a loss starts a fresh run. */
  function begin(){
    if (game && game.entry && !game.over) run.combo = 0;
    if (runOver) { run = {score: 0, combo: 0}; runOver = false; }
    const entry = mode === "daily" ? dailyEntry(words.entries, words.cats, todayStr())
      : pickEntry(filterEntries(words.entries, settings), lastAnswer);
    if (entry) lastAnswer = entry.answer;
    game = {entry, mode, lives: settings.lives, guessed: new Set(), wrong: [], misses: 0, hits: 0,
      hintUsed: false, over: false, won: false, startTime: Date.now()};
    syncKeys();
    if (skin) skin.start(game, {resumed: false});
  }
  /* A new word on request. The daily puzzle is one word a day; auto-advance stays quiet about it. */
  function newGame(opts){
    opts = opts || {};
    if (opts.run) { run = {score: 0, combo: 0}; runOver = false; }
    if (mode === "daily") { if (!opts.auto && skin) skin.toast(DAILY_ONLY); return false; }
    begin();
    return true;
  }
  function setMode(m){
    if (m !== "free" && m !== "daily") return;
    if (m !== mode) { mode = m; begin(); }
  }
  function guess(L){
    const g = game;
    if (!g || !g.entry || g.over || !isLetter(L) || g.guessed.has(L)) return null;
    g.guessed.add(L);
    const hit = g.entry.answer.includes(L);
    if (hit) { g.hits++; stats.treats++; } else { g.wrong.push(L); g.misses++; }
    const won = hit && isSolved(g.entry.answer, g.guessed), lost = !hit && g.misses >= g.lives;
    if (won || lost) { g.over = true; g.won = won; }
    const res = {letter: L, hit, won, lost, left: g.lives - g.misses, badges: g.over ? [] : earnBadges(stats, facts())[skinId] || []};
    saveStats(); syncKeys();
    if (skin) skin.guessed(res);
    if (g.over) finish();
    return res;
  }
  function finish(){
    const g = game, s = stats, won = g.won, today = todayStr();
    const isFlawless = won && g.misses === 0 && !g.hintUsed;
    const quick = won && settings.quick && (Date.now() - g.startTime) / 1000 <= 60;
    let points = 0;
    s.played++;
    if (won) {
      s.won++; s.streak++; s.best = Math.max(s.best, s.streak);
      s.winsPerCat[g.entry.cat] = (s.winsPerCat[g.entry.cat] || 0) + 1;
      if (g.mode === "daily" && s.dailyLast !== today) {
        s.dailyStreak = (s.dailyLast === yesterdayStr() ? s.dailyStreak : 0) + 1;
        s.dailyLast = today;
      }
      points = pointsFor({letters: letterCount(g.entry.answer), diff: g.entry.difficulty, flawless: isFlawless, comboBefore: run.combo, quick});
      run.combo = isFlawless ? run.combo + 1 : 0;
      run.score += points;
      s.bestScore = Math.max(s.bestScore, run.score);
    } else {
      if (g.mode !== "daily") s.streak = 0; /* a lost daily puzzle keeps the free-play streak */
      run.combo = 0; runOver = true;
    }
    const fresh = earnBadges(s, facts({won, quick}));
    saveStats();
    if (skin) skin.finished({won, points, flawless: isFlawless, quick, badges: fresh[skinId] || []});
  }
  function hint(){
    if (!game || !game.entry || game.over) return "";
    game.hintUsed = true;
    return game.entry.hint;
  }

  /* ---------------- keyboard ---------------- */
  function keyboard(container){
    container.textContent = "";
    for (const L of LETTERS) {
      const b = document.createElement("button"), s = document.createElement("span");
      b.type = "button"; b.className = "key"; b.dataset.l = L; b.setAttribute("aria-label", "Guess " + L);
      s.textContent = L; b.appendChild(s);
      b.addEventListener("click", () => guess(L));
      container.appendChild(b);
    }
    keysEl = container;
    syncKeys();
  }
  function syncKeys(){
    if (!keysEl || !game) return;
    for (const b of keysEl.children) {
      const L = b.dataset.l, used = game.guessed.has(L), wrong = game.wrong.includes(L);
      b.classList.toggle("right", used && !wrong);
      b.classList.toggle("wrong", wrong);
      b.disabled = !game.entry || game.over || used;
    }
    keysEl.classList.toggle("over", game.over);
  }
  function onKey(e){
    if (!skin || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { if (skin.closeModal) skin.closeModal(); return; }
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "Enter") { if (skin.enter) skin.enter(e); return; }
    const L = e.key && e.key.length === 1 ? e.key.toUpperCase() : "";
    if (isLetter(L) && !(skin.modalOpen && skin.modalOpen())) guess(L);
  }

  /* ---------------- settings form ---------------- */
  const filterKey = () => JSON.stringify([settings.min, settings.max, settings.phrases, settings.cats.slice().sort(), settings.lives, mode]);
  function editSettings(){ snapshot = filterKey(); syncForm(); }
  /* Closing settings starts a new word only when the filters, lives or mode changed. */
  function doneSettings(){
    const changed = snapshot !== null && snapshot !== filterKey();
    snapshot = null;
    if (changed) begin();
    return changed;
  }
  function settingsChanged(){ if (skin && skin.sync) skin.sync(); syncForm(); }
  function resetSettings(){ settings = cleanSettings({}, words.cats); saveSettings(); settingsChanged(); }
  function toggleSound(){ settings.muted = !settings.muted; saveSettings(); settingsChanged(); return settings.muted; }
  function resetStats(){ stats = cleanStats({}, words.cats); run = {score: 0, combo: 0}; saveStats(); }

  function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function row(label, id, control){
    const r = el("div", "hm-row"), l = el("span", "hm-label", label);
    l.id = id; control.setAttribute("aria-labelledby", id);
    r.append(l, control);
    return r;
  }
  function radios(name, options, onPick){
    const g = el("div", "hm-opts");
    g.setAttribute("role", "radiogroup");
    for (const [value, label] of options) {
      const o = el("label", "hm-opt"), i = el("input");
      i.type = "radio"; i.name = name; i.value = value;
      i.addEventListener("change", () => { if (i.checked) onPick(value); });
      o.append(i, el("span", "", label));
      g.appendChild(o);
    }
    return g;
  }
  function range(id, label, min, max, onSet){
    const r = el("div", "hm-row hm-range"), l = el("label", "hm-label"), i = el("input");
    l.htmlFor = id; l.append(el("span", "", label), " ", el("output"));
    Object.assign(i, {type: "range", id, min, max, step: 1});
    i.addEventListener("input", () => { onSet(Number(i.value)); saveSettings(); settingsChanged(); });
    r.append(l, i);
    return r;
  }
  function toggle(key, label, onFlip){
    const r = el("div", "hm-row hm-switchrow"), l = el("span", "", label), b = el("button", "hm-switch");
    l.id = "hm-" + key + "-label";
    b.type = "button"; b.dataset.key = key; b.setAttribute("role", "switch"); b.setAttribute("aria-labelledby", l.id);
    b.addEventListener("click", () => { onFlip(); saveSettings(); settingsChanged(); });
    r.append(l, b);
    return r;
  }
  function buildForm(box){
    const f = el("div", "hm-form");
    f.append(
      row("Look", "hm-skin-label", radios("hm-skin", Object.keys(skins).map(k => [k, skins[k].meta.name]), switchSkin)),
      row("Mode", "hm-mode-label", radios("hm-mode", [["free", "Free play"], ["daily", "Daily puzzle"]], m => { mode = m; })),
      range("hm-min", "Shortest word", 3, 14, v => { settings.min = v; if (settings.max < v) settings.max = v; }),
      range("hm-max", "Longest word", 3, 14, v => { settings.max = v; if (settings.min > v) settings.min = v; }),
      range("hm-lives", "Lives", 4, 10, v => { settings.lives = v; }));
    const cats = el("div", "hm-cats");
    cats.setAttribute("role", "group");
    for (const c of words.cats) {
      const b = el("button", "hm-cat", c.name);
      b.type = "button"; b.dataset.cat = c.id;
      b.addEventListener("click", () => {
        const i = settings.cats.indexOf(c.id);
        if (i < 0) settings.cats.push(c.id);
        else if (settings.cats.length > 1) settings.cats.splice(i, 1);
        else { if (skin) skin.toast(KEEP_ONE); return; }
        saveSettings(); settingsChanged();
      });
      cats.appendChild(b);
    }
    const reset = el("button", "hm-reset", "Reset settings");
    reset.type = "button";
    reset.addEventListener("click", resetSettings);
    f.append(row("Categories", "hm-cats-label", cats),
      toggle("phrases", "Multi-word phrases", () => { settings.phrases = !settings.phrases; }),
      toggle("quick", "Quick-round bonus (+50 under 60 s)", () => { settings.quick = !settings.quick; }),
      toggle("sound", "Sound", () => { settings.muted = !settings.muted; }),
      reset);
    box.replaceChildren(f);
    form = f;
    syncForm();
  }
  function syncForm(){
    if (!form) return;
    for (const i of form.querySelectorAll("input[type=radio]")) i.checked = i.value === (i.name === "hm-skin" ? skinId : mode);
    for (const [id, v] of [["hm-min", settings.min], ["hm-max", settings.max], ["hm-lives", settings.lives]]) {
      const i = form.querySelector("#" + id);
      i.value = v; i.parentNode.querySelector("output").textContent = v;
    }
    for (const b of form.querySelectorAll(".hm-cat")) b.setAttribute("aria-pressed", String(settings.cats.includes(b.dataset.cat)));
    const on = {phrases: settings.phrases, quick: settings.quick, sound: !settings.muted};
    for (const b of form.querySelectorAll(".hm-switch")) b.setAttribute("aria-checked", String(on[b.dataset.key]));
  }

  /* ---------------- skin host ---------------- */
  /* Timers a skin starts are tracked so unmounting stops every loop and pending beat. */
  function makeTimers(){
    const t = new Set(), iv = new Set(), raf = new Set();
    return {
      setTimeout(fn, ms){ const id = setTimeout(() => { t.delete(id); fn(); }, ms); t.add(id); return id; },
      clearTimeout(id){ t.delete(id); clearTimeout(id); },
      setInterval(fn, ms){ const id = setInterval(fn, ms); iv.add(id); return id; },
      clearInterval(id){ iv.delete(id); clearInterval(id); },
      requestAnimationFrame(fn){ const id = requestAnimationFrame(ts => { raf.delete(id); fn(ts); }); raf.add(id); return id; },
      cancelAnimationFrame(id){ raf.delete(id); cancelAnimationFrame(id); },
      clearAll(){ t.forEach(clearTimeout); iv.forEach(clearInterval); raf.forEach(cancelAnimationFrame); t.clear(); iv.clear(); raf.clear(); }
    };
  }
  let actx = null;
  /* One shared AudioContext, created on the first sound after a gesture; none while muted. */
  function audio(){
    if (settings.muted) return null;
    try {
      if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
      if (actx.state === "suspended") actx.resume().catch(() => {});
      return actx;
    } catch (e) { return null; }
  }
  function context(lifeRef){
    return {
      get game(){ return game; }, get settings(){ return settings; }, get stats(){ return stats; },
      get run(){ return run; }, get mode(){ return mode; },
      cats: words.cats, letterCount, isLetter, todayStr, dailyDone: () => stats.dailyLast === todayStr(),
      guess, hint, newGame, setMode, keyboard, editSettings, doneSettings, resetSettings, toggleSound, resetStats, audio,
      timers: lifeRef.timers,
      on(target, type, fn, opts){ target.addEventListener(type, fn, opts); lifeRef.offs.push(() => target.removeEventListener(type, fn, opts)); },
      store: {get: k => store.get(k), set: (k, v) => store.set(k, v)}
    };
  }
  function mount(id){
    const def = skins[id];
    skinId = id; store.set(KEYS.skin, id);
    root.replaceChildren(document.getElementById("skin-" + id).content.cloneNode(true));
    document.title = def.meta.title;
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = def.meta.theme;
    life = {timers: makeTimers(), offs: []};
    keysEl = null; form = null; snapshot = null;
    skin = def.factory(context(life), root);
    const box = root.querySelector("[data-hm-settings]");
    if (box) buildForm(box);
  }
  function unmount(){
    if (!skin) return;
    life.timers.clearAll(); life.offs.forEach(off => off());
    skin = null; keysEl = null; form = null;
    root.replaceChildren();
    document.body.className = "";
  }
  /* Switch looks without a reload; the word in play carries over unless settings changed under it. */
  function switchSkin(id){
    if (!skins[id] || id === skinId) return;
    const changed = snapshot !== null && snapshot !== filterKey();
    snapshot = null;
    unmount(); mount(id);
    if (changed) begin(); else skin.start(game, {resumed: true});
    const opener = root.querySelector("[data-hm-open-settings]");
    if (opener) opener.focus({preventScroll: true});
  }

  function boot(){
    const params = new URLSearchParams(location.search), testing = params.has("selftest");
    let backend = null;
    try { backend = window.localStorage; } catch (e) {}
    /* ?selftest runs on throwaway storage so it never touches saved progress */
    store = makeStore(testing || !backend ? memoryBackend() : backend);
    words = parseWords(readWordData());
    load();
    root = document.getElementById("hm-root");
    document.addEventListener("keydown", onKey);
    let id = params.get("skin");
    if (!skins[id]) id = store.get(KEYS.skin);
    if (!skins[id]) id = DEFAULT_SKIN;
    mount(id);
    begin();
    if (testing && Hangman.selftest) Hangman.selftest();
  }

  return {
    skin(id, meta, factory){ skins[id] = {meta, factory}; },
    boot,
    /* for ?selftest */
    pure: {isLetter, letterCount, parseWords, filterEntries, pickEntry, isSolved, pointsFor, dailyIndex, todayStr, dailyEntry,
      earnBadges, cleanSettings, cleanStats, legacySettings, legacyStats, makeStore, memoryBackend, BADGE_RULES, LETTERS, KEYS},
    host: {
      get skins(){ return skins; }, get skinId(){ return skinId; }, get skin(){ return skin; }, get root(){ return root; },
      get keysEl(){ return keysEl; }, get game(){ return game; }, get settings(){ return settings; }, get stats(){ return stats; },
      get run(){ return run; }, get store(){ return store; }, get words(){ return words; },
      switchSkin, guess, newGame, setMode, hint, editSettings, doneSettings, begin,
      setSettings(s){ settings = cleanSettings(s, words.cats); saveSettings(); settingsChanged(); }
    }
  };
})();
