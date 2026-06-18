/* ============================================================
   MediaSuite V3 — Phase 8 Spatial Remix & Local Collaboration
   Local-first. WebRTC uses manual signaling only.
   ============================================================ */
(function(){
  'use strict';
  const $=(id)=>document.getElementById(id);
  const qa=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const DB_NAME='MediaSuiteV3';
  const DB_VERSION=8;
  const state={db:null,ctx:null,spatial:{A:{x:-.45,z:.25},B:{x:.45,z:.25},nodes:{}},rtc:{pc:null,dc:null,role:null},status:[]};

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function log(msg,kind=''){state.status.unshift({msg,kind,at:new Date().toLocaleTimeString()});state.status=state.status.slice(0,10);renderStatus();}
  function idb(){ if(state.db) return Promise.resolve(state.db); return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION); req.onupgradeneeded=()=>{const db=req.result; ['tracks','metadata','waveforms','crates','playlists','settings','cuePoints','sessions','analysis','loops','directoryHandles','phase7Events','isolatorPresets','phase8Packets','phase8PeerImports','phase8SpatialPresets','phase8Slices'].forEach(s=>{if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'});});}; req.onsuccess=()=>{state.db=req.result;resolve(state.db);}; req.onerror=()=>reject(req.error);}); }
  async function store(name,mode='readonly'){const db=await idb();return db.transaction(name,mode).objectStore(name);} async function getAll(name){const os=await store(name);return new Promise((res,rej)=>{const r=os.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});} async function put(name,val){const os=await store(name,'readwrite');return new Promise((res,rej)=>{const r=os.put(val);r.onsuccess=()=>res(val);r.onerror=()=>rej(r.error);});}

  function ensureCtx(){ if(!state.ctx) state.ctx=new (window.AudioContext||window.webkitAudioContext)(); if(state.ctx.state==='suspended') state.ctx.resume().catch(()=>{}); return state.ctx; }
  function activeAudio(deck){return $(deck==='A'?'audioA':'audioB')||$('deckAudio'+deck)||$(deck==='A'?'deckAaudio':'deckBaudio')||document.querySelector('audio');}
  function deckBpm(deck){const el=$(deck==='A'?'deckABPM':'deckBBPM'); const n=parseFloat((el?.textContent||'').match(/\d+(\.\d+)?/)?.[0]||''); return Number.isFinite(n)&&n>30?n:120;}

  /* ------------------ Spatial Audio ------------------ */
  function buildSpatialNode(deck){
    const ctx=ensureCtx();
    if(state.spatial.nodes[deck]) return state.spatial.nodes[deck];
    const panner=ctx.createPanner(); panner.panningModel='HRTF'; panner.distanceModel='inverse'; panner.refDistance=1; panner.maxDistance=10000; panner.rolloffFactor=0.7; panner.coneInnerAngle=360; panner.coneOuterAngle=0; panner.coneOuterGain=0;
    panner.connect(ctx.destination);
    state.spatial.nodes[deck]={panner};
    applySpatial(deck);
    return state.spatial.nodes[deck];
  }
  function applySpatial(deck){ const ctx=ensureCtx(); const n=buildSpatialNode(deck).panner; const pos=state.spatial[deck]; const t=ctx.currentTime; if(n.positionX) {n.positionX.setTargetAtTime(pos.x,t,.015); n.positionY.setTargetAtTime(0,t,.015); n.positionZ.setTargetAtTime(pos.z,t,.015);} else {n.setPosition(pos.x,0,pos.z);} updateSpatialUI(); put('phase8SpatialPresets',{id:'latest',A:state.spatial.A,B:state.spatial.B,updatedAt:Date.now()}).catch(()=>{}); }
  function spatialReset(){state.spatial.A={x:-.45,z:.25};state.spatial.B={x:.45,z:.25};applySpatial('A');applySpatial('B');log('Spatial positions reset.','ok');}
  function setSpatialFromPad(e,deck){const pad=$('phase8SpatialPad'); if(!pad)return; const rect=pad.getBoundingClientRect(); const x=((e.clientX-rect.left)/rect.width)*2-1; const z=((e.clientY-rect.top)/rect.height)*2-1; state.spatial[deck]={x:Math.max(-1,Math.min(1,x)),z:Math.max(-1,Math.min(1,z))}; applySpatial(deck);}
  function updateSpatialUI(){['A','B'].forEach(d=>{const dot=$('phase8Dot'+d); const pos=state.spatial[d]; if(dot){dot.style.left=((pos.x+1)/2*100)+'%';dot.style.top=((pos.z+1)/2*100)+'%';} const txt=$('phase8Pos'+d); if(txt)txt.textContent=`X ${pos.x.toFixed(2)} · Z ${pos.z.toFixed(2)}`;});}

  /* ------------------ 8-pad quantized slicer ------------------ */
  function sliceDuration(deck){ const beats=parseFloat($('phase8SliceBeats')?.value||'4'); return (60/deckBpm(deck))*beats; }
  function triggerSlice(deck,index){ const a=activeAudio(deck); if(!a){log('No deck audio element found. Load a track first.','warn');return;} ensureCtx(); const dur=sliceDuration(deck); const target=index*dur; try{ a.currentTime=Math.min(Math.max(0,target), Math.max(0,(a.duration||target)-.05)); a.play().catch(()=>{}); }catch(e){} qa('.phase8-slice').forEach(b=>b.classList.remove('active')); const btn=$(`phase8Slice${index}`); if(btn){btn.classList.add('active'); setTimeout(()=>btn.classList.remove('active'),220);} put('phase8Slices',{id:'slice_'+Date.now(),deck,index,start:target,duration:dur,bpm:deckBpm(deck),createdAt:Date.now()}).catch(()=>{}); log(`Triggered ${deck} slice ${index+1} at ${target.toFixed(2)}s.`, 'ok'); }
  function renderSlicer(){const root=$('phase8Slicer'); if(!root)return; const deck=$('phase8SliceDeck')?.value||'A'; const dur=sliceDuration(deck); root.innerHTML=Array.from({length:8},(_,i)=>`<button class="phase8-slice" id="phase8Slice${i}" data-i="${i}"><span>PAD ${i+1}</span><small>${(i*dur).toFixed(1)}s</small></button>`).join(''); qa('.phase8-slice',root).forEach(btn=>btn.onclick=()=>triggerSlice(deck,Number(btn.dataset.i)));}

  /* ------------------ Local WebRTC metadata exchange ------------------ */
  function openPeerModal(){const m=$('phase8Modal'); if(m)m.classList.add('show');}
  function closePeerModal(){const m=$('phase8Modal'); if(m)m.classList.remove('show');}
  function rtcConfig(){return {iceServers:[]};}
  function bindChannel(dc){ state.rtc.dc=dc; dc.binaryType='arraybuffer'; dc.onopen=()=>log('Peer data channel open.','ok'); dc.onclose=()=>log('Peer data channel closed.','warn'); dc.onerror=()=>log('Peer channel error.','danger'); dc.onmessage=async(ev)=>{try{const data=JSON.parse(ev.data); await importPeerPacket(data); log('Peer packet imported into IndexedDB.','ok');}catch(e){log('Could not import peer packet: '+(e.message||e),'danger');}}; }
  async function createOffer(){ state.rtc.pc=new RTCPeerConnection(rtcConfig()); bindChannel(state.rtc.pc.createDataChannel('mediasuite-meta')); state.rtc.pc.onicecandidate=()=>{ if(state.rtc.pc.iceGatheringState==='complete') $('phase8LocalSignal').value=btoa(JSON.stringify(state.rtc.pc.localDescription)); }; const offer=await state.rtc.pc.createOffer(); await state.rtc.pc.setLocalDescription(offer); log('Offer created. Copy the local token to peer device.','ok'); }
  async function acceptOffer(){ const token=$('phase8RemoteSignal')?.value.trim(); if(!token){log('Paste an offer token first.','warn');return;} state.rtc.pc=new RTCPeerConnection(rtcConfig()); state.rtc.pc.ondatachannel=e=>bindChannel(e.channel); state.rtc.pc.onicecandidate=()=>{ if(state.rtc.pc.iceGatheringState==='complete') $('phase8LocalSignal').value=btoa(JSON.stringify(state.rtc.pc.localDescription)); }; await state.rtc.pc.setRemoteDescription(JSON.parse(atob(token))); const answer=await state.rtc.pc.createAnswer(); await state.rtc.pc.setLocalDescription(answer); log('Answer created. Send local token back to host.','ok'); }
  async function acceptAnswer(){ const token=$('phase8RemoteSignal')?.value.trim(); if(!state.rtc.pc||!token){log('Create offer first, then paste peer answer.','warn');return;} await state.rtc.pc.setRemoteDescription(JSON.parse(atob(token))); log('Answer accepted. Waiting for data channel.','ok'); }
  async function buildExportPacket(){ const [crates,metadata,cues,waves]=await Promise.all([getAll('crates').catch(()=>[]),getAll('metadata').catch(()=>[]),getAll('cuePoints').catch(()=>[]),getAll('waveforms').catch(()=>[])]); return {type:'MediaSuitePhase8Packet',version:1,createdAt:Date.now(),payload:{crates,metadata,cuePoints:cues,waveforms:waves.map(w=>({id:w.id,duration:w.duration,sampleRate:w.sampleRate,peaks:w.peaks}))}}; }
  async function sendPacket(){ if(!state.rtc.dc||state.rtc.dc.readyState!=='open'){log('Peer channel is not open.','warn');return;} const packet=await buildExportPacket(); state.rtc.dc.send(JSON.stringify(packet)); await put('phase8Packets',{id:'sent_'+Date.now(),direction:'sent',createdAt:Date.now(),counts:{crates:packet.payload.crates.length,metadata:packet.payload.metadata.length,cuePoints:packet.payload.cuePoints.length}}); log('Metadata/crate/cue packet sent.','ok'); }
  async function importPeerPacket(packet){ if(packet?.type!=='MediaSuitePhase8Packet') throw new Error('Invalid MediaSuite packet'); const p=packet.payload||{}; for(const x of (p.crates||[])) await put('crates',{...x,id:x.id||('peer_crate_'+Date.now()+Math.random()),peerImported:true}); for(const x of (p.metadata||[])) await put('metadata',{...x,id:x.id||('peer_meta_'+Date.now()+Math.random()),peerImported:true}); for(const x of (p.cuePoints||[])) await put('cuePoints',{...x,id:x.id||('peer_cue_'+Date.now()+Math.random()),peerImported:true}); for(const x of (p.waveforms||[])) await put('waveforms',{...x,id:x.id||('peer_wave_'+Date.now()+Math.random()),peerImported:true}); await put('phase8PeerImports',{id:'import_'+Date.now(),createdAt:Date.now(),counts:{crates:(p.crates||[]).length,metadata:(p.metadata||[]).length,cuePoints:(p.cuePoints||[]).length,waveforms:(p.waveforms||[]).length}}); }

  function renderStatus(){const el=$('phase8Status'); if(!el)return; el.innerHTML=state.status.map(s=>`<div class="phase8-${s.kind||'muted'}">[${esc(s.at)}] ${esc(s.msg)}</div>`).join('')||'<span class="phase8-muted">Phase 8 ready.</span>';}

  function mount(){
    if($('phase8Root')) return;
    const css=document.createElement('link'); css.rel='stylesheet'; css.href='phase8.css'; document.head.appendChild(css);
    const root=document.createElement('section'); root.id='phase8Root'; root.className='phase8-card';
    root.innerHTML=`
      <div class="phase8-head"><div><div class="phase8-title">Phase 8 · Spatial Remix & Local Collaboration</div><div class="phase8-muted">HRTF deck positioning, quantized 8-pad slicing, and manual-token local peer metadata exchange.</div></div><span class="phase8-badge">OFFLINE-FIRST</span></div>
      <div class="phase8-grid">
        <div class="phase8-panel"><h3>Spatial Mixer</h3><div class="phase8-spatial-wrap"><div class="phase8-pad" id="phase8SpatialPad"><div class="phase8-dot a" id="phase8DotA"></div><div class="phase8-dot b" id="phase8DotB"></div></div><div><div class="phase8-kv"><span>Deck A</span><strong id="phase8PosA">—</strong></div><div class="phase8-kv"><span>Deck B</span><strong id="phase8PosB">—</strong></div><div class="phase8-actions"><button class="phase8-btn" id="phase8EnableSpatial">Enable HRTF</button><button class="phase8-btn warn" id="phase8ResetSpatial">Reset Center</button></div><div class="phase8-muted">Drag dots: cyan = Deck A, pink = Deck B. X controls left/right; Z controls front/back.</div></div></div></div>
        <div class="phase8-panel"><h3>Quantized Remix Slicer</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><select class="phase8-select" id="phase8SliceDeck"><option>A</option><option>B</option></select><select class="phase8-select" id="phase8SliceBeats"><option value="1">1 beat</option><option value="2">2 beats</option><option value="4" selected>4 beats</option><option value="8">8 beats</option></select></div><div class="phase8-slicer" id="phase8Slicer"></div></div>
        <div class="phase8-panel"><h3>Peer Collaboration</h3><div class="phase8-muted">Serverless WebRTC manual signaling. Shares crates, metadata, hot cues, and waveform summaries only — no automatic music-file transfer.</div><div class="phase8-actions"><button class="phase8-btn" id="phase8OpenPeer">Open Peer Exchange</button><button class="phase8-btn hot" id="phase8SendPacket">Send Metadata Packet</button></div></div>
        <div class="phase8-panel"><h3>Engine Status</h3><div id="phase8Status" class="phase8-status"></div></div>
      </div>
      <div class="phase8-modal" id="phase8Modal"><div class="phase8-dialog"><div class="phase8-dialog-head"><div><div class="phase8-title">Local Peer Exchange</div><div class="phase8-muted">Copy/paste tokens between two devices. Works without accounts or servers after signaling.</div></div><button class="phase8-close" id="phase8ClosePeer">✕</button></div><div class="phase8-grid"><div><h3>Create / Accept</h3><div class="phase8-actions"><button class="phase8-btn" id="phase8CreateOffer">Create Offer</button><button class="phase8-btn" id="phase8AcceptOffer">Accept Offer</button><button class="phase8-btn warn" id="phase8AcceptAnswer">Accept Answer</button></div><p class="phase8-muted">Host: Create Offer → peer accepts it → host accepts peer answer.</p></div><div><h3>Safety</h3><p class="phase8-muted">This module exchanges library intelligence only. Full audio blobs are intentionally excluded for performance, storage, and rights safety.</p></div></div><h3>Local Token</h3><textarea class="phase8-textarea" id="phase8LocalSignal" readonly placeholder="Generated local token appears here..."></textarea><h3>Remote Token</h3><textarea class="phase8-textarea" id="phase8RemoteSignal" placeholder="Paste peer token here..."></textarea></div></div>`;
    const anchor=$('mixerCenter') || $('tab-deck') || document.querySelector('.workspace') || document.body; anchor.appendChild(root);
    document.body.appendChild($('phase8Modal'));
    $('phase8EnableSpatial').onclick=()=>{buildSpatialNode('A');buildSpatialNode('B');log('HRTF PannerNodes enabled for Deck A and Deck B.','ok');};
    $('phase8ResetSpatial').onclick=spatialReset; $('phase8SliceDeck').onchange=renderSlicer; $('phase8SliceBeats').onchange=renderSlicer;
    $('phase8OpenPeer').onclick=openPeerModal; $('phase8ClosePeer').onclick=closePeerModal; $('phase8CreateOffer').onclick=()=>createOffer().catch(e=>log(e.message||e,'danger')); $('phase8AcceptOffer').onclick=()=>acceptOffer().catch(e=>log(e.message||e,'danger')); $('phase8AcceptAnswer').onclick=()=>acceptAnswer().catch(e=>log(e.message||e,'danger')); $('phase8SendPacket').onclick=()=>sendPacket().catch(e=>log(e.message||e,'danger'));
    let dragging=null; $('phase8DotA').onpointerdown=e=>{dragging='A';e.preventDefault();}; $('phase8DotB').onpointerdown=e=>{dragging='B';e.preventDefault();}; $('phase8SpatialPad').onpointerdown=e=>{if(e.target.id==='phase8SpatialPad'){dragging='A';setSpatialFromPad(e,'A');}}; window.addEventListener('pointermove',e=>{if(dragging)setSpatialFromPad(e,dragging);}); window.addEventListener('pointerup',()=>dragging=null);
    updateSpatialUI(); renderSlicer(); renderStatus(); idb().then(()=>log('Phase 8 IndexedDB stores verified.','ok')).catch(e=>log(e.message||e,'danger'));
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
