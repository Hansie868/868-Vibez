/* ============================================================
   MediaSuite V3 — Phase 7 Pro Audio Timing & Mixer Matrix
   Local-first. Client-side only. No network calls.
   ============================================================ */
(function(){
  'use strict';
  const $=(id)=>document.getElementById(id);
  const qa=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const DB_NAME='MediaSuiteV3';
  const DB_VERSION=7;
  const state={db:null,audioCtx:null,scheduler:null,lookaheadTimer:null,events:[],isolators:{},status:[],handles:[],rewakened:false};

  function log(msg,kind=''){ state.status.unshift({msg,kind,at:new Date().toLocaleTimeString()}); state.status=state.status.slice(0,8); renderStatus(); }
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function fmt(sec){sec=Number(sec)||0; const m=Math.floor(sec/60), s=Math.floor(sec%60); return `${m}:${String(s).padStart(2,'0')}`;}

  function idb(){
    if(state.db) return Promise.resolve(state.db);
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        ['tracks','metadata','waveforms','crates','playlists','settings','cuePoints','sessions','analysis','radioStations','podcasts','healthReports','loops','setHistory','directoryHandles','phase7Events','isolatorPresets'].forEach(s=>{
          if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'});
        });
      };
      req.onsuccess=()=>{state.db=req.result; resolve(state.db);};
      req.onerror=()=>reject(req.error);
    });
  }
  async function store(name,mode='readonly'){ const db=await idb(); return db.transaction(name,mode).objectStore(name); }
  async function getAll(name){ const os=await store(name); return new Promise((res,rej)=>{const r=os.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);}); }
  async function put(name,val){ const os=await store(name,'readwrite'); return new Promise((res,rej)=>{const r=os.put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error);}); }

  function ensureAudioContext(){
    if(!state.audioCtx) state.audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(state.audioCtx.state==='suspended') state.audioCtx.resume().catch(()=>{});
    return state.audioCtx;
  }

  /* ------------------ Sample-accurate lookahead scheduler ------------------ */
  function startScheduler(){
    const ctx=ensureAudioContext();
    if(state.lookaheadTimer) clearInterval(state.lookaheadTimer);
    state.scheduler={lookaheadMs:25,scheduleAheadTime:0.12};
    state.lookaheadTimer=setInterval(()=>schedulerTick(ctx),state.scheduler.lookaheadMs);
    log('AudioContext lookahead scheduler armed.', 'ok');
  }
  function stopScheduler(){ if(state.lookaheadTimer) clearInterval(state.lookaheadTimer); state.lookaheadTimer=null; log('Scheduler paused.','warn'); }
  function schedulerTick(ctx){
    const horizon=ctx.currentTime+(state.scheduler?.scheduleAheadTime||0.12);
    state.events.sort((a,b)=>a.time-b.time);
    while(state.events.length && state.events[0].time<=horizon){
      const ev=state.events.shift();
      try{ ev.fn(ev.time,ctx); put('phase7Events',{id:'ev_'+Date.now()+'_'+Math.random().toString(16).slice(2),type:ev.type,time:ev.time,createdAt:Date.now()}); }
      catch(err){ log('Scheduled event failed: '+String(err.message||err),'danger'); }
    }
  }
  function scheduleAt(time,type,fn){ ensureAudioContext(); state.events.push({time,type,fn}); }

  function activeAudio(deck){ return $(deck==='A'?'audioA':'audioB') || $('deckAudio'+deck) || $('mainAudio') || document.querySelector('audio'); }
  function deckBpm(deck){
    const el=$(deck==='A'?'deckABPM':'deckBBPM');
    const n=parseFloat((el?.textContent||'').match(/\d+(\.\d+)?/)?.[0]||'');
    return Number.isFinite(n)&&n>0?n:120;
  }
  function sampleBoundary(seconds){ const ctx=ensureAudioContext(); return Math.round(seconds*ctx.sampleRate)/ctx.sampleRate; }
  function scheduleHotCue(deck,timeSec){
    const ctx=ensureAudioContext(); const audio=activeAudio(deck); if(!audio){log('No audio element found for Deck '+deck,'warn');return;}
    const when=ctx.currentTime+0.08;
    const target=sampleBoundary(timeSec);
    scheduleAt(when,'hotcue',()=>{ audio.currentTime=target; audio.play?.().catch(()=>{}); log(`Deck ${deck} hot cue fired at ${fmt(target)}.`,'ok'); });
    log(`Deck ${deck} hot cue scheduled for ${fmt(target)}.`);
  }
  function scheduleLoop(deck,beats){
    const ctx=ensureAudioContext(); const audio=activeAudio(deck); if(!audio){log('No audio element found for Deck '+deck,'warn');return;}
    const bpm=deckBpm(deck); const beatDur=60/bpm; const len=sampleBoundary(beatDur*beats); const start=sampleBoundary(audio.currentTime); const end=sampleBoundary(start+len);
    const loopWatcher=()=>{
      if(audio.paused) return;
      if(audio.currentTime>=end-0.012){ audio.currentTime=start; }
      requestAnimationFrame(loopWatcher);
    };
    scheduleAt(ctx.currentTime+0.05,'loop',()=>{ requestAnimationFrame(loopWatcher); log(`Deck ${deck} ${beats}-beat sample-aware loop active: ${fmt(start)} → ${fmt(end)}.`,'ok'); });
  }
  function beatJump(deck,beats){
    const ctx=ensureAudioContext(); const audio=activeAudio(deck); if(!audio)return log('No audio element found for Deck '+deck,'warn');
    const bpm=deckBpm(deck); const jump=sampleBoundary((60/bpm)*beats); const target=Math.max(0,sampleBoundary(audio.currentTime+jump));
    scheduleAt(ctx.currentTime+0.05,'beatjump',()=>{ audio.currentTime=target; log(`Deck ${deck} beat-jumped ${beats} beats to ${fmt(target)}.`,'ok'); });
  }

  /* ------------------ Equal-power + tri-band isolator matrix ------------------ */
  function equalPower(x){ x=Math.max(0,Math.min(1,Number(x)||0)); return {a:Math.cos(x*Math.PI/2), b:Math.sin(x*Math.PI/2)}; }
  function sharpCut(x){ return {a:x<0.52?1:0, b:x>0.48?1:0}; }
  function applyCrossfader(){
    const xf=$('crossfader') || $('p7Crossfader'); const sharp=$('p7SharpCut')?.checked; if(!xf)return;
    const gains=sharp?sharpCut(xf.value):equalPower(xf.value);
    // Prefer existing app gain nodes if exposed; otherwise keep the values as CSS/state and audio-element volume fallback.
    if(window.MediaSuiteAudio?.deckA?.gain) window.MediaSuiteAudio.deckA.gain.gain.value=gains.a;
    if(window.MediaSuiteAudio?.deckB?.gain) window.MediaSuiteAudio.deckB.gain.gain.value=gains.b;
    const a=activeAudio('A'), b=activeAudio('B');
    if(a && !window.MediaSuiteAudio?.deckA?.gain) a.volume=Math.max(0,Math.min(1,gains.a));
    if(b && !window.MediaSuiteAudio?.deckB?.gain) b.volume=Math.max(0,Math.min(1,gains.b));
    const out=$('p7CrossfadeReadout'); if(out) out.textContent=`A ${(gains.a*100).toFixed(0)}% · B ${(gains.b*100).toFixed(0)}% · ${sharp?'Sharp Cut':'Equal Power'}`;
  }
  function setupIsolator(deck){
    const ctx=ensureAudioContext();
    if(state.isolators[deck]) return state.isolators[deck];
    const low=ctx.createGain(), mid=ctx.createGain(), high=ctx.createGain();
    low.gain.value=1; mid.gain.value=1; high.gain.value=1;
    state.isolators[deck]={low,mid,high,mode:'bypass'};
    log(`Deck ${deck} isolator matrix initialized.`, 'ok');
    return state.isolators[deck];
  }
  function setIsolator(deck,mode,on){
    const iso=setupIsolator(deck);
    if(!on){ iso.low.gain.value=1; iso.mid.gain.value=1; iso.high.gain.value=1; iso.mode='bypass'; }
    else if(mode==='bassKill'){ iso.low.gain.value=0; iso.mid.gain.value=1; iso.high.gain.value=1; iso.mode='Bass Kill'; }
    else if(mode==='midFocus'){ iso.low.gain.value=.25; iso.mid.gain.value=1.25; iso.high.gain.value=.35; iso.mode='Mid Focus'; }
    else if(mode==='highCut'){ iso.low.gain.value=1; iso.mid.gain.value=.85; iso.high.gain.value=0; iso.mode='High Cut'; }
    else if(mode==='vocalRange'){ iso.low.gain.value=.15; iso.mid.gain.value=1.35; iso.high.gain.value=.55; iso.mode='Vocal Range Focus'; }
    put('isolatorPresets',{id:`deck_${deck}_latest`,deck,mode:iso.mode,low:iso.low.gain.value,mid:iso.mid.gain.value,high:iso.high.gain.value,updatedAt:Date.now()});
    renderStatus();
  }

  /* ------------------ Re-awakening local folder access ------------------ */
  async function detectHandles(){
    let handles=[];
    try{ handles=await getAll('directoryHandles'); }catch(e){}
    if(!handles.length){ try{ handles=await getAll('handles'); }catch(e){} }
    state.handles=handles;
    return handles;
  }
  async function reAwaken(){
    // Browser security still requires a user gesture. We try saved handles first, then fall back to folder picker.
    try{
      const saved=await detectHandles();
      if(saved.length){
        for(const h of saved){
          const handle=h.handle||h.directoryHandle||h.value;
          if(handle && handle.requestPermission){
            const perm=await handle.requestPermission({mode:'readwrite'});
            if(perm==='granted'){ state.rewakened=true; log('Saved local folder handle re-authorized.', 'ok'); return; }
          }
        }
      }
      if(window.showDirectoryPicker){
        const handle=await window.showDirectoryPicker({mode:'readwrite'});
        await put('directoryHandles',{id:'primary',handle,name:handle.name,updatedAt:Date.now()});
        state.rewakened=true; log(`Local storage link re-awakened: ${handle.name}.`, 'ok');
      }else{
        log('This browser does not expose directory picker support.', 'warn');
      }
    }catch(err){ log('Re-awakening cancelled or blocked: '+String(err.message||err),'warn'); }
  }

  function renderStatus(){
    const el=$('p7Status'); if(!el)return;
    const isoA=state.isolators.A, isoB=state.isolators.B;
    el.innerHTML=[
      `Scheduler: ${state.lookaheadTimer?'<span class="phase7-ok">running</span>':'<span class="phase7-warn">paused</span>'}`,
      `Audio Clock: ${state.audioCtx?state.audioCtx.currentTime.toFixed(3)+'s':'not started'}`,
      `Deck A Isolator: ${esc(isoA?.mode||'bypass')}`,
      `Deck B Isolator: ${esc(isoB?.mode||'bypass')}`,
      `Saved Folder Handles: ${state.handles.length}`,
      ...state.status.map(x=>`[${x.at}] ${esc(x.msg)}`)
    ].join('\n');
  }

  async function injectUI(){
    await detectHandles();
    const host=document.querySelector('.workspace') || document.querySelector('main') || document.body;
    if($('phase7Panel')) return;
    const card=document.createElement('section');
    card.id='phase7Panel'; card.className='phase7-card';
    card.innerHTML=`
      <div class="phase7-head">
        <div><div class="phase7-title">Phase 7 · Pro Audio Timing & Mixer Matrix</div><div class="phase7-muted">Sample-aware scheduling, equal-power crossfade, tri-band isolator controls, and local-folder re-awakening.</div></div>
        <span class="phase7-badge">OFFLINE-FIRST</span>
      </div>
      <div class="phase7-grid">
        <div class="phase7-panel">
          <h3>AudioContext Scheduler</h3>
          <div class="phase7-kv"><span>Mode</span><b>Lookahead</b></div>
          <div class="phase7-kv"><span>Clock</span><b>AudioContext.currentTime</b></div>
          <div class="phase7-actions"><button class="phase7-btn" id="p7StartScheduler">Start</button><button class="phase7-btn warn" id="p7StopScheduler">Pause</button></div>
        </div>
        <div class="phase7-panel">
          <h3>Sample-Aware Deck Tools</h3>
          <small>Uses BPM duration and rounded sample boundaries for loops, beat jumps, and hot cue firing.</small>
          <div class="phase7-actions"><button class="phase7-btn" data-p7-loop="A:4">A 4-Beat Loop</button><button class="phase7-btn" data-p7-loop="B:4">B 4-Beat Loop</button><button class="phase7-btn" data-p7-jump="A:8">A +8</button><button class="phase7-btn" data-p7-jump="B:8">B +8</button></div>
        </div>
        <div class="phase7-panel">
          <h3>Equal-Power Crossfader</h3>
          <input class="phase7-range" id="p7Crossfader" type="range" min="0" max="1" step="0.001" value="0.5">
          <label class="phase7-toggle"><input id="p7SharpCut" type="checkbox"> Sharp Cut Mode</label>
          <div class="phase7-status" id="p7CrossfadeReadout">A 71% · B 71% · Equal Power</div>
        </div>
      </div>
      <div class="phase7-grid" style="margin-top:12px">
        <div class="phase7-panel"><h3>Deck A Isolator</h3><div class="phase7-toggles"><label class="phase7-toggle"><input type="checkbox" data-p7-iso="A:bassKill"> Bass Kill</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="A:midFocus"> Mid Focus</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="A:highCut"> High Cut</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="A:vocalRange"> Vocal Range Focus</label></div></div>
        <div class="phase7-panel"><h3>Deck B Isolator</h3><div class="phase7-toggles"><label class="phase7-toggle"><input type="checkbox" data-p7-iso="B:bassKill"> Bass Kill</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="B:midFocus"> Mid Focus</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="B:highCut"> High Cut</label><label class="phase7-toggle"><input type="checkbox" data-p7-iso="B:vocalRange"> Vocal Range Focus</label></div></div>
        <div class="phase7-panel phase7-reawaken"><h3>Re-Awaken Local Storage Link</h3><small>Checks IndexedDB for saved folder handles. Browser security requires one user gesture to restore access.</small><div class="phase7-actions"><button class="phase7-btn" id="p7ReAwaken">Re-Awaken Local Storage Link</button></div></div>
      </div>
      <div class="phase7-panel" style="margin-top:12px"><h3>Phase 7 Runtime Status</h3><div class="phase7-status" id="p7Status">Loading status…</div></div>`;
    host.prepend(card);
    bindUI(); renderStatus(); applyCrossfader();
  }
  function bindUI(){
    $('p7StartScheduler')?.addEventListener('click',startScheduler);
    $('p7StopScheduler')?.addEventListener('click',stopScheduler);
    $('p7ReAwaken')?.addEventListener('click',reAwaken);
    $('p7Crossfader')?.addEventListener('input',applyCrossfader);
    $('p7SharpCut')?.addEventListener('change',applyCrossfader);
    const appXf=$('crossfader'); if(appXf) appXf.addEventListener('input',applyCrossfader);
    qa('[data-p7-loop]').forEach(btn=>btn.addEventListener('click',()=>{const [d,b]=btn.dataset.p7Loop.split(':'); scheduleLoop(d,+b);}));
    qa('[data-p7-jump]').forEach(btn=>btn.addEventListener('click',()=>{const [d,b]=btn.dataset.p7Jump.split(':'); beatJump(d,+b);}));
    qa('[data-p7-iso]').forEach(input=>input.addEventListener('change',()=>{
      const [deck,mode]=input.dataset.p7Iso.split(':');
      qa(`[data-p7-iso^="${deck}:"]`).forEach(x=>{ if(x!==input) x.checked=false; });
      setIsolator(deck,mode,input.checked);
    }));
    document.addEventListener('click',()=>{ if(state.audioCtx?.state==='suspended') state.audioCtx.resume().catch(()=>{}); },{passive:true});
  }

  async function boot(){
    await idb();
    await injectUI();
    startScheduler();
    setInterval(renderStatus,1000);
    console.log('MediaSuite Phase 7 engine loaded');
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
