"use strict";
/* ============================================================
   Skin C, "Arcade run": a floodlit match where right letters
   push one side forward and misses push the other, with a run
   score and combo on top. The engine owns words, rules, scoring,
   storage and the keyboard; this file runs the pitch, the sounds
   and the copy.
   ============================================================ */
Hangman.skin("c", {name: "Arcade run", title: "Arcade Run — Hangman", theme: "#0a0016", fit: "nextBtn"}, (ctx, root) => {
  const {setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame} = ctx.timers;
  const {isLetter} = ctx;

  const BADGES = [
    ["first-win","Off the Mark","Solve your first word"],
    ["clean-sheet","Clean Sheet","Solve with zero misses and no clue"],
    ["hat-trick","Hat-Trick Hero","Reach a 3-word streak"],
    ["five-alive","Five Alive","Reach a 5-word streak"],
    ["comeback","Great Escape","Solve after 3 or more misses"],
    ["explorer","Globetrotter","Win in 5 different categories"],
    ["scholar","No Peeking","Solve a hard word with no clue"],
    ["quick","Quick Off the Mark","Earn a quick-round bonus"],
    ["scorer-500","Five Hundred Club","Score 500+ in one run"],
    ["ever-present","Ever Present","Play 25 words"]
  ];

  /* ================= PURE LOGIC (tested by ?selftest) ================= */
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  /* Largest tile width (20-38px) that keeps every word on one line and the
     whole answer within maxH. Tiles are 1.3x as tall as wide, 5px apart;
     words wrap 16px apart and rows 8px apart, as in .tiles. */
  function tileSize(lens, room, maxH){
    for (let t = 38; t > 20; t--){
      let rows = 1, x = 0, fits = true;
      for (const n of lens){
        const w = n * t + (n - 1) * 5;
        if (w > room){ fits = false; break; }
        if (x && x + 16 + w > room){ rows++; x = w; } else x += (x ? 16 : 0) + w;
      }
      if (fits && rows * t * 1.3 + (rows - 1) * 8 <= maxH) return t;
    }
    return 20;
  }
  /* Reveal map: letters guessed show; digits/punctuation/spaces
     are always shown (spaces render as gaps). */
  function maskOf(text, guessed){
    const cells = [];
    for (const ch of text){
      if (ch === " "){ cells.push({ ch:ch, kind:"gap", shown:true }); }
      else if (isLetter(ch)){ cells.push({ ch:ch, kind:"letter", shown:guessed.has(ch) }); }
      else { cells.push({ ch:ch, kind:"fixed", shown:true }); }
    }
    return cells;
  }
  /* Share of the word's distinct letters found so far. */
  function revealedFraction(text, guessed){
    const need = new Set();
    for (const ch of text) if (isLetter(ch)) need.add(ch);
    let got = 0;
    need.forEach(function(ch){ if (guessed.has(ch)) got++; });
    return need.size ? got / need.size : 1;
  }
  /* Small seeded generator (mulberry32), so a word's choices replay exactly. */
  function seededRand(seed){
    let a = seed >>> 0;
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let q = Math.imul(a ^ (a >>> 15), a | 1);
      q ^= q + Math.imul(q ^ (q >>> 7), q | 61);
      return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* The match as a pure function of the word: each correct letter swings play
     towards the City goal (x=0), each miss towards the Arsenal goal (x=105).
     Whoever is ahead on the swing has the ball; a dead level swing goes to the
     word's seed. Play stays outside both penalty areas until the word ends:
     the solving letter is Arsenal's shot, the final miss City's. */
  const SWING_REACH = 34;
  function matchState(revealed, misses, lives, seed){
    const r = clamp(revealed, 0, 1), m = clamp(misses / lives, 0, 1);
    const tilt = m - r;
    const shot = r >= 1 ? "ars" : m >= 1 ? "city" : null;
    const poss = shot || (Math.abs(tilt) < 1e-9 ? (seed & 1 ? "ars" : "city") : tilt > 0 ? "city" : "ars");
    return {
      poss:poss, shot:shot, lastLife: lives - misses === 1,
      x: shot === "ars" ? 0 : shot === "city" ? 105 : 52.5 + SWING_REACH * tilt,
      /* the point of play wanders across the width as the word goes on */
      y: clamp(34 + 20 * Math.sin((seed % 628) / 100 + r * 4.1 + m * 3.3), 8, 60)
    };
  }
  /* Goal-scoring moves and their captions, by the side that scores. */
  const FINISHES = {
    ars: { longBall:"Long ball over the top", counter:"Counter-attack", throughBall:"Through ball, one-on-one", oneTwo:"One-two", cutBack:"Cut-back" },
    city: { buildUp:"Patient build-up", turnover:"Turnover and counter", corner:"Header from a corner" }
  };
  /* Moves that suit where play was (`st`, the state before the deciding
     guess), skipping the one played last time. */
  function pickFinish(side, st, last, rand){
    let fits;
    if (side === "ars"){
      if (st.lastLife || st.x > 64) fits = ["counter", "longBall"];   /* City camped in Arsenal's half */
      else if (st.x > 40) fits = ["throughBall", "longBall"];          /* even play */
      else fits = ["oneTwo", "cutBack"];                               /* Arsenal in the final third */
    } else {
      if (st.x > 64) fits = ["buildUp", "corner"];                     /* City dominated */
      else if (st.poss === "ars") fits = ["turnover", "corner"];       /* Arsenal had the ball, pressing high */
      else fits = ["corner", "buildUp"];                               /* even play */
    }
    fits = fits.filter(function(k){ return k !== last; });
    return fits[Math.floor(rand() * fits.length)];
  }
  /* Pitch coordinates are metres: x 0-105 towards the Arsenal goal,
     y 0-68 from the far touchline. Formations are written in each team's
     own frame, x towards the goal it attacks. Index 0 is the goalkeeper. */
  /* Man City 4-3-3: GK, LB, LCB, RCB, RB, CDM, LCM, RCM, LW, ST, RW */
  const CITY_START = [[5,34],[22,9],[17,24],[17,44],[22,59],[30,34],[38,22],[38,46],[48,8],[50,34],[48,60]];
  const CITY_CHANCE = [[28,34],[68,10],[50,25],[50,43],[62,47],[66,33],[80,21],[83,44],[95,13],[88,33],[95,56]];
  /* Arsenal 4-4-2: GK, back four, midfield four, two strikers */
  const ARS_START = [[2,34],[40.5,12],[39,27],[39,41],[40.5,56],[53,10],[52,26],[52,42],[53,58],[65,27],[65,41]];
  const ARS_CHANCE = [[26,34],[64,9],[52,25],[52,43],[64,59],[92,11],[78,27],[80,42],[92,57],[90,30],[87,40]];
  const FORMS = { city:{ start:CITY_START, chance:CITY_CHANCE }, ars:{ start:ARS_START, chance:ARS_CHANCE } };
  /* wide: far-side then near-side wide player */
  const ROLES = {
    city: { st:[9], wide:[8,10], mid:[6,7,5], back:[2,3] },
    ars:  { st:[9,10], wide:[5,8], mid:[6,7], back:[2,3] }
  };
  /* In possession: from the kick-off shape towards the chance shape; the
     midfield and attack overload one flank mid-move, then converge. */
  function attackShape(f, a, flank){
    return f.start.map(function(s, i){
      const c = f.chance[i];
      let y = s[1] + (c[1] - s[1]) * a;
      if (i >= 6) y += (flank || 0) * 3 * Math.sin(Math.PI * a);
      return [s[0] + (c[0] - s[0]) * a, clamp(y, 2, 66)];
    });
  }
  /* Out of possession: drop deeper and narrower as the opponents advance
     (p), each line sliding towards the ball. */
  function blockShape(f, p, ballY){
    const by = ballY == null ? 34 : ballY, squeeze = 1 - 0.18 * p;
    return f.start.map(function(s, i){
      if (!i) return [s[0], clamp(34 + (by - 34) * 0.12, 31, 37)];
      const pull = i <= 4 ? 0.22 : i <= 7 ? 0.34 : 0.4;
      return [6 + (s[0] - 6) * (1 - 0.75 * p), clamp(34 + (s[1] - 34) * squeeze + (by - 34) * pull, 3, 65)];
    });
  }
  /* How far the side in possession has pushed on, 0-1. */
  function advanceOf(st){
    return clamp(((st.poss === "city" ? st.x : 105 - st.x) - 36) / 48, 0, 1);
  }
  /* A team's shape for a match state, in pitch coordinates. */
  function teamShape(team, st){
    const a = advanceOf(st), f = FORMS[team];
    const own = st.poss === team ? attackShape(f, a, st.y < 34 ? -1 : 1) : blockShape(f, a, st.y);
    return team === "city" ? own : own.map(function(q){ return [105 - q[0], q[1]]; });
  }
  /* Who has the ball: the outfield player nearest the point of play,
     strikers excepted (they make the runs for the finish). */
  function carrierFor(shape, st, strikers){
    let best = 1, bd = Infinity;
    for (let i = 1; i < shape.length; i++){
      if (strikers.indexOf(i) !== -1) continue;
      const d = Math.hypot(shape[i][0] - st.x, shape[i][1] - st.y);
      if (d < bd){ bd = d; best = i; }
    }
    return best;
  }
  /* An outfield player positioned between the ball and the target to
     play the ball through; -1 when nobody fits. */
  function pickRelay(fromIdx, toIdx, shape, ballX, rand){
    const tx = shape[toIdx][0];
    const lo = Math.min(ballX, tx) - 8, hi = Math.max(ballX, tx) + 6;
    let best = -1, bestScore = -Infinity;
    for (let i = 1; i < shape.length; i++){
      if (i === fromIdx || i === toIdx) continue;
      const x = shape[i][0];
      if (x < lo || x > hi) continue;
      const score = rand() * 10 - Math.abs(x - (ballX + tx) / 2) * 0.5;
      if (score > bestScore){ bestScore = score; best = i; }
    }
    return best;
  }
  /* Motion segment: cubic Hermite from the actor's current position and
     velocity to a resting target, so a new move never jolts the old one.
     `bulge` bends the path sideways without changing either end velocity. */
  function makeSeg(t0, d, from, to, bulge){
    let vx = from.vx, vy = from.vy;
    const cap = (Math.hypot(to[0] - from.x, to[1] - from.y) * 1.2 + 2) / d;
    const sp = Math.hypot(vx, vy);
    if (sp > cap){ vx *= cap / sp; vy *= cap / sp; }
    return { t0:t0, d:Math.max(0.001, d), p0:[from.x, from.y], v0:[vx, vy], p1:[to[0], to[1]], bulge:bulge || null };
  }
  function evalSeg(s, t){
    if (t >= s.t0 + s.d) return { x:s.p1[0], y:s.p1[1], vx:0, vy:0 };
    const u = Math.max(0, (t - s.t0) / s.d), u2 = u * u, u3 = u2 * u;
    const h00 = 2*u3 - 3*u2 + 1, h10 = u3 - 2*u2 + u, h01 = 3*u2 - 2*u3;
    const d00 = 6*u2 - 6*u, d10 = 3*u2 - 4*u + 1, d01 = 6*u - 6*u2;
    const b = 16 * u2 * (1 - u) * (1 - u), db = 32 * u * (1 - u) * (1 - 2*u);
    const bx = s.bulge ? s.bulge[0] : 0, by = s.bulge ? s.bulge[1] : 0;
    return {
      x: h00*s.p0[0] + h10*s.d*s.v0[0] + h01*s.p1[0] + b*bx,
      y: h00*s.p0[1] + h10*s.d*s.v0[1] + h01*s.p1[1] + b*by,
      vx: (d00*s.p0[0] + d10*s.d*s.v0[0] + d01*s.p1[0] + db*bx) / s.d,
      vy: (d00*s.p0[1] + d10*s.d*s.v0[1] + d01*s.p1[1] + db*by) / s.d
    };
  }

  /* ================= audio (quiet, gesture-started) ================= */
  /* The engine's shared AudioContext, through this skin's quiet master gain. */
  let actx = null, master = null;
  function ensureAudio(){
    const a = ctx.audio();
    if (!a || a === actx) return;
    actx = a;
    master = actx.createGain();
    master.gain.value = 0.14;
    master.connect(actx.destination);
  }
  function tone(freq, dur, type, when, slideTo, vol){
    if (!actx || ctx.settings.muted) return;
    try{
      const t = actx.currentTime + (when || 0);
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 1, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }catch(e){}
  }
  function crowd(dur, low, when, vol){
    if (!actx || ctx.settings.muted) return;
    try{
      const t = actx.currentTime + (when || 0);
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = low ? 300 : 1200; f.Q.value = 0.6;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.9, t + dur * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t);
    }catch(e){}
  }
  const SFX = {
    click(){ tone(660, 0.07, "triangle", 0); },
    good(){ tone(740, 0.1, "sine", 0); tone(988, 0.12, "sine", 0.07); },
    bad(){ tone(196, 0.22, "sawtooth", 0, 130); },
    kick(){ tone(150, 0.09, "sine", 0, 60, 0.45); },
    shot(){ tone(130, 0.12, "triangle", 0, 55); crowd(0.5, false, 0, 0.4); },
    tackle(){ tone(120, 0.1, "triangle", 0, 70, 0.7); },
    clear(){ tone(170, 0.12, "sine", 0, 60); crowd(0.8, false, 0.05, 0.5); },
    cheer(){ tone(523,0.12,"triangle",0); tone(659,0.12,"triangle",0.1); tone(784,0.2,"triangle",0.2); crowd(0.9,false,0.05); },
    groan(){ tone(330,0.3,"sawtooth",0,140); tone(220,0.4,"sawtooth",0.15,90); crowd(1.1,true,0); },
    badge(){ tone(880,0.1,"sine",0); tone(1174,0.16,"sine",0.09); }
  };
  ctx.on(window, "pointerdown", ensureAudio, { passive:true });
  ctx.on(window, "keydown", ensureAudio);

  /* ================= stadium: projection ================= */
  /* A side-on broadcast camera: the far touchline is narrower and higher. */
  const CAM_D = 200, CAM_F = 724, Y_FAR = 62, Y_NEAR = 246;
  function depthScale(y){ return CAM_F / (CAM_D + (68 - y)); }
  const K_NEAR = depthScale(68), K_FAR = depthScale(0);
  const CAM_H = (Y_NEAR - Y_FAR) / (K_NEAR - K_FAR);
  const CAM_Y0 = Y_FAR - CAM_H * K_FAR;
  function project(x, y, z){
    const k = depthScale(y);
    return [200 + (x - 52.5) * k, CAM_Y0 + CAM_H * k - (z || 0) * k, k];
  }
  /* goals are drawn larger than life so they read next to the figures */
  const GOAL_HW = 4.6, GOAL_H = 5.2, GOAL_D = 2.4;

  function f1(n){ return n.toFixed(1); }
  function ptsStr(list){ return list.map(function(p){ return f1(p[0]) + "," + f1(p[1]); }).join(" "); }
  function pathOf(list, close){ return "M" + list.map(function(p){ return f1(p[0]) + " " + f1(p[1]); }).join("L") + (close ? "Z" : ""); }
  function P(x, y, z){ return project(x, y, z).slice(0, 2); }
  function quad(x0, y0, x1, y1){ return [P(x0,y0), P(x1,y0), P(x1,y1), P(x0,y1)]; }
  function arc(cx, cy, r, keep){
    const out = [];
    for (let i = 0; i <= 64; i++){
      const a = i / 64 * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!keep || keep(x)) out.push(P(x, y));
    }
    return out;
  }
  function goalSVG(gx, out){
    /* out: +1 net behind x=105, -1 net behind x=0 */
    const bx = gx + out * GOAL_D, y0 = 34 - GOAL_HW, y1 = 34 + GOAL_HW, hb = GOAL_H * 0.82;
    let mesh = "";
    for (let i = 1; i < 6; i++){
      const y = y0 + (y1 - y0) * i / 6;
      mesh += pathOf([P(gx, y, GOAL_H), P(bx, y, hb), P(bx, y, 0)]);
    }
    for (let i = 1; i < 4; i++){
      const z = hb * i / 4;
      mesh += pathOf([P(bx, y0, z), P(bx, y1, z)]);
    }
    const back = '<polygon points="' + ptsStr([P(bx,y0,0), P(bx,y0,hb), P(bx,y1,hb), P(bx,y1,0)]) + '" fill="rgba(255,233,244,.07)"/>' +
      '<polygon points="' + ptsStr([P(gx,y0,GOAL_H), P(bx,y0,hb), P(bx,y1,hb), P(gx,y1,GOAL_H)]) + '" fill="rgba(255,233,244,.05)"/>' +
      '<path d="' + mesh + pathOf([P(gx,y0,GOAL_H), P(bx,y0,hb), P(bx,y0,0), P(gx,y0,0)]) + pathOf([P(gx,y1,GOAL_H), P(bx,y1,hb), P(bx,y1,0), P(gx,y1,0)]) +
      '" fill="none" stroke="rgba(255,233,244,.4)" stroke-width=".5"/>';
    const frame = '<path d="' + pathOf([P(gx,y0,0), P(gx,y0,GOAL_H), P(gx,y1,GOAL_H), P(gx,y1,0)]) +
      '" fill="none" stroke="#ff2e88" stroke-width="3" stroke-opacity=".35" stroke-linejoin="round"/>' +
      '<path d="' + pathOf([P(gx,y0,0), P(gx,y0,GOAL_H), P(gx,y1,GOAL_H), P(gx,y1,0)]) +
      '" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>';
    return { back:back, frame:frame };
  }
  function buildPitch(svg){
    let s = '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0731"/><stop offset="1" stop-color="#07010f"/></linearGradient>' +
      '<pattern id="crowd" width="14" height="7" patternUnits="userSpaceOnUse">' +
        '<circle cx="2" cy="2" r="1.3" fill="#ff7ab8" fill-opacity=".45"/><circle cx="7" cy="4.6" r="1.3" fill="#7fd4ff" fill-opacity=".3"/>' +
        '<circle cx="11.5" cy="1.8" r="1.2" fill="#fff" fill-opacity=".22"/><circle cx="4.6" cy="5.6" r="1.1" fill="#ff4d5e" fill-opacity=".35"/>' +
        '<circle cx="9.6" cy="6.4" r="1" fill="#ff2e88" fill-opacity=".3"/></pattern>' +
      '<linearGradient id="standShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07010f" stop-opacity=".9"/><stop offset=".7" stop-color="#07010f" stop-opacity=".2"/><stop offset="1" stop-color="#07010f" stop-opacity=".55"/></linearGradient>' +
      '<linearGradient id="board" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2e88"/><stop offset=".5" stop-color="#b3186a"/><stop offset="1" stop-color="#ff2e88"/></linearGradient>' +
      '<radialGradient id="pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".13"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="vig" cx=".5" cy=".55" r=".75"><stop offset=".6" stop-color="#05010d" stop-opacity="0"/><stop offset="1" stop-color="#05010d" stop-opacity=".7"/></radialGradient>' +
      '<radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ffd6ea" stop-opacity=".7"/><stop offset="1" stop-color="#ff2e88" stop-opacity="0"/></radialGradient>' +
      '<filter id="neon" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4"/></filter>' +
      '</defs>';
    s += '<rect width="400" height="266" fill="url(#sky)"/>';
    /* stand and crowd */
    s += '<rect y="10" width="400" height="' + (Y_FAR - 12) + '" fill="#13052a"/>';
    s += '<rect y="10" width="400" height="' + (Y_FAR - 12) + '" fill="url(#crowd)"/>';
    s += '<rect y="10" width="400" height="' + (Y_FAR - 12) + '" fill="url(#standShade)"/>';
    s += '<path d="M0 10H400" stroke="#ff2e88" stroke-width="1.2" stroke-opacity=".7"/>';
    /* floodlight lamps on the roof */
    [40, 140, 260, 360].forEach(function(x){ s += '<ellipse cx="' + x + '" cy="8" rx="26" ry="9" fill="url(#lamp)"/>'; });
    /* surrounding grass and stripes */
    s += '<polygon points="' + ptsStr(quad(-12, -4, 117, 74)) + '" fill="#0a4a33"/>';
    for (let i = 0; i < 10; i++){
      s += '<polygon points="' + ptsStr(quad(i * 10.5, 0, (i + 1) * 10.5, 68)) + '" fill="' + (i % 2 ? "#0e6444" : "#117a52") + '"/>';
    }
    /* LED board behind the far touchline */
    const b0 = P(-6, -3, 0), b1 = P(111, -3, 1.3);
    s += '<rect x="' + f1(b0[0]) + '" y="' + f1(b1[1]) + '" width="' + f1(b1[0] - b0[0]) + '" height="' + f1(b0[1] - b1[1]) + '" fill="url(#board)" opacity=".85"/>';
    s += '<text x="200" y="' + f1(b0[1] - 1) + '" font-size="3" font-weight="800" letter-spacing="2" fill="#fff" text-anchor="middle" opacity=".9">ARCADE RUN · MAN CITY v ARSENAL · ARCADE RUN · MAN CITY v ARSENAL · ARCADE RUN</text>';
    /* floodlight pools */
    [[26, 30], [79, 30]].forEach(function(c){
      const p = P(c[0], c[1]);
      s += '<ellipse cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" rx="120" ry="70" fill="url(#pool)"/>';
    });
    /* markings */
    let lines = pathOf(quad(0, 0, 105, 68), true) + pathOf([P(52.5, 0), P(52.5, 68)]) + pathOf(arc(52.5, 34, 9.15), true);
    lines += pathOf(quad(0, 13.84, 16.5, 54.16)) + pathOf(quad(0, 24.84, 5.5, 43.16));
    lines += pathOf(quad(105, 13.84, 88.5, 54.16)) + pathOf(quad(105, 24.84, 99.5, 43.16));
    lines += pathOf(arc(11, 34, 9.15, function(x){ return x > 16.5; })) + pathOf(arc(94, 34, 9.15, function(x){ return x < 88.5; }));
    s += '<path d="' + pathOf(quad(0, 0, 105, 68), true) + '" fill="none" stroke="#ff2e88" stroke-width="2.6" filter="url(#neon)"/>';
    s += '<path d="' + lines + '" fill="none" stroke="#fff" stroke-opacity=".72" stroke-width=".9" stroke-linejoin="round"/>';
    [[52.5, 34], [11, 34], [94, 34]].forEach(function(c){
      const p = P(c[0], c[1]);
      s += '<ellipse cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" rx="1.3" ry=".9" fill="#fff" fill-opacity=".8"/>';
    });
    s += '<rect width="400" height="266" fill="url(#vig)"/>';
    svg.innerHTML = s;
  }

  /* ================= stadium: actors ================= */
  const KITS = {
    city:   { shirt:"#7fd4ff", shorts:"#f4fbff", socks:"#7fd4ff", trim:"#1b4f75" },
    cityGk: { shirt:"#ff2e88", shorts:"#2a0b3d", socks:"#ff2e88", trim:"#6d0a3a" },
    ars:    { shirt:"#e5243b", shorts:"#ffffff", socks:"#ffffff", trim:"#7a0d1c", sleeves:"#ffffff" },
    arsGk:  { shirt:"#ffd23f", shorts:"#1c1c1c", socks:"#ffd23f", trim:"#7a5a00" }
  };
  function figureSVG(kit){
    return '<ellipse rx="4.8" ry="1.5" fill="#04000c" fill-opacity=".5"/>' +
      '<g class="bd">' +
        '<path d="M-1.5 0L-1.1-6M1.5 0L1.1-6" stroke="' + kit.socks + '" stroke-width="1.8" stroke-linecap="round"/>' +
        '<rect x="-2.7" y="-8.4" width="5.4" height="3.2" rx="1" fill="' + kit.shorts + '"/>' +
        '<rect x="-3.2" y="-15" width="6.4" height="7.4" rx="2.2" fill="' + kit.shirt + '" stroke="' + kit.trim + '" stroke-width=".5"/>' +
        (kit.sleeves ? '<rect x="-4.4" y="-14.6" width="1.9" height="4" rx=".9" fill="' + kit.sleeves + '"/><rect x="2.5" y="-14.6" width="1.9" height="4" rx=".9" fill="' + kit.sleeves + '"/>' : '') +
        '<path d="M-2.2-14.3Q0-15.3 2.2-14.3" stroke="#fff" stroke-opacity=".6" stroke-width=".7" fill="none"/>' +
        '<circle cy="-17.3" r="2.2" fill="#ffe3ec"/>' +
      '</g>';
  }
  const scene = {
    actors:[], city:[], ars:[], cues:[], clockOffset:0, busyUntil:0,
    mode:"home", netHit:-99, nets:null, netNow:null, netLive:null, conceded:null, reduced:false
  };
  const B = { events:[], holder:null, el:null, shadow:null, ring:null, ringO:0, sy:0 };
  function now(){ return performance.now() / 1000 + scene.clockOffset; }
  function restSeg(pos){ return { t0:-1e9, d:0.001, p0:pos.slice(), v0:[0,0], p1:pos.slice(), bulge:null }; }
  function actorAt(a, t){
    let s = a.segs[0];
    for (const g of a.segs){ if (g.t0 <= t) s = g; else break; }
    return evalSeg(s, t);
  }
  function moveTo(a, to, at, d, bulge, shuffle){
    const st = actorAt(a, at);
    a.segs = a.segs.filter(function(g){ return g.t0 < at; });
    a.segs.push(makeSeg(at, d, st, [clamp(to[0], -1, 106), clamp(to[1], 1, 67)], bulge));
    if (!shuffle){ a.base = to.slice(); busy(at + d); }
  }
  function busy(t){ scene.busyUntil = Math.max(scene.busyUntil, t); }
  function setFx(a, kind, t0, d, dir){ a.fx = { kind:kind, t0:t0, d:d, dir:dir || 1 }; busy(t0 + d); }
  function nearestTo(list, pt, outfield){
    let best = null, bd = Infinity;
    for (let i = outfield ? 1 : 0; i < list.length; i++){
      const s = actorAt(list[i], now());
      const d = Math.hypot(s.x - pt[0], s.y - pt[1]);
      if (d < bd){ bd = d; best = list[i]; }
    }
    return best;
  }
  /* ---- ball: a timeline of "owned by" and "in flight" events ---- */
  const EASE = {
    lin(u){ return u; },
    pass(u){ return u * (1.6 - 0.6 * u); },   /* rolls out, still moving on arrival */
    out(u){ return 1 - (1 - u) * (1 - u); },
    fall(u){ return u * u; }                    /* gravity */
  };
  function lerp3(a, b, k){ return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function ownedSpot(a, t){ const s = actorAt(a, t); return [s.x + a.dir * 0.9, s.y + 0.35, 0]; }
  function ballEventAt(t){
    let e = B.events[0];
    for (const g of B.events){ if (g.t <= t) e = g; else break; }
    return e;
  }
  function ballAt(t){
    const e = ballEventAt(t);
    if (e.kind === "own"){
      const spot = ownedSpot(e.who, t);
      /* a receiver who moved after the pass was struck: the ball rolls on to them */
      const q = e.from ? (t - e.t) / Math.max(0.14, Math.hypot(e.from[0] - spot[0], e.from[1] - spot[1]) / 22) : 1;
      if (q < 1){ const k = q * q * (3 - 2 * q); return lerp3(e.from, spot, k); }
      return spot;
    }
    /* a kick leaves from wherever the ball is when it is struck, fixed from then on */
    let from = e.from;
    if (e.src){
      from = ballAt(e.t - 1e-4);
      if (e.t <= now()){ e.from = from; e.src = null; }
    }
    const u = clamp((t - e.t) / e.d, 0, 1);
    const p = lerp3(from, e.to, EASE[e.ease](u));
    p[2] += e.arc * 4 * u * (1 - u);
    return p;
  }
  function cutBall(at){ B.events = B.events.filter(function(g){ return g.t < at; }); }
  /* Who has the ball at `at`: a kick leaves from their feet even if a later
     play changes their run. */
  function ownerAt(at){ const e = ballEventAt(at); return e && e.kind === "own" ? e.who : null; }
  /* Play the ball to `rcv` at time `at`, aiming where they will be. */
  function passBall(rcv, at, o){
    o = o || {};
    const from = ballAt(at);
    let d = 0.6, to = null, lofted = false, dist = 0;
    for (let k = 0; k < 3; k++){
      to = ownedSpot(rcv, at + d);
      dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
      lofted = o.lofted || dist > 34;
      d = o.quick ? 0.16 : lofted ? 0.5 + dist / 48 : 0.3 + dist / 32;
    }
    to = ownedSpot(rcv, at + d);
    cutBall(at);
    B.events.push({ t:at, kind:"fly", from:from, src:ownerAt(at), to:to, d:d, arc: lofted ? Math.min(14, dist * 0.17) : 0, ease: lofted ? "lin" : "pass", sound:o.sound || "kick" });
    B.events.push({ t:at + d, kind:"own", who:rcv, from:to });
    B.holder = rcv;
    busy(at + d);
    return at + d;
  }
  /* A dead ball: rolls or flies to a spot and stays there. */
  function ballTo(to, at, d, arc, sound, ease){
    const from = ballAt(at);
    cutBall(at);
    B.events.push({ t:at, kind:"fly", from:from, src:ownerAt(at), to:to, d:d, arc:arc || 0, ease:ease || "out", sound:sound || "none" });
    B.holder = null;
    busy(at + d);
    return at + d;
  }
  /* Play the ball on unless `rcv` already has it. */
  function feed(rcv, at, o){ return B.holder === rcv ? at : passBall(rcv, at, o); }
  /* Run to a spot at about `speed` m/s; returns the arrival time. */
  function sprint(a, to, at, bulge, speed){
    const s = actorAt(a, at);
    const d = Math.max(0.5, Math.hypot(to[0] - s.x, to[1] - s.y) / (speed || 13));
    moveTo(a, to, at, d, bulge);
    return at + d;
  }
  /* ---- sides: each team seen from its own end ---- */
  function sideOf(name){
    const me = name === "city" ? scene.city : scene.ars, dir = me[0].dir;
    const S = {
      name:name, me:me, opp: name === "city" ? scene.ars : scene.city, oppName: name === "city" ? "ars" : "city",
      dir:dir, roles:ROLES[name],
      /* own-frame point to pitch coordinates, and an actor's own-frame spot */
      at: function(x, y){ return [dir > 0 ? x : 105 - x, y]; },
      own: function(a, t){ const s = actorAt(a, t); return [dir > 0 ? s.x : 105 - s.x, s.y]; },
      pick: function(role, not){
        const list = ROLES[name][role].map(function(i){ return me[i]; });
        return list.find(function(a){ return not.indexOf(a) === -1; }) || list[0];
      },
      /* the wide player on the ball's flank */
      wide: function(fl){ return me[ROLES[name].wide[fl < 0 ? 0 : 1]]; }
    };
    return S;
  }
  /* The side gets the ball: kept if they have it already, otherwise the
     nearest player steps in and takes it. Returns who has it, and when. */
  function winBall(S, t){
    const h = B.holder, last = B.events[B.events.length - 1];
    if (h && h.team === S.name) return { who:h, t:Math.max(t, last.t) };
    let bp = ballAt(t + 0.4);
    const tk = nearestTo(S.me, bp, true), s = actorAt(tk, t);
    const d = clamp(Math.hypot(bp[0] - s.x, bp[1] - s.y) / 12, 0.4, 0.9), tt = t + d;
    bp = ballAt(tt);
    moveTo(tk, [bp[0] - tk.dir * 0.9, bp[1] - 0.35], t, d);
    if (h){
      const hs = actorAt(h, tt);
      moveTo(h, [hs.x - h.dir * 1.4, hs.y - 0.6], tt, 0.7);
      setFx(h, "stumble", tt, 0.8);
    }
    passBall(tk, tt - 0.04, { quick:true, sound: h ? "tackle" : "none" });
    return { who:tk, t:tt + 0.12 };
  }
  /* The nearest defender steps out to press, goal-side of the ball. */
  function press(D, pt, at, d){
    const pr = nearestTo(D.me, pt, true);
    const gx = (D.dir > 0 ? 0 : 105) - pt[0], gy = 34 - pt[1], gl = Math.hypot(gx, gy) || 1;
    moveTo(pr, [pt[0] + gx / gl * 2.6, pt[1] + gy / gl * 2.6], at, d * 0.8);
  }
  /* With reduced motion every script lands at once behind a calm fade. */
  function afterScript(){
    if (!scene.reduced) return;
    const skip = scene.busyUntil - now() + 0.02;
    if (skip > 0) scene.clockOffset += skip;
    if (scene.fg.animate) scene.fg.animate([{ opacity:0.15 }, { opacity:1 }], { duration:320, easing:"ease" });
  }
  /* ---- choreography: the ebb and flow of a word ---- */
  const RUN_DELAY = [0.34, 0.22, 0.26, 0.26, 0.22, 0.14, 0.08, 0.08, 0, 0, 0];
  /* At least `d`, and no quicker than a 10 m/s run: the long way back from a celebration takes its time. */
  function runFor(a, to, at, d){ const s = actorAt(a, at); return Math.max(d, Math.hypot(to[0] - s.x, to[1] - s.y) / 10); }
  /* Both teams take the shape for `st` and the ball goes to the right player:
     kept and worked forward, won back with a tackle, or, after a goal,
     fetched from the net by the beaten keeper and sent long. */
  scene.play = function(st){
    const t = now();
    scene.cues.length = 0;
    if (scene.netHit > t) scene.netHit = -99;
    const S = sideOf(st.poss), D = sideOf(S.oppName);
    const sa = teamShape(S.name, st), sd = teamShape(D.name, st);
    /* off-ball runs first: forwards go early and bend their runs */
    sa.forEach(function(pos, i){
      const bulge = i >= 8 ? [0, (pos[1] < 34 ? -1 : 1) * 2.2] : null;
      const at = t + RUN_DELAY[i] + Math.random() * 0.08;
      moveTo(S.me[i], pos, at, runFor(S.me[i], pos, at, 1.9 + Math.random() * 0.35), bulge);
    });
    sd.forEach(function(pos, i){ const at = t + 0.04 + Math.random() * 0.12; moveTo(D.me[i], pos, at, runFor(D.me[i], pos, at, 1.1 + Math.random() * 0.4)); });
    const target = S.me[carrierFor(sa, st, S.roles.st)];
    if (scene.mode === "goal" && scene.conceded){
      const gk = scene.conceded[0], home = gk === S.me[0] ? sa[0] : sd[0];
      moveTo(gk, [gk.dir > 0 ? 1.5 : 103.5, 34], t, 0.5);
      const tk = passBall(gk, t + 0.05, { sound:"none" }) + 0.25;
      moveTo(gk, home, tk + 0.3, 1.2);
      passBall(target, tk, { lofted:true, sound:"clear" });
    } else {
      const old = B.holder, w = winBall(S, t);
      if (old && old !== w.who) moveTo(old, sd[old.i], w.t + 0.7, 1.4);
      let tk = w.t + 0.22, last = w.who;
      if (last !== target){
        const ri = pickRelay(last.i, target.i, sa, ballAt(tk)[0], Math.random);
        if (ri >= 0){
          const arr = passBall(S.me[ri], tk);
          press(D, ownedSpot(S.me[ri], arr), tk + 0.18, 1.0);
          tk = arr + 0.3; last = S.me[ri];
        }
      }
      if (last !== target){
        const arr2 = passBall(target, tk);
        press(D, ownedSpot(target, arr2), tk + 0.18, 1.1);
      } else press(D, ballAt(tk), tk, 1.1);
      if (w.who !== old && w.who !== target) moveTo(w.who, sa[w.who.i], tk + 0.3, 1.3);
    }
    scene.mode = "play";
    afterScript();
  };
  /* Before a finish the scorers flood forward and the defence scrambles back;
     `lag` > 1 leaves defenders chasing a break. */
  function commit(S, t, fl, lag){
    const go = attackShape(FORMS[S.name], 1, fl), back = blockShape(FORMS[S.oppName], 1, 34 + fl * 6);
    S.me.forEach(function(a, i){
      const to = S.at(go[i][0], go[i][1]), at = t + 0.1 + Math.random() * 0.25;
      moveTo(a, to, at, runFor(a, to, at, 1.8 + Math.random() * 0.4));
    });
    S.opp.forEach(function(a, i){
      const to = [S.dir > 0 ? 105 - back[i][0] : back[i][0], back[i][1]], at = t + 0.15 + Math.random() * 0.2;
      moveTo(a, to, at, runFor(a, to, at, (1.6 + Math.random() * 0.5) * (lag || 1)));
    });
  }
  /* Shot into the net S attacks: keeper beaten, ripple, celebration. */
  function shootGoal(S, shooter, tShot, o){
    const side = o.side || (Math.random() < 0.5 ? -1 : 1), z = o.header ? 1.1 : 3.4;
    const gx = S.at(105.4, 0)[0], ty = 34 + side * 3.3;
    const from = ballAt(tShot);
    const d = 0.26 + Math.hypot(gx - from[0], ty - from[1]) * 0.012, hit = tShot + d;
    cutBall(tShot);
    B.events.push({ t:tShot, kind:"fly", from:from, src:ownerAt(tShot), to:[gx, ty, z], d:d, arc: o.header ? 0 : 0.6, ease:"lin", sound: o.header ? "kick" : "shot" });
    const deep = [S.at(107.3, 0)[0], ty + side * 0.6, z * 0.53];
    B.events.push({ t:hit, kind:"fly", from:[gx, ty, z], to:deep, d:0.2, arc:0, ease:"out" });
    B.events.push({ t:hit + 0.2, kind:"fly", from:deep, to:[S.at(107, 0)[0], ty + side * 0.8, 0], d:0.34, arc:0, ease:"fall" });
    B.holder = null;
    scene.netHit = hit;
    scene.netNow = scene.nets[S.oppName];
    scene.conceded = S.opp;
    /* keeper reads it late: full stretch, beaten */
    const gk = S.opp[0];
    const gkx = S.own(gk, tShot)[0] > 96 ? S.at(103.4, 0)[0] : actorAt(gk, tShot).x;
    moveTo(gk, [gkx, 34 + side * 2.3], tShot + 0.06, 0.34);
    setFx(gk, "dive", tShot + 0.06, 2.4, side);
    /* the scorer wheels away to the corner, the nearest team-mates chase */
    const flag = S.at(100, side < 0 ? 5 : 63), sp = actorAt(shooter, hit);
    moveTo(shooter, flag, hit + 0.15, runFor(shooter, flag, hit + 0.15, 1.7), [-3 * S.dir, 0]);
    setFx(shooter, "celebrate", hit + 0.7, 1.6);
    S.me.slice(1).filter(function(a){ return a !== shooter; }).sort(function(a, b){
      const pa = actorAt(a, hit), pb = actorAt(b, hit);
      return Math.hypot(pa.x - sp.x, pa.y - sp.y) - Math.hypot(pb.x - sp.x, pb.y - sp.y);
    }).slice(0, 4).forEach(function(a, n){
      const to = [flag[0] - S.dir * (3 + n * 1.6), flag[1] - side * (2 + n * 1.4)], at = hit + 0.35 + n * 0.08;
      moveTo(a, to, at, runFor(a, to, at, 1.8));
      setFx(a, "celebrate", hit + 1.3 + n * 0.1, 1.2);
    });
    for (let i = 1; i < 11; i++) setFx(S.opp[i], "dejected", hit + 0.2, 2.4);
    if (o.onNet) scene.cues.push({ t:hit, fn:o.onNet });
    busy(hit + 0.6);
    scene.mode = "goal";
    return hit;
  }
  /* Each finish starts from wherever everyone is right now. Coordinates are
     in the scoring side's own frame; `fl` is the flank the ball is on. */
  const FINISH_PLAYS = {
    /* win it back, then one ball over the top for the striker to chase */
    longBall: function(S, t, fl, o){
      commit(S, t, fl, 1.9);
      const w = winBall(S, t), st = S.pick("st", [w.who]), sp = S.own(st, w.t);
      sprint(st, S.at(clamp(sp[0] + 28, 56, 80), 34 + fl * 8), w.t, [0, fl * 2], 15);
      const arr = passBall(st, w.t + 0.3, { lofted:true, sound:"clear" });
      const shotAt = sprint(st, S.at(91, 34 + fl * 3), arr, null, 14) - 0.2;
      return shootGoal(S, st, shotAt, o);
    },
    /* win it back and break at speed: out to the flank, low ball across */
    counter: function(S, t, fl, o){
      commit(S, t, fl, 1.7);
      const w = winBall(S, t), wing = S.wide(fl), st = S.pick("st", [w.who, wing]);
      const wp = S.own(wing, w.t), sp = S.own(st, w.t);
      sprint(wing, S.at(clamp(wp[0] + 26, 55, 82), fl < 0 ? 9 : 59), w.t, null, 15);
      sprint(st, S.at(clamp(sp[0] + 22, 58, 80), 34 - fl * 4), w.t + 0.1, null, 14);
      const a1 = feed(wing, w.t + 0.2);
      const carried = sprint(wing, S.at(91, fl < 0 ? 15 : 53), a1, null, 13);
      sprint(st, S.at(95, 34 - fl * 2), a1 + 0.2, [0, fl * 1.5], 13);
      const a2 = passBall(st, carried - 0.2);
      return shootGoal(S, st, a2 + 0.04, Object.assign({ side:-fl }, o));
    },
    /* a pass split between the centre-backs, the keeper rushes out and is beaten */
    throughBall: function(S, t, fl, o){
      commit(S, t, fl, 1.4);
      const w = winBall(S, t), st = S.pick("st", [w.who]), sp = S.own(st, w.t);
      sprint(st, S.at(clamp(sp[0] + 16, 74, 86), 34 + fl * 4), w.t, [0, -fl * 2], 14);
      const arr = feed(st, w.t + 0.4);
      moveTo(S.opp[0], S.at(97, 34 + fl * 2), arr - 0.15, 0.55);
      const shotAt = sprint(st, S.at(95, 34 - fl * 3), arr, [0, -fl * 1.5], 12) - 0.1;
      return shootGoal(S, st, shotAt, Object.assign({ side:-fl }, o));
    },
    /* give and go on the edge of the box */
    oneTwo: function(S, t, fl, o){
      commit(S, t, fl, 1);
      const w = winBall(S, t), h = w.who, mate = S.pick("st", [h]), hp = S.own(h, w.t);
      sprint(mate, S.at(clamp(hp[0] + 9, 74, 88), 34 + fl * 7), w.t, null, 12);
      const a1 = passBall(mate, w.t + 0.35);
      sprint(h, S.at(clamp(hp[0] + 18, 88, 94), 34 - fl * 2), w.t + 0.4, [0, fl * 2], 12);
      const a2 = passBall(h, a1 + 0.05);
      return shootGoal(S, h, a2 + 0.2, o);
    },
    /* to the byline, pulled back for a runner arriving at the penalty spot */
    cutBack: function(S, t, fl, o){
      commit(S, t, fl, 1);
      const w = winBall(S, t), wing = S.wide(fl);
      const runner = w.who === wing ? S.pick("mid", [wing]) : w.who;
      sprint(wing, S.at(96, fl < 0 ? 12 : 56), w.t, null, 13);
      const a1 = feed(wing, w.t + 0.2);
      const byline = sprint(wing, S.at(102.5, fl < 0 ? 22 : 46), a1, null, 12);
      sprint(runner, S.at(92, 34 + fl), a1 + 0.1, null, 12);
      const a2 = passBall(runner, byline - 0.1);
      return shootGoal(S, runner, a2 + 0.03, Object.assign({ side:-fl }, o));
    },
    /* keep it, work it across the edge of the box, then in to the striker */
    buildUp: function(S, t, fl, o){
      commit(S, t, fl, 1);
      const w = winBall(S, t), st = S.pick("st", [w.who]);
      const m0 = S.me[S.roles.mid[0]], m1 = S.me[S.roles.mid[1]];
      const chain = [[m0, 80, 34 - fl * 10], [S.wide(fl), 88, fl < 0 ? 14 : 54], [m1, 84, 34 + fl * 6]];
      let tk = w.t + 0.25;
      chain.forEach(function(c, n){
        const arrive = sprint(c[0], S.at(c[1], c[2]), w.t + n * 0.25, null, 9);
        tk = feed(c[0], Math.max(tk, arrive - 0.4)) + 0.35;
      });
      sprint(st, S.at(94, 34 - fl * 2), tk - 0.6, [0, fl * 2], 12);
      const last = passBall(st, tk);
      return shootGoal(S, st, last + 0.06, o);
    },
    /* nick it off a high press and run straight at goal */
    turnover: function(S, t, fl, o){
      commit(S, t, fl, 1.8);
      const w = winBall(S, t);
      const st = S.me.slice(1).filter(function(a){ return a !== w.who; }).sort(function(a, b){ return S.own(b, w.t)[0] - S.own(a, w.t)[0]; })[0];
      const sp = S.own(st, w.t);
      sprint(st, S.at(clamp(sp[0] + 26, 60, 84), 34 + fl * 9), w.t, [0, fl * 2], 15);
      const arr = passBall(st, w.t + 0.25);
      const shotAt = sprint(st, S.at(92, 34 + fl * 4), arr, null, 14) - 0.2;
      return shootGoal(S, st, shotAt, Object.assign({ side:-fl }, o));
    },
    /* a cross is blocked behind; the corner is met with a header */
    corner: function(S, t, fl, o){
      commit(S, t, fl, 1);
      const w = winBall(S, t), wing = S.wide(fl), cy = fl < 0 ? 1.2 : 66.8;
      const reach = sprint(wing, S.at(95, fl < 0 ? 10 : 58), w.t, null, 13);
      const a1 = feed(wing, w.t + 0.2);
      const bl = nearestTo(S.opp, S.at(97, fl < 0 ? 12 : 56), true);
      sprint(bl, S.at(98, fl < 0 ? 13 : 55), w.t + 0.1, null, 12);
      const tb = Math.max(a1, reach) + 0.1;
      ballTo(S.at(106, fl < 0 ? 7 : 61).concat(0.6), tb, 0.45, 0.8, "tackle");
      setFx(bl, "celebrate", tb, 0.5);
      /* taker to the flag, ball placed in the quadrant, the box fills */
      const tq = tb + 0.5;
      let ready = sprint(wing, S.at(105.8, fl < 0 ? 1 : 67), tq, null, 7);
      ballTo(S.at(105, cy).concat(0), tq + 0.15, 0.7, 0, "none");
      const runners = S.me.slice(1).filter(function(a){ return a !== wing; })
        .sort(function(a, b){ return S.own(b, tq)[0] - S.own(a, tq)[0]; }).slice(0, 4);
      const spots = [[96, 34 + fl * 4], [95, 30 - fl], [97, 40 + fl], [90, 34]];
      const marked = [];
      runners.forEach(function(a, n){
        ready = Math.max(ready, sprint(a, S.at(spots[n][0], spots[n][1]), tq + n * 0.1, null, 11));
        const mk = S.opp.slice(1).filter(function(d){ return d !== bl && marked.indexOf(d) === -1; })
          .sort(function(p, q){
            const pp = actorAt(p, tq), qq = actorAt(q, tq), s = S.at(spots[n][0], spots[n][1]);
            return Math.hypot(pp.x - s[0], pp.y - s[1]) - Math.hypot(qq.x - s[0], qq.y - s[1]);
          })[0];
        marked.push(mk);
        sprint(mk, S.at(spots[n][0] + 1.4, spots[n][1] + 0.8), tq + 0.2 + n * 0.1, null, 10);
      });
      /* whipped in to the near post, met by the first runner */
      const tk = ready + 0.35, head = runners[0], hp = S.at(99.5, 34 + fl * 2.5);
      ballTo(hp.concat(2.5), tk, 0.85, 5, "kick", "lin");
      sprint(head, hp, tk + 0.3, null, 9);
      setFx(head, "jump", tk + 0.55, 0.6);
      return shootGoal(S, head, tk + 0.85, Object.assign({ header:true, side:-fl }, o));
    }
  };
  /* A word is over: the side that won it scores with `kind`.
     Returns the time the ball hits the net. */
  scene.finish = function(side, kind, onNet){
    const t = now(), S = sideOf(side);
    scene.cues.length = 0;
    const hit = FINISH_PLAYS[kind](S, t, ballAt(t)[1] < 34 ? -1 : 1, { onNet:onNet });
    afterScript();
    return hit;
  };
  /* ---- rendering: one requestAnimationFrame loop for 22 players + ball ---- */
  function makeActor(team, i, kit, dir, pos){
    const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
    root.innerHTML = figureSVG(kit);
    const a = { team:team, i:i, dir:dir, root:root, body:root.querySelector(".bd"), segs:[restSeg(pos)], base:pos.slice(), phase:Math.random() * 6, fx:null, tr:"", br:"", sy:pos[1] };
    scene.actors.push(a);
    return a;
  }
  function buildScene(){
    const fg = scene.fg = document.getElementById("pitchFg");
    const gc = goalSVG(0, -1), ga = goalSVG(105, 1);
    fg.innerHTML =
      '<defs><radialGradient id="ballGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff7ab8" stop-opacity=".7"/><stop offset="1" stop-color="#ff2e88" stop-opacity="0"/></radialGradient></defs>' +
      '<g id="netCity">' + gc.back + '</g>' + gc.frame + '<g id="netArs">' + ga.back + '</g>' + ga.frame +
      '<g id="under"><ellipse id="ring" rx="6.5" ry="2" fill="none" stroke="#ff7ab8" stroke-width=".9" opacity="0"/>' +
      '<ellipse id="ballShadow" rx="2.3" ry=".8" fill="#04000c" fill-opacity=".55"/></g>' +
      '<g id="actors"></g>';
    /* nets keyed by the team defending them */
    scene.nets = {
      city: { el:document.getElementById("netCity"), x:P(0, 34)[0] },
      ars: { el:document.getElementById("netArs"), x:P(105, 34)[0] }
    };
    scene.layer = document.getElementById("actors");
    B.shadow = document.getElementById("ballShadow");
    B.ring = document.getElementById("ring");
    B.el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    B.el.innerHTML = '<circle r="6" fill="url(#ballGlow)"/><circle r="2.3" fill="#fff" stroke="#ff2e88" stroke-width=".8"/><circle cx="-.6" cy="-.5" r=".8" fill="#2b0a1e"/>';
    const home = CITY_START, away = ARS_START.map(function(q){ return [105 - q[0], q[1]]; });
    for (let i = 0; i < 11; i++) scene.city.push(makeActor("city", i, i ? KITS.city : KITS.cityGk, 1, home[i]));
    for (let i = 0; i < 11; i++) scene.ars.push(makeActor("ars", i, i ? KITS.ars : KITS.arsGk, -1, away[i]));
    /* the ball waits on the centre spot for the first word */
    B.events = [{ t:-1e9, kind:"fly", from:[52.5, 34, 0], to:[52.5, 34, 0], d:1, arc:0, ease:"lin" }];
    B.holder = null;
    scene.order = scene.actors.concat([B]);
    scene.order.forEach(function(a){ scene.layer.appendChild(a.root || B.el); });
    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    scene.reduced = !!(mq && mq.matches);
    if (mq && mq.addEventListener) ctx.on(mq, "change", function(){ scene.reduced = mq.matches; });
    requestAnimationFrame(frame);
  }
  function fxPose(a, t, pose){
    const fx = a.fx;
    if (!fx) return;
    const q = t - fx.t0;
    if (q < 0) return;
    if (q > fx.d){ a.fx = null; return; }
    if (fx.kind === "dive"){
      const down = 1 - Math.pow(1 - Math.min(1, q / 0.3), 3);
      const up = q > fx.d - 0.5 ? (q - (fx.d - 0.5)) / 0.5 : 0;
      pose.rot += fx.dir * 72 * down * (1 - up * up * (3 - 2 * up));
      pose.hop += 5 * Math.sin(Math.PI * Math.min(1, q / 0.45));
    } else if (fx.kind === "celebrate"){
      const fade = 1 - q / fx.d;
      pose.hop += Math.abs(Math.sin(q * 10)) * 3 * fade;
      pose.rot += Math.sin(q * 14) * 6 * fade;
    } else if (fx.kind === "dejected"){
      pose.rot += a.dir * 10 * Math.sin(Math.PI * q / fx.d);
    } else if (fx.kind === "jump"){
      pose.hop += 7 * Math.sin(Math.PI * Math.min(1, q / fx.d));
    } else if (fx.kind === "stumble"){
      pose.rot += Math.sin(q * 22) * 16 * Math.exp(-q * 4);
    }
  }
  let lastMs = 0, sortTick = 0, shuffleAt = 0;
  function frame(ms){
    const dt = lastMs ? Math.min(0.05, (ms - lastMs) / 1000) : 0.016;
    lastMs = ms;
    const t = now();
    /* sounds and callbacks fire on the frame their motion starts */
    for (const e of B.events){
      if (!e.fired && e.t <= t){ e.fired = true; if (e.sound && SFX[e.sound] && e.t > t - 0.25) SFX[e.sound](); }
    }
    for (let i = scene.cues.length - 1; i >= 0; i--){
      if (scene.cues[i].t <= t){ const c = scene.cues.splice(i, 1)[0]; c.fn(); }
    }
    for (const a of scene.actors){
      while (a.segs.length > 1 && a.segs[1].t0 <= t) a.segs.shift();
      const s = evalSeg(a.segs[0], t);
      const speed = Math.hypot(s.vx, s.vy);
      a.phase += speed * dt * 2.2;
      const pose = { rot:clamp(s.vx * 2.2, -14, 14), hop:Math.abs(Math.sin(a.phase)) * 1.4 * Math.min(1, speed / 3.5) };
      fxPose(a, t, pose);
      const p = project(s.x, s.y, 0);
      const tr = "translate(" + f1(p[0]) + " " + f1(p[1]) + ") scale(" + (p[2] / K_NEAR).toFixed(3) + ")";
      if (tr !== a.tr){ a.root.setAttribute("transform", tr); a.tr = tr; }
      const br = "rotate(" + f1(pose.rot) + ") translate(0 " + (-pose.hop).toFixed(2) + ")";
      if (br !== a.br){ a.body.setAttribute("transform", br); a.br = br; }
      a.sy = s.y; a.speed = speed;
    }
    /* ball, its shadow and the carrier ring */
    const e = ballEventAt(t);
    const b = ballAt(t);
    if (e.kind === "own" && e.who.speed > 0.4) b[0] += e.who.dir * 0.45 * Math.abs(Math.sin(e.who.phase));
    const gp = project(b[0], b[1], 0), bp = project(b[0], b[1], b[2]), bs = gp[2] / K_NEAR;
    B.shadow.setAttribute("transform", "translate(" + f1(gp[0]) + " " + f1(gp[1]) + ") scale(" + (bs * (1 - Math.min(0.5, b[2] / 12))).toFixed(3) + ")");
    B.el.setAttribute("transform", "translate(" + f1(bp[0]) + " " + f1(bp[1] - 2.3 * bs) + ") scale(" + bs.toFixed(3) + ")");
    B.sy = b[1] + 0.05;
    const owner = e.kind === "own" && (!e.from || t - e.t > 0.14) ? e.who : null;
    B.ringO += ((owner ? 0.9 : 0) - B.ringO) * Math.min(1, dt * 10);
    if (owner){
      const o = project(owner.segs[0] ? evalSeg(owner.segs[0], t).x : 0, owner.sy, 0);
      B.ring.setAttribute("transform", "translate(" + f1(o[0]) + " " + f1(o[1]) + ") scale(" + (o[2] / K_NEAR).toFixed(3) + ")");
    }
    B.ring.setAttribute("opacity", B.ringO.toFixed(2));
    /* net ripple after a goal */
    const nq = t - scene.netHit, net = scene.netNow;
    if (net && nq >= 0 && nq < 1.6){
      const amp = 0.22 * Math.exp(-nq * 3.2) * Math.sin(nq * 22);
      net.el.setAttribute("transform", "translate(" + f1(net.x) + " 0) scale(" + (1 + amp).toFixed(3) + " " + (1 + amp * 0.15).toFixed(3) + ") translate(" + f1(-net.x) + " 0)");
      scene.netLive = net;
    } else if (scene.netLive){ scene.netLive.el.removeAttribute("transform"); scene.netLive = null; }
    /* paint nearer players over farther ones */
    if (++sortTick % 6 === 0){
      const sorted = scene.order.slice().sort(function(x, y){ return x.sy - y.sy; });
      if (sorted.some(function(x, i){ return x !== scene.order[i]; })){
        scene.order = sorted;
        sorted.forEach(function(x){ scene.layer.appendChild(x.root || B.el); });
      }
    }
    if (t > shuffleAt) idleShuffle(t);
    requestAnimationFrame(frame);
  }
  /* players holding shape keep adjusting, so nobody stands frozen */
  function idleShuffle(t){
    shuffleAt = t + 0.45;
    if (scene.reduced || t < scene.busyUntil + 0.3) return;
    for (let n = 0; n < 3; n++){
      const a = scene.actors[Math.floor(Math.random() * scene.actors.length)];
      if (a.segs.length > 1 || t < a.segs[0].t0 + a.segs[0].d) continue;
      const r = a.i === 0 ? 0.6 : 1.5;
      moveTo(a, [a.base[0] + (Math.random() * 2 - 1) * r, a.base[1] + (Math.random() * 2 - 1) * r], t, 1.1 + Math.random() * 0.9, null, true);
    }
  }

  /* ================= game state ================= */
  let cur = null; /* the engine's word in play */
  let seed = 0, state = null; /* this word's kick-off seed, and the match it shows */
  let lastFinish = "";
  let nextTimer = 0;
  let cellEls = [];

  const $ = function(id){ return document.getElementById(id); };
  const tilesEl = $("tiles"), keysEl = $("keys"), dotsEl = $("dots");
  const bannerEl = $("banner"), flashEl = $("flash"), toastEl = $("toast");
  const reduceMotion = function(){ return scene.reduced; };

  function renderDots(){
    dotsEl.innerHTML = "";
    for (let i = 0; i < cur.lives; i++){
      const d = document.createElement("div");
      d.className = "dot" + (i < cur.misses ? " used" : "");
      dotsEl.appendChild(d);
    }
  }
  function updateDots(){
    Array.prototype.forEach.call(dotsEl.children, function(d, i){ d.classList.toggle("used", i < cur.misses); });
  }
  function renderLives(){
    const left = cur.entry ? Math.max(0, cur.lives - cur.misses) : 0;
    $("livesLine").innerHTML = "<strong>" + left + "</strong> left";
    dotsEl.parentNode.setAttribute("aria-label", left + " chance" + (left === 1 ? "" : "s") + " left");
  }
  function bump(el){
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    setTimeout(function(){ el.classList.remove("bump"); }, 200);
  }
  let countRaf = 0;
  function countTo(el, to){
    cancelAnimationFrame(countRaf);
    const from = Number(el.textContent) || 0;
    if (reduceMotion() || from === to){ el.textContent = to; return; }
    const t0 = performance.now();
    (function step(ms){
      const u = Math.min(1, (ms - t0) / 650), k = 1 - Math.pow(1 - u, 3);
      el.textContent = Math.round(from + (to - from) * k);
      if (u < 1) countRaf = requestAnimationFrame(step);
    })(t0);
  }
  function renderScore(animate){
    const run = ctx.run;
    if (animate) countTo($("scoreVal"), run.score); else { cancelAnimationFrame(countRaf); $("scoreVal").textContent = run.score; }
    const c = $("comboVal");
    c.textContent = "×" + run.combo;
    c.classList.toggle("hot", run.combo >= 2);
    $("bestVal").textContent = ctx.stats.bestScore;
    $("streakVal").textContent = ctx.stats.streak;
  }
  function renderWord(){
    tilesEl.innerHTML = "";
    cellEls = [];
    const words = cur.entry.answer.split(" ");
    const avail = tilesEl.clientWidth || 340;
    tilesEl.style.setProperty("--tw", tileSize(words.map(function(w){ return w.length; }), avail, Math.min(104, Math.round(innerHeight * .13))) + "px");
    let wordEl = null, n = 0;
    maskOf(cur.entry.answer, cur.guessed).forEach(function(cell){
      if (cell.kind === "gap"){ wordEl = null; cellEls.push(null); return; }
      if (!wordEl){ wordEl = document.createElement("div"); wordEl.className = "word"; tilesEl.appendChild(wordEl); }
      const s = document.createElement("span");
      s.className = "tile enter" + (cell.kind === "fixed" ? " fixed" : "");
      s.style.setProperty("--i", n++);
      const c = document.createElement("span");
      c.className = "ch";
      c.textContent = cell.shown ? cell.ch : "";
      s.appendChild(c);
      wordEl.appendChild(s);
      cellEls.push(s);
    });
  }
  function revealLetter(ch){
    let n = 0;
    Array.from(cur.entry.answer).forEach(function(c, i){
      if (c !== ch) return;
      const el = cellEls[i];
      el.firstChild.textContent = ch;
      el.classList.remove("enter");
      el.style.setProperty("--d", (n++ * 55) + "ms");
      el.classList.add("pop");
    });
  }
  function revealMissed(){
    Array.from(cur.entry.answer).forEach(function(c, i){
      const el = cellEls[i];
      if (!el || !isLetter(c) || cur.guessed.has(c)) return;
      el.firstChild.textContent = c;
      el.classList.remove("enter");
      el.classList.add("missed");
    });
  }
  function renderAll(){
    renderScore(false); renderDots(); renderLives(); renderWord();
    $("catTag").textContent = cur.entry.catName;
  }
  let bannerTimer = 0;
  function showBanner(main, sub, city, ms){
    $("bannerMain").textContent = main;
    $("bannerSub").textContent = sub || "";
    bannerEl.classList.toggle("city", !!city);
    bannerEl.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function(){ bannerEl.classList.remove("show"); }, ms || 1500);
  }
  function pulse(el, peak, ms){
    if (el.animate) el.animate([{ opacity:0 }, { opacity:peak, offset:0.25 }, { opacity:0 }], { duration:ms, easing:"ease-out" });
  }
  let toastTimer = 0;
  function toast(text, ms){
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, ms || 2200);
  }
  function confetti(fromEl){
    if (reduceMotion() || !Element.prototype.animate) return;
    const layer = $("confetti");
    const r = fromEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const colours = ["#ff2e88", "#ff7ab8", "#7fd4ff", "#ffd166", "#ffffff"];
    for (let i = 0; i < 28; i++){
      const p = document.createElement("i");
      p.style.left = cx + "px"; p.style.top = cy + "px";
      p.style.background = colours[i % colours.length];
      layer.appendChild(p);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 90 + Math.random() * 130;
      const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v, spin = (Math.random() - 0.5) * 720;
      p.animate([
        { transform:"translate(-50%,-50%) rotate(0deg)", opacity:1 },
        { transform:"translate(calc(-50% + " + dx.toFixed(0) + "px), calc(-50% + " + dy.toFixed(0) + "px)) rotate(" + (spin / 2).toFixed(0) + "deg)", opacity:1, offset:0.55 },
        { transform:"translate(calc(-50% + " + (dx * 1.2).toFixed(0) + "px), calc(-50% + " + (dy + 120).toFixed(0) + "px)) rotate(" + spin.toFixed(0) + "deg)", opacity:0 }
      ], { duration:1000 + Math.random() * 400, easing:"cubic-bezier(0.23, 1, 0.32, 1)" }).onfinish = function(){ p.remove(); };
    }
  }
  /* the engine decides which badges are earned; this album only announces them */
  function announceBadge(id){
    const b = BADGES.find(function(x){ return x[0] === id; });
    if (b){ toast("🏅 Badge: " + b[1]); SFX.badge(); }
  }
  function showClue(){
    $("clueText").textContent = "Clue: " + cur.entry.hint;
    $("clueBtn").hidden = true;
    $("hintCost").hidden = true;
    requestAnimationFrame(function(){ $("clueText").classList.add("show"); });
  }

  /* ---- round flow ---- */
  function start(g){
    clearTimeout(nextTimer);
    cur = g;
    const empty = $("emptyState");
    if (!g.entry){
      empty.hidden = false;
      $("clueRow").hidden = true;
      tilesEl.innerHTML = "";
      keysEl.hidden = true;
      $("catTag").textContent = "—";
      renderDots(); renderLives(); renderScore(false);
      if (scene.mode === "goal") scene.play(matchState(0, 0, g.lives, 0));   /* back to shape after a goal */
      return;
    }
    empty.hidden = true;
    keysEl.hidden = false;
    $("clueRow").hidden = false;
    /* after a goal the side that conceded kicks off */
    seed = Math.floor(Math.random() * 0x7fffffff);
    if (scene.mode === "goal") seed = (seed & ~1) | (scene.conceded === scene.ars ? 1 : 0);
    $("clueText").textContent = "";
    $("clueText").classList.remove("show");
    $("clueBtn").hidden = false;
    $("clueBtn").disabled = g.over;
    $("hintCost").hidden = false;
    renderAll();
    if (g.hintUsed) showClue();
    if (!g.over){ swing(); return; }
    /* a finished word carried over from another look: show the result, then play on */
    if (g.won) cellEls.forEach(function(el){ if (el) el.classList.add("win"); }); else revealMissed();
    scene.play(matchState(0, 0, g.lives, seed));
    nextTimer = setTimeout(function(){ ctx.newGame({ auto:true }); }, 1700);
  }
  /* The match for the word in play; the final guess plays a finish instead. */
  function stateNow(){
    return matchState(revealedFraction(cur.entry.answer, cur.guessed), Math.min(cur.misses, cur.lives - 1), cur.lives, seed);
  }
  function swing(){
    state = stateNow();
    scene.play(state);
  }
  function guessed(res){
    if (res.hit){
      SFX.good();
      revealLetter(res.letter);
    } else {
      SFX.bad();
      updateDots(); renderLives();
      pulse($("edge"), 1, 600);
    }
    if (!res.won && !res.lost) swing();
    res.badges.forEach(announceBadge);
  }
  function finished(out){
    $("clueBtn").disabled = true;
    if (out.won) onWin(out); else onLoss();
    out.badges.forEach(announceBadge);
  }
  function onWin(out){
    /* Arsenal score, with a move that suits where play was before this letter */
    const kind = lastFinish = pickFinish("ars", state, lastFinish, seededRand(seed));
    const hit = scene.finish("ars", kind, function(){
      flashEl.classList.add("left");
      pulse(flashEl, 1, 900);
      SFX.cheer();
      confetti(tilesEl);
      showBanner("GOAL!", FINISHES.ars[kind] + " · +" + out.points + (out.flawless ? " · flawless" : ""), false, 1700);
    });
    cellEls.forEach(function(el){ if (el) el.classList.add("win"); });
    renderScore(true);
    bump($("scoreVal"));
    nextTimer = setTimeout(function(){ ctx.newGame({ auto:true }); }, Math.max(1700, (hit - now() + 1.6) * 1000));
  }
  function onLoss(){
    revealMissed();
    renderScore(false);
    /* City score, with a move that suits where play was before this miss */
    const kind = lastFinish = pickFinish("city", state, lastFinish, seededRand(seed));
    const hit = scene.finish("city", kind, function(){
      flashEl.classList.remove("left");
      pulse(flashEl, 1, 900);
      SFX.groan();
      showBanner("GOAL", "Man City · " + FINISHES.city[kind], true, 1700);
    });
    nextTimer = setTimeout(function(){
      if (ctx.newGame({ auto:true })) toast("Full time on that run. New attack under way — score: 0");
    }, Math.max(3200, (hit - now() + 2) * 1000));
  }

  /* ================= sheets and buttons ================= */
  const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>';
  const ICON_MUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  function syncSoundBtn(){
    $("soundBtn").innerHTML = ctx.settings.muted ? ICON_MUTE : ICON_SOUND;
    $("soundBtn").setAttribute("aria-pressed", String(ctx.settings.muted));
  }
  function openSheet(el){
    el.hidden = false;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ el.classList.add("open"); });
    });
  }
  function closeSheet(el){
    if (el.hidden) return;
    el.classList.remove("open");
    setTimeout(function(){ if (!el.classList.contains("open")) el.hidden = true; }, 260);
  }
  const sheetOpen = function(){ return !$("settingsSheet").hidden || !$("statsSheet").hidden; };
  function closeSheets(){
    if (!$("settingsSheet").hidden){ closeSheet($("settingsSheet")); ctx.doneSettings(); }
    closeSheet($("statsSheet"));
  }
  root.querySelectorAll(".scrim").forEach(function(s){ s.addEventListener("click", closeSheets); });
  $("settingsBtn").addEventListener("click", function(){ SFX.click(); ctx.editSettings(); openSheet($("settingsSheet")); });
  $("setDone").addEventListener("click", function(){ SFX.click(); closeSheets(); toast("Settings saved"); });
  $("widenBtn").addEventListener("click", function(){ ctx.resetSettings(); ctx.newGame(); });
  $("soundBtn").addEventListener("click", function(){
    if (!ctx.toggleSound()){ ensureAudio(); SFX.click(); }
  });
  $("statsBtn").addEventListener("click", function(){ SFX.click(); renderStats(); openSheet($("statsSheet")); });
  $("statsDone").addEventListener("click", function(){ SFX.click(); closeSheet($("statsSheet")); });
  /* stats are shared by every look, so erasing takes a second tap */
  let wipeArmed = 0;
  $("statsWipe").addEventListener("click", function(){
    SFX.click();
    if (!wipeArmed){
      $("statsWipe").textContent = "Tap again to erase";
      toast("This erases stats and badges in all three looks");
      wipeArmed = setTimeout(function(){ wipeArmed = 0; $("statsWipe").textContent = "Erase stats"; }, 3000);
      return;
    }
    clearTimeout(wipeArmed); wipeArmed = 0;
    $("statsWipe").textContent = "Erase stats";
    ctx.resetStats(); renderStats(); renderScore(false); toast("Stats erased");
  });
  $("nextBtn").addEventListener("click", function(){ SFX.click(); ctx.newGame(); });
  $("runBtn").addEventListener("click", function(){
    SFX.click();
    if (ctx.newGame({ run:true })) toast("New run — score reset"); else renderScore(false);
  });
  $("clueBtn").addEventListener("click", function(){
    if (!cur || !cur.entry || cur.over) return;
    SFX.click();
    ctx.hint();
    showClue();
  });
  function renderStats(){
    const stats = ctx.stats;
    $("stBest").textContent = stats.bestScore;
    $("stBestStreak").textContent = stats.best;
    $("stPlayed").textContent = stats.played;
    $("stStreak").textContent = stats.streak;
    const wg = $("winsGrid"); wg.innerHTML = "";
    ctx.cats.forEach(function(c){
      const d = document.createElement("div");
      d.className = "cell";
      const name = document.createElement("span"); name.textContent = c.name;
      const b = document.createElement("b"); b.textContent = stats.winsPerCat[c.id] || 0;
      d.appendChild(name); d.appendChild(b); wg.appendChild(d);
    });
    const bg = $("badgeGrid"); bg.innerHTML = "";
    BADGES.forEach(function(bd){
      const won = stats.badges.c[bd[0]];
      const d = document.createElement("div");
      d.className = "badge" + (won ? " won" : "");
      const t = document.createElement("b"); t.textContent = (won ? "🏅 " : "🔒 ") + bd[1];
      const s = document.createElement("span"); s.textContent = bd[2];
      d.appendChild(t); d.appendChild(s); bg.appendChild(d);
    });
  }

  /* ================= scene checks (?selftest) ================= */
  /* The engine covers words, rules, storage, keys and fit; these pin the pitch. */
  function selftest(ev){
    start(cur);
    const t = function(name, actual, expected){ ev(name, function(){ return actual; }, expected); };
    /* reveal logic: only A-Z hidden; digits/punct/space always shown */
    const m = maskOf("MAMBO NO 5", new Set(["M","O"]));
    t("mask letters+prefill", m.map(function(c){ return c.shown ? c.ch : "_"; }).join(""),
      "M_M_O _O 5");
    t("mask gap kind", maskOf("A B", new Set()).map(function(c){ return c.kind; }), ["letter","gap","letter"]);
    /* revealed fraction counts distinct letters, ignoring digits and punctuation */
    t("revealed none", revealedFraction("MAMBO NO 5", new Set()), 0);
    t("revealed by distinct letter", revealedFraction("MAMBO NO 5", new Set(["M","Z"])), 0.2);
    t("revealed all", revealedFraction("MAMBO NO 5", new Set(["M","A","B","O","N"])), 1);
    /* match state: correct letters push Arsenal to x=0, misses push City to x=105 */
    function ms(r, m, l, seed){ const s = matchState(r, m, l, seed || 0); return [s.poss, Math.round(s.x * 10) / 10, s.shot]; }
    t("kick-off is level at halfway", ms(0, 0, 6).slice(1), [52.5, null]);
    t("kick-off possession comes from the word seed", [ms(0, 0, 6, 2)[0], ms(0, 0, 6, 3)[0]], ["city", "ars"]);
    t("a correct letter gives Arsenal the ball in City's half", ms(0.25, 0, 6), ["ars", 44, null]);
    t("a miss gives City the ball in Arsenal's half", ms(0, 1, 4), ["city", 61, null]);
    t("letters and misses ebb and flow", [ms(0.5, 1, 6)[0], ms(0.5, 4, 6)[0], ms(0.75, 4, 6)[0]], ["ars", "city", "ars"]);
    t("full word is Arsenal's shot", ms(1, 0, 6), ["ars", 0, "ars"]);
    t("full word on the last life is still Arsenal's shot", ms(1, 9, 10), ["ars", 0, "ars"]);
    t("final miss is City's shot (4 lives)", ms(0, 4, 4), ["city", 105, "city"]);
    t("final miss is City's shot (10 lives)", ms(0.9, 10, 10), ["city", 105, "city"]);
    t("last life with nothing revealed: City camped, 10 lives", ms(0, 9, 10), ["city", 83.1, null]);
    t("last life flagged", [matchState(0.5, 3, 4, 0).lastLife, matchState(0.5, 2, 4, 0).lastLife], [true, false]);
    t("same inputs, same state", JSON.stringify(matchState(0.4, 2, 7, 99)), JSON.stringify(matchState(0.4, 2, 7, 99)));
    /* a shot only at the end of a word; until then play stays outside both penalty areas */
    const shotBad = [];
    for (let lives = 4; lives <= 10; lives++){
      for (let n = 1; n <= 14; n++){
        for (let k = 0; k <= n; k++){
          for (let m = 0; m <= lives; m++){
            if (k === n && m === lives) continue; /* unreachable: the solving guess is never a miss */
            const s = matchState(k / n, m, lives, k * 31 + m);
            const end = k === n || m >= lives;
            if ((s.shot !== null) !== end || (!end && !(s.x > 16.5 && s.x < 88.5))) shotBad.push([lives, n, k, m]);
          }
        }
      }
    }
    t("shot only at terminal states, lives 4-10", shotBad, []);
    /* finishes fit where play was when the word ended, and never repeat back to back */
    function fits(side, st){
      const seen = new Set();
      for (let i = 0; i < 40; i++) seen.add(pickFinish(side, st, "", seededRand(i)));
      return Array.from(seen).sort();
    }
    const lastLifeLevel = matchState(0.8, 5, 6, 0), cityCamped = matchState(0, 3, 4, 0);
    const level = matchState(0.2, 1, 6, 0), arsHigh = matchState(0.8, 0, 6, 0);
    t("Arsenal win on the last life: counter or long ball", fits("ars", lastLifeLevel), ["counter", "longBall"]);
    t("Arsenal win with City camped: counter or long ball", fits("ars", cityCamped), ["counter", "longBall"]);
    t("Arsenal win from even play: through ball or long ball", fits("ars", level), ["longBall", "throughBall"]);
    t("Arsenal win in the final third: one-two or cut-back", fits("ars", arsHigh), ["cutBack", "oneTwo"]);
    /* City finish from the state before the final miss, so misses = lives - 1 */
    const cityDominant = matchState(0, 5, 6, 0), arsHadIt = matchState(0.9, 5, 6, 0), cityLevel = matchState(0.5, 5, 6, 0);
    t("City win after dominating: build-up or corner", fits("city", cityDominant), ["buildUp", "corner"]);
    t("City win while Arsenal had the ball: turnover or corner", fits("city", arsHadIt), ["corner", "turnover"]);
    t("City win from even play: corner or build-up", fits("city", cityLevel), ["buildUp", "corner"]);
    t("finish never repeats", [0, 0.5, 0.99].map(function(r){ return pickFinish("ars", cityCamped, "counter", function(){ return r; }); }), ["longBall", "longBall", "longBall"]);
    t("finish never repeats (City)", [0, 0.99].map(function(r){ return pickFinish("city", arsHadIt, "turnover", function(){ return r; }); }), ["corner", "corner"]);
    t("every finish has a play and a caption", ["ars", "city"].every(function(side){
      return Object.keys(FINISHES[side]).length >= 3 && Object.keys(FINISHES[side]).every(function(k){ return typeof FINISH_PLAYS[k] === "function" && FINISHES[side][k].length > 0; });
    }), true);
    /* formations: eleven a side, keeper first, everyone on the pitch, for every state */
    function onPitch(shape){ return shape.every(function(p){ return p[0] >= 0 && p[0] <= 105 && p[1] >= 0 && p[1] <= 68; }); }
    function meanX(shape){ return shape.reduce(function(s, p){ return s + p[0]; }, 0) / shape.length; }
    function at6(r, m){ return matchState(r, m, 6, 0); }
    const grid = [];
    [0, 0.2, 0.5, 0.8, 0.95].forEach(function(r){ for (let m = 0; m < 6; m++) grid.push(at6(r, m)); });
    t("11 v 11, keepers deepest, all on the pitch", grid.every(function(st){
      const c = teamShape("city", st), a = teamShape("ars", st);
      return c.length === 11 && a.length === 11 && onPitch(c) && onPitch(a) &&
        c.slice(1).every(function(q){ return q[0] > c[0][0]; }) &&
        a.slice(1).every(function(q){ return q[0] < a[0][0]; });
    }), true);
    t("defending back four stays goal-side of the ball", grid.every(function(st){
      const d = teamShape(st.poss === "city" ? "ars" : "city", st).slice(1, 5);
      return d.every(function(q){ return st.poss === "city" ? q[0] > st.x : q[0] < st.x; });
    }), true);
    t("misses push City up the pitch", meanX(teamShape("city", at6(0, 1))) < meanX(teamShape("city", at6(0, 3))) && meanX(teamShape("city", at6(0, 3))) < meanX(teamShape("city", at6(0, 5))), true);
    t("letters push Arsenal up the pitch", meanX(teamShape("ars", at6(0.2, 0))) > meanX(teamShape("ars", at6(0.5, 0))) && meanX(teamShape("ars", at6(0.5, 0))) > meanX(teamShape("ars", at6(0.8, 0))), true);
    t("City drop back when Arsenal win the ball", meanX(teamShape("city", at6(0.5, 2))) < meanX(teamShape("city", at6(0, 2))), true);
    t("City 4-3-3 kick-off lines", CITY_START.map(function(p){ return p[0]; }), [5, 22, 17, 17, 22, 30, 38, 38, 48, 50, 48]);
    t("Arsenal 4-4-2 kick-off lines", ARS_START.map(function(p){ return 105 - p[0]; }), [103, 64.5, 66, 66, 64.5, 52, 53, 53, 52, 40, 40]);
    const near = matchState(0.5, 0, 6, 0), far = Object.assign({}, near, { y:58 });
    near.y = 10;
    t("defending side slides towards the ball", teamShape("city", near)[2][1] < teamShape("city", far)[2][1], true);
    t("carrier is an outfield non-striker of the side in possession", grid.every(function(st){
      const i = carrierFor(teamShape(st.poss, st), st, ROLES[st.poss].st);
      return i > 0 && ROLES[st.poss].st.indexOf(i) === -1;
    }), true);
    const sh = teamShape("city", at6(0, 3));
    const relays = [0, 0.3, 0.6, 0.99].map(function(r){ return pickRelay(5, 6, sh, sh[5][0], function(){ return r; }); });
    t("relay never the keeper, passer or receiver", relays.every(function(i){ return i > 0 && i !== 5 && i !== 6; }), true);
    t("relay -1 when nobody fits", pickRelay(1, 2, [[0,0],[10,0],[12,0]], 10, Math.random), -1);
    /* motion segments: start where the actor is, keep its velocity, land on target */
    const seg = makeSeg(1, 2, { x:10, y:20, vx:3, vy:0 }, [30, 20], [0, 4]);
    const s0 = evalSeg(seg, 1), s1 = evalSeg(seg, 3), sm = evalSeg(seg, 2);
    t("segment starts at current position", [s0.x, s0.y], [10, 20]);
    t("segment keeps incoming velocity", [Math.round(s0.vx * 1000) / 1000, Math.round(s0.vy * 1000) / 1000], [3, 0]);
    t("segment lands at rest on target", [s1.x, s1.y, s1.vx, s1.vy], [30, 20, 0, 0]);
    t("segment bulge bends the path midway", Math.round(sm.y * 1000) / 1000, 24);
    t("segment caps runaway velocity", makeSeg(0, 1, { x:0, y:0, vx:100, vy:0 }, [1, 0]).v0[0], 3.2);
    const a1 = evalSeg(seg, 1.999), a2 = evalSeg(seg, 2.001);
    t("segment is continuous", Math.abs(a1.x - a2.x) < 0.05 && Math.abs(a1.y - a2.y) < 0.05, true);
    /* ball: a pass scheduled before the passer's run changes still leaves from their feet */
    const saved = [B.events, B.holder, scene.busyUntil], tp = now() + 5;
    const pa = { dir:1, segs:[restSeg([30, 30])] }, pr = { dir:1, segs:[restSeg([50, 30])] };
    B.events = [{ t:-1e9, kind:"own", who:pa }];
    passBall(pr, tp);
    moveTo(pa, [36, 38], tp - 2, 1, null, true);
    const kb = ballAt(tp - 1e-3), ka = ballAt(tp + 1e-3);
    t("kick leaves from the passer's new spot", Math.hypot(kb[0] - ka[0], kb[1] - ka[1]) < 0.1, true);
    B.events = saved[0]; B.holder = saved[1]; scene.busyUntil = saved[2];
    /* tile size: largest tile that fits each word on a line and the answer within the height budget */
    t("tile size: short word is full size", tileSize([6], 321, 86), 38);
    t("tile size: long word shrinks to fit the row", tileSize([12], 321, 86), 22);   /* 12*22 + 11*5 = 319 */
    t("tile size: long phrase shrinks into two rows", tileSize([3, 5, 2, 4, 6], 321, 86), 25);   /* row one 10t + 67 <= 321 */
    t("tile size: falls back to the smallest tile", tileSize([14, 14, 14], 200, 40), 20);
  }

  /* ================= boot ================= */
  buildPitch($("pitchBg"));
  buildScene();
  ctx.keyboard(keysEl);
  syncSoundBtn();

  return {
    start, guessed, finished, toast, selftest,
    sync: syncSoundBtn,
    badgeIds: BADGES.map(function(b){ return b[0]; }),
    modalOpen: sheetOpen,
    closeModal: closeSheets
  };
});
