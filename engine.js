/* ============================================================
   868 VIBEZ — Core Engine
   DB · State · Audio · Camelot · Waveform · File System
   No UI. No phase panels. No debug output.
   ============================================================ */
'use strict';

/* ── IndexedDB ──
   AUDIT FIX (Phase 16): this is now the SINGLE, authoritative
   schema definition for the entire app. Every store any phase
   needs is declared here, at one version, opened exactly once.
   No other file calls indexedDB.open() directly anymore.

   This replaces what used to be three separate, independently
   versioned indexedDB.open() calls (engine.js v1, phase1.js v2,
   phase4.js v3) that could race each other since indexedDB.open()
   is asynchronous and script-load order alone does not guarantee
   which upgrade transaction completes first. That race could
   silently leave 'artwork_cache' or 'stats' missing depending on
   device speed and browser task scheduling. */
const DB_NAME = '868VibezDB', DB_VERSION = 4;
let _db = null;

const FULL_DB_SCHEMA = [
  'tracks','waveforms','playlists','crates','settings','handles','cuePoints', // v1
  'artwork_cache',                                                             // v2
  'stats',                                                                     // v3
  // v4 introduces no new stores — it exists purely as the consolidation
  // version that guarantees every store above is created in one pass.
];

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      FULL_DB_SCHEMA.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:'id'}); });
    };
    r.onblocked = () => {
      console.warn('[engine] DB upgrade blocked — another tab has an old connection open.');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror   = () => rej(r.error);
  });
}
const dbPut  = async (s,v)  => { const d=await openDB(); return new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess=()=>res(v); r.onerror=()=>rej(r.error); }); };
const dbGet  = async (s,k)  => { const d=await openDB(); return new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); };
const dbDel  = async (s,k)  => { const d=await openDB(); return new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).delete(k); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); };
const dbAll  = async s      => { const d=await openDB(); return new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); };

/* ── Global state ── */
const MS = window.MS = {
  library: [], selectedTrack: null, folderHandle: null,
  deck: { A:{ track:null, playing:false, _peaks:null }, B:{ track:null, playing:false, _peaks:null } },
  _activeGenre: '', _listeners: {},
  db: { put:dbPut, get:dbGet, del:dbDel, all:dbAll, open:openDB },
  on(ev,fn)  { (this._listeners[ev]=this._listeners[ev]||[]).push(fn); },
  emit(ev,d) { (this._listeners[ev]||[]).forEach(fn=>fn(d)); },
  toast(msg,type='info',dur=2800) { showToast(msg,type,dur); }
};

/* ── Utilities ── */
const $   = id => document.getElementById(id);
const fmt = s  => !isFinite(s)?'0:00':`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const esc = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const num = v => (v===''||v==null)?null:Number(v);
const audioExt = new Set(['mp3','wav','ogg','m4a','aac','flac','mp4','webm','opus']);
const getExt   = n => (n.split('.').pop()||'').toLowerCase();
const sanitize = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120);
const fingerprint = (file,path='') => `${path||file.name}_${file.size}_${file.lastModified}`.replace(/[^a-z0-9_.-]/gi,'_');

/* ── Toast ── */
function showToast(msg, type='info', dur=2800) {
  let stack = document.querySelector('.vz-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'vz-toast-stack';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `vz-toast vz-toast--${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('vz-toast--in'));
  setTimeout(() => el.classList.remove('vz-toast--in'), dur - 300);
  setTimeout(() => el.remove(), dur);
}

/* ── Camelot harmonic engine ── */
function compatibleKeys(key) {
  if (!/^\d{1,2}[AB]$/i.test(key||'')) return [];
  const n=parseInt(key), l=key.slice(-1).toUpperCase(), o=l==='A'?'B':'A';
  const prev=n===1?12:n-1, next=n===12?1:n+1;
  return [`${n}${l}`,`${prev}${l}`,`${next}${l}`,`${n}${o}`];
}
function harmonicTier(base, key) {
  if (!base||!key) return null;
  const b=base.toUpperCase(), t=key.toUpperCase();
  if (t===b) return 'perfect';
  if (compatibleKeys(b).includes(t)) return 'harmonic';
  return null;
}
function scoreTrack(seed, candidate) {
  let s=0;
  const tier=harmonicTier(seed.key, candidate.key);
  if (tier==='perfect') s+=50; else if (tier==='harmonic') s+=35;
  if (seed.bpm&&candidate.bpm) { const d=Math.abs(seed.bpm-candidate.bpm); s+=d<=2?25:d<=5?15:d<=10?5:0; }
  if (seed.energy&&candidate.energy) { const d=Math.abs(seed.energy-candidate.energy); s+=d<=1?12:d<=2?6:0; }
  if (seed.genre&&candidate.genre&&seed.genre.toLowerCase()===candidate.genre.toLowerCase()) s+=10;
  return s;
}
MS.camelot = { compatibleKeys, harmonicTier, scoreTrack };

/* ── Waveform ── */
async function buildPeaks(file, buckets=400) {
  try {
    const ab  = await file.arrayBuffer();
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const data= buf.getChannelData(0);
    const step= Math.max(1, Math.floor(data.length/buckets));
    const peaks=[];
    for(let i=0;i<buckets;i++) {
      let max=0;
      for(let j=0;j<step;j++) max=Math.max(max,Math.abs(data[i*step+j]||0));
      peaks.push(+max.toFixed(4));
    }
    await ctx.close(); return peaks;
  } catch { return Array.from({length:buckets},(_,i)=>Math.abs(Math.sin(i*.17))*(.3+Math.random()*.7)); }
}

function drawWave(canvas, peaks, pct=0, colorA='#00e5ff', colorB='rgba(255,255,255,0.15)') {
  if (!canvas||!peaks) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth*devicePixelRatio;
  const H=canvas.height=canvas.offsetHeight*devicePixelRatio;
  ctx.clearRect(0,0,W,H);
  const mid=H/2, bw=W/peaks.length;
  peaks.forEach((p,i) => {
    const bh=p*mid*.88;
    ctx.fillStyle = (i/peaks.length)<pct ? colorA : colorB;
    ctx.fillRect(i*bw, mid-bh, Math.max(1,bw-.5), bh*2);
  });
  const px=pct*W;
  ctx.shadowColor=colorA; ctx.shadowBlur=8;
  ctx.fillStyle=colorA; ctx.fillRect(px-1,0,2,H);
  ctx.shadowBlur=0;
}

async function renderWave(deck, track, file) {
  const canvas=$(deck==='A'?'waveA':'waveB');
  if(!canvas) return;
  let cached=await dbGet('waveforms',track.id);
  let peaks=cached?.peaks;
  if(!peaks) {
    peaks=await buildPeaks(file,400);
    await dbPut('waveforms',{id:track.id,peaks,createdAt:Date.now()});
  }
  MS.deck[deck]._peaks=peaks;
  const color=deck==='A'?'#00e5ff':'#f0007a';
  drawWave(canvas,peaks,0,color);
}

function tickWaveheads() {
  ['A','B'].forEach(d=>{
    const audio = d==='A'?MS.audio.A:MS.audio.B;
    const canvas=$(d==='A'?'waveA':'waveB');
    const peaks =MS.deck[d]._peaks;
    if(!canvas||!peaks||!audio?.duration) return;
    drawWave(canvas,peaks,audio.currentTime/audio.duration,d==='A'?'#00e5ff':'#f0007a');
  });
  requestAnimationFrame(tickWaveheads);
}

/* ── File system ── */
async function fileFromTrack(t) {
  if(t._fileHandle) return t._fileHandle.getFile();
  const stored=await dbGet('handles',t.id);
  if(stored?.handle) { t._fileHandle=stored.handle; return stored.handle.getFile(); }
  throw new Error('File not found — re-open your music folder.');
}
MS.fileFromTrack=fileFromTrack;

async function scanFolder(handle, path='') {
  let count=0;
  for await(const [name,h] of handle.entries()) {
    const p=path?`${path}/${name}`:name;
    if(h.kind==='directory') { count+=await scanFolder(h,p); continue; }
    if(!audioExt.has(getExt(name))) continue;
    const file=await h.getFile();
    const id=fingerprint(file,p);
    let track=await dbGet('tracks',id);
    if(!track) track={
      id,title:name.replace(/\.[^.]+$/,''),artist:'Unknown',album:'',genre:'',
      mood:'',bpm:null,key:'',energy:null,favorite:false,playCount:0,
      lastPlayed:null,dateImported:Date.now(),path:p,size:file.size,
      lastModified:file.lastModified,type:file.type,artwork:null,source:'local'
    };
    track.path=p; track.size=file.size; track._fileHandle=h;
    await dbPut('tracks',track);
    await dbPut('handles',{id,handle:h,path:p});
    count++;
  }
  return count;
}

async function openFolder() {
  if(!('showDirectoryPicker' in window)) { MS.toast('Folder access requires Chrome or Edge.','warn'); return; }
  try {
    MS.folderHandle=await window.showDirectoryPicker({mode:'read'});
    MS.toast(`Scanning ${MS.folderHandle.name}…`,'info');
    const n=await scanFolder(MS.folderHandle);
    MS.library=await dbAll('tracks');
    MS.emit('library:updated',MS.library);
    MS.toast(`Imported ${n} tracks.`,'ok');
  } catch(e) { if(e.name!=='AbortError') MS.toast(e.message,'error'); }
}
MS.openFolder=openFolder;

/* ── Audio master chain ── */
function buildAudioChain() {
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const limiter=ctx.createDynamicsCompressor();
  limiter.threshold.value=-1; limiter.knee.value=0;
  limiter.ratio.value=20; limiter.attack.value=0.001; limiter.release.value=0.1;
  limiter.connect(ctx.destination);
  const gainA=ctx.createGain(), gainB=ctx.createGain(), gainM=ctx.createGain();
  gainA.connect(limiter); gainB.connect(limiter); gainM.connect(limiter);
  MS.audioCtx=ctx; MS.limiter=limiter;
  MS.gainA=gainA; MS.gainB=gainB; MS.gainM=gainM;
  MS.emit('audio:ready',ctx);
  return ctx;
}

function ensureAudioCtx() {
  if(MS.audioCtx&&MS.audioCtx.state!=='closed') {
    if(MS.audioCtx.state==='suspended') MS.audioCtx.resume();
    return MS.audioCtx;
  }
  return buildAudioChain();
}

function connectAudioEl(el, gainNode) {
  if(el._msNode) { try{el._msNode.disconnect();}catch{} }
  const ctx=ensureAudioCtx();
  const src=ctx.createMediaElementSource(el);
  el._msNode=src; src.connect(gainNode);
}
MS.connectAudioEl=connectAudioEl;
MS.ensureAudioCtx=ensureAudioCtx;

/* ── Deck engine ── */
async function loadDeck(deck, track) {
  if(!track) { MS.toast('Select a track first.','warn'); return; }
  const audio=deck==='A'?MS.audio.A:MS.audio.B;
  const gain =deck==='A'?MS.gainA:MS.gainB;
  try {
    const file=await fileFromTrack(track);
    if(audio.src&&audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src=URL.createObjectURL(file);
    await new Promise((res,rej)=>{ audio.oncanplay=res; audio.onerror=rej; audio.load(); });
    ensureAudioCtx();
    if(!audio._msNode) connectAudioEl(audio,gain);
    MS.deck[deck].track={...track};
    MS.deck[deck].playing=false;
    await renderWave(deck,track,file);
    MS.emit('deck:loaded',{deck,track});
    MS.toast(`Deck ${deck}: ${track.title}`,'info',1800);
  } catch(e) { MS.toast(e.message,'error'); }
}

async function loadStreamToDeck(deck, url, type) {
  const audio=deck==='A'?MS.audio.A:MS.audio.B;
  const gain =deck==='A'?MS.gainA:MS.gainB;
  const label=decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/,''));
  if(audio.src&&audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  audio.src=url; audio.load();
  ensureAudioCtx();
  if(!audio._msNode) connectAudioEl(audio,gain);
  const track={id:`stream_${Date.now()}`,title:label,url,type,artist:'Stream',
    bpm:null,key:'',energy:null,source:'stream'};
  MS.deck[deck].track=track;
  MS.deck[deck].playing=false;
  MS.emit('deck:loaded',{deck,track});
  MS.toast(`Deck ${deck}: ${label}`,'info',1800);
}
MS.loadDeck=loadDeck;
MS.loadStreamToDeck=loadStreamToDeck;

async function toggleDeck(deck) {
  const audio=deck==='A'?MS.audio.A:MS.audio.B;
  if(!audio.src) { MS.toast(`Load a track on Deck ${deck} first.`,'warn'); return; }
  ensureAudioCtx();
  if(audio.paused) { await audio.play(); MS.deck[deck].playing=true; }
  else             { audio.pause();      MS.deck[deck].playing=false; }
  MS.emit('deck:toggle',{deck,playing:MS.deck[deck].playing});
}
MS.toggleDeck=toggleDeck;

function syncDeck(deck) {
  const src=deck==='A'?MS.deck.B.track:MS.deck.A.track;
  const dst=MS.deck[deck].track;
  if(!src?.bpm||!dst?.bpm) { MS.toast('Both decks need BPM to sync.','warn'); return; }
  const ratio=src.bpm/dst.bpm;
  const audio=deck==='A'?MS.audio.A:MS.audio.B;
  audio.playbackRate=ratio;
  MS.toast(`Deck ${deck} synced → ${src.bpm} BPM`,'ok');
  MS.emit('deck:synced',{deck,ratio});
}
MS.syncDeck=syncDeck;

/* ── Cue points ── */
async function saveCue(deck) {
  const audio=deck==='A'?MS.audio.A:MS.audio.B;
  const track=MS.deck[deck].track;
  if(!track||!audio.duration) { MS.toast('Load a track first.','warn'); return; }
  const cue={id:`${track.id}_${deck}_${Date.now()}`,trackId:track.id,deck,
    time:audio.currentTime,label:fmt(audio.currentTime),createdAt:Date.now()};
  await dbPut('cuePoints',cue);
  MS.emit('cue:saved',cue);
}
MS.saveCue=saveCue;

async function getCues(deck) {
  const track=MS.deck[deck].track;
  if(!track) return [];
  const all=await dbAll('cuePoints');
  return all.filter(c=>c.trackId===track.id&&c.deck===deck);
}
MS.getCues=getCues;

/* ── Main player ── */
async function playMain(track) {
  MS.selectedTrack=track;
  try {
    const file=await fileFromTrack(track);
    const audio=MS.audio.main;
    if(audio.src&&audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src=URL.createObjectURL(file);
    ensureAudioCtx();
    if(!audio._msNode) connectAudioEl(audio,MS.gainM);
    await audio.play();
    track.playCount=(track.playCount||0)+1;
    track.lastPlayed=Date.now();
    await dbPut('tracks',track);
    MS.emit('player:play',track);
  } catch(e) { MS.toast(e.message,'error'); }
}

async function playStreamMain(url) {
  const audio=MS.audio.main;
  if(audio.src&&audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  audio.src=url;
  ensureAudioCtx();
  if(!audio._msNode) connectAudioEl(audio,MS.gainM);
  await audio.play().catch(e=>MS.toast(e.message,'error'));
  const track={id:`stream_${Date.now()}`,title:decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/,'')),url,source:'stream'};
  MS.selectedTrack=track;
  MS.emit('player:play',track);
}

function playRelative(dir) {
  const lib=MS.library; if(!lib.length) return;
  const i=lib.findIndex(t=>t.id===MS.selectedTrack?.id);
  playMain(lib[(i+dir+lib.length)%lib.length]);
}
MS.playMain=playMain;
MS.playStreamMain=playStreamMain;
MS.playRelative=playRelative;

/* ── Smart crates ── */
function matchRules(t,r={}) {
  if(r.favorite&&!t.favorite)                                      return false;
  if(r.bpmMin&&(!t.bpm||t.bpm<r.bpmMin))                         return false;
  if(r.bpmMax&&(!t.bpm||t.bpm>r.bpmMax))                         return false;
  if(r.energyMin&&(!t.energy||t.energy<r.energyMin))             return false;
  if(r.genre&&!(t.genre||'').toLowerCase().includes(r.genre.toLowerCase())) return false;
  return true;
}
async function applySmartCrates() {
  const crates=await dbAll('crates');
  for(const c of crates.filter(x=>x.isSmart)) {
    c.trackIds=MS.library.filter(t=>matchRules(t,c.rules)).map(t=>t.id);
    await dbPut('crates',c);
  }
}
async function ensureDefaultCrates() {
  const ex=await dbAll('crates'); if(ex.length) return;
  await dbPut('crates',{id:'sc-energy',name:'High Energy',isSmart:true,rules:{energyMin:7},trackIds:[]});
  await dbPut('crates',{id:'sc-favs',  name:'Favourites', isSmart:true,rules:{favorite:true},trackIds:[]});
}
MS.matchRules=matchRules; MS.applySmartCrates=applySmartCrates;

/* ── Stream engine ── */
function detectStreamType(url) {
  const u=url.toLowerCase().split('?')[0];
  if(/\.mp4$|\.webm$/.test(u))            return 'mp4';
  if(/\.mp3$|\.ogg$|\.wav$|\.m4a$/.test(u))  return 'mp3';
  if(/icecast|shoutcast|stream|\.pls$|\.m3u$/.test(u)) return 'live';
  return 'portal';
}

async function fetchAndBuffer(url) {
  const res=await fetch(url);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

const MP3_RE=/href="([^"]+\.mp3[^"]*)"/gi;
const MP4_RE=/href="([^"]+\.mp4[^"]*)"/gi;

async function extractMediaLinks(url) {
  try {
    const res=await fetch(url,{headers:{'Accept':'text/html,*/*'}});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const html=await res.text();
    const base=new URL(url).origin;
    const links=[]; const seen=new Set();
    const resolve=h=>h.startsWith('http')?h:h.startsWith('//')?'https:'+h:base+'/'+h.replace(/^\//,'');
    let m;
    const r1=new RegExp(MP3_RE.source,'gi');
    const r2=new RegExp(MP4_RE.source,'gi');
    while((m=r1.exec(html))) { const u=resolve(m[1]); if(!seen.has(u)){seen.add(u);links.push({url:u,type:'mp3'});} }
    while((m=r2.exec(html))) { const u=resolve(m[1]); if(!seen.has(u)){seen.add(u);links.push({url:u,type:'mp4'});} }
    return links;
  } catch { return []; }
}

async function saveStreamToLibrary(blob, artist, album, title, genre) {
  const fname=`${sanitize(title)}.${blob.type.includes('video')?'mp4':'mp3'}`;
  if('showDirectoryPicker' in window) {
    const root=MS.folderHandle||await window.showDirectoryPicker({mode:'readwrite'});
    if(!MS.folderHandle) MS.folderHandle=root;
    const artistDir=await root.getDirectoryHandle(sanitize(artist),{create:true});
    const albumDir =await artistDir.getDirectoryHandle(sanitize(album),{create:true});
    const fh=await albumDir.getFileHandle(sanitize(fname),{create:true});
    const wr=await fh.createWritable();
    await wr.write(blob); await wr.close();
    const track={id:`saved_${Date.now()}`,title,artist,album,genre,
      path:`${artist}/${album}/${fname}`,size:blob.size,type:blob.type,
      lastModified:Date.now(),dateImported:Date.now(),source:'saved',
      bpm:null,key:'',energy:null,favorite:false,playCount:0,lastPlayed:null,artwork:null};
    await dbPut('tracks',track);
    await dbPut('handles',{id:track.id,handle:fh,path:track.path});
    MS.library.push(track);
    MS.emit('library:updated',MS.library);
    MS.toast(`Saved: ${fname}`,'ok');
    return track;
  } else {
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=fname; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    MS.toast(`Downloading ${fname}`,'ok');
  }
}

MS.stream={detectType:detectStreamType,fetchAndBuffer,extractMediaLinks,saveStreamToLibrary};

/* ── Boot ── */
async function boot() {
  await openDB();
  MS.library=await dbAll('tracks');
  // Restore saved handles
  const handles=await dbAll('handles');
  handles.forEach(h=>{ const t=MS.library.find(t=>t.id===h.id); if(t&&h.handle) t._fileHandle=h.handle; });
  await ensureDefaultCrates();
  await applySmartCrates();
  // Wire audio elements (created by HTML)
  document.addEventListener('DOMContentLoaded',()=>{
    MS.audio={ A:$('audioA'), B:$('audioB'), main:$('mainAudio') };
    tickWaveheads();
    MS.emit('boot:complete',MS.library);
    console.info(`[868 Vibez] Engine ready — ${MS.library.length} tracks`);
  });
}
boot().catch(e=>{
  console.error('[868 Vibez] Boot failed:',e);
  document.body.innerHTML=`<div style="display:grid;place-items:center;height:100vh;background:#050505;color:#ff4d6d;font:16px sans-serif;padding:20px;text-align:center">Failed to start: ${e.message}</div>`;
});
