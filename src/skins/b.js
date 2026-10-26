"use strict";
/* =====================================================================
   Skin B, "Piggy Paradise": guinea pigs, a gallows that builds and a
   soft landing in the hay. The engine owns words, rules, storage and
   the keyboard; this file runs the scene, the sounds and the copy.
   ===================================================================== */
Hangman.skin("b", {name: "Piggy Paradise", title: "Piggy Paradise Hangman", theme: "#fde3ee", fit: "newBtn"}, (ctx, root) => {
  const {setTimeout, clearTimeout} = ctx.timers;
  const STORE_HAY = "hangman-b:hayseen";
  let game = null, started = false;
  /* hay landings after the first reveal; never the same one twice running */
  const LANDINGS=["bounce","hat","friend","carrot","dandelion","shades","bird","veg","sneeze","heart"];
  const NAMES={pepper:"Pepper",pixie:"Pixie"};
  /* ============ pure scene logic (tested by ?selftest) ============ */
  const PigLogic = {
    /* everything not A-Z shows from the start */
    prefilled(w){
      const out=[];
      for(const ch of w){
        if(ch>="A"&&ch<="Z") out.push(null);
        else out.push(ch===" "?" ":ch);
      }
      return out;
    },
    /* gallows stage 0..10 for a miss count: 1-9 build and lead up, 10 is the drop; every miss advances at least one step */
    stageFor(m,lives){ return m>=lives?10:Math.round(m*9/(lives-1)); },
    /* which hay landing to play: the first reveal is the classic, later ones vary */
    landingVariant(seen,last,rand){
      if(!(seen>0)) return "first";
      const pool=LANDINGS.filter(v=>v!==last);
      return pool[Math.min(pool.length-1,Math.floor((rand?rand():Math.random())*pool.length))];
    },
    /* who stars this word: the hero is in the gallows scene, the buddy watches from the log */
    castFor(rand){ const hero=(rand?rand():Math.random())<0.5?"pepper":"pixie"; return {hero,buddy:hero==="pepper"?"pixie":"pepper"}; },
    /* largest tile (20-42px) that fits every word on one line and the whole answer within maxH; words wrap 14px apart, rows 8px apart */
    tileSize(lens,room,gap,maxH){
      for(let t=42;t>20;t--){
        let rows=1, x=0, fits=true;
        for(const n of lens){
          const w=n*t+(n-1)*gap;
          if(w>room){ fits=false; break; }
          if(x&&x+14+w>room){ rows++; x=w; } else x+=(x?14:0)+w;
        }
        if(fits&&rows*t*1.22+(rows-1)*8<=maxH) return t;
      }
      return 20;
    }
  };
  /* sticker album: the engine decides who earns what, the album names them */
  const BADGES=[
   {id:"first",em:"🌱",name:"First munch",desc:"Win your first game"},
   {id:"streak3",em:"🔥",name:"Wheek streak",desc:"Reach a streak of 3"},
   {id:"streak5",em:"⚡",name:"Popcorn party",desc:"Reach a streak of 5"},
   {id:"daily",em:"📅",name:"Daily dab",desc:"Solve the daily puzzle"},
   {id:"daily3",em:"🗓️",name:"Three-day grazer",desc:"Daily streak of 3"},
   {id:"nomiss",em:"✨",name:"Squeaky clean",desc:"Win without a single miss or hint"},
   {id:"comeback",em:"💪",name:"Hay-day hero",desc:"Win with only 1 life left"},
   {id:"explorer",em:"🧭",name:"Explorer",desc:"Win in 4 different categories"},
   {id:"hintwin",em:"💡",name:"Clever clogs",desc:"Win after using the hint"},
   {id:"veg10",em:"🥕",name:"Veg feast",desc:"Earn 10 treats in one game"},
   {id:"ten",em:"🏆",name:"Top pig",desc:"Play 10 games"}
  ];
  function sticker(id){
    const b=BADGES.find(b=>b.id===id);
    if(b) toast("New sticker: "+b.em+" "+b.name+"!");
    renderAlbum();
  }

  /* ============ sound (Web Audio, gesture-gated) ============ */
  let actx=null;
  function ensureAudio(){ actx=ctx.audio(); return !!actx; }
  function tone(freq,dur,delay,type,vol){
    if(ctx.settings.muted||snap||!actx) return;
    const t=actx.currentTime+(delay||0);
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type||"sine"; o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(vol||0.06,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t+dur+0.05);
  }
  function sweep(f0,f1,dur,delay,type,vol){
    if(ctx.settings.muted||snap||!actx) return;
    const t=actx.currentTime+(delay||0);
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type||"sine"; o.frequency.setValueAtTime(f0,t); o.frequency.exponentialRampToValueAtTime(f1,t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(vol||0.05,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t+dur+0.05);
  }
  const Snd={
    unlock(){ ensureAudio(); },
    press(){ tone(520,0.08,0,"triangle",0.03); },
    right(){ tone(660,0.12,0,"sine",0.05); tone(880,0.14,0.09,"sine",0.05); }, /* wheek-ish rise */
    wrong(){ tone(220,0.18,0,"sawtooth",0.02); },
    win(){ [523,659,784,1047].forEach((f,i)=>tone(f,0.22,i*0.11,"triangle",0.05)); },
    crunch(){ tone(1500,0.03,0,"square",0.012); tone(1150,0.03,0.05,"square",0.012); },
    knock(){ tone(190,0.09,0,"triangle",0.07); tone(95,0.12,0.01,"sine",0.06); },
    zip(){ sweep(520,240,0.35,0,"triangle",0.025); },
    click(){ tone(1300,0.04,0,"square",0.018); tone(900,0.05,0.04,"square",0.014); },
    creak(){ sweep(190,140,0.4,0,"sawtooth",0.01); },
    gulp(){ sweep(300,150,0.12,0,"sine",0.06); sweep(260,420,0.1,0.14,"sine",0.04); },
    clack(){ tone(140,0.08,0,"square",0.025); tone(110,0.1,0.06,"triangle",0.05); },
    ping(){ tone(1760,0.3,0,"sine",0.035); tone(2637,0.25,0.02,"sine",0.018); },
    whoosh(){ sweep(900,160,0.85,0,"sine",0.022); },
    flump(){ tone(110,0.22,0,"triangle",0.09); tone(70,0.28,0.02,"sine",0.08); },
    chirp(){ sweep(2300,3300,0.07,0,"sine",0.025); sweep(2500,3500,0.07,0.11,"sine",0.025); },
    sneeze(){ sweep(500,1100,0.22,0,"sine",0.02); sweep(1700,260,0.16,0.26,"triangle",0.03); },
    wheek(p){ p=p||1; sweep(900*p,1500*p,0.12,0,"sine",0.045); sweep(1400*p,1100*p,0.14,0.12,"sine",0.045); sweep(950*p,1600*p,0.12,0.3,"sine",0.04); }
  };
  function syncSoundBtn(){
    $("soundBtn").setAttribute("aria-pressed",String(!ctx.settings.muted));
  }


  const VEG=["🥕","🫑","🥒","🥬","🍅","🌿","🌽","🍀"];

  /* A fresh word, or the word in play redrawn after a skin switch: the scene snaps to its stage. */
  function start(g,opts){
    game=g;
    const instant=opts.resumed||!started; started=true;
    snap=opts.resumed;
    sceneReset(instant,PigLogic.castFor());
    const empty=$("empty");
    empty.hidden=!!g.entry;
    if(!g.entry) empty.textContent="No words match those filters — widen the word length or tick more categories in Settings.";
    $("hinttext").classList.remove("show");
    $("hinttext").textContent="";
    $("hintbtn").disabled=!g.entry;
    buildWord(); renderPips(); renderMeta(); syncTabs(); syncSoundBtn();
    if(opts.resumed&&g.entry){
      for(const L of g.guessed) if(!g.wrong.includes(L)) revealLetter(L);
      if(g.hintUsed) showHint();
      if(g.over) g.won?celebrateTiles():revealAnswer();
      else sceneTo(PigLogic.stageFor(g.misses,g.lives));
    }
    enqueue(()=>{ snap=false; });
  }

  /* ============ rendering ============ */
  const $=id=>document.getElementById(id);
  function toast(msg){
    const t=$("toast"); t.textContent=msg; t.classList.add("show");
    clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"),2600);
  }
  function say(msg){ $("sr").textContent=msg; }
  /* snap: a resumed game jumps to its stage the way reduced motion does, without sound */
  let snap=false;
  const reduced=()=>snap||window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE={out:"cubic-bezier(0.23,1,0.32,1)",inOut:"cubic-bezier(0.77,0,0.175,1)",back:"cubic-bezier(0.34,1.56,0.64,1)",
    fall:"cubic-bezier(0.55,0.085,0.68,0.53)",up:"cubic-bezier(0.33,1,0.68,1)",down:"cubic-bezier(0.32,0,0.67,0)"};

  /* --- cartoon guinea pigs, front view, feet at (0,0): Pepper (white and grey) & Pixie (white, chocolate, black, tan) --- */
  function pigArt(kind){
    const P=kind==="pepper";
    const body=P?"#f1ebe0":"#fffdf8", earL=P?"#6c7380":"#2b2624", earR=P?"#9aa0aa":"#6b4226";
    const marks=P
      ? `<ellipse cx="-24" cy="-11" rx="12" ry="15" fill="#cdd0d6"/><ellipse cx="24" cy="-11" rx="12" ry="15" fill="#cdd0d6"/>
         <path d="M-29-27C-30-44-16-52-1-51C1-44-1-36-3-29C-6-21-15-19-21-21C-26-22-29-24-29-27z" fill="#646b78"/>
         <ellipse cx="0" cy="-35" rx="4.2" ry="15" fill="#fff"/><ellipse cx="0" cy="-11" rx="14" ry="8" fill="#fff" opacity=".65"/>`
      : `<path d="M1-51C14-52 29-44 29-31C29-23 21-19 13-21C6-23 3-30 3-37z" fill="#6b4226"/>
         <ellipse cx="-23" cy="-12" rx="13" ry="14" fill="#2b2624"/><ellipse cx="22" cy="-8" rx="10" ry="9" fill="#c98a4b"/>`;
    const eyes=r=>`<circle cx="-10" cy="-30" r="${r}" fill="#2a1520"/><circle cx="10" cy="-30" r="${r}" fill="#2a1520"/><circle cx="-8.7" cy="-31.4" r="1.25" fill="#fff"/><circle cx="11.3" cy="-31.4" r="1.25" fill="#fff"/>`;
    const line=`stroke="#7a2f48" stroke-width="1.8" fill="none" stroke-linecap="round"`;
    return `<g class="hz"><path d="M-21-26L0-64L21-26" stroke="#e14e87" stroke-width="3.4" fill="none" stroke-linejoin="round"/><circle cx="0" cy="-66" r="4" fill="none" stroke="#b93a6c" stroke-width="2.6"/></g>
    <ellipse cx="-19" cy="-45" rx="8" ry="6.5" fill="${earL}" transform="rotate(-28 -19 -45)"/><ellipse cx="19" cy="-45" rx="8" ry="6.5" fill="${earR}" transform="rotate(28 19 -45)"/>
    <ellipse cx="-19" cy="-44" rx="4.5" ry="3.4" fill="#f4b3c3" transform="rotate(-28 -19 -44)"/><ellipse cx="19" cy="-44" rx="4.5" ry="3.4" fill="#f4b3c3" transform="rotate(28 19 -44)"/>
    <g class="feet" fill="#f2a9ba"><ellipse cx="-15" cy="-2" rx="5.5" ry="3.2"/><ellipse cx="-5" cy="-1" rx="4.5" ry="3"/><ellipse cx="5" cy="-1" rx="4.5" ry="3"/><ellipse cx="15" cy="-2" rx="5.5" ry="3.2"/></g>
    <ellipse cx="0" cy="-25" rx="29" ry="25" fill="${body}"/>
    <g clip-path="url(#pigClip)">${marks}<g class="hz"><rect x="-30" y="-12" width="60" height="8" fill="#f27ba8"/><rect x="-30" y="-12" width="60" height="2" fill="#fff" opacity=".5"/></g></g>
    <ellipse cx="0" cy="-25" rx="29" ry="25" fill="none" stroke="#e5d6c8" stroke-width="1.2"/>
    <ellipse cx="-18" cy="-21" rx="4.6" ry="3" fill="#f7a8bf" opacity=".75"/><ellipse cx="18" cy="-21" rx="4.6" ry="3" fill="#f7a8bf" opacity=".75"/>
    <ellipse cx="0" cy="-22.5" rx="3.2" ry="2.3" fill="#f08aa6"/>
    <g class="m-happy"><g class="blink">${eyes(3.6)}</g><path d="M-5-18q2.5 3 5 0q2.5 3 5 0" ${line}/></g>
    <g class="m-worried">${eyes(3.8)}<path d="M-16-37L-6-40M16-37L6-40" stroke="#2a1520" stroke-width="1.9" stroke-linecap="round"/><path d="M-5-16.5q2.5-2.2 5 0q2.5 2.2 5 0" ${line}/></g>
    <g class="m-scared"><circle cx="-10" cy="-30" r="5.6" fill="#fff" stroke="#2a1520" stroke-width="1.2"/><circle cx="10" cy="-30" r="5.6" fill="#fff" stroke="#2a1520" stroke-width="1.2"/><g class="pupils"><circle cx="-10" cy="-29.5" r="2.2" fill="#2a1520"/><circle cx="10" cy="-29.5" r="2.2" fill="#2a1520"/></g><path d="M-16-40L-6-44M16-40L6-44" stroke="#2a1520" stroke-width="1.9" stroke-linecap="round"/><ellipse cx="0" cy="-15.5" rx="2.6" ry="3.2" fill="#7a2f48"/></g>
    <g class="m-joy"><path d="M-14-29q4-6 8 0M6-29q4-6 8 0" stroke="#2a1520" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M-6-18.5q6 8 12 0z" fill="#7a2f48"/><path d="M-3.2-15q3.2 2.6 6.4 0" fill="#f58fab"/></g>
    <g class="sw"><path class="drip" d="M25-47q3.4 5.4 0 7.6q-3.4-2.2 0-7.6z" fill="#b6e2f7" stroke="#78bde0" stroke-width=".8"/></g>
    <g class="hb"><path d="M-9-49l-6-7M1-50l2-9M9-48l7-5" stroke="#d6a640" stroke-width="2" stroke-linecap="round"/></g>
    <g class="prop p-hat"><ellipse cx="0" cy="-47" rx="24" ry="5.5" fill="#efcd70" stroke="#c99a3a" stroke-width="1.2"/><path d="M-12-48C-12-62 12-62 12-48z" fill="#f4d985" stroke="#c99a3a" stroke-width="1.2"/><rect x="-12" y="-52" width="24" height="3.4" fill="#e14e87"/></g>
    <g class="prop p-shades"><path d="M-10-23C-21-30-19-40-10-35.5C-1-40 1-30-10-23zM10-23C-1-30 1-40 10-35.5C19-40 21-30 10-23z" fill="#3a1d2b" stroke="#e14e87" stroke-width="2.2" stroke-linejoin="round"/><path d="M-2.5-33h5" stroke="#e14e87" stroke-width="2.2"/><path d="M-15-33q2-2 4-1M5-33q2-2 4-1" stroke="#fff" stroke-width="1.3" opacity=".6" fill="none" stroke-linecap="round"/></g>
    <g class="prop p-carrot"><path d="M3-17L23.4-39.1Q27.5-38 28.6-32.9z" fill="#f28c28" stroke="#d06a14" stroke-width="1.2" stroke-linejoin="round"/><path d="M12-26l3 2M18-31l3 2" stroke="#d06a14" stroke-width="1.2" stroke-linecap="round"/><path d="M26-36l1-9M26-36l7-5M26-36l-4-7" stroke="#5da271" stroke-width="2.4" stroke-linecap="round"/></g>
    <g class="prop p-dandelion"><path d="M-3-17Q-16-26-22-44" stroke="#5da271" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M-11-24q-9-3-12 3q7 2 12-3z" fill="#7cc47f"/><g transform="translate(-22 -48)"><circle r="7.5" fill="#ffd23f"/><circle r="7.5" fill="none" stroke="#f5b400" stroke-width="2.2" stroke-dasharray="2 2"/><circle r="3" fill="#f5b400"/></g></g>
    <g class="prop p-bird"><g transform="translate(5 -50)"><path d="M-2 0l-1.5 3M2 0l1 3" stroke="#e8a93d" stroke-width="1.4" stroke-linecap="round"/><path d="M-8-7l-6-3 1 6z" fill="#6aaee0"/><ellipse cy="-6" rx="8" ry="6.5" fill="#8fc8f0"/><path d="M-4-6q3.5 4 7 0" fill="#6aaee0"/><circle cx="3" cy="-8.5" r="1.3" fill="#2a1520"/><path d="M7.5-8.5l4 1.2-4 1.4z" fill="#e8a93d"/><ellipse cx="4" cy="-4.5" rx="1.8" ry="1.1" fill="#f7a8bf"/></g></g>`;
  }

  /* ============ scene: one continuous world moved with WAAPI, transform and opacity only ============ */
  const HOME={x:168,y:212}, TRAP={x:332,y:188}, ROPE=40, HOIST=12, POP_Y=654;
  const BUDDY={hide:44,peek:86,out:112}; /* translateX into, at and beyond the log mouth */
  const CAM_DOWN="translateY(-62.857%)", BG_DOWN="translateY(-36.667%)"; /* 440 of 700 world units; the sky follows at 0.35x */
  /* each piece's hidden pose: building animates from here to rest, dismantling animates back */
  const HIDDEN={pDeckBack:"translateY(-28px)",pDeckFront:"translateY(-28px)",pPost:"scaleY(0.2)",pBeam:"translateX(-30px) rotate(-8deg)",
    pBrace:"rotate(-60deg)",rope:"scaleY(0.08)",bow:"translateY(3px)",gulp:"scale(0.85)"};
  const MOVERS=["cam","world","bg","pigPos","pigHoist","pigHop","pigSquash","pigShadow","swing","tdL","tdR","buddy","buddyHop","buddySquash",
    "hayBuddy","hayBack","hayFront","hayBackSq","hayFrontSq"].concat(Object.keys(HIDDEN));
  const SC={stage:0,target:0,queue:[],busy:false,gen:0,speed:1,timers:new Set(),sway:null,down:false,pigHome:true,onLanded:null,moodT:0};
  const pt=(x,y)=>`translate(${x}px,${y}px)`;
  const hopT=(y,r)=>`translate(0px,${y}px) translate(0px,-26px) rotate(${r}deg) translate(0px,26px)`; /* turns about the body, not the feet */
  const moodFor=s=>s>=8?"scared":s>=2?"worried":"happy";
  const D=ms=>Math.round(ms*SC.speed);
  const hero=()=>$("heroArt");
  let cast={hero:"pepper",buddy:"pixie"}, lastLanding="", buddyT=0;
  /* draws whichever pig plays each part; art is only swapped while that part is out of sight */
  function applyCast(c){
    cast=c;
    for(const [id,kind] of [["heroArt",c.hero],["buddyArt",c.buddy],["hayBuddyArt",c.buddy]]){
      const el=$(id); if(el.dataset.kind!==kind){ el.innerHTML=pigArt(kind); el.dataset.kind=kind; }
    }
    $("stage").setAttribute("aria-label","Guinea pig scene: "+NAMES[c.hero]+" in the middle, "+NAMES[c.buddy]+" peeking from her log");
  }

  function freeze(el){
    const list=el.getAnimations(); if(!list.length) return;
    const cs=getComputedStyle(el), t=cs.transform, o=cs.opacity;
    list.forEach(a=>a.cancel());
    el.style.transform=t==="none"?"":t; el.style.opacity=o;
  }
  /* runs keyframes, then writes the end state to style so the next animation starts from where this one stopped */
  function anim(el,frames,opts){
    const last=frames[frames.length-1];
    if(frames.length===1){
      const cs=getComputedStyle(el), from={};
      if(last.transform!=null) from.transform=cs.transform;
      if(last.opacity!=null) from.opacity=cs.opacity;
      freeze(el); frames=[from,last];
    }else if((last.transform!=null&&el._t&&el._t.playState==="running")||(last.opacity!=null&&el._o&&el._o.playState==="running")) freeze(el);
    if(reduced()){ /* calm: positions land at once, only opacity eases */
      if(last.transform!=null) el.style.transform=last.transform;
      if(last.opacity==null) return null;
      const from=frames[0].opacity!=null?frames[0].opacity:getComputedStyle(el).opacity;
      el.style.opacity=String(last.opacity);
      return el.animate([{opacity:from},{opacity:last.opacity}],{duration:240,easing:"ease"});
    }
    const a=el.animate(frames,Object.assign({fill:"forwards"},opts));
    if(last.transform!=null) el._t=a;
    if(last.opacity!=null) el._o=a;
    a.finished.then(()=>{
      if(last.transform!=null&&el._t===a) el.style.transform=last.transform;
      if(last.opacity!=null&&el._o===a) el.style.opacity=String(last.opacity);
      a.cancel();
    },()=>{});
    return a;
  }
  function pose(id,t,o){ const el=$(id); el.getAnimations().forEach(a=>a.cancel()); if(t!=null) el.style.transform=t; if(o!=null) el.style.opacity=String(o); }
  function later(ms,fn){ const t=setTimeout(()=>{ SC.timers.delete(t); fn(); },ms); SC.timers.add(t); }
  const wait=ms=>new Promise(r=>later(reduced()?Math.min(ms,60):ms,r));
  /* a sequence interrupted by a new round, a win or a switch to another look simply never resumes */
  const mounted=root.firstElementChild;
  function done(a){ const g=SC.gen; return (a?a.finished:Promise.resolve()).then(()=>{ if(g!==SC.gen||!mounted.isConnected) return new Promise(()=>{}); },()=>new Promise(()=>{})); }
  function enqueue(fn){ SC.queue.push(fn); pump(); }
  async function pump(){
    if(SC.busy) return; SC.busy=true; const g=SC.gen;
    while(SC.queue.length){
      const fn=SC.queue.shift(); SC.speed=SC.queue.length?0.6:1; /* several queued misses play faster */
      try{ await fn(); }catch(e){ console.error(e); }
      if(g!==SC.gen) return;
    }
    SC.busy=false;
  }
  function cancelScene(){
    SC.gen++; SC.queue=[]; SC.busy=false; SC.sway=null;
    SC.timers.forEach(clearTimeout); SC.timers.clear(); clearTimeout(buddyT);
    MOVERS.forEach(id=>freeze($(id)));
    ["strawFx","hearts","dust"].forEach(id=>{ $(id).textContent=""; });
  }
  function setMood(m){ clearTimeout(SC.moodT); hero().dataset.mood=m; }
  function flashJoy(){
    const art=hero(); if(art.dataset.mood==="joy") return;
    art.dataset.mood="joy"; clearTimeout(SC.moodT);
    SC.moodT=setTimeout(()=>{ if(!game.over) art.dataset.mood=moodFor(SC.stage); },650);
  }
  function initScene(away){
    for(const id in HIDDEN) pose(id,HIDDEN[id],0);
    pose("tdL","rotate(0deg)"); pose("tdR","rotate(0deg)"); pose("swing","rotate(0deg)");
    pose("pigPos",pt(away?-40:HOME.x,HOME.y),1); pose("pigHoist","translateY(0px)"); pose("pigHop",hopT(0,0)); pose("pigSquash","scale(1,1)"); pose("pigShadow","scale(1)",1);
    pose("hayBack",null,0); pose("hayFront",null,0); pose("hayBackSq","scale(1,1)"); pose("hayFrontSq","scale(1,1)"); pose("hayBuddy","translateY(0px)");
    pose("world","translateY(0%)"); pose("bg","translateY(0%)"); pose("cam","translate(0px,0px)",1);
    pose("buddy",`translateX(${BUDDY.hide}px)`); pose("buddyHop",hopT(0,0)); pose("buddySquash","scale(1,1)");
    const art=hero(); Object.assign(art.dataset,{mood:"happy",harness:"",sweat:"",prop:"",hay:"",dangle:""});
    const p=art.querySelector(".pupils"); p.getAnimations().forEach(a=>a.cancel()); p.style.transform="";
    Object.assign($("buddyArt").dataset,{mood:"happy",sweat:""});
    $("pigShake").classList.remove("tremble");
    ["strawFx","hearts","dust"].forEach(id=>{ $(id).textContent=""; });
    SC.down=false; SC.pigHome=true; SC.sway=null;
  }
  function sceneTo(target){
    while(SC.target<target){
      const s=++SC.target;
      enqueue(()=>{ SC.stage=s; if(s<10) setMood(moodFor(s)); return STEP[s](); });
    }
  }

  /* --- little effects inside the world --- */
  const SVGNS="http://www.w3.org/2000/svg";
  function svgEl(tag,attrs,parent){ const e=document.createElementNS(SVGNS,tag); for(const k in attrs) e.setAttribute(k,attrs[k]); parent.appendChild(e); return e; }
  function spark(el,frames,o){ const a=el.animate(frames,Object.assign({fill:"forwards"},o)); a.finished.then(()=>el.remove(),()=>{}); }
  function dust(x,y){
    if(reduced()) return;
    for(const dx of [-14,0,14]){
      const c=svgEl("circle",{cx:x+dx,cy:y,r:5,fill:"#fff"},$("dust"));
      spark(c,[{transform:"translate(0px,0px) scale(0.5)",opacity:.8},{transform:`translate(${dx*.8}px,-6px) scale(1.5)`,opacity:0}],{duration:460,easing:EASE.out});
    }
  }
  function straws(x,y,n){
    if(reduced()) return;
    for(let i=0;i<n;i++){
      const w=svgEl("g",{transform:`translate(${x+Math.random()*44-22} ${y})`},$("strawFx"));
      const s=svgEl("path",{d:"M-5 0H5",stroke:i%3?"#e0b54c":"#c99a3a","stroke-width":2.4,"stroke-linecap":"round"},w);
      const ang=-Math.PI/2+(Math.random()-.5)*2.4, v=36+Math.random()*52, ax=Math.cos(ang)*v, ay=Math.sin(ang)*v, r=Math.random()*400-200;
      spark(s,[{transform:"translate(0px,0px) rotate(0deg)",opacity:1,easing:EASE.out},
        {transform:`translate(${ax}px,${ay}px) rotate(${r/2}deg)`,opacity:1,offset:.4,easing:EASE.fall},
        {transform:`translate(${ax*1.4}px,${ay+70}px) rotate(${r}deg)`,opacity:0}],{duration:900+Math.random()*500});
      w.addEventListener("animationend",()=>w.remove());
      later(1500,()=>w.remove());
    }
  }
  function hearts(x,y){
    if(reduced()) return;
    [-16,2,18].forEach((dx,i)=>{
      const h=svgEl("path",{d:"M0 3C-6-2-4-7 0-4C4-7 6-2 0 3z",fill:"#e14e87",transform:`translate(${x+dx} ${y})`},$("hearts"));
      const k=svgEl("g",{},h.parentNode); k.appendChild(h);
      spark(k,[{transform:"translate(0px,6px) scale(0.6)",opacity:0},{transform:`translate(${dx*.3}px,-8px) scale(1.1)`,opacity:1,offset:.3},{transform:`translate(${dx*.6}px,-34px) scale(1)`,opacity:0}],{duration:1300,delay:i*120,easing:EASE.out,fill:"both"});
    });
    bubble("wheek!",x+34,y-2);
  }
  function bubble(txt,x,y){
    const t=svgEl("text",{x,y,"font-size":12,"font-weight":800,fill:"#b93a6c","text-anchor":"middle"},$("hearts")); t.textContent=txt;
    spark(t,reduced()?[{opacity:0},{opacity:1,offset:.25},{opacity:0}]
      :[{transform:"translate(0px,6px)",opacity:0},{transform:"translate(0px,0px)",opacity:1,offset:.25},{transform:"translate(0px,-14px)",opacity:0}],{duration:1500,easing:EASE.out});
  }
  function bigHeart(x,y){
    const g=svgEl("g",{transform:`translate(${x} ${y})`},$("hearts"));
    const h=svgEl("path",{d:"M0 9C-18-6-12-21 0-12C12-21 18-6 0 9z",fill:"#e14e87",stroke:"#fff","stroke-width":2},g);
    spark(h,reduced()?[{opacity:0},{opacity:1,offset:.15},{opacity:1,offset:.8},{opacity:0}]
      :[{transform:"translateY(10px) scale(0.3)",opacity:0,easing:EASE.back},{transform:"translateY(-4px) scale(1.15)",opacity:1,offset:.22},{transform:"translateY(-8px) scale(1)",offset:.36},
        {transform:"translateY(-10px) scale(1.12)",offset:.46},{transform:"translateY(-12px) scale(1)",opacity:1,offset:.58},{transform:"translateY(-44px) scale(0.9)",opacity:0}],{duration:2300});
    bubble("wheek!",x+34,y+6);
  }
  /* a little pile of veg tumbles out of the hay and stays put */
  function tumble(x,y){
    VEG.slice(0,6).forEach((em,i)=>{
      const dx=(i%2?0.7:-1)*(22+i*6), g=svgEl("g",{transform:`translate(${x} ${y})`},$("strawFx"));
      const t=svgEl("text",{"font-size":17,"text-anchor":"middle"},g); t.textContent=em;
      const end=`translate(${dx}px,${36-i}px) rotate(${dx*2}deg)`;
      t.animate(reduced()?[{opacity:0,transform:end},{opacity:1,transform:end}]
        :[{transform:"translate(0px,0px) rotate(0deg)",opacity:0,easing:EASE.out},{transform:`translate(${dx*.5}px,-38px) rotate(${dx}deg)`,opacity:1,offset:.4,easing:EASE.fall},{transform:end,opacity:1}],
        {duration:reduced()?240:780,delay:i*80,fill:"both"});
    });
  }

  /* --- pig moves --- */
  function walk(x0,y0,x1,y1,ms,hops,ease){
    const n=Math.max(1,Math.round(ms/(hops?180:190))), h=hops?-7:-3;
    anim($("pigHop"),[{transform:hopT(0,0),easing:EASE.up},{transform:hopT(h,0),easing:EASE.down},{transform:hopT(0,0)}],{duration:ms/n,iterations:n});
    return anim($("pigPos"),[{transform:pt(x0,y0)},{transform:pt(x1,y1)}],{duration:ms,easing:ease||(hops?"linear":EASE.inOut)});
  }
  async function fadeSwap(el,fn){ await done(anim(el,[{opacity:0}],{duration:160,easing:"ease"})); fn(); await done(anim(el,[{opacity:1}],{duration:220,easing:"ease"})); }
  const busy=el=>el.getAnimations().some(a=>a.playState==="running");
  /* popcorning: crouch, launch with a twist, squash on landing, settle */
  function popcorn(which){
    const hop=$(which+"Hop"), sq=$(which+"Squash");
    if(reduced()||busy(hop)) return null; /* a hop already in the air is not restarted */
    const o={duration:640,easing:"linear"};
    anim(sq,[{transform:"scale(1,1)",easing:EASE.out},{transform:"scale(1.1,0.86)",offset:.14},{transform:"scale(0.92,1.1)",offset:.3,easing:EASE.out},{transform:"scale(1,1)",offset:.55},
      {transform:"scale(1,1)",offset:.76,easing:EASE.out},{transform:"scale(1.12,0.84)",offset:.84},{transform:"scale(0.97,1.04)",offset:.93},{transform:"scale(1,1)"}],o);
    return anim(hop,[{transform:hopT(0,0)},{transform:hopT(0,0),offset:.14,easing:EASE.up},{transform:hopT(-24,-14),offset:.48,easing:EASE.down},{transform:hopT(0,0),offset:.8},{transform:hopT(0,0)}],o);
  }
  function wiggle(){
    const hop=$("pigHop"); if(reduced()||busy(hop)) return;
    anim(hop,[0,-8,7,-4,0].map(r=>({transform:hopT(0,r)})),{duration:480,easing:"ease-in-out"});
  }
  function startSway(){
    if(reduced()) return;
    SC.sway=$("swing").animate([{transform:"rotate(0deg)",easing:"ease-out"},{transform:"rotate(2.4deg)",offset:.25,easing:"ease-in"},
      {transform:"rotate(0deg)",offset:.5,easing:"ease-out"},{transform:"rotate(-2.4deg)",offset:.75,easing:"ease-in"},{transform:"rotate(0deg)"}],{duration:2800,iterations:Infinity});
  }
  function stopSway(){ SC.sway=null; return anim($("swing"),[{transform:"rotate(0deg)"}],{duration:260,easing:EASE.out}); }
  async function walkHome(){
    const pos=$("pigPos"), m=new DOMMatrixReadOnly(getComputedStyle(pos).transform);
    let x=m.e, y=m.f;
    if(reduced()){ await fadeSwap(pos,()=>{ pos.style.transform=pt(HOME.x,HOME.y); }); SC.pigHome=true; return; }
    if(x>252){ await done(walk(x,y,252,188,Math.max(200,(x-252)*7))); x=252; y=188; }
    if(x>214){ await done(walk(x,y,214,HOME.y,420,true)); x=214; y=HOME.y; }
    await done(walk(x,y,HOME.x,HOME.y,520,false,EASE.out));
    SC.pigHome=true;
  }
  function dismantle(){
    let last=null;
    ["gulp","bow","rope","pBrace","pBeam","pPost","pDeckFront","pDeckBack"].forEach((id,i)=>{
      const el=$(id); if(getComputedStyle(el).opacity==="0") return;
      last=anim(el,[{transform:HIDDEN[id],opacity:0}],{duration:320,delay:i*60,easing:EASE.inOut,fill:"both"});
    });
    return last;
  }
  /* --- the onlooker: peeks from the log, ducks back now and then, cheers hits and frets at misses --- */
  const buddyTo=(x,ms,ease)=>anim($("buddy"),[{transform:`translateX(${x}px)`}],{duration:ms,easing:ease||EASE.out});
  function buddyRest(ms){
    clearTimeout(buddyT);
    buddyT=setTimeout(()=>{
      if(game.over||SC.down) return;
      Object.assign($("buddyArt").dataset,{mood:moodFor(SC.target),sweat:""});
      buddyTo(BUDDY.peek,520,EASE.back); buddyIdle();
    },ms);
  }
  function buddyIdle(){
    if(reduced()) return;
    buddyT=setTimeout(()=>{ if(game.over||SC.down) return; buddyTo(BUDDY.hide+6,340,EASE.inOut); buddyRest(800+Math.random()*900); },5000+Math.random()*5000);
  }
  function buddyCheer(){
    $("buddyArt").dataset.mood="joy";
    buddyTo(BUDDY.out,360); popcorn("buddy"); buddyRest(1100);
  }
  function buddyWorry(){
    Object.assign($("buddyArt").dataset,{mood:SC.target>=8?"scared":"worried",sweat:"on"});
    buddyTo(BUDDY.peek-6,260,EASE.out);
    anim($("buddySquash"),[{transform:"scale(1,1)"},{transform:"scale(1.06,0.92)",offset:.3},{transform:"scale(1,1)"}],{duration:420,easing:"ease-in-out"});
    buddyRest(1300);
  }

  /* --- the miss sequence: 1-5 build the gallows, 6-9 lead the pig up, 10 is the drop --- */
  const STEP=[null,
    async()=>{ /* 1 deck */
      const f=[{transform:HIDDEN.pDeckBack,opacity:0},{transform:"translateY(0px)",opacity:1}], o={duration:D(440),easing:EASE.back};
      anim($("pDeckBack"),f,o); const a=anim($("pDeckFront"),f,o);
      later(D(260),()=>{ Snd.knock(); dust(306,197); });
      await done(a);
    },
    async()=>{ /* 2 post rises out of the deck */
      const a=anim($("pPost"),[{transform:HIDDEN.pPost,opacity:0},{transform:"scaleY(1.05)",opacity:1,offset:.7},{transform:"scaleY(1)",opacity:1}],{duration:D(460),easing:EASE.out});
      later(D(300),()=>{ Snd.knock(); dust(280,189); });
      await done(a);
    },
    async()=>{ /* 3 beam slides on */
      const a=anim($("pBeam"),[{transform:HIDDEN.pBeam,opacity:0},{transform:"translateX(0px) rotate(0deg)",opacity:1}],{duration:D(440),easing:EASE.back});
      later(D(280),Snd.knock);
      await done(a);
    },
    async()=>{ /* 4 brace swings in */
      const a=anim($("pBrace"),[{transform:HIDDEN.pBrace,opacity:0},{transform:"rotate(0deg)",opacity:1}],{duration:D(420),easing:EASE.back});
      later(D(260),Snd.knock);
      await done(a);
    },
    async()=>{ /* 5 rope lowers with its pink bow */
      const o={duration:D(620),easing:EASE.back};
      anim($("rope"),[{transform:HIDDEN.rope,opacity:0},{transform:HIDDEN.rope,opacity:1,offset:.12},{transform:"scaleY(1)",opacity:1}],o);
      const a=anim($("bow"),[{transform:HIDDEN.bow,opacity:0},{transform:HIDDEN.bow,opacity:1,offset:.12},{transform:`translateY(${ROPE}px)`,opacity:1}],o);
      Snd.zip();
      await done(a);
    },
    async()=>{ /* 6 the pig is led up: trots over, hesitates at the steps, hops up, edges onto the trapdoor */
      SC.pigHome=false;
      const pos=$("pigPos");
      if(reduced()){ await fadeSwap(pos,()=>{ pos.style.transform=pt(TRAP.x,TRAP.y); }); return; }
      await done(walk(HOME.x,HOME.y,214,HOME.y,D(560)));
      anim($("pigSquash"),[{transform:"scale(1,1)"},{transform:"scale(1.05,0.94)"},{transform:"scale(1,1)"}],{duration:D(320),easing:"ease-in-out"});
      await wait(D(420));
      await done(walk(214,HOME.y,252,188,D(540),true));
      await done(walk(252,188,TRAP.x,TRAP.y,D(620)));
    },
    async()=>{ /* 7 padded harness on; the bow clips to its ring, well clear of the neck */
      hero().dataset.harness="on";
      await wait(D(240));
      anim($("bow"),[{transform:`translateY(${ROPE}px) scale(1.3)`},{transform:`translateY(${ROPE}px) scale(1)`}],{duration:D(280),easing:EASE.back});
      Snd.click(); $("pigShake").classList.add("tremble");
      anim($("pigSquash"),[{transform:"scale(1,1)"},{transform:"scale(0.97,1.04)"},{transform:"scale(1,1)"}],{duration:D(260)});
      await wait(D(300));
    },
    async()=>{ /* 8 hoisted a little: feet dangle, gentle pendulum sway */
      const o={duration:D(720),easing:EASE.inOut};
      anim($("rope"),[{transform:"scaleY(1)"},{transform:`scaleY(${(ROPE-HOIST)/ROPE})`}],o);
      anim($("bow"),[{transform:`translateY(${ROPE}px)`},{transform:`translateY(${ROPE-HOIST}px)`}],o);
      anim($("pigShadow"),[{transform:"scale(1)",opacity:1},{transform:"scale(0.7)",opacity:.55}],o);
      Snd.creak(); hero().dataset.dangle="on";
      await done(anim($("pigHoist"),[{transform:"translateY(0px)"},{transform:`translateY(${-HOIST}px)`}],o));
      startSway();
    },
    async()=>{ /* 9 gulp */
      hero().dataset.sweat="on"; Snd.gulp();
      anim($("gulp"),[{transform:HIDDEN.gulp,opacity:0},{transform:"scale(1)",opacity:1}],{duration:D(260),easing:EASE.back});
      anim($("pigSquash"),[{transform:"scale(1,1)"},{transform:"scale(1.04,0.95)",offset:.4},{transform:"scale(1,1)"}],{duration:D(360)});
      later(1500,()=>anim($("gulp"),[{transform:"scale(0.95)",opacity:0}],{duration:220,easing:"ease"}));
      await wait(D(520));
    },
    async()=>{ /* 10 the drop */
      const v=lastLanding=PigLogic.landingVariant(hayCount(),lastLanding), art=hero(), pos=$("pigPos"), sq=$("pigSquash"), hop=$("pigHop");
      if(reduced()) return landQuietly(v);
      await done(stopSway());
      art.dataset.dangle=""; setMood("scared");
      anim(sq,[{transform:"scale(1,1)"},{transform:"scale(1.06,0.92)"}],{duration:220,easing:EASE.out}); /* braces */
      const jig=s=>[0,3,-1.5,2,0].map(d=>({transform:`rotate(${d*s}deg)`}));
      anim($("tdL"),jig(1),{duration:280}); anim($("tdR"),jig(-1),{duration:280}); Snd.creak();
      await wait(340);
      const open=s=>[{transform:"rotate(0deg)",easing:EASE.fall},{transform:`rotate(${98*s}deg)`,offset:.6,easing:EASE.out},{transform:`rotate(${84*s}deg)`,offset:.8,easing:"ease-in-out"},{transform:`rotate(${90*s}deg)`}];
      anim($("tdL"),open(1),{duration:560}); anim($("tdR"),open(-1),{duration:560}); later(300,Snd.clack);
      anim(sq,[{transform:"scale(1,1)"}],{duration:240,easing:EASE.out});
      await wait(640);
      const eyes=art.querySelector(".pupils"); /* still hanging: looks down at the open hatch... */
      anim(eyes,[{transform:"translateY(2.2px)"}],{duration:200,easing:EASE.out});
      await wait(560);
      anim(eyes,[{transform:"translateY(0px)"}],{duration:160,easing:EASE.out}); /* ...then straight at us */
      await wait(320);
      Snd.ping(); $("pigShake").classList.remove("tremble"); /* the bow unties and the rope springs up */
      anim($("bow"),[{transform:`translateY(${ROPE-HOIST-8}px) scale(1.3)`,opacity:0}],{duration:280,easing:EASE.out});
      anim($("rope"),[{transform:HIDDEN.rope}],{duration:420,easing:EASE.back});
      await wait(180);
      /* the camera rides the same curve as the fall, so the pig holds its place on screen */
      pos.style.transform=pt(TRAP.x,TRAP.y-HOIST); $("pigHoist").style.transform="translateY(0px)";
      $("hayBack").style.opacity="1"; $("hayFront").style.opacity="1"; /* still well below the window */
      anim($("pigShadow"),[{opacity:0}],{duration:120});
      SC.down=true; Snd.whoosh();
      const F={duration:900,easing:EASE.fall};
      const fall=anim(pos,[{transform:pt(TRAP.x,TRAP.y-HOIST)},{transform:pt(335,650)}],F);
      anim(sq,[{transform:"scale(1,1)"},{transform:"scale(0.88,1.16)"}],{duration:900,easing:EASE.out});
      anim(hop,[{transform:hopT(0,0)},{transform:hopT(0,-18)}],{duration:900,easing:"ease-in-out"});
      anim($("world"),[{transform:"translateY(0%)"},{transform:CAM_DOWN}],F);
      anim($("bg"),[{transform:"translateY(0%)"},{transform:BG_DOWN}],F);
      await done(fall);
      /* landing: squash, scattered straw, a beat of stillness, then the head pops out */
      hayBump(); Snd.flump();
      const bounce=v==="bounce";
      later(bounce?720:200,()=>{ art.dataset.harness=""; }); /* the harness comes off out of sight */
      anim(pos,bounce?[{transform:pt(335,650),easing:EASE.up},{transform:pt(335,598),offset:.42,easing:EASE.down},{transform:pt(335,714)}]:[{transform:pt(335,650)},{transform:pt(335,714)}],
        {duration:bounce?700:170,easing:bounce?"linear":EASE.out});
      anim(sq,[{transform:"scale(0.88,1.16)"},{transform:"scale(1,1)"}],{duration:200,easing:EASE.out});
      anim(hop,[{transform:hopT(0,-18)},{transform:hopT(0,0)}],{duration:bounce?520:200,easing:EASE.out});
      const squash=k=>[{transform:"scale(1,1)"},{transform:`scale(${1+.12*k},${1-.2*k})`,offset:.25},{transform:`scale(${1-.03*k},${1+.05*k})`,offset:.6},{transform:"scale(1,1)"}];
      anim($("hayBackSq"),squash(1),{duration:620,easing:EASE.out}); anim($("hayFrontSq"),squash(1),{duration:620,easing:EASE.out});
      straws(335,634,14); dust(335,640);
      anim($("cam"),[0,3,-2,1,0].map(y=>({transform:`translate(0px,${y}px)`})),{duration:280});
      if(bounce) later(680,()=>{ anim($("hayBackSq"),squash(.5),{duration:480,easing:EASE.out}); anim($("hayFrontSq"),squash(.5),{duration:480,easing:EASE.out}); straws(335,634,6); Snd.flump(); });
      await wait(bounce?1000:780);
      Object.assign(art.dataset,{hay:"on",sweat:"",prop:BURIED.includes(v)?v:""}); /* changed while buried in the hay */
      setMood("joy");
      const pop=anim(pos,[{transform:pt(335,714)},{transform:pt(335,POP_Y)}],{duration:460,easing:EASE.back});
      Snd.wheek(); if(v!=="heart") hearts(335,POP_Y-60);
      flourish(v);
      await done(pop);
      landed();
    }
  ];
  /* what follows the pop for each landing; also runs, calmly, under reduced motion */
  const BURIED=["hat","carrot","dandelion"]; /* props she pops up already holding or wearing */
  function flourish(v){
    const art=hero(), sq=$("pigSquash"), nudge=k=>[{transform:"scale(1,1)"},{transform:`scale(${1+.05*k},${1-.06*k})`},{transform:"scale(1,1)"}];
    if(v==="friend") later(420,()=>{ anim($("hayBuddy"),[{transform:"translateY(0px)"},{transform:"translateY(-66px)"}],{duration:460,easing:EASE.back}); Snd.wheek(1.2); });
    if(v==="shades") later(560,()=>{ art.dataset.prop=v; later(300,Snd.ping); });
    if(v==="bird") later(420,()=>{ art.dataset.prop=v; later(600,()=>{ Snd.chirp(); anim(sq,nudge(1),{duration:260}); }); });
    if(v==="carrot"||v==="dandelion") for(let i=0;i<4;i++) later(600+i*240,()=>{ Snd.crunch(); anim(sq,nudge(.7),{duration:200}); });
    if(v==="veg") later(380,()=>{ tumble(335,646); Snd.flump(); });
    if(v==="sneeze") later(640,()=>{
      anim(sq,[{transform:"scale(1,1)"},{transform:"scale(0.94,1.08)",offset:.55},{transform:"scale(1.14,0.86)",offset:.7},{transform:"scale(1,1)"}],{duration:760,easing:EASE.out});
      later(500,()=>{ straws(335,612,18); bubble("atchoo!",372,596); Snd.sneeze(); });
    });
    if(v==="heart") later(320,()=>{ bigHeart(335,POP_Y-64); Snd.wheek(1.1); });
  }
  function landed(cut){ if(SC.onLanded){ const f=SC.onLanded; SC.onLanded=null; f(!cut); } }
  function hayCount(){ return Math.max(0,parseInt(ctx.store.get(STORE_HAY),10)||0); }
  function hayBump(){ ctx.store.set(STORE_HAY,hayCount()+1); }
  /* reduced motion: fade straight to the landed pig */
  async function landQuietly(v){
    await done(anim($("cam"),[{opacity:0}],{duration:220}));
    for(const id of ["rope","bow","gulp"]) pose(id,HIDDEN[id],0);
    pose("swing","rotate(0deg)"); pose("tdL","rotate(90deg)"); pose("tdR","rotate(-90deg)");
    pose("pigPos",pt(335,POP_Y),1); pose("pigHoist","translateY(0px)"); pose("pigHop",hopT(0,0)); pose("pigSquash","scale(1,1)"); pose("pigShadow",null,0);
    pose("hayBack",null,1); pose("hayFront",null,1); pose("world",CAM_DOWN); pose("bg",BG_DOWN);
    Object.assign(hero().dataset,{mood:"joy",hay:"on",prop:BURIED.includes(v)?v:"",sweat:"",dangle:"",harness:""});
    $("pigShake").classList.remove("tremble");
    SC.down=true; hayBump();
    await done(anim($("cam"),[{opacity:1}],{duration:320}));
    Snd.wheek(); flourish(v); landed();
  }
  /* new round: dismantle, pan back up if we fell, and trot the pig back in */
  function sceneReset(instant,next){
    const away=!SC.pigHome, down=SC.down, swap=next.hero!==cast.hero;
    cancelScene(); SC.stage=0; SC.target=0; landed(true); /* show any pending loss message now, without the landing */
    if(instant){ applyCast(next); initScene(false); buddyRest(500); return; }
    enqueue(async()=>{
      setMood("happy"); $("pigShake").classList.remove("tremble");
      Object.assign(hero().dataset,{sweat:"",dangle:""});
      if(reduced()&&(down||away||swap)){
        await done(anim($("cam"),[{opacity:0}],{duration:200}));
        applyCast(next); initScene(false); buddyRest(0);
        await done(anim($("cam"),[{opacity:1}],{duration:260}));
        return;
      }
      let last=dismantle();
      buddyTo(BUDDY.hide,420,EASE.inOut); const duck=wait(420); /* timed, not awaited: a quick guess cheers or frets and cancels the duck */
      if(away){ const f=anim($("pigPos"),[{opacity:0}],{duration:200,easing:"ease"}); last=last||f; }
      else if(swap){ SC.pigHome=false; await Promise.all([done(walk(HOME.x,HOME.y,-40,HOME.y,720,true,EASE.inOut)),done(last)]); last=null; } /* trots off so the other pig can star */
      if(down){
        anim($("bg"),[{transform:"translateY(0%)"}],{duration:760,easing:EASE.inOut});
        last=anim($("world"),[{transform:"translateY(0%)"}],{duration:760,easing:EASE.inOut});
      }
      await Promise.all([done(last),duck]);
      applyCast(next); initScene(away||swap); buddyRest(160);
      if(away||swap){ SC.pigHome=false; await done(walk(-40,HOME.y,HOME.x,HOME.y,820,true,EASE.out)); SC.pigHome=true; }
    });
  }
  function sceneWin(){
    cancelScene();
    enqueue(async()=>{
      const art=hero();
      setMood("joy"); Object.assign(art.dataset,{sweat:"",dangle:""}); $("pigShake").classList.remove("tremble");
      if(!SC.pigHome){
        if(art.dataset.harness==="on"){ /* unclip: the rope retracts and the pig is set down */
          anim($("swing"),[{transform:"rotate(0deg)"}],{duration:260,easing:EASE.out});
          anim($("pigHoist"),[{transform:"translateY(0px)"}],{duration:340,easing:EASE.out});
          anim($("pigShadow"),[{transform:"scale(1)",opacity:1}],{duration:340});
          anim($("bow"),[{transform:HIDDEN.bow,opacity:0}],{duration:420,easing:EASE.inOut});
          anim($("rope"),[{transform:HIDDEN.rope,opacity:0}],{duration:420,easing:EASE.inOut});
          art.dataset.harness=""; Snd.ping();
          await wait(380);
        }
        await walkHome();
      }
      dismantle();
      $("buddyArt").dataset.mood="joy";
      anim($("buddy"),[{transform:"translateX(118px)"}],{duration:560,easing:EASE.out}); /* all the way out of the log to join in */
      await wait(220);
      for(let i=0;i<3;i++){ popcorn("buddy"); await done(popcorn("pig")); }
    });
  }

  /* --- HTML effects: treats fly to the pig, confetti --- */
  function treatFly(fromEl){
    const bump=()=>{
      $("treatN").textContent=game.hits;
      if(!reduced()) $("treatchip").animate([{transform:"scale(1.18)"},{transform:"scale(1)"}],{duration:260,easing:EASE.out});
    };
    if(reduced()||!fromEl){ bump(); return; }
    const a=fromEl.getBoundingClientRect(), b=hero().getBoundingClientRect();
    const sx=a.left+a.width/2-12, sy=a.top+a.height/2-12, tx=b.left+b.width/2-12, ty=b.top+b.height*.6-12, dy=ty-sy;
    const el=document.createElement("div"); el.className="fly"; el.innerHTML="<i></i>";
    el.firstChild.textContent=VEG[(game.hits-1)%VEG.length];
    $("fx").appendChild(el);
    el.animate([{transform:`translate(${sx}px,${sy}px)`},{transform:`translate(${tx}px,${sy}px)`}],{duration:460,easing:"cubic-bezier(0.3,0.6,0.5,1)",fill:"forwards"});
    const f=el.firstChild.animate([{transform:"translateY(0px) scale(1)",easing:EASE.up},{transform:`translateY(${Math.min(0,dy)-70}px) scale(1.15)`,offset:.45,easing:EASE.down},
      {transform:`translateY(${dy}px) scale(0.7)`,opacity:1,offset:.9},{transform:`translateY(${dy}px) scale(0.5)`,opacity:0}],{duration:460,fill:"forwards"});
    f.finished.then(()=>{
      if(!el.isConnected) return; /* this look was switched away mid-flight */
      el.remove(); bump(); Snd.crunch();
      if(game.over&&!game.won) return;
      if(SC.stage>=8&&SC.stage<10) wiggle(); else popcorn("pig");
    },()=>el.remove());
  }
  function confetti(){
    if(reduced()) return;
    const r=$("stage").getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height*.35;
    const cols=["#e14e87","#f9a8c9","#e8a93d","#5da271","#ffffff","#b93a6c"];
    for(let i=0;i<28;i++){
      const d=document.createElement("div"); d.className="confetti"; d.style.background=cols[i%cols.length];
      $("fx").appendChild(d);
      const ang=Math.PI+Math.random()*Math.PI, v=90+Math.random()*120, x1=Math.cos(ang)*v, y1=Math.sin(ang)*v*.9-20, rot=Math.random()*720-360;
      d.animate([{transform:`translate(${cx}px,${cy}px) rotate(0deg) scale(0.9)`,opacity:1,easing:EASE.out},
        {transform:`translate(${cx+x1}px,${cy+y1}px) rotate(${rot/2}deg) scale(1)`,opacity:1,offset:.35,easing:EASE.fall},
        {transform:`translate(${cx+x1*1.35}px,${cy+y1+220+Math.random()*120}px) rotate(${rot}deg) scale(1)`,opacity:0}],
        {duration:1300+Math.random()*500,delay:i*12,fill:"backwards"}).finished.then(()=>d.remove(),()=>d.remove());
    }
  }

  /* --- word tiles and keyboard: built once per round, then updated in place --- */
  function buildWord(){
    const w=$("word"); w.textContent="";
    if(!game.entry){ w.setAttribute("aria-label","Word"); return; }
    const up=game.entry.answer, pre=PigLogic.prefilled(up);
    const longest=Math.max(...up.split(" ").map(s=>s.length)), gap=longest>9?3:5;
    const room=Math.min(w.clientWidth||360,452);
    w.style.setProperty("--gap",gap+"px");
    w.style.setProperty("--tile",PigLogic.tileSize(up.split(" ").map(s=>s.length),room,gap,Math.min(112,Math.round(innerHeight*.13)))+"px");
    let grp=null, n=0;
    pre.forEach((fixed,i)=>{
      if(fixed===" "){ grp=null; return; }
      if(!grp){ grp=document.createElement("div"); grp.className="wgrp"; w.appendChild(grp); }
      const t=document.createElement("div"); t.className="tile"+(fixed!==null?" punct":""); t.dataset.ch=up[i];
      const s=document.createElement("span"); s.className="ch"; s.textContent=fixed!==null?fixed:""; t.appendChild(s); grp.appendChild(t);
      if(!reduced()) t.animate([{opacity:0,transform:"translateY(6px)"},{opacity:1,transform:"translateY(0px)"}],{duration:260,delay:Math.min(n*30,360),easing:EASE.out,fill:"backwards"});
      n++;
    });
    labelWord();
  }
  function labelWord(){
    const tiles=[...$("word").querySelectorAll(".tile")];
    $("word").setAttribute("aria-label","Word: "+tiles.map(t=>t.firstChild.textContent||"blank").join(" "));
  }
  function revealLetter(L){
    let n=0;
    $("word").querySelectorAll(`.tile[data-ch="${L}"]`).forEach(t=>{
      t.firstChild.textContent=L;
      if(reduced()){ t.firstChild.animate([{opacity:0},{opacity:1}],{duration:200}); return; }
      const d=n++*50; /* a small dip before the pop */
      t.animate([{transform:"scale(1)"},{transform:"scale(0.9)",offset:.3},{transform:"scale(1.06)",offset:.7},{transform:"scale(1)"}],{duration:340,delay:d,easing:"ease-out"});
      t.firstChild.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"translateY(0px)"}],{duration:280,delay:d+60,easing:EASE.back,fill:"backwards"});
    });
    labelWord();
  }
  function revealAnswer(){
    let n=0;
    $("word").querySelectorAll(".tile:not(.punct)").forEach(t=>{
      if(t.firstChild.textContent) return;
      t.classList.add("miss"); t.firstChild.textContent=t.dataset.ch;
      t.firstChild.animate([{opacity:0},{opacity:1}],{duration:260,delay:reduced()?0:n++*40,fill:"backwards"});
    });
    labelWord();
  }
  function celebrateTiles(){
    $("word").querySelectorAll(".tile").forEach((t,i)=>{
      t.style.setProperty("--d",i*40+"ms"); t.classList.add("won");
      if(!reduced()) t.animate([{transform:"translateY(0px)"},{transform:"translateY(-10px)",offset:.4},{transform:"translateY(0px)"}],{duration:440,delay:i*40,easing:"ease-in-out"});
    });
  }
  const keyEl=L=>$("kbd").querySelector(`[data-l="${L}"]`);
  function keyFeedback(L,ok){
    if(reduced()) return;
    const s=keyEl(L).firstChild;
    if(ok) s.animate([{transform:"translateY(3px) scale(1.12)"},{transform:"translateY(0px) scale(1)"}],{duration:260,easing:EASE.back});
    else s.animate([0,-3,3,-2,0].map(x=>({transform:`translate(${x}px,3px)`})),{duration:280,easing:"ease-in-out"});
  }
  function renderPips(){
    const p=$("pips"), L=game.lives, used=game.misses;
    if(p.children.length!==L){ p.textContent=""; for(let i=0;i<L;i++){ const d=document.createElement("i"); d.className="pip"; p.appendChild(d); } }
    [...p.children].forEach((d,i)=>d.classList.toggle("used",i>=L-used));
    p.setAttribute("aria-label",(L-used)+" of "+L+" chances left");
  }
  function renderMeta(){
    const stats=ctx.stats, entry=game.entry, daily=game.mode==="daily";
    $("treatN").textContent=game.hits;
    $("dailySub").textContent = ctx.dailyDone() ? "done ✓ · streak "+stats.dailyStreak : "one a day";
    $("freeSub").textContent="streak "+stats.streak;
    if(!entry){ $("catpill").textContent="—"; $("diffpill").textContent="—"; return; }
    $("catpill").textContent=daily?"📅 daily · "+entry.catName:entry.catName;
    $("diffpill").textContent=entry.difficulty;
    const st=daily?stats.dailyStreak:stats.streak;
    $("streakpill").textContent="🔥 streak "+st;
  }

  function renderAlbum(){
    const a=$("album"); if(!a) return; a.innerHTML="";
    for(const b of BADGES){
      const won=!!ctx.stats.badges.b[b.id];
      const d=document.createElement("div");
      d.className="sticker"+(won?" won":"");
      d.innerHTML=`<div class="em">${won?b.em:"🔒"}</div><b>${won?b.name:"???"}</b><small>${won?b.desc:"keep playing"}</small>`;
      a.appendChild(d);
    }
  }

  /* ============ guessing: the engine rules, the piggies react ============ */
  function guessed(res){
    const L=res.letter;
    Snd.unlock();
    if(res.hit){
      Snd.right();
      keyFeedback(L,true); revealLetter(L);
      treatFly(keyEl(L)); buddyCheer(); flashJoy();
      say(L+" is in the word.");
    } else {
      Snd.wrong();
      keyFeedback(L,false); renderPips();
      sceneTo(PigLogic.stageFor(game.misses,game.lives)); buddyWorry();
      say("No "+L+". "+res.left+" chances left.");
    }
    res.badges.forEach(sticker);
  }
  function finished(out){
    const w=game.entry.answer;
    if(out.won){
      Snd.win();
      toast("🎉 "+w+" — the piggies popcorn with joy!");
      say("Solved: "+w+".");
      celebrateTiles(); confetti(); sceneWin();
    } else {
      const name=NAMES[cast.hero];
      SC.onLanded=soft=>toast("The word was "+w+(soft?" — "+name+" landed softly and is very pleased 🐹":""));
      say("Out of chances. The word was "+w+".");
      revealAnswer();
    }
    renderMeta();
    out.badges.forEach((id,i)=>setTimeout(()=>sticker(id),2700*(i+1))); /* after the win or loss message */
  }
  function showHint(){ const h=$("hinttext"); h.textContent="💡 "+game.entry.hint; h.classList.add("show"); say("Hint: "+game.entry.hint); }

  /* ============ sheets ============ */
  let sheetOpener=null;
  function openSheet(id){
    const s=$(id); sheetOpener=document.activeElement;
    s.inert=false; s.setAttribute("aria-hidden","false"); s.classList.add("open");
    $("app").inert=true;
    s.querySelector(".card").focus({preventScroll:true});
  }
  function closeSheet(id){
    const s=$(id); s.classList.remove("open"); s.setAttribute("aria-hidden","true"); s.inert=true;
    $("app").inert=false;
    if(sheetOpener&&sheetOpener.focus) sheetOpener.focus({preventScroll:true});
    sheetOpener=null;
  }

  /* ============ stats sheet ============ */
  function renderStatsSheet(){
    const stats=ctx.stats;
    $("sStreak").textContent=stats.streak; $("sBest").textContent=stats.best;
    $("sGames").textContent=stats.played; $("sWins").textContent=stats.won;
    $("statSub").textContent="Daily puzzle streak: "+stats.dailyStreak+(ctx.dailyDone()?" (done today ✓)":"");
    const cw=$("catwins"); cw.innerHTML="<b style='font-size:13px'>Wins per category</b>";
    const ul=document.createElement("div"); ul.style.cssText="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px";
    for(const c of ctx.cats){
      const n=stats.winsPerCat[c.id]||0;
      const s=document.createElement("span");
      s.style.cssText="font-size:12px;font-weight:700;background:#fff;border:2px solid var(--pink-100);border-radius:999px;padding:4px 10px";
      s.textContent=c.name+": "+n; ul.appendChild(s);
    }
    cw.appendChild(ul);
    renderAlbum();
  }


  /* ============ events ============ */
  const sheetOpen=()=>$("setSheet").classList.contains("open")||$("statSheet").classList.contains("open");
  function openSettings(){ Snd.press(); ctx.editSettings(); openSheet("setSheet"); }
  function closeSettings(){ closeSheet("setSheet"); ctx.doneSettings(); }
  function closeSheets(){
    if($("setSheet").classList.contains("open")) closeSettings();
    else if($("statSheet").classList.contains("open")) closeSheet("statSheet");
  }
  function bind(){
    ctx.on(document,"pointerdown",()=>Snd.unlock(),{once:true});
    $("tabFree").addEventListener("click",()=>{ if(game.mode!=="free"){Snd.press();ctx.setMode("free");} });
    $("tabDaily").addEventListener("click",()=>{ if(game.mode!=="daily"){Snd.press();ctx.setMode("daily");} });
    $("hintbtn").addEventListener("click",()=>{
      if(!game.entry) return; Snd.unlock(); Snd.press(); ctx.hint(); showHint();
    });
    $("newBtn").addEventListener("click",()=>{ Snd.unlock(); Snd.press(); ctx.newGame(); });
    $("setBtn").addEventListener("click",openSettings);
    $("setDone").addEventListener("click",()=>{ Snd.press(); closeSettings(); });
    $("statDone").addEventListener("click",()=>{ Snd.press(); closeSheet("statSheet"); });
    $("albumBtn").addEventListener("click",()=>{ Snd.press(); renderStatsSheet(); openSheet("statSheet"); });
    $("soundBtn").addEventListener("click",()=>{ if(!ctx.toggleSound()){Snd.unlock();Snd.press();} });
    $("setSheet").addEventListener("click",e=>{ if(e.target===$("setSheet")) closeSettings(); });
    $("statSheet").addEventListener("click",e=>{ if(e.target===$("statSheet")) closeSheet("statSheet"); });
  }
  function syncTabs(){
    const mode=game?game.mode:ctx.mode;
    $("tabFree").setAttribute("aria-selected",String(mode==="free"));
    $("tabDaily").setAttribute("aria-selected",String(mode==="daily"));
    $("seg").dataset.mode=mode;
  }

  /* ============ boot ============ */
  ctx.keyboard($("kbd"));
  bind(); renderAlbum();

  return {
    start, guessed, finished, toast,
    sync(){ syncSoundBtn(); if(game) renderMeta(); },
    badgeIds: BADGES.map(b=>b.id),
    modalOpen: sheetOpen,
    closeModal: closeSheets,
    /* scene checks from the prototype; the word in play is redrawn first so the world is at rest */
    selftest(t){
      start(game,{resumed:true});
      const ev=t;
      ev("stage 4 lives",()=>[0,1,2,3,4].map(m=>PigLogic.stageFor(m,4)),[0,3,6,9,10]);
      ev("stage 6 lives",()=>[0,1,2,3,4,5,6].map(m=>PigLogic.stageFor(m,6)),[0,2,4,5,7,9,10]);
      ev("stage 10 lives",()=>[0,1,2,3,4,5,6,7,8,9,10].map(m=>PigLogic.stageFor(m,10)),[0,1,2,3,4,5,6,7,8,9,10]);
      ev("stage rises every miss, all lives",()=>{ for(let L=4;L<=10;L++) for(let m=1;m<=L;m++) if(PigLogic.stageFor(m,L)<=PigLogic.stageFor(m-1,L)) return L+":"+m; return "ok"; },"ok");
      ev("stage past lives stays dropped",()=>PigLogic.stageFor(9,6),10);
      ev("first landing is the classic",()=>PigLogic.landingVariant(0,"",()=>0.5),"first");
      const rs=Array.from({length:50},(_,i)=>i/50);
      ev("at least eight later landings",()=>new Set(rs.map(r=>PigLogic.landingVariant(3,"",()=>r))).size>=8,true);
      ev("later landings never repeat the last",()=>["bounce","hat","friend","sneeze"].every(last=>rs.every(r=>{ const v=PigLogic.landingVariant(3,last,()=>r); return v&&v!==last&&v!=="first"; })),true);
      ev("every other landing still reachable after one",()=>[...new Set(rs.map(r=>PigLogic.landingVariant(3,"hat",()=>r)))].sort(),LANDINGS.filter(v=>v!=="hat").sort());
      ev("cast: Pepper reachable",()=>PigLogic.castFor(()=>0),{hero:"pepper",buddy:"pixie"});
      ev("cast: Pixie reachable",()=>PigLogic.castFor(()=>0.99),{hero:"pixie",buddy:"pepper"});
      ev("onlooker on screen is the other pig",()=>{ const prev=cast; return ["pepper","pixie"].map(k=>{ applyCast({hero:k,buddy:k==="pepper"?"pixie":"pepper"}); const r=$("heroArt").dataset.kind+"/"+$("buddyArt").dataset.kind+"/"+$("hayBuddyArt").dataset.kind; applyCast(prev); return r; }); },["pepper/pixie/pixie","pixie/pepper/pepper"]);
      ev("tile size: short word is full size",()=>PigLogic.tileSize([6],374,5,112),42);
      ev("tile size: long word fits the row",()=>{ const t=PigLogic.tileSize([12],374,3,112); return 12*t+11*3<=374; },true);
      ev("tile size: long phrase stays within height",()=>{ const t=PigLogic.tileSize([2,4,3,3,2,8],374,5,112); return t<42&&t>=20; },true);
      const shown=el=>{ for(;el&&el.nodeType===1;el=el.parentNode) if(getComputedStyle(el).opacity==="0") return false; return true; };
      const atLog=(x,wx,wy)=>{ const prev=$("buddy").style.transform; pose("buddy",`translateX(${x}px)`); const pt=new DOMPoint(wx,wy).matrixTransform($("world").getScreenCTM()); const hit=document.elementsFromPoint(pt.x,pt.y).find(shown); pose("buddy",prev); return hit; };
      ev("log mouth is open: hollow shows across the whole opening",()=>[74,80,86].map(x=>atLog(BUDDY.hide,x,190)===$("logHollow")),[true,true,true]);
      ev("peeking onlooker shows through the mouth, not cut off at its middle",()=>$("buddy").contains(atLog(BUDDY.peek,76,192)),true);
      ev("ducked onlooker is out of sight in the mouth",()=>{ for(let x=69;x<=91;x++) for(let y=168;y<=212;y+=2) { const h=atLog(BUDDY.hide,x,y); if(!h||$("buddy").contains(h)) return x+","+y; } return "hidden"; },"hidden");
      ev("log rim not drawn over the peeking onlooker",()=>$("buddy").contains(atLog(BUDDY.peek,91,190)),true);
      ev("hay hidden when the scene is set up",()=>[$("hayBack").style.opacity,$("hayFront").style.opacity],["0","0"]);
    }
  };
});
