"use strict";
/* ============================================================
   Skin A, "Pen & paper": a hand-drawn gallows on lined paper.
   The engine owns words, rules, storage and the keyboard; this
   file draws the scene, plays the sounds and writes the copy.
   ============================================================ */
Hangman.skin("a", {name: "Pen & paper", title: "Hangman · Pen & paper", theme: "#fdf2f0"}, (ctx, root) => {
  const {setTimeout, clearTimeout} = ctx.timers;
  let game = null;
  /* Drawing order: the gallows, then the figure. */
  const STAGE_IDS = ["base", "upright", "beam", "brace", "rope", "head", "body", "armL", "armR", "legL", "legR"];
  /* Stages drawn after `misses` wrong guesses, spread evenly so the final miss always completes the figure.
     Lives never exceed the stage count, so every miss draws at least one stage. */
  function stagesShown(misses, lives){
    if (misses <= 0) return 0;
    if (misses >= lives) return STAGE_IDS.length;
    return Math.ceil(misses * STAGE_IDS.length / lives);
  }
  /* ---------- sound: quiet Web Audio, created on first gesture ---------- */
  let noiseBuf = null;
  const audio = ctx.audio;
  function tone(freq, dur, type, vol, when, glideTo){
    const a = audio(); if (!a) return;
    try {
      const t = a.currentTime + (when || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.06, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  /* filtered noise: the scratch of a pen nib on paper */
  function scratch(dur, when, vol, freq){
    const a = audio(); if (!a) return;
    try {
      if (!noiseBuf) {
        noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = a.currentTime + (when || 0), n = Math.max(0.05, Math.min(0.9, dur));
      const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
      src.buffer = noiseBuf;
      bp.type = "bandpass"; bp.frequency.value = freq || 2400; bp.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.035, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n);
      src.connect(bp).connect(g).connect(a.destination);
      src.start(t, Math.random() * 0.1); src.stop(t + n + 0.02);
    } catch {}
  }
  const sfx = {
    tap(){ tone(520, .09, "sine", .045); },
    good(){ tone(660, .12, "sine", .055); tone(990, .16, "sine", .04, .06); },
    bad(){ tone(196, .2, "triangle", .045); },
    snap(when){ scratch(.07, when, .06, 4200); tone(1250, .06, "triangle", .03, when); },
    thud(when){ tone(150, .16, "sine", .08, when, 70); },
    win(when){ [523, 659, 784, 1047].forEach((f, i) => tone(f, .2, "sine", .05, (when || 0) + i * .09)); },
    sigh(when){ tone(440, .9, "sine", .045, when, 262); }
  };
  ctx.on(window, "pointerdown", () => { audio(); }, {once: true});

  /* ---------- badges: the engine decides, this album names them ---------- */
  const BADGES = [
    ["first-win","Off the hook","Win your first round"],
    ["flawless","Clean sheet","Win without a single miss or clue"],
    ["close-call","By a thread","Win with one life left"],
    ["streak-3","Hat-trick","Reach a streak of 3"],
    ["streak-5","On a roll","Reach a streak of 5"],
    ["streak-10","Unstoppable","Reach a streak of 10"],
    ["explorer","Explorer","Win in 3 different categories"],
    ["collector","Full set","Win in every category"],
    ["regular","Regular","Play 10 games"],
    ["veteran","Dog-eared","Play 50 games"]
  ];
  const badgeName = id => (BADGES.find(b => b[0] === id) || ["", id])[1];
  const owned = () => ctx.stats.badges.a;

  /* ---------- DOM ---------- */
  const $ = id => document.getElementById(id);
  const tilesEl = $("tiles"), keysEl = $("keys"), missedEl = $("missed"),
        catTag = $("catTag"), diffTag = $("diffTag"), livesLabel = $("livesLabel"),
        clueBtn = $("clueBtn"), clueText = $("clueText"),
        emptyBox = $("emptyBox"), result = $("result"), toast = $("toast"), sceneSvg = $("scene");
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const EASE_OUT = "cubic-bezier(.23,1,.32,1)", EASE_IN_OUT = "cubic-bezier(.77,0,.175,1)",
        EASE_BACK = "cubic-bezier(.34,1.56,.64,1)",
        EASE_FALL = "cubic-bezier(.11,0,.5,0)"; /* gravity: speeds up into the landing */
  const DROP = 36; /* hanging feet (y 186) to the ground (y 222) */

  /* Pen strokes per stage: [path, group, style]. "ink" strokes get a faint pencil re-trace. */
  const STROKES = {
    base:    [["M38 223 C 66 219, 104 224, 138 221", "gallows", "ink"]],
    upright: [["M86 222 C 84 166, 87 104, 85 34", "gallows", "ink"]],
    beam:    [["M80 37 C 122 34, 168 38, 214 35", "gallows", "ink"]],
    brace:   [["M86 78 C 96 64, 108 52, 126 36", "gallows", "ink"]],
    rope:    [["M206 36 C 207.5 41, 205 46, 206 51", "gallows", "rope"], ["M206 51 C 207 56, 205 61, 206 66", "ropeB", "rope"]],
    head:    [["M206 66 C 216 66, 223 74, 223 83 C 223 93, 215 100, 206 100 C 196 100, 189 92, 189 83 C 189 74, 196 66.5, 208 67.5", "fig", "ink"],
              ["M199.6 80.4 L200.4 81.6", "eyes", "dot"], ["M211.6 80.4 L212.4 81.6", "eyes", "dot"],
              ["M201 89 Q 206 92.5 211 89", "mouth", "thin"]],
    body:    [["M206 100 C 205 116, 207 132, 206 148", "fig", "ink"]],
    armL:    [["M206 112 C 200 120, 192 128, 184 134", "fig", "ink"]],
    armR:    [["M206 112 C 212 120, 220 128, 228 134", "armR", "ink"]],
    legL:    [["M206 148 C 201 162, 195 174, 190 186", "fig", "ink"]],
    legR:    [["M206 148 C 211 162, 217 174, 222 186", "fig", "ink"]]
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  function svgPath(d, cls){
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d); p.setAttribute("pathLength", "1"); p.setAttribute("class", cls);
    return p;
  }
  /* STAGE_EL[i] = strokes for stage i: {el, sk, len} */
  const STAGE_EL = STAGE_IDS.map(id => STROKES[id].map(([d, group, style]) => {
    const g = $(group), s = {el: svgPath(d, "ink " + style), sk: null, len: 0};
    if (style === "ink") { s.sk = svgPath(d, "sk"); s.sk.setAttribute("transform", "translate(.9 .8)"); g.appendChild(s.sk); }
    g.appendChild(s.el);
    s.len = s.el.getTotalLength();
    return s;
  }));

  const G = {drawn: 0, round: 0, timers: []};
  const pen = {freeAt: 0};

  /* Run fn after ms unless a new round started meanwhile. */
  function later(ms, fn){
    const round = G.round;
    G.timers.push(setTimeout(() => { if (round === G.round) fn(); }, ms));
  }
  /* WAAPI with the end state committed, so a later animation starts from where this one left off. */
  function play(el, frames, opts){
    const a = el.animate(frames, {fill: "both", ...opts});
    a.onfinish = () => { try { a.commitStyles(); } catch {} a.cancel(); };
    return a;
  }

  /* One pen stroke: the nib travels the path. Reduced motion: a soft fade instead. */
  function inkStroke(el, dur, delay){
    el.style.strokeDashoffset = "0";
    if (RM.matches) el.animate([{opacity: 0}, {opacity: 1}], {duration: 220, delay, fill: "backwards"});
    else el.animate([{strokeDashoffset: "1.02"}, {strokeDashoffset: "0"}], {duration: dur, delay, easing: EASE_IN_OUT, fill: "backwards"});
  }
  /* Queue strokes on the single pen so each part follows the last, as by hand. Returns ms until the pen lifts. */
  function penDraw(strokes, fast){
    const now = performance.now();
    let t = Math.max(now, pen.freeAt);
    const hurry = t - now > 450; /* fast tapping: catch up rather than lag behind */
    for (const s of strokes) {
      let dur = Math.min(460, 90 + s.len * 2);
      if (fast) dur = Math.min(dur, 150); else if (hurry) dur *= 0.6;
      if (RM.matches) dur = 120;
      inkStroke(s.el, dur, t - now);
      if (s.sk) inkStroke(s.sk, dur * 1.05, t - now + 50);
      if (!fast) scratch(dur / 1000, (t - now) / 1000, 0.03, 2000 + Math.random() * 900);
      t += dur;
    }
    pen.freeAt = t;
    return t - now;
  }

  function resetDrawing(){
    const parts = $("parts");
    let ghost = null;
    if (G.drawn > 0 && !RM.matches) { /* rub out the old drawing while the fresh page is already live */
      ghost = parts.cloneNode(true);
      ghost.removeAttribute("id"); ghost.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
    }
    sceneSvg.getAnimations({subtree: true}).forEach(a => { const t = a.effect && a.effect.target; if (!t || !t.closest("#scenery")) a.cancel(); });
    parts.querySelectorAll(".ink, .sk").forEach(p => { p.style.strokeDashoffset = ""; p.style.opacity = ""; });
    for (const id of ["fig", "ropeB", "armR", "bubble", "eyes", "mouth", "xeyes", "sadMouth", "grin"]) { $(id).style.transform = ""; $(id).style.opacity = ""; }
    $("fx").replaceChildren();
    if (ghost) {
      parts.before(ghost);
      ghost.animate([{opacity: 1}, {opacity: 0, transform: "translate(-3px, 3px)"}], {duration: 260, easing: EASE_OUT}).onfinish = () => ghost.remove();
    }
    G.drawn = 0; pen.freeAt = 0;
  }

  function buildTiles(){
    tilesEl.innerHTML = "";
    const words = game.entry.answer.split(" ");
    tilesEl.style.setProperty("--n", Math.max(...words.map(w => w.length)));
    let i = 0;
    for (const word of words) {
      const ws = document.createElement("span");
      ws.className = "word";
      for (const ch of word) {
        const t = document.createElement("span"), c = document.createElement("span");
        t.style.setProperty("--r", ((Math.random() * 2 - 1) * 5).toFixed(1) + "deg");
        t.style.setProperty("--i", i++);
        c.className = "ch";
        if (ctx.isLetter(ch)) { t.className = "tile"; t.dataset.ch = ch; }
        else { t.className = "tile fixed shown"; c.textContent = ch; }
        t.appendChild(c); ws.appendChild(t);
      }
      tilesEl.appendChild(ws);
    }
  }
  /* Write letters into their blanks; the text only exists once revealed. */
  function writeLetters(tiles, cls){
    tiles.forEach(t => { t.firstChild.textContent = t.dataset.ch; });
    void tilesEl.offsetWidth;
    tiles.forEach((t, i) => { t.firstChild.style.transitionDelay = (i * 55) + "ms"; t.classList.add("shown"); if (cls) t.classList.add(cls); });
  }
  function renderMeta(){
    if (!game.entry) return;
    catTag.textContent = game.entry.catName;
    diffTag.textContent = game.entry.difficulty;
    diffTag.className = "tag diff-" + game.entry.difficulty;
    const left = game.lives - game.misses;
    livesLabel.textContent = `${left} of ${game.lives} lives left`;
  }
  function sync(){
    $("streakNum").textContent = ctx.stats.streak;
    $("soundBtn").setAttribute("aria-pressed", String(!ctx.settings.muted));
  }
  function addMissed(ch){
    const s = document.createElement("span");
    s.className = "ml"; s.textContent = ch;
    missedEl.appendChild(s);
    if (!RM.matches) s.animate([{opacity: 0, transform: "translateY(-6px) scale(.8)"}, {opacity: 1, transform: "none"}], {duration: 300, easing: EASE_OUT});
  }

  /* A fresh word, or the word in play redrawn after a skin switch. */
  function start(g, opts){
    game = g;
    G.round++;
    G.timers.forEach(clearTimeout); G.timers = [];
    resetDrawing();
    emptyBox.hidden = !!g.entry;
    keysEl.style.display = g.entry ? "" : "none";
    result.classList.remove("open");
    missedEl.replaceChildren(missedEl.firstElementChild);
    sync();
    if (!g.entry) {
      tilesEl.innerHTML = ""; livesLabel.textContent = ""; catTag.textContent = ""; diffTag.textContent = "";
      clueBtn.hidden = true; clueText.hidden = true;
      return;
    }
    clueText.hidden = true; clueText.classList.remove("show"); clueText.textContent = "";
    clueBtn.hidden = false;
    buildTiles(); renderMeta();
    if (!opts.resumed) return;
    writeLetters([...tilesEl.querySelectorAll(".tile:not(.shown)")].filter(t => g.guessed.has(t.dataset.ch)));
    g.wrong.forEach(addMissed);
    if (g.hintUsed) showClue();
    if (g.over && !g.won) writeLetters([...tilesEl.querySelectorAll(".tile:not(.shown)")], "late");
    const target = g.over ? STAGE_IDS.length : stagesShown(g.misses, g.lives), strokes = [];
    for (let i = 0; i < target; i++) strokes.push(...STAGE_EL[i]);
    G.drawn = target;
    penDraw(strokes, true);
    if (g.over) { writeResult(); showResult(); }
  }

  function guessed(res){
    if (res.hit) {
      sfx.good();
      writeLetters([...tilesEl.querySelectorAll(`.tile[data-ch="${res.letter}"]`)]);
    } else {
      sfx.bad();
      const target = stagesShown(game.misses, game.lives), strokes = [];
      for (let i = G.drawn; i < target; i++) strokes.push(...STAGE_EL[i]);
      G.drawn = target;
      penDraw(strokes);
      addMissed(res.letter);
    }
    renderMeta();
    toastBadges(res.badges, 0);
  }
  function toastBadges(ids, at){
    ids.forEach((id, i) => later(at + i * 2300, () => showToast("★ Badge unlocked: " + badgeName(id))));
  }
  function writeResult(){
    const s = ctx.stats;
    $("resTitle").textContent = game.won ? (game.misses === 0 ? "Not a single stroke!" : "Off the hook!") : "Oh, so close";
    $("resWord").textContent = game.entry.answer;
    $("resClue").textContent = game.entry.catName + " · " + game.entry.hint;
    $("resStats").textContent = `Streak ${s.streak} · best ${s.best} · ${game.lives - game.misses} of ${game.lives} lives left`;
  }
  function finished(out){
    writeResult(); renderMeta(); sync();
    const beat = out.won ? playWin() : playLoss();
    later(beat, showResult);
    toastBadges(out.badges, beat + 700);
  }
  function showResult(){ if (game && game.over) result.classList.add("open"); }

  /* ---------- win: the rope snaps, the figure drops to the grass, hops and waves ---------- */
  function playWin(){
    const ropeAt = STAGE_IDS.indexOf("rope"), hanging = G.drawn > ropeAt, fig = $("fig");
    if (!hanging) fig.style.transform = `translateY(${DROP}px)`; /* never strung up: sketch them standing on the grass */
    const rest = [];
    for (let i = Math.max(G.drawn, ropeAt + 1); i < STAGE_IDS.length; i++) rest.push(...STAGE_EL[i]);
    G.drawn = STAGE_IDS.length;
    const t = Math.max(penDraw(rest, true), 120) + 120;
    if (RM.matches) {
      later(t, () => {
        if (hanging) {
          play($("ropeB"), [{opacity: 1}, {opacity: 0}], {duration: 220});
          play(fig, [{opacity: 1}, {opacity: 0}], {duration: 160}).onfinish = () => {
            fig.getAnimations().forEach(a => a.cancel());
            fig.style.transform = `translateY(${DROP}px)`;
            play(fig, [{opacity: 0}, {opacity: 1}], {duration: 240});
          };
        }
        faceSwap("grin", ["mouth"]);
        play($("bubble"), [{opacity: 0}, {opacity: 1}], {duration: 260, delay: 300});
        sfx.win(0.1);
      });
      return t + 700;
    }
    let land = t;
    if (hanging) {
      later(t, () => {
        sfx.snap();
        snapMarks();
        play($("ropeB"), [{transform: "none", opacity: 1}, {transform: `translate(4px, ${DROP + 8}px) rotate(38deg)`, opacity: 0}], {duration: 520, easing: EASE_FALL});
        play(STAGE_EL[ropeAt][0].el, [{transform: "translateY(0)"}, {transform: "translateY(-3px)", offset: .3}, {transform: "translateY(0)"}], {duration: 380, easing: EASE_OUT});
        play(fig, [{transform: "translateY(0)"}, {transform: `translateY(${DROP}px)`}], {duration: 330, easing: EASE_FALL});
      });
      land = t + 330;
    }
    later(land, () => {
      sfx.thud();
      /* squash on landing, then a happy hop */
      play(fig, [
        {transform: `translateY(${DROP}px)`},
        {transform: `translateY(${DROP}px) scale(1.1, .86)`, offset: .25, easing: EASE_OUT},
        {transform: `translateY(${DROP - 16}px) scale(.96, 1.05)`, offset: .62, easing: "cubic-bezier(.5,0,.75,0)"},
        {transform: `translateY(${DROP}px) scale(1.04, .96)`, offset: .86},
        {transform: `translateY(${DROP}px)`}
      ], {duration: 760});
      faceSwap("grin", ["mouth"]);
    });
    later(land + 520, () => {
      sfx.win();
      play($("armR"), [
        {transform: "rotate(0)", easing: EASE_OUT},
        {transform: "rotate(-88deg)", offset: .24, easing: "ease-in-out"},
        {transform: "rotate(-58deg)", offset: .4, easing: "ease-in-out"},
        {transform: "rotate(-90deg)", offset: .56, easing: "ease-in-out"},
        {transform: "rotate(-58deg)", offset: .72, easing: "ease-in-out"},
        {transform: "rotate(-76deg)"}
      ], {duration: 1350});
      confetti();
      play($("bubble"), [{opacity: 0, transform: "scale(.6) rotate(-8deg)"}, {opacity: 1, transform: "none"}], {duration: 420, delay: 160, easing: EASE_BACK});
    });
    return land + 1100;
  }
  function snapMarks(){
    [[-8, -3], [8, -3], [-7, 4], [7, 4]].forEach(([dx, dy]) => {
      const p = svgPath(`M${206 + dx * .5} ${51 + dy * .5} l${dx * .7} ${dy * .7}`, "ink thin");
      p.style.cssText = "stroke:var(--accent);stroke-dashoffset:0;transform-box:view-box;transform-origin:206px 51px";
      $("fx").appendChild(p);
      p.animate([{opacity: 0, transform: "scale(.6)"}, {opacity: 1, transform: "scale(1)", offset: .3}, {opacity: 0, transform: "scale(1.25)"}],
        {duration: 380, easing: EASE_OUT}).onfinish = () => p.remove();
    });
  }
  function confetti(){
    const cols = ["#e0457f", "#f59bbb", "#b0275e", "#f7c35f", "#c97fd8"];
    const shapes = ["M0 3 C -6 -3, -3 -8, 0 -4 C 3 -8, 6 -3, 0 3 Z", "M0 -5 L1.5 -1.5 5 0 1.5 1.5 0 5 -1.5 1.5 -5 0 -1.5 -1.5 Z", "M-4 0 Q -2 -3, 0 0 T 4 0"];
    for (let i = 0; i < 16; i++) {
      const p = document.createElementNS(SVGNS, "path"), k = i % 3;
      p.setAttribute("d", shapes[k]);
      if (k === 2) { p.setAttribute("fill", "none"); p.setAttribute("stroke", cols[i % 5]); p.setAttribute("stroke-width", "1.8"); p.setAttribute("stroke-linecap", "round"); }
      else p.setAttribute("fill", cols[i % 5]);
      $("fx").appendChild(p);
      const a = -Math.PI * (0.08 + 0.84 * (i / 15)) + (Math.random() - .5) * .3, r = 46 + Math.random() * 44;
      const x = 206 + Math.cos(a) * r, y = 112 + Math.sin(a) * r * .9, s = .9 + Math.random() * .7, rot = (Math.random() - .5) * 260;
      p.animate([
        {transform: "translate(206px, 116px) scale(.4)", opacity: 0},
        {transform: `translate(${(206 + x) / 2}px, ${(116 + y) / 2}px) scale(${s})`, opacity: 1, offset: .2},
        {transform: `translate(${x}px, ${y}px) rotate(${rot * .7}deg) scale(${s})`, opacity: 1, offset: .65},
        {transform: `translate(${x}px, ${y + 22}px) rotate(${rot}deg) scale(${s * .8})`, opacity: 0}
      ], {duration: 1500 + Math.random() * 500, delay: i * 14, easing: EASE_OUT, fill: "both"}).onfinish = () => p.remove();
    }
  }
  /* Swap a face detail: the old line lifts away, the new one is drawn by pen. */
  function faceSwap(showId, hideIds){
    for (const id of hideIds) play($(id), [{opacity: 1}, {opacity: 0}], {duration: 180});
    const el = $(showId);
    el.style.opacity = "1";
    inkStroke(el, 260, 60);
  }

  /* ---------- loss: the face turns to crosses, the paper lets out a sigh ---------- */
  function playLoss(){
    const t = Math.max(0, pen.freeAt - performance.now()) + 260;
    later(t, () => {
      faceSwap("xeyes", ["eyes"]);
      later(260, () => faceSwap("sadMouth", ["mouth"]));
      sfx.sigh(0.25);
      if (!RM.matches) {
        play(sceneSvg, [
          {transform: "none", easing: "ease-in-out"},
          {transform: "translateY(3px) scale(.988, .972)", offset: .42, easing: "ease-in-out"},
          {transform: "none"}
        ], {duration: 1500, delay: 120});
        sighPuff();
      }
      writeLetters([...tilesEl.querySelectorAll(".tile:not(.shown)")], "late");
    });
    return t + 1100;
  }
  function sighPuff(){
    const p = svgPath("M198 92 q-4 -3 -8 0 t-8 0", "ink thin");
    p.style.cssText = "stroke:var(--ink-faint);stroke-dashoffset:0";
    $("fx").appendChild(p);
    p.animate([{opacity: 0, transform: "translate(0, 0)"}, {opacity: .9, transform: "translate(-6px, -6px)", offset: .3}, {opacity: 0, transform: "translate(-16px, -20px)"}],
      {duration: 1500, delay: 500, easing: EASE_OUT, fill: "both"}).onfinish = () => p.remove();
  }

  /* ---------- toast ---------- */
  let toastT = null;
  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add("open");
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove("open"), 2100);
  }
  /* ---------- sheets ---------- */
  const scrim = $("scrim"), setSheet = $("settingsSheet"), statsSheet = $("statsSheet");
  function openSheet(el){ closeSheets(); scrim.classList.add("open"); el.classList.add("open"); }
  /* Returns true when closing settings started a new word. */
  function closeSheets(){
    const wasSettings = setSheet.classList.contains("open");
    scrim.classList.remove("open"); setSheet.classList.remove("open"); statsSheet.classList.remove("open");
    return wasSettings && ctx.doneSettings();
  }
  function openSettings(){ result.classList.remove("open"); ctx.editSettings(); openSheet(setSheet); }
  scrim.addEventListener("click", closeSheets);
  $("settingsClose").addEventListener("click", closeSheets);
  $("statsClose").addEventListener("click", closeSheets);
  /* tapping the drawing skips the end beat straight to the result */
  $("sceneCard").addEventListener("click", showResult);

  $("settingsBtn").addEventListener("click", openSettings);
  $("newWordBtn").addEventListener("click", () => { if (closeSheets() || ctx.newGame()) showToast("Fresh page, new word"); });
  $("emptySettings").addEventListener("click", openSettings);
  $("soundBtn").addEventListener("click", () => {
    const muted = ctx.toggleSound();
    showToast(muted ? "Sound off" : "Sound on");
    if (!muted) sfx.tap();
  });
  $("resSettings").addEventListener("click", openSettings);
  $("resNext").addEventListener("click", () => ctx.newGame());
  function showClue(){
    clueText.textContent = game.entry ? game.entry.hint : "";
    clueBtn.hidden = true;
    clueText.hidden = false; clueText.classList.add("show");
  }
  clueBtn.addEventListener("click", () => { sfx.tap(); ctx.hint(); showClue(); });

  /* ---------- stats UI ---------- */
  function syncStatsUI(){
    const s = ctx.stats;
    $("stStreak").textContent = s.streak;
    $("stBest").textContent = s.best;
    $("stPlayed").textContent = s.played;
    $("stWon").textContent = s.won;
    const cw = $("catWins"); cw.innerHTML = "";
    ctx.cats.forEach(({id, name}) => {
      const a = document.createElement("span"), b = document.createElement("b");
      a.textContent = name; b.textContent = s.winsPerCat[id] || 0;
      cw.append(a, b);
    });
    const g = $("badgeGrid"); g.innerHTML = "";
    BADGES.forEach(([id, name, desc]) => {
      const d = document.createElement("div"), b = document.createElement("b"), got = !!owned()[id];
      d.className = "badge " + (got ? "won" : "locked");
      b.textContent = (got ? "★ " : "☆ ") + name;
      d.append(b, desc);
      g.appendChild(d);
    });
  }
  $("statsBtn").addEventListener("click", () => { syncStatsUI(); openSheet(statsSheet); });

  /* ---------- boot ---------- */
  document.body.classList.add("load");
  ctx.keyboard(keysEl);

  return {
    start, guessed, finished, sync, toast: showToast,
    badgeIds: BADGES.map(b => b[0]),
    modalOpen: () => setSheet.classList.contains("open") || statsSheet.classList.contains("open") || result.classList.contains("open"),
    closeModal: closeSheets,
    enter(){ if (result.classList.contains("open")) ctx.newGame(); },
    selftest(t){
      t("stages: 6 lives", () => [0,1,2,3,4,5,6].map(m => stagesShown(m, 6)).join(), "0,2,4,6,8,10,11");
      t("stages: 4 lives", () => [0,1,2,3,4].map(m => stagesShown(m, 4)).join(), "0,3,6,9,11");
      t("stages: 10 lives", () => [0,1,9,10].map(m => stagesShown(m, 10)).join(), "0,2,10,11");
      t("stages: every miss draws, last miss completes (4-10 lives)", () => [4,5,6,7,8,9,10].every(L => {
        for (let m = 1; m <= L; m++) if (stagesShown(m, L) <= stagesShown(m - 1, L)) return false;
        return stagesShown(L, L) === 11 && stagesShown(L - 1, L) < 11;
      }));
      t("every stage has pen strokes", () => STAGE_IDS.every(id => STROKES[id] && STROKES[id].length > 0));
      t("the clue shows the hint", () => { ctx.hint(); showClue(); return !clueText.hidden && clueText.textContent === game.entry.hint; });
    }
  };
});
