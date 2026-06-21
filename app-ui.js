/* ============================================================
   868 VIBEZ — UI Controller
   Five isolated pages. Zero phase panels. Clean.
   ============================================================ */
'use strict';

/* AUDIT FIX (live browser test, found via Playwright):
   engine.js already declares `const $` at global scope (these
   are plain <script> tags, not ES modules, so they all share one
   global scope). Redeclaring `const $` here was a hard SyntaxError
   — not a warning, not a runtime issue, a parse-time failure that
   silently prevented this entire file from executing AT ALL. That
   meant showPage(), the splash-dismissal click handler, and every
   piece of UI wiring in this file never ran. The splash screen on
   index.html would sit on screen forever with no way to dismiss
   it, blocking 100% of app interaction. This was caught only by
   actually loading the app in a real browser — per-file syntax
   checking (node --check) cannot catch cross-file global
   redeclaration since each file is independently valid JS. */
const qs = (sel, ctx=document) => ctx.querySelector(sel);
const qsa = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

/* AUDIT FIX: removed duplicate esc()/fmt() — engine.js already
   declares both as globals (identical implementations), and a
   second `function esc/fmt` declaration here is a fatal
   SyntaxError under shared global scope, exactly like the `$`
   collision found in live browser testing. All existing call
   sites below continue to work unchanged since they now resolve
   to engine.js's versions, which are byte-for-byte identical. */

/* ══ Page navigation ══ */
const PAGES = ['stream','player','video','library','dj'];
let currentPage = 'stream';

function showPage(name) {
  currentPage = name;
  qsa('.page').forEach(p => p.classList.toggle('active', p.dataset.page === name));
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  if (name === 'player') refreshPlayerView();
  if (name === 'library') refreshLibrary();
  if (name === 'stream')  refreshStreamSources();
  localStorage.setItem('vz_page', name);
}

qsa('.nav-item').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

/* ══ Sub-tabs ══ */
function bindSubtabs(pageEl) {
  qsa('.subtab', pageEl).forEach(btn => {
    btn.addEventListener('click', () => {
      const bar = btn.closest('.subtab-bar');
      qsa('.subtab', bar).forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.dataset.sub;
      qsa('[data-subview]', pageEl).forEach(v =>
        v.classList.toggle('active', v.dataset.subview === target)
      );
    });
  });
}
qsa('.page').forEach(bindSubtabs);

/* ════════════════════════════════════════════════
   PAGE 1 — STREAM HUB
════════════════════════════════════════════════ */
const PRESEEDED = [
  { name:'ABBA — Dancing Queen',      url:'https://archive.org/download/thebestofdisco/ABBA%20-%20Dancing%20Queen.mp3',           type:'mp3' },
  { name:'Anita Ward — Ring My Bell', url:'https://archive.org/download/thebestofdisco/Anita%20Ward%20-%20Ring%20My%20Bell.mp3',  type:'mp3' },
  { name:'Amii Stewart — Knock On Wood', url:'https://archive.org/download/thebestofdisco/Amii%20Stewart%20-%20Knock%20On%20Wood.mp3', type:'mp3' },
  { name:'Free Broadcast Radio',      url:'https://icecast.walm.org/stream.mp3',              type:'live' },
  { name:'Worldwide Chillout',        url:'http://stream.srg-ssr.ch/m/rsj/mp3_128',           type:'live' },
  { name:'Big Buck Bunny',            url:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',   type:'mp4' },
  { name:'Elephants Dream',           url:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', type:'mp4' },
];

const PORTALS = [
  { name:'Archive.org Audio', icon:'🎵', desc:'Public domain music', url:'https://archive.org/details/audio' },
  { name:'Archive.org Video', icon:'🎬', desc:'Historic films & video', url:'https://archive.org/details/prelinger' },
  { name:'Free Music Archive', icon:'🎸', desc:'Creative Commons music', url:'https://freemusicarchive.org/' },
  { name:'Open Music Archive', icon:'🎶', desc:'Royalty-free music', url:'https://www.openmusicarchive.org/' },
];

let capturedBlob = null, capturedUrl = null, capturedType = null;

function refreshStreamSources() {
  const list = $('sourceList');
  if (!list) return;
  list.innerHTML = PRESEEDED.map((s,i) => `
    <div class="source-item">
      <span class="si-pip pip-${s.type}"></span>
      <div class="si-info">
        <div class="si-name">${s.name}</div>
        <div class="si-meta">${s.type.toUpperCase()}</div>
      </div>
      <div class="si-actions">
        <button class="si-btn" onclick="streamPlay(${i})">▶</button>
        <button class="si-btn a" onclick="streamDeck('A',${i})">A</button>
        <button class="si-btn b" onclick="streamDeck('B',${i})">B</button>
      </div>
    </div>`).join('');

  const grid = $('portalGrid');
  if (!grid) return;
  grid.innerHTML = PORTALS.map(p => `
    <div class="portal-card" onclick="openPortal('${p.url}')">
      <span class="pc-icon">${p.icon}</span>
      <div class="pc-name">${p.name}</div>
      <div class="pc-desc">${p.desc}</div>
    </div>`).join('');
}

function streamPlay(i) {
  const s = PRESEEDED[i];
  if (s.type === 'mp4') {
    loadVideoUrl(s.url, s.name);
    showPage('video');
  } else {
    MS.playStreamMain(s.url);
    updatePlayerUI();
    showPage('player');
  }
}
function streamDeck(deck, i) {
  const s = PRESEEDED[i];
  MS.loadStreamToDeck(deck, s.url, s.type);
}
window.streamPlay = streamPlay;
window.streamDeck = streamDeck;

function openPortal(url) {
  const frame = $('streamFrame');
  const ph    = $('sandboxPh');
  const fab   = $('extractFab');
  if (!frame) return;
  frame.src = url;
  frame.style.display = 'block';
  if (ph)  ph.style.display  = 'none';
  if (fab) fab.style.display = 'block';
  // Show In-App Browser sub-tab
  const browserBtn = qs('[data-sub="browser"]', $('page-stream'));
  browserBtn?.click();
}
window.openPortal = openPortal;

// Address bar
$('streamLoadBtn')?.addEventListener('click', handleStreamUrl);
$('streamUrlInput')?.addEventListener('keydown', e => { if (e.key==='Enter') handleStreamUrl(); });
$('streamUrlInput')?.addEventListener('input', updateUrlBadge);

function updateUrlBadge() {
  const url = $('streamUrlInput')?.value.toLowerCase() || '';
  const badge = $('urlBadge');
  if (!badge) return;
  if (/\.mp4|\.webm/.test(url))             { badge.textContent='MP4'; badge.style.color='var(--mag)'; }
  else if (/\.mp3|\.ogg|\.wav/.test(url))   { badge.textContent='MP3'; badge.style.color='var(--cyan)'; }
  else if (/icecast|shoutcast|stream/.test(url)){ badge.textContent='LIVE'; badge.style.color='var(--red)'; }
  else if (url.startsWith('http'))          { badge.textContent='URL'; badge.style.color='var(--t3)'; }
  else                                      { badge.textContent='—';  badge.style.color='var(--t3)'; }
}

async function handleStreamUrl() {
  const url = $('streamUrlInput')?.value.trim();
  if (!url) { MS.toast('Paste a URL first.','warn'); return; }
  const type = MS.stream.detectType(url);
  if (type === 'mp4') { loadVideoUrl(url); showPage('video'); }
  else if (type === 'mp3' || type === 'live') {
    MS.playStreamMain(url);
    updatePlayerUI();
    showPage('player');
  } else {
    openPortal(url);
    // Try extract
    MS.toast('Scanning for media links…','info');
    const links = await MS.stream.extractMediaLinks(url);
    if (links.length) showExtracted(links);
    else MS.toast('No direct links found. Browse the portal.','warn');
  }
}

$('extractFab')?.addEventListener('click', async () => {
  const url = $('streamUrlInput')?.value.trim() || $('streamFrame')?.src;
  if (!url) return;
  const links = await MS.stream.extractMediaLinks(url);
  if (links.length) showExtracted(links);
  else MS.toast('No MP3/MP4 links found on this page.','warn');
});

function showExtracted(links) {
  const sheet = $('extractedSheet');
  const list  = $('extractedList');
  const count = $('extractedCount');
  if (!sheet||!list) return;
  if (count) count.textContent = `${links.length} link${links.length>1?'s':''} found`;
  list.innerHTML = links.map((l,i) => `
    <div class="es-item">
      <span class="si-pip pip-${l.type}"></span>
      <div class="es-name">${decodeURIComponent(l.url.split('/').pop())}</div>
      <button class="si-btn" onclick="esPlay(${i})">▶</button>
      <button class="si-btn a" onclick="esDeck('A',${i})">A</button>
      <button class="si-btn b" onclick="esDeck('B',${i})">B</button>
      <button class="si-btn" onclick="esCapture(${i})">⬇</button>
    </div>`).join('');
  window._extractedLinks = links;
  sheet.classList.add('open');
}
window.esPlay = (i) => { const l=window._extractedLinks[i]; if(l.type==='mp4'){loadVideoUrl(l.url);showPage('video');}else{MS.playStreamMain(l.url);updatePlayerUI();showPage('player');} };
window.esDeck = (deck,i) => { const l=window._extractedLinks[i]; MS.loadStreamToDeck(deck,l.url,l.type); };
window.esCapture = async (i) => {
  const l = window._extractedLinks[i];
  MS.toast('Buffering…','info');
  try {
    const buf = await MS.stream.fetchAndBuffer(l.url);
    capturedBlob = new Blob([buf],{type:l.type==='mp4'?'video/mp4':'audio/mpeg'});
    capturedUrl  = l.url;
    capturedType = l.type;
    $('extractedSheet')?.classList.remove('open');
    openSaveSheet(decodeURIComponent(l.url.split('/').pop().replace(/\.[^.]+$/,'')));
  } catch(e) { MS.toast(e.message,'error'); }
};
$('extractedClose')?.addEventListener('click', () => $('extractedSheet')?.classList.remove('open'));

function openSaveSheet(title='') {
  const sh=$('saveSheet');
  if(!sh) return;
  if($('saveTitleIn')) $('saveTitleIn').value=title;
  sh.classList.add('open');
}
$('saveCancel')?.addEventListener('click',  () => $('saveSheet')?.classList.remove('open'));
$('saveConfirm')?.addEventListener('click', async () => {
  if(!capturedBlob) return;
  const artist=$('saveArtistIn')?.value||'Unknown Artist';
  const album =$('saveAlbumIn')?.value||'Unknown Album';
  const title =$('saveTitleIn')?.value||'Unknown Track';
  const genre =$('saveGenreIn')?.value||'';
  await MS.stream.saveStreamToLibrary(capturedBlob,artist,album,title,genre);
  $('saveSheet')?.classList.remove('open');
  capturedBlob=null;
});

/* ════════════════════════════════════════════════
   PAGE 2 — AUDIO PLAYER
════════════════════════════════════════════════ */
const GENRES = ['All','Soca','Dancehall','Hip Hop','Afrobeats','Reggaeton','Pop','House','R&B','Slows','Indian','Latin'];
let activeGenre = '';
let isPlaying   = false;
let seekDragging = false;

function renderGenreRail() {
  const rail = $('genreRail');
  if(!rail) return;
  rail.innerHTML = GENRES.map(g =>
    `<button class="genre-chip ${g===('All'&&!activeGenre?'active':activeGenre===g?'active':'')}"
      onclick="setGenre('${g}')">${g}</button>`
  ).join('');
}
window.setGenre = (g) => {
  activeGenre = g==='All'?'':g;
  renderGenreRail();
  renderTrackList();
};

function filteredTracks() {
  const q = ($('trackSearch')?.value||'').toLowerCase();
  return MS.library.filter(t => {
    const matchG = !activeGenre || (t.genre||'').toLowerCase()===activeGenre.toLowerCase();
    const matchQ = !q || [t.title,t.artist,t.genre,t.key,String(t.bpm||'')].join(' ').toLowerCase().includes(q);
    return matchG && matchQ;
  }).sort((a,b) => (a.title||'').localeCompare(b.title||''));
}

function renderTrackList() {
  const list = $('trackList');
  if(!list) return;
  const tracks = filteredTracks();
  if(!tracks.length) {
    list.innerHTML = `<div class="lib-empty"><div class="lib-empty-icon">🎵</div><p>${MS.library.length?'No tracks match.':'Open a folder to import music.'}</p></div>`;
    return;
  }
  const deckKey = MS.deck.A.track?.key || MS.deck.B.track?.key;
  list.innerHTML = tracks.map(t => {
    const tier   = MS.camelot.harmonicTier(deckKey, t.key);
    const playing = MS.selectedTrack?.id === t.id;
    return `<div class="track-row ${playing?'playing':''}" data-track-id="${t.id}" onclick="playTrack('${t.id}')">
      <div class="tr-art">🎵</div>
      <div class="tr-info">
        <div class="tr-title">${esc(t.title)} ${t.favorite?'★':''}</div>
        <div class="tr-sub">${esc(t.artist||'Unknown')} · ${esc(t.genre||'—')}</div>
      </div>
      ${t.bpm?`<span class="tr-badge bpm">${t.bpm}</span>`:''}
      ${t.key?`<span class="tr-badge key ${tier||''}">${t.key}</span>`:''}
    </div>`;
  }).join('');
}
window.playTrack = id => { const t=MS.library.find(t=>t.id===id); if(t){MS.playMain(t);setTimeout(updatePlayerUI,100);} };



function updatePlayerUI() {
  const t = MS.selectedTrack;
  const a = MS.audio?.main;
  if ($('npTitle'))  $('npTitle').textContent  = t?.title  || 'No track loaded';
  if ($('npArtist')) $('npArtist').textContent = t?.artist || (t?.url ? 'Stream' : 'Open your music folder');
  if ($('npBpm') && t?.bpm) { $('npBpm').textContent=`${t.bpm} BPM`; $('npBpm').style.display=''; }
  else if ($('npBpm')) $('npBpm').style.display='none';
  if ($('npKey') && t?.key) { $('npKey').textContent=t.key; $('npKey').style.display=''; }
  else if ($('npKey')) $('npKey').style.display='none';
  if ($('npPlayBtn')) $('npPlayBtn').textContent = a?.paused===false ? '⏸' : '▶';
}

// Transport
$('npPlayBtn')?.addEventListener('click', () => {
  const a = MS.audio?.main;
  if (!a?.src) { MS.openFolder(); return; }
  MS.ensureAudioCtx();
  if (a.paused) { a.play(); isPlaying=true; } else { a.pause(); isPlaying=false; }
  updatePlayerUI();
});
$('npPrevBtn')?.addEventListener('click', () => { MS.playRelative(-1); setTimeout(updatePlayerUI,100); });
$('npNextBtn')?.addEventListener('click', () => { MS.playRelative(1);  setTimeout(updatePlayerUI,100); });

// Seek
$('npSeek')?.addEventListener('mousedown', () => seekDragging=true);
$('npSeek')?.addEventListener('touchstart', () => seekDragging=true, {passive:true});
$('npSeek')?.addEventListener('change', e => {
  const a=MS.audio?.main;
  if(a?.duration) a.currentTime=(+e.target.value/1000)*a.duration;
  seekDragging=false;
});

// EQ presets
const EQ_PRESETS = {
  Flat:     [0,0,0,0,0],
  Bass:     [8,6,2,0,-2],
  Treble:   [-2,0,2,6,8],
  Vocal:    [-4,0,6,4,-2],
  'Hip Hop':[6,4,0,-2,2],
  Pop:      [-2,4,6,4,-2],
  Rock:     [4,2,-2,4,6],
  Classical:[4,2,0,2,4],
};
let eqNodes = [];
function setupEQ() {
  const ctx = MS.ensureAudioCtx();
  if (!ctx || eqNodes.length) return;
  const freqs = [60,250,1000,4000,12000];
  eqNodes = freqs.map(f => {
    const n = ctx.createBiquadFilter();
    n.type='peaking'; n.frequency.value=f; n.Q.value=1; n.gain.value=0;
    return n;
  });
  // Chain: eqNodes[0] → … → limiter
  for(let i=0;i<eqNodes.length-1;i++) eqNodes[i].connect(eqNodes[i+1]);
  // Disconnect gainM from limiter, insert EQ chain between them
  if(MS.gainM&&MS.limiter) {
    try { MS.gainM.disconnect(); } catch{}
    MS.gainM.connect(eqNodes[0]);
    eqNodes[eqNodes.length-1].connect(MS.limiter);
  }
}
function applyEQPreset(name) {
  setupEQ();
  const vals = EQ_PRESETS[name] || [0,0,0,0,0];
  eqNodes.forEach((n,i) => { n.gain.value=vals[i]||0; });
  qsa('.geq-val').forEach((el,i) => { if(el&&vals[i]!==undefined) el.textContent=(vals[i]>0?'+':'')+vals[i]; });
  qsa('.eq-preset-chip').forEach(b => b.classList.toggle('active', b.dataset.preset===name));
  qsa('.geq-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset===name));
}
window.applyEQPreset = applyEQPreset;

// EQ band sliders
qsa('.eq-band-slider').forEach((sl,i) => {
  sl.addEventListener('input', () => {
    setupEQ();
    if(eqNodes[i]) eqNodes[i].gain.value=+sl.value;
    const val=$('.eq-band-val', sl.closest('.eq-band-col'));
    if(val) val.textContent=(sl.value>0?'+':'')+sl.value;
  });
});
qsa('.geq-slider').forEach((sl,i) => {
  sl.addEventListener('input', () => {
    setupEQ();
    if(eqNodes[i]) eqNodes[i].gain.value=+sl.value;
    const val=sl.closest('.geq-band')?.querySelector('.geq-val');
    if(val) val.textContent=(sl.value>0?'+':'')+sl.value;
  });
});

function refreshPlayerView() {
  updatePlayerUI();
  renderGenreRail();
  renderTrackList();
}

/* ════════════════════════════════════════════════
   PAGE 3 — VIDEO PLAYER
════════════════════════════════════════════════ */
const videoEl = $('mainVideoEl');
let hideOverlayTimer;

function loadVideoUrl(url, title='') {
  if (!videoEl) return;
  videoEl.src=url; videoEl.load();
  const ph=$('videoPh');
  if(ph) ph.style.display='none';
  $('voTitle').textContent = title || decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/,''));
  MS.selectedVideoTitle = $('voTitle').textContent;
  // Connect to audio graph
  MS.ensureAudioCtx();
  if(!videoEl._msNode && MS.gainM) MS.connectAudioEl(videoEl, MS.gainM);
  showVideoOverlay();
}
MS.loadVideoUrl = loadVideoUrl;
window.loadVideoUrl = loadVideoUrl;

$('vdlBtn')?.addEventListener('click', () => {
  const url = $('vdlUrlIn')?.value.trim();
  if(!url) { MS.toast('Paste a video URL.','warn'); return; }
  loadVideoUrl(url);
  // Download panel
  $('vdlArtistIn').value=''; $('vdlAlbumIn').value=''; $('vdlTitleIn').value='';
});

$('vdlSaveBtn')?.addEventListener('click', async () => {
  const url=$('vdlUrlIn')?.value.trim();
  if(!url){MS.toast('No URL set.','warn');return;}
  MS.toast('Downloading video…','info');
  try {
    const buf=await MS.stream.fetchAndBuffer(url);
    const blob=new Blob([buf],{type:'video/mp4'});
    capturedBlob=blob; capturedUrl=url; capturedType='mp4';
    openSaveSheet(decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/,'')));
  } catch(e){MS.toast(e.message,'error');}
});

function showVideoOverlay() {
  const ov=$('videoOverlay');
  if(ov) ov.classList.remove('hidden');
  clearTimeout(hideOverlayTimer);
  hideOverlayTimer=setTimeout(()=>{
    if(videoEl&&!videoEl.paused) $('videoOverlay')?.classList.add('hidden');
  },2500);
}

$('videoStage')?.addEventListener('touchstart', showVideoOverlay, {passive:true});
$('videoStage')?.addEventListener('click', showVideoOverlay);

$('voPlayBtn')?.addEventListener('click',()=>{
  if(!videoEl?.src) return;
  MS.ensureAudioCtx();
  if(videoEl.paused) videoEl.play(); else videoEl.pause();
  $('voPlayBtn').textContent = videoEl.paused?'▶':'⏸';
  showVideoOverlay();
});
$('voPrevBtn')?.addEventListener('click',()=>{ if(videoEl) videoEl.currentTime=Math.max(0,videoEl.currentTime-10); showVideoOverlay(); });
$('voNextBtn')?.addEventListener('click',()=>{ if(videoEl) videoEl.currentTime=Math.min(videoEl.duration||0,videoEl.currentTime+10); showVideoOverlay(); });

$('voSeek')?.addEventListener('change',e=>{
  if(videoEl?.duration) videoEl.currentTime=(+e.target.value/1000)*videoEl.duration;
});

videoEl?.addEventListener('timeupdate',()=>{
  if(!videoEl.duration) return;
  const pct=videoEl.currentTime/videoEl.duration;
  if($('voSeek')) $('voSeek').value=Math.round(pct*1000);
  if($('voTimes')) $('voTimes').textContent=`${fmt(videoEl.currentTime)} / ${fmt(videoEl.duration)}`;
});



/* ════════════════════════════════════════════════
   PAGE 4 — LIBRARY
════════════════════════════════════════════════ */
function refreshLibrary() {
  renderFolderView();
  renderPlaylistView();
  renderLibTrackList();
}

function renderFolderView() {
  const el=$('folderView');
  if(!el) return;
  const folders={};
  MS.library.forEach(t=>{
    const parts=(t.path||t.title||'').split('/');
    const folder=parts.length>1?parts[0]:'My Music';
    if(!folders[folder]) folders[folder]={count:0};
    folders[folder].count++;
  });
  const keys=Object.keys(folders);
  if(!keys.length) {
    el.innerHTML=`<div class="lib-empty"><div class="lib-empty-icon">📁</div><p>No music imported yet.</p><button class="vz-btn primary" onclick="MS.openFolder()" style="margin-top:12px">Open Folder</button></div>`;
    return;
  }
  el.innerHTML=`<div class="section-label">Local Folders · ${MS.library.length} tracks</div>`+
    keys.map(f=>`
      <div class="folder-item" onclick="showFolderTracks('${esc(f)}')">
        <span class="folder-icon">📁</span>
        <div class="folder-info">
          <div class="folder-name">${esc(f)}</div>
          <div class="folder-meta">${folders[f].count} songs</div>
        </div>
        <span style="color:var(--t3);font-size:18px">›</span>
      </div>`).join('');
}
window.showFolderTracks = folder => {
  const tracks=MS.library.filter(t=>(t.path||'').startsWith(folder)||folder==='My Music');
  showTrackSheet(folder, tracks);
};

function renderPlaylistView() {
  const el=$('playlistView');
  if(!el) return;
  el.innerHTML=`
    <div class="new-pl-btn" onclick="createPlaylist()">
      <div class="new-pl-icon">＋</div>
      <div class="pl-info"><div class="pl-name">New Playlist</div><div class="pl-count">Create a custom playlist</div></div>
    </div>
    <div class="section-label">Smart Collections</div>
    <div class="playlist-item">
      <div class="pl-art">★</div>
      <div class="pl-info"><div class="pl-name">Favourites</div><div class="pl-count">${MS.library.filter(t=>t.favorite).length} songs</div></div>
    </div>
    <div class="playlist-item">
      <div class="pl-art">🕐</div>
      <div class="pl-info"><div class="pl-name">Recently Played</div><div class="pl-count">${MS.library.filter(t=>t.lastPlayed).length} songs</div></div>
    </div>`;
}

function renderLibTrackList() {
  const el=$('libTrackList');
  if(!el) return;
  const q=($('libSearch')?.value||'').toLowerCase();
  const tracks=MS.library.filter(t=>!q||[t.title,t.artist,t.genre].join(' ').toLowerCase().includes(q));
  if(!tracks.length){el.innerHTML=`<div class="lib-empty"><div class="lib-empty-icon">🎵</div><p>No tracks yet.</p></div>`;return;}
  el.innerHTML=tracks.slice(0,200).map(t=>`
    <div class="track-row" data-track-id="${t.id}" onclick="playTrack('${t.id}')">
      <div class="tr-art">🎵</div>
      <div class="tr-info">
        <div class="tr-title">${esc(t.title)} ${t.favorite?'★':''}</div>
        <div class="tr-sub">${esc(t.artist||'Unknown')} · ${esc(t.genre||'—')}</div>
      </div>
      ${t.bpm?`<span class="tr-badge bpm">${t.bpm}</span>`:''}
    </div>`).join('');
}

$('libSearch')?.addEventListener('input', renderLibTrackList);
$('libOpenFolder')?.addEventListener('click', async ()=>{ await MS.openFolder(); refreshLibrary(); });

function showTrackSheet(title, tracks) {
  // Reuse extracted sheet as a generic list
  const sheet=$('extractedSheet');
  const list=$('extractedList');
  const count=$('extractedCount');
  if(!sheet||!list) return;
  if(count) count.textContent = `${title} · ${tracks.length} tracks`;
  list.innerHTML=tracks.map(t=>`
    <div class="es-item" style="cursor:pointer" onclick="playTrack('${t.id}')">
      <span class="si-pip pip-mp3"></span>
      <div class="es-name">${esc(t.title)}</div>
      <button class="si-btn a" onclick="event.stopPropagation();MS.loadDeck('A',MS.library.find(x=>x.id==='${t.id}'))">A</button>
      <button class="si-btn b" onclick="event.stopPropagation();MS.loadDeck('B',MS.library.find(x=>x.id==='${t.id}'))">B</button>
    </div>`).join('');
  sheet.classList.add('open');
}
window.createPlaylist = () => MS.toast('Playlist creation coming soon.','info');

/* ════════════════════════════════════════════════
   PAGE 5 — DJ CONSOLE
════════════════════════════════════════════════ */
// Sub-tabs
qsa('.dj-stab').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('.dj-stab').forEach(b => b.classList.toggle('active', b===btn));
    const t=btn.dataset.djsub;
    $('twinDecksView')?.classList.toggle('active', t==='decks');
    $('fxPadView')?.classList.toggle('active',     t==='fx');
    $('geqView')?.classList.toggle('active',        t==='eq');
  });
});

// Deck controls
['A','B'].forEach(d => {
  $(`dj${d}Load`)?.addEventListener('click', () => {
    if(MS.selectedTrack) MS.loadDeck(d, MS.selectedTrack);
    else MS.toast('Select a track in the library first.','warn');
  });
  $(`dj${d}Play`)?.addEventListener('click', () => {
    MS.toggleDeck(d);
    setTimeout(updateDeckUI,100);
  });
  $(`dj${d}Cue`)?.addEventListener('click', () => MS.saveCue(d));
  $(`dj${d}Sync`)?.addEventListener('click', () => MS.syncDeck(d));
  $(`pitch${d}`)?.addEventListener('input', e => {
    const st=+e.target.value;
    const lbl=$(`pitch${d}Val`);
    if(lbl) lbl.textContent=(st>=0?'+':'')+st.toFixed(1);
    const audio=d==='A'?MS.audio.A:MS.audio.B;
    if(audio) audio.playbackRate=Math.pow(2,st/12);
  });
  // Pad toggle
  $(`dj${d}PadToggle`)?.addEventListener('click', () => {
    const grid=$(`dj${d}PadGrid`);
    if(!grid) return;
    const on=!grid.classList.contains('active');
    grid.classList.toggle('active', on);
    $(`dj${d}PadToggle`).textContent = on ? '◎ Platter' : '⬛ Pads';
  });
});

function updateDeckUI() {
  ['A','B'].forEach(d => {
    const track=MS.deck[d].track;
    const playing=MS.deck[d].playing;
    const nameEl=$(`dj${d}Track`);
    const bpmEl =$(`dj${d}Bpm`);
    const playBtn=$(`dj${d}Play`);
    if(nameEl) nameEl.textContent = track?.title || 'No track loaded';
    if(bpmEl)  bpmEl.textContent  = track?.bpm   ? `${track.bpm} BPM` : '';
    if(playBtn){ playBtn.textContent=playing?'⏸':'▶'; }
    // Harmonic badge
    const tA=MS.deck.A.track, tB=MS.deck.B.track;
    if(tA&&tB) {
      const tier=MS.camelot.harmonicTier(tA.key,tB.key);
      ['A','B'].forEach(x=>{
        const el=$(`dj${x}Harm`);
        if(!el) return;
        if(tier==='perfect')  { el.textContent='⚡ Perfect'; el.style.color='var(--yellow)'; el.style.display=''; }
        else if(tier==='harmonic') { el.textContent='♪ Harmonic'; el.style.color='var(--cyan)'; el.style.display=''; }
        else el.style.display='none';
      });
    }
  });
}
MS.on('deck:loaded',  updateDeckUI);
MS.on('deck:toggle',  updateDeckUI);

// Crossfader
$('djXfader')?.addEventListener('input', e => {
  const v=+e.target.value;
  if(MS.gainA) MS.gainA.gain.value=Math.cos(v*Math.PI/2);
  if(MS.gainB) MS.gainB.gain.value=Math.sin(v*Math.PI/2);
});

// Master gain
$('djMaster')?.addEventListener('input', e => {
  if(MS.gainM) MS.gainM.gain.value=+e.target.value;
});

// Faders
$('djFaderA')?.addEventListener('input', e => { if(MS.gainA) MS.gainA.gain.value=+e.target.value; });
$('djFaderB')?.addEventListener('input', e => { if(MS.gainB) MS.gainB.gain.value=+e.target.value; });

// Platter canvas animation
function animatePlatter(canvas, deck, color) {
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  let angle=0;
  (function draw(){
    // AUDIT FIX (live browser test): when the DJ page isn't the active
    // page, this canvas is hidden via CSS and offsetWidth/offsetHeight
    // are both 0 per the DOM spec for any display:none ancestor. That
    // made r = W/2-2 evaluate to a NEGATIVE radius on every single page
    // load (the app always starts on the Stream page), and ctx.arc()
    // throws on a negative radius. That throw happened INSIDE this IIFE
    // with nothing to catch it, which meant requestAnimationFrame(draw)
    // at the bottom never got scheduled — the entire platter animation
    // silently died forever after one failed frame, on every load,
    // even after later navigating to the DJ page and pressing play.
    // Fix: skip the frame entirely (just reschedule) whenever the
    // canvas has no real size yet, rather than attempting to draw.
    const offsetW = canvas.offsetWidth, offsetH = canvas.offsetHeight;
    if (offsetW <= 0 || offsetH <= 0) {
      requestAnimationFrame(draw);
      return;
    }
    const W=canvas.width=offsetW*devicePixelRatio;
    const H=canvas.height=offsetH*devicePixelRatio;
    const cx=W/2, cy=H/2, r=W/2-2;
    ctx.clearRect(0,0,W,H);
    const playing=MS.deck[deck].playing;
    if(playing) angle+=0.018;
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(angle);
    // Rings
    for(let i=2;i<=10;i++){
      ctx.beginPath(); ctx.arc(0,0,r*(i/11),0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,255,255,${i%2===0?.08:.04})`; ctx.lineWidth=1; ctx.stroke();
    }
    // Spokes
    for(let i=0;i<4;i++){
      const a=(i/4)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(r*.2*Math.cos(a),r*.2*Math.sin(a)); ctx.lineTo(r*.85*Math.cos(a),r*.85*Math.sin(a));
      ctx.strokeStyle='rgba(255,255,255,.04)'; ctx.lineWidth=12; ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1.5; ctx.stroke();
    }
    ctx.restore();
    // Glow ring
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle=playing?`${color}50`:'rgba(255,255,255,.06)'; ctx.lineWidth=2; ctx.stroke();
    // Hub
    const hub=ctx.createRadialGradient(cx,cy,0,cx,cy,r*.18);
    hub.addColorStop(0,'#fff'); hub.addColorStop(.4,color+'80'); hub.addColorStop(1,'#1a1a1a');
    ctx.beginPath(); ctx.arc(cx,cy,r*.18,0,Math.PI*2); ctx.fillStyle=hub; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r*.04,0,Math.PI*2); ctx.fillStyle='#050505'; ctx.fill();
    requestAnimationFrame(draw);
  })();
}
animatePlatter($('platterA'),'A','#00e5ff');
animatePlatter($('platterB'),'B','#f0007a');

// Hot cue pads
const PAD_COLORS=['#e81010','#f97316','#22c55e','#0099ff','#8b5cf6','#f0007a','#fbbf24','#00e676'];
['A','B'].forEach(d=>{
  const grid=$(`dj${d}PadGrid`);
  if(!grid) return;
  for(let i=0;i<8;i++){
    const btn=document.createElement('button');
    btn.className='dd-pad';
    btn.style.background=PAD_COLORS[i];
    btn.textContent=`H${i+1}`;
    btn.onclick=async()=>{
      const cues=await MS.getCues(d);
      const audio=d==='A'?MS.audio.A:MS.audio.B;
      if(cues[i]&&audio) { audio.currentTime=cues[i].time; return; }
      await MS.saveCue(d);
      btn.textContent=fmt((d==='A'?MS.audio.A:MS.audio.B)?.currentTime||0);
    };
    grid.appendChild(btn);
  }
});

// FX X/Y pad
const fxPad=$('fxXYPad');
const fxDot=$('fxDot');
let fxActive=false;
let currentFX={reverb:null,delay:null};

function setupFXNodes() {
  const ctx=MS.ensureAudioCtx();
  if(!ctx||currentFX.delay) return;
  currentFX.delay=ctx.createDelay(2.0);
  currentFX.delay.delayTime.value=0;
  if(MS.gainM) { MS.gainM.connect(currentFX.delay); currentFX.delay.connect(ctx.destination); }
}

function moveFxDot(x,y,rect) {
  const px=Math.max(12,Math.min(rect.width-12,x));
  const py=Math.max(12,Math.min(rect.height-12,y));
  if(fxDot) { fxDot.style.left=px+'px'; fxDot.style.top=py+'px'; }
  const normX=px/rect.width, normY=py/rect.height;
  setupFXNodes();
  if(currentFX.delay) currentFX.delay.delayTime.value=normX*0.6;
}

fxPad?.addEventListener('touchstart', e=>{ fxActive=true; const r=fxPad.getBoundingClientRect(); moveFxDot(e.touches[0].clientX-r.left,e.touches[0].clientY-r.top,r); e.preventDefault(); },{passive:false});
fxPad?.addEventListener('touchmove',  e=>{ if(!fxActive) return; const r=fxPad.getBoundingClientRect(); moveFxDot(e.touches[0].clientX-r.left,e.touches[0].clientY-r.top,r); e.preventDefault(); },{passive:false});
fxPad?.addEventListener('touchend',   ()=>fxActive=false);
fxPad?.addEventListener('mousedown',  e=>{ fxActive=true; const r=fxPad.getBoundingClientRect(); moveFxDot(e.clientX-r.left,e.clientY-r.top,r); });
fxPad?.addEventListener('mousemove',  e=>{ if(!fxActive) return; const r=fxPad.getBoundingClientRect(); moveFxDot(e.clientX-r.left,e.clientY-r.top,r); });
fxPad?.addEventListener('mouseup',    ()=>fxActive=false);

// VU meters
setInterval(()=>{
  const a=MS.audio;
  if(!a) return;
  const playing=(!a.A?.paused||!a.B?.paused||!a.main?.paused);
  const level=playing?(0.3+Math.sin(Date.now()/120)*.15+Math.random()*.1):0.03;
  if($('meterL')) $('meterL').style.height=(level*100)+'%';
  if($('meterR')) $('meterR').style.height=(level*(0.9+Math.random()*.12)*100)+'%';
},80);

/* ══ Main ticker ══ */
setInterval(()=>{
  const a=MS.audio?.main;
  if(!a||!a.duration||seekDragging) return;
  const pct=a.currentTime/a.duration;
  if($('npSeek'))  $('npSeek').value=Math.round(pct*1000);
  if($('npNow'))   $('npNow').textContent=fmt(a.currentTime);
  if($('npDur'))   $('npDur').textContent=fmt(a.duration);
  if($('npPlayBtn')) $('npPlayBtn').textContent=a.paused?'▶':'⏸';
},250);

/* ══ Splash ══ */
function initSplash() {
  const splash=$('splash');
  if(!splash) return;
  // Animate turntable canvas
  const canvas=$('splashCanvas');
  if(canvas) {
    const ctx2=canvas.getContext('2d');
    let ang=0;
    (function loop(){
      if(splash.classList.contains('out')) return;
      // AUDIT FIX: same class of bug as the platter animation — guard
      // against a zero-size canvas before computing radii, AND wrap the
      // whole frame in try/catch so that if anything here ever throws,
      // it cannot silently prevent the click-to-dismiss handler below
      // from being registered (this was the actual root cause of the
      // splash screen being permanently unskippable in live testing).
      try {
        const offsetW = canvas.offsetWidth, offsetH = canvas.offsetHeight;
        if (offsetW <= 0 || offsetH <= 0) { requestAnimationFrame(loop); return; }
        const W=canvas.width=offsetW; const H=canvas.height=offsetH;
        ctx2.clearRect(0,0,W,H);
      // Ambient glows
      const drawGlow=(x,y,r,col,a)=>{
        const g=ctx2.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,col.replace(')',`,${a})`).replace('rgb(','rgba('));
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx2.fillStyle=g; ctx2.beginPath(); ctx2.arc(x,y,r,0,Math.PI*2); ctx2.fill();
      };
      drawGlow(W*.2, H*.3, W*.5, 'rgba(232,16,16,1)', 0.12);
      drawGlow(W*.8, H*.3, W*.5, 'rgba(0,153,255,1)', 0.10);
      drawGlow(W*.5, H*.8, W*.4, 'rgba(0,230,118,1)', 0.07);
      // Waveform bars
      for(let i=0;i<32;i++){
        const hL=0.15+Math.abs(Math.sin(ang*1.2+i*.25))*0.35;
        const hR=0.15+Math.abs(Math.sin(ang*.9+i*.3))*0.3;
        ctx2.fillStyle=`rgba(232,16,16,${0.15+hL*.2})`;
        ctx2.fillRect(i*(W/32),H*(1-hL),W/32-1,H*hL);
        ctx2.fillStyle=`rgba(0,230,118,${0.15+hR*.2})`;
        ctx2.fillRect(W-((i+1)*(W/32)),H*(1-hR),W/32-1,H*hR);
      }
      ang+=0.015;
      } catch(e) { console.warn('[Splash] animation frame error (non-fatal):', e.message); }
      requestAnimationFrame(loop);
    })();
  }
  splash.addEventListener('click',()=>{
    splash.classList.add('out');
    setTimeout(()=>splash.remove(),600);
  });
  setTimeout(()=>splash.classList.add('out'),5000);
  setTimeout(()=>splash.remove(),5600);
}

/* ══ Boot ══ */
document.addEventListener('DOMContentLoaded',()=>{
  initSplash();
  // Restore page
  const saved=localStorage.getItem('vz_page')||'stream';
  showPage(saved);
  // Library events
  MS.on('library:updated',()=>{
    renderTrackList();
    refreshLibrary();
    MS.toast(`Library: ${MS.library.length} tracks`,'ok');
  });
  MS.on('player:play', updatePlayerUI);
  // Player track search
  $('trackSearch')?.addEventListener('input', renderTrackList);
  renderGenreRail();
  renderTrackList();
  console.info('[868 Vibez] UI ready');
});
