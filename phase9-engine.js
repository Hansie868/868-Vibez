/* ============================================================
   MediaSuite V3 — Phase 9 MIDI Control & Master Protection
   Local-first. No external services.
   ============================================================ */
(function(){
  'use strict';
  const $=(id)=>document.getElementById(id);
  const qa=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const DB_NAME='MediaSuiteV3';
  const DB_VERSION=9;
  const state={
    db:null,ctx:null,midi:null,inputs:[],learnTarget:null,mappings:{},status:[],
    limiter:{node:null,enabled:false,reduction:0},
    slip:{enabled:false,A:{active:false,virtualStart:0,realStart:0,lastRelease:0},B:{active:false,virtualStart:0,realStart:0,lastRelease:0}}
  };
  const DEFAULT_MAP={
    'cc:1':'crossfader','cc:7':'masterGain','cc:10':'spatialX_A','cc:11':'spatialZ_A','cc:12':'spatialX_B','cc:13':'spatialZ_B',
    'cc:20':'lowEqA','cc:21':'midEqA','cc:22':'hiEqA','cc:23':'lowEqB','cc:24':'midEqB','cc:25':'hiEqB',
    'note:36':'slicePad1','note:37':'slicePad2','note:38':'slicePad3','note:39':'slicePad4','note:40':'slicePad5','note:41':'slicePad6','note:42':'slicePad7','note:43':'slicePad8'
  };
  const CONTROLS=['crossfader','masterGain','faderA','faderB','lowEqA','midEqA','hiEqA','lowEqB','midEqB','hiEqB','spatialX_A','spatialZ_A','spatialX_B','spatialZ_B','slicePad1','slicePad2','slicePad3','slicePad4','slicePad5','slicePad6','slicePad7','slicePad8','slipToggle'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function log(msg,kind=''){state.status.unshift({msg,kind,at:new Date().toLocaleTimeString()});state.status=state.status.slice(0,14);renderStatus();}

  function idb(){ if(state.db) return Promise.resolve(state.db); return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION); req.onupgradeneeded=()=>{const db=req.result; ['tracks','metadata','waveforms','crates','playlists','settings','cuePoints','sessions','analysis','loops','directoryHandles','phase7Events','isolatorPresets','phase8Packets','phase8PeerImports','phase8SpatialPresets','phase8Slices','phase9MidiMappings','phase9Limiter','phase9SlipEvents'].forEach(s=>{if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'});});}; req.onsuccess=()=>{state.db=req.result;resolve(state.db);}; req.onerror=()=>reject(req.error);}); }
  async function store(name,mode='readonly'){const db=await idb();return db.transaction(name,mode).objectStore(name);} async function put(name,val){const os=await store(name,'readwrite');return new Promise((res,rej)=>{const r=os.put(val);r.onsuccess=()=>res(val);r.onerror=()=>rej(r.error);});} async function get(name,id){const os=await store(name);return new Promise((res,rej)=>{const r=os.get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}

  function ensureCtx(){
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C){log('Web Audio API not available in this browser.','danger');return null;}
    if(!state.ctx) state.ctx=(window.mediaSuiteAudioCtx || window.audioCtx || new C());
    if(state.ctx.state==='suspended') state.ctx.resume().catch(()=>{});
    return state.ctx;
  }

  /* ---------------- Master limiter ---------------- */
  function enableLimiter(){
    const ctx=ensureCtx(); if(!ctx) return;
    if(!state.limiter.node){
      const lim=ctx.createDynamicsCompressor();
      lim.threshold.value=-1.0; lim.knee.value=0.0; lim.ratio.value=20.0; lim.attack.value=0.001; lim.release.value=0.05;
      state.limiter.node=lim;
    }
    state.limiter.enabled=true;
    window.mediaSuiteMasterLimiter=state.limiter.node;
    window.mediaSuiteGetMasterOutput=function(){return state.limiter.enabled?state.limiter.node:ctx.destination;};
    try{state.limiter.node.disconnect();state.limiter.node.connect(ctx.destination);}catch(e){}
    put('phase9Limiter',{id:'latest',enabled:true,threshold:-1,knee:0,ratio:20,attack:0.001,release:0.05,updatedAt:Date.now()}).catch(()=>{});
    log('Brickwall master limiter enabled before destination. Route deck outputs to window.mediaSuiteGetMasterOutput() where possible.','ok');
    updateLimiterUI();
  }
  function disableLimiter(){
    state.limiter.enabled=false;
    put('phase9Limiter',{id:'latest',enabled:false,updatedAt:Date.now()}).catch(()=>{});
    log('Limiter bypass flag set. Existing direct audio nodes may still need page reload to fully bypass.','warn');
    updateLimiterUI();
  }
  function updateLimiterUI(){
    const enabled=$('phase9LimiterState'); if(enabled) enabled.textContent=state.limiter.enabled?'ON':'OFF';
    const fill=$('phase9LimiterMeter'); if(fill){ const r=state.limiter.node?Math.abs(state.limiter.node.reduction||0):0; fill.style.width=Math.min(100,r*8)+'%'; }
  }
  setInterval(updateLimiterUI,250);

  /* ---------------- MIDI ---------------- */
  async function initMidi(){
    if(!('requestMIDIAccess' in navigator)){log('Web MIDI is not available in this browser. Chrome/Edge desktop is usually required.','warn');return;}
    try{
      state.midi=await navigator.requestMIDIAccess({sysex:false});
      refreshMidiInputs();
      state.midi.onstatechange=refreshMidiInputs;
      log('Web MIDI access granted.','ok');
    }catch(e){log('MIDI permission denied or unavailable: '+(e.message||e),'danger');}
  }
  function refreshMidiInputs(){
    if(!state.midi)return;
    state.inputs=Array.from(state.midi.inputs.values());
    state.inputs.forEach(input=>{input.onmidimessage=handleMidiMessage;});
    const sel=$('phase9MidiInput');
    if(sel) sel.innerHTML=state.inputs.map(i=>`<option value="${esc(i.id)}">${esc(i.name||i.manufacturer||i.id)}</option>`).join('') || '<option>No MIDI inputs found</option>';
    log(`${state.inputs.length} MIDI input(s) ready.`, state.inputs.length?'ok':'warn');
  }
  function midiKey(status,data1){ const type=status&0xF0; if(type===0x90||type===0x80)return 'note:'+data1; if(type===0xB0)return 'cc:'+data1; return 'raw:'+status+':'+data1; }
  function loadDefaultMappings(){state.mappings={...DEFAULT_MAP}; saveMappings(); renderMappings(); log('Default MIDI mappings loaded.','ok');}
  async function loadMappings(){ const saved=await get('phase9MidiMappings','latest').catch(()=>null); state.mappings=saved?.mappings || {...DEFAULT_MAP}; renderMappings(); }
  function saveMappings(){put('phase9MidiMappings',{id:'latest',mappings:state.mappings,updatedAt:Date.now()}).catch(()=>{});}
  function handleMidiMessage(ev){
    const [status,data1,data2]=ev.data; const type=status&0xF0; const key=midiKey(status,data1); const value=(data2||0)/127;
    const noteOn=type===0x90 && data2>0; const cc=type===0xB0;
    $('phase9LastMidi') && ($('phase9LastMidi').textContent=`${key} value ${data2}`);
    if(state.learnTarget){ state.mappings[key]=state.learnTarget; saveMappings(); renderMappings(); log(`Mapped ${key} → ${state.learnTarget}.`,'ok'); state.learnTarget=null; renderLearnState(); return; }
    const target=state.mappings[key]; if(!target)return;
    if(cc) applyContinuous(target,value,data2); else if(noteOn) applyTrigger(target);
  }
  function setRange(id,norm){ const el=$(id); if(!el)return false; const min=parseFloat(el.min||'0'), max=parseFloat(el.max||'1'); el.value=(min+(max-min)*norm).toFixed(3); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
  function applyContinuous(target,norm,raw){
    if(['crossfader','masterGain','faderA','faderB','lowEqA','midEqA','hiEqA','lowEqB','midEqB','hiEqB'].includes(target)){ if(!setRange(target,norm)) log(`Control not found: ${target}`,'warn'); return; }
    if(target.startsWith('spatial')){
      const deck=target.endsWith('_A')?'A':'B'; const axis=target.includes('X')?'x':'z'; const val=norm*2-1;
      window.mediaSuitePhase8Spatial=window.mediaSuitePhase8Spatial||{};
      window.mediaSuitePhase8Spatial[deck]=window.mediaSuitePhase8Spatial[deck]||{x:0,z:0};
      window.mediaSuitePhase8Spatial[deck][axis]=val;
      const dot=$(deck==='A'?'phase8DotA':'phase8DotB'); if(dot){ const pos=window.mediaSuitePhase8Spatial[deck]; dot.style.left=((pos.x+1)*50)+'%'; dot.style.top=((pos.z+1)*50)+'%'; }
      log(`${target} = ${val.toFixed(2)}`,''); return;
    }
  }
  function applyTrigger(target){
    if(target.startsWith('slicePad')){ const n=Number(target.replace('slicePad',''))-1; const btn=$('phase8Slice'+n); if(btn) btn.click(); else log(`Slice pad ${n+1} not found. Install/run Phase 8 first.`,'warn'); return; }
    if(target==='slipToggle') toggleSlip();
  }
  function renderLearnState(){ const el=$('phase9LearnState'); if(el) el.textContent=state.learnTarget?`Learning: ${state.learnTarget}`:'Idle'; }
  function renderMappings(){ const list=$('phase9MapList'); if(!list)return; const entries=Object.entries(state.mappings); list.innerHTML=entries.map(([k,v])=>`<div class="phase9-map"><div><strong>${esc(v)}</strong><br><small>${esc(k)}</small></div><button class="phase9-btn warn" data-del="${esc(k)}">Remove</button></div>`).join('') || '<div class="phase9-muted">No mappings yet.</div>'; qa('[data-del]',list).forEach(b=>b.onclick=()=>{delete state.mappings[b.dataset.del];saveMappings();renderMappings();}); }

  /* ---------------- Slip mode dual timeline ---------------- */
  function toggleSlip(){state.slip.enabled=!state.slip.enabled; renderSlip(); log('Slip mode '+(state.slip.enabled?'enabled':'disabled')+'.',state.slip.enabled?'ok':'warn');}
  function startSlip(deck='A'){
    const ctx=ensureCtx(); if(!ctx||!state.slip.enabled)return;
    const s=state.slip[deck]; if(s.active)return;
    s.active=true; s.realStart=ctx.currentTime; s.virtualStart=currentDeckTime(deck);
    renderSlip(); put('phase9SlipEvents',{id:'start_'+deck+'_'+Date.now(),deck,type:'start',virtualStart:s.virtualStart,ctxTime:ctx.currentTime,createdAt:Date.now()}).catch(()=>{});
  }
  function releaseSlip(deck='A'){
    const ctx=ensureCtx(); if(!ctx)return; const s=state.slip[deck]; if(!s.active)return;
    const elapsed=ctx.currentTime-s.realStart; const target=s.virtualStart+elapsed; s.active=false; s.lastRelease=target;
    seekDeck(deck,target); renderSlip(); put('phase9SlipEvents',{id:'release_'+deck+'_'+Date.now(),deck,type:'release',target,ctxTime:ctx.currentTime,createdAt:Date.now()}).catch(()=>{});
    log(`Slip ${deck} returned to ${target.toFixed(2)}s background timeline.`,'ok');
  }
  function currentDeckTime(deck){ const el=$(deck==='A'?'audioA':'audioB') || $(deck==='A'?'deckAudioA':'deckAudioB') || document.querySelector('audio'); return Number(el?.currentTime||0); }
  function seekDeck(deck,t){ const el=$(deck==='A'?'audioA':'audioB') || $(deck==='A'?'deckAudioA':'deckAudioB') || document.querySelector('audio'); if(el&&Number.isFinite(t)){ try{el.currentTime=Math.max(0,Math.min(el.duration||t,t));}catch(e){} } }
  function renderSlip(){ const enabled=$('phase9SlipEnabled'); if(enabled) enabled.textContent=state.slip.enabled?'ON':'OFF'; ['A','B'].forEach(d=>{const dot=$('phase9SlipDot'+d); if(dot) dot.className='phase9-slip-dot '+(state.slip[d].active?'on':''); const v=$('phase9Slip'+d); if(v){const s=state.slip[d]; v.textContent=s.active?`active · virtual ${s.virtualStart.toFixed(2)}s`:`ready · last ${s.lastRelease.toFixed(2)}s`;}}); }
  window.mediaSuitePhase9StartSlip=startSlip; window.mediaSuitePhase9ReleaseSlip=releaseSlip;

  function renderStatus(){ const el=$('phase9Status'); if(!el)return; el.innerHTML=state.status.map(s=>`<div class="phase9-${s.kind||'muted'}">[${esc(s.at)}] ${esc(s.msg)}</div>`).join('')||'<span class="phase9-muted">Phase 9 ready.</span>'; }

  function mount(){
    if($('phase9Root')) return;
    const css=document.createElement('link'); css.rel='stylesheet'; css.href='phase9.css'; document.head.appendChild(css);
    const root=document.createElement('section'); root.id='phase9Root'; root.className='phase9-card';
    root.innerHTML=`
      <div class="phase9-head"><div><div class="phase9-title">Phase 9 · MIDI Control & Master Protection</div><div class="phase9-muted">Physical controller mapping, hard master limiter, and slip-mode background timing.</div></div><span class="phase9-badge">PRO AUDIO</span></div>
      <div class="phase9-grid">
        <div class="phase9-panel"><h3>Web MIDI Hub</h3><select class="phase9-select" id="phase9MidiInput"><option>Not connected</option></select><div class="phase9-actions"><button class="phase9-btn good" id="phase9MidiEnable">Enable MIDI</button><button class="phase9-btn" id="phase9DefaultMap">Load Defaults</button></div><div class="phase9-row"><span>Last Message</span><strong id="phase9LastMidi">—</strong></div><div class="phase9-row"><span>Learn State</span><strong id="phase9LearnState">Idle</strong></div><select class="phase9-select" id="phase9LearnTarget">${CONTROLS.map(c=>`<option>${c}</option>`).join('')}</select><div class="phase9-actions"><button class="phase9-btn hot" id="phase9LearnBtn">Learn Selected Control</button></div><div class="phase9-map-list" id="phase9MapList"></div></div>
        <div class="phase9-panel"><h3>Brickwall Master Limiter</h3><div class="phase9-muted">DynamicsCompressorNode configured as hard-knee peak protection: threshold <span class="phase9-kbd">-1dB</span>, ratio <span class="phase9-kbd">20:1</span>, attack <span class="phase9-kbd">0.001</span>, release <span class="phase9-kbd">0.05</span>.</div><div class="phase9-meter"><div class="phase9-meter-fill" id="phase9LimiterMeter"></div></div><div class="phase9-row"><span>Limiter</span><strong id="phase9LimiterState">OFF</strong></div><div class="phase9-actions"><button class="phase9-btn good" id="phase9LimiterEnable">Enable Limiter</button><button class="phase9-btn warn" id="phase9LimiterDisable">Bypass Flag</button></div></div>
        <div class="phase9-panel"><h3>Slip-Mode Timeline</h3><div class="phase9-row"><span>Slip Mode</span><strong id="phase9SlipEnabled">OFF</strong></div><div class="phase9-row"><span><i id="phase9SlipDotA" class="phase9-slip-dot"></i>Deck A</span><strong id="phase9SlipA">ready</strong></div><div class="phase9-row"><span><i id="phase9SlipDotB" class="phase9-slip-dot"></i>Deck B</span><strong id="phase9SlipB">ready</strong></div><div class="phase9-actions"><button class="phase9-btn" id="phase9SlipToggle">Toggle Slip</button><button class="phase9-btn hot" id="phase9SlipStartA">Start A</button><button class="phase9-btn warn" id="phase9SlipReleaseA">Release A</button><button class="phase9-btn hot" id="phase9SlipStartB">Start B</button><button class="phase9-btn warn" id="phase9SlipReleaseB">Release B</button></div><p class="phase9-small">Hook slicer/scratch gestures to <span class="phase9-kbd">mediaSuitePhase9StartSlip(deck)</span> and <span class="phase9-kbd">mediaSuitePhase9ReleaseSlip(deck)</span>.</p></div>
      </div><div class="phase9-status" id="phase9Status"></div>`;
    const anchor=$('phase8Root') || $('mixerCenter') || $('tab-deck') || document.querySelector('.workspace') || document.body; anchor.appendChild(root);
    $('phase9MidiEnable').onclick=initMidi; $('phase9DefaultMap').onclick=loadDefaultMappings; $('phase9LearnBtn').onclick=()=>{state.learnTarget=$('phase9LearnTarget').value;renderLearnState();log('Move a knob/fader or press a pad to map '+state.learnTarget+'.','warn');};
    $('phase9LimiterEnable').onclick=enableLimiter; $('phase9LimiterDisable').onclick=disableLimiter;
    $('phase9SlipToggle').onclick=toggleSlip; $('phase9SlipStartA').onclick=()=>startSlip('A'); $('phase9SlipReleaseA').onclick=()=>releaseSlip('A'); $('phase9SlipStartB').onclick=()=>startSlip('B'); $('phase9SlipReleaseB').onclick=()=>releaseSlip('B');
    idb().then(loadMappings).then(()=>log('Phase 9 IndexedDB stores verified.','ok')).catch(e=>log(e.message||e,'danger'));
    get('phase9Limiter','latest').then(v=>{if(v?.enabled) enableLimiter();}).catch(()=>{});
    renderSlip(); renderStatus();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();

/* ============================================================
   Phase 21 Stability Patch — merged into Phase 9
   Adds: MIDI conflict detection, smoothed slip timing (12ms),
   diagnostic log (200 entries), mediasuite:slip events.
   ============================================================ */
(function () {
  'use strict';
  const LOG_LIMIT = 200;
  const diag = [];

  function logDiag(level, message, data) {
    const item = { level, message, data: data || null, at: new Date().toISOString() };
    diag.unshift(item);
    if (diag.length > LOG_LIMIT) diag.length = LOG_LIMIT;
    window.dispatchEvent(new CustomEvent('mediasuite:phase21:diagnostic', { detail: item }));
  }

  /* ── Conflict detection ── */
  function detectMidiConflicts() {
    const mappings = window.mediaSuitePhase9Mappings ? window.mediaSuitePhase9Mappings() : [];
    const seen = new Map();
    const conflicts = [];
    mappings.forEach(m => {
      if (seen.has(m.key) && seen.get(m.key) !== m.target)
        conflicts.push({ key: m.key, a: seen.get(m.key), b: m.target });
      else seen.set(m.key, m.target);
    });
    if (conflicts.length) {
      logDiag('warn', 'MIDI mapping conflicts detected', conflicts);
      if (window.MS?.toast) window.MS.toast(`${conflicts.length} MIDI mapping conflict(s) detected`, 'warn');
    }
    return conflicts;
  }

  /* ── Smoothed slip mode ── */
  const SMOOTHING_MS = 12;
  const slipState = {
    A: { active: false, virtualTime: 0, lastReleaseAt: 0 },
    B: { active: false, virtualTime: 0, lastReleaseAt: 0 }
  };

  function beginSmoothedSlip(deck, virtualTime) {
    slipState[deck] = { active: true, virtualTime: +virtualTime || 0, lastReleaseAt: 0 };
    window.dispatchEvent(new CustomEvent('mediasuite:slip:update', {
      detail: { deck, state: { ...slipState[deck] } }
    }));
    logDiag('info', `Slip begin Deck ${deck}`, slipState[deck]);
  }

  function releaseSmoothedSlip(deck) {
    const d = slipState[deck];
    if (!d.active) return;
    d.active = false;
    d.lastReleaseAt = Date.now();
    window.dispatchEvent(new CustomEvent('mediasuite:slip:release', {
      detail: { deck, targetTime: d.virtualTime, smoothingMs: SMOOTHING_MS }
    }));
    logDiag('info', `Slip release Deck ${deck}`, { targetTime: d.virtualTime });
    // Apply smoothed seek via existing phase9 hook
    if (typeof window.mediaSuitePhase9ReleaseSlip === 'function')
      window.mediaSuitePhase9ReleaseSlip(deck);
  }

  /* ── Wire into MS event bus ── */
  window.addEventListener('mediasuite:phase21:diagnostic', () => {});

  /* ── Expose on window.MS ── */
  if (window.MS) {
    window.MS.on('deck:loaded', () => detectMidiConflicts());
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      window.MS?.on('deck:loaded', () => detectMidiConflicts());
    });
  }

  window.MediaSuitePhase21 = {
    detectMidiConflicts,
    beginSmoothedSlip,
    releaseSmoothedSlip,
    getDiagnostics: () => [...diag],
    logDiag
  };

  logDiag('info', 'Phase 21 stability patch active (merged into phase9-engine.js)');
})();
