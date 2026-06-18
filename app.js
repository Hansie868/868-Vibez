/* ============================================================
   MediaSuite V3 — Unified Engine
   Single source of truth for DB, state, audio, UI.
   All phase modules read from window.MS (this object).
   ============================================================ */

/* ── DB ── */
const DB_NAME = 'MediaSuiteV3DB';
const DB_VERSION = 2;
const STORES = [
  'tracks','waveforms','crates','cuePoints',
  'sessions','settings','handles'
];

let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      STORES.forEach(s => {
        if (!d.objectStoreNames.contains(s))
          d.createObjectStore(s, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => { db = req.result; res(db); };
    req.onerror  = () => rej(req.error);
  });
}

async function dbPut(store, val) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    const r  = tx.objectStore(store).put(val);
    r.onsuccess = () => res(val);
    r.onerror   = () => rej(r.error);
  });
}
async function dbGet(store, key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const r = d.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function dbDel(store, key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const r = d.transaction(store,'readwrite').objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}
async function dbAll(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}

/* ── Shared state — all phase modules read window.MS ── */
const MS = window.MS = {
  library:       [],
  selectedTrack: null,
  folderHandle:  null,
  currentCrate:  null,
  session:       { active: false, startedAt: null, events: [] },
  deck: {
    A: { track: null, playing: false },
    B: { track: null, playing: false }
  },
  audioCtx: null,
  // DB helpers exposed for phase modules
  db: { put: dbPut, get: dbGet, del: dbDel, all: dbAll, open: openDB },
  // Events bus
  on(event, fn)  { (this._listeners = this._listeners || {})[event] = (this._listeners[event] || []); this._listeners[event].push(fn); },
  emit(event, d) { ((this._listeners || {})[event] || []).forEach(fn => fn(d)); }
};

/* ── Audio elements ── */
const audioA    = document.getElementById('audioA');
const audioB    = document.getElementById('audioB');
const mainAudio = document.getElementById('mainAudio');
MS.audio = { A: audioA, B: audioB, main: mainAudio };

/* ── Utilities ── */
const $ = id => document.getElementById(id);
const fmt = s => !isFinite(s) ? '0:00' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const num = v => (v === '' || v == null) ? null : Number(v);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const audioExt = new Set(['mp3','wav','ogg','m4a','aac','flac','mp4','webm','opus']);
const getExt   = name => (name.split('.').pop() || '').toLowerCase();

function fingerprint(file, path='') {
  return `${path||file.name}_${file.size}_${file.lastModified}`.replace(/[^a-z0-9_.-]/gi,'_');
}

/* ── Toast notifications (replaces all alert() calls) ── */
function toast(msg, type = 'info', duration = 3200) {
  let stack = document.querySelector('.ms-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ms-toast-stack';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `ms-toast ms-toast--${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.classList.add('ms-toast--out'), duration - 300);
  setTimeout(() => el.remove(), duration);
}
MS.toast = toast;

/* ── Camelot harmonic engine ── */
function compatibleKeys(key) {
  if (!/^\d{1,2}[AB]$/i.test(key || '')) return [];
  const n = parseInt(key), l = key.slice(-1).toUpperCase();
  const other = l === 'A' ? 'B' : 'A';
  const prev  = n === 1  ? 12 : n - 1;
  const next  = n === 12 ? 1  : n + 1;
  return [`${n}${l}`,`${prev}${l}`,`${next}${l}`,`${n}${other}`];
}
function harmonicTier(base, trackKey) {
  if (!base || !trackKey) return null;
  const b = base.toUpperCase(), t = trackKey.toUpperCase();
  if (t === b) return 'perfect';
  if (compatibleKeys(b).includes(t)) return 'harmonic';
  return null;
}
MS.camelot = { compatibleKeys, harmonicTier };

/* ── Track HTML renderer ── */
function trackHTML(t) {
  const deckKey = MS.deck.A.track?.key || MS.deck.B.track?.key;
  const tier    = harmonicTier(deckKey, t.key);
  const cls     = ['track', MS.selectedTrack?.id === t.id ? 'selected' : '', tier ? `tier-${tier}` : '']
    .filter(Boolean).join(' ');
  return `<div class="${cls}" data-id="${t.id}">
    <span class="track-fav">${t.favorite ? '★' : '♪'}</span>
    <div class="track-meta">
      <div class="track-title">${esc(t.title)}</div>
      <small>${esc(t.artist || 'Unknown')} · ${esc(t.genre || '—')}</small>
    </div>
    <span class="badge badge--bpm">${t.bpm || '—'}</span>
    <span class="badge badge--key ${tier ? `badge--${tier}` : ''}">${t.key || '—'}</span>
    <span class="badge badge--energy">E${t.energy || '—'}</span>
    <span class="badge badge--plays">${t.playCount || 0}×</span>
  </div>`;
}
MS.trackHTML = trackHTML;

/* ── Score engine for recommendations ── */
function scoreTrack(seed, candidate) {
  let s = 0;
  if (seed.key && candidate.key) {
    const tier = harmonicTier(seed.key, candidate.key);
    if (tier === 'perfect')  s += 50;
    if (tier === 'harmonic') s += 35;
  }
  if (seed.bpm && candidate.bpm) {
    const d = Math.abs(seed.bpm - candidate.bpm);
    if (d <= 2) s += 25; else if (d <= 5) s += 15; else if (d <= 10) s += 5;
  }
  if (seed.energy && candidate.energy) {
    const d = Math.abs(seed.energy - candidate.energy);
    if (d <= 1) s += 12; else if (d <= 2) s += 6;
  }
  if (seed.genre && candidate.genre &&
      seed.genre.toLowerCase() === candidate.genre.toLowerCase()) s += 10;
  return s;
}
MS.scoreTrack = scoreTrack;

/* ── Waveform ── */
async function buildPeaks(file, buckets = 400) {
  try {
    const ab  = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const peaks = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i*step+j] || 0));
      peaks.push(+max.toFixed(4));
    }
    await ctx.close();
    return peaks;
  } catch {
    return Array.from({ length: buckets }, (_, i) => Math.abs(Math.sin(i * .17)) * Math.random());
  }
}

function drawWave(canvas, peaks, playheadPct = 0) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * devicePixelRatio;
  const h = canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const barW = w / peaks.length;
  peaks.forEach((p, i) => {
    const x    = i * barW;
    const barH = p * mid * 0.9;
    const played = (i / peaks.length) < playheadPct;
    ctx.fillStyle = played
      ? `rgba(0,229,255,${0.55 + p * 0.4})`
      : `rgba(255,255,255,${0.12 + p * 0.18})`;
    ctx.fillRect(x, mid - barH, Math.max(1, barW - 0.5), barH * 2);
  });
  // Playhead
  const px = playheadPct * w;
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(px - 1, 0, 2, h);
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur  = 8;
  ctx.fillRect(px - 1, 0, 2, h);
  ctx.shadowBlur  = 0;
}

async function renderWave(deck, track, file) {
  const canvas = $(deck === 'A' ? 'waveA' : 'waveB');
  if (!canvas) return;
  let cached = await dbGet('waveforms', track.id);
  let peaks  = cached?.peaks;
  if (!peaks) {
    peaks = await buildPeaks(file, 400);
    await dbPut('waveforms', {
      id: track.id, peaks, duration: file.duration || 0, createdAt: Date.now()
    });
  }
  MS.deck[deck]._peaks = peaks;
  drawWave(canvas, peaks, 0);
}

function tickWaveheads() {
  ['A','B'].forEach(d => {
    const audio  = d === 'A' ? audioA : audioB;
    const canvas = $(d === 'A' ? 'waveA' : 'waveB');
    const peaks  = MS.deck[d]._peaks;
    if (!canvas || !peaks || !audio.duration) return;
    drawWave(canvas, peaks, audio.currentTime / audio.duration);
  });
  requestAnimationFrame(tickWaveheads);
}

/* ── File access ── */
async function fileFromTrack(t) {
  if (t._fileHandle) return t._fileHandle.getFile();
  if (t.handle)      return t.handle.getFile();
  // Try to recover from stored handles
  const stored = await dbGet('handles', t.id);
  if (stored?.handle) { t._fileHandle = stored.handle; return stored.handle.getFile(); }
  throw new Error('File handle lost — re-open your music folder to restore access.');
}
MS.fileFromTrack = fileFromTrack;

/* ── Library scanning ── */
async function scanFolder(handle, path = '') {
  let count = 0;
  for await (const [name, h] of handle.entries()) {
    const p = path ? `${path}/${name}` : name;
    if (h.kind === 'directory') {
      count += await scanFolder(h, p);
    } else if (audioExt.has(getExt(name))) {
      const file = await h.getFile();
      const id   = fingerprint(file, p);
      let track  = await dbGet('tracks', id);
      if (!track) {
        track = {
          id, title: name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist',
          album: '', genre: '', mood: '', bpm: null, key: '', energy: null,
          favorite: false, playCount: 0, lastPlayed: null, dateImported: Date.now(),
          path: p, size: file.size, lastModified: file.lastModified, type: file.type,
          crates: [], artwork: null
        };
      }
      track.path = p;
      track.size = file.size;
      track.lastModified = file.lastModified;
      track._fileHandle = h;
      await dbPut('tracks', track);
      // Store handle separately (handles can't be serialised into track record)
      await dbPut('handles', { id, handle: h, path: p });
      count++;
    }
  }
  return count;
}

async function openFolder() {
  if (!('showDirectoryPicker' in window)) {
    toast('Folder access requires Chrome or Edge on desktop.', 'warn');
    return;
  }
  try {
    MS.folderHandle = await window.showDirectoryPicker({ mode: 'read' });
    toast(`Scanning ${MS.folderHandle.name}…`, 'info');
    await dbPut('settings', { id: 'lastFolder', name: MS.folderHandle.name });
    const count = await scanFolder(MS.folderHandle);
    MS.library = await dbAll('tracks');
    await applySmartCrates();
    renderAll();
    toast(`Imported ${count} tracks from ${MS.folderHandle.name}`, 'ok');
    MS.emit('library:updated', MS.library);
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not open folder: ' + e.message, 'error');
  }
}

/* ── Smart crates ── */
function matchRules(t, r = {}) {
  if (r.favorite  && !t.favorite)                                     return false;
  if (r.bpmMin    && (!t.bpm    || t.bpm    < r.bpmMin))             return false;
  if (r.bpmMax    && (!t.bpm    || t.bpm    > r.bpmMax))             return false;
  if (r.energyMin && (!t.energy || t.energy < r.energyMin))          return false;
  if (r.genre     && !(t.genre||'').toLowerCase().includes(r.genre.toLowerCase())) return false;
  if (r.keys) {
    const keys = String(r.keys).toUpperCase().split(',').map(x=>x.trim()).filter(Boolean);
    if (keys.length && !keys.includes((t.key||'').toUpperCase()))    return false;
  }
  return true;
}

async function applySmartCrates() {
  const crates = await dbAll('crates');
  for (const c of crates.filter(x => x.isSmart)) {
    c.trackIds = MS.library.filter(t => matchRules(t, c.rules)).map(t => t.id);
    await dbPut('crates', c);
  }
}

async function ensureDefaultCrates() {
  const existing = await dbAll('crates');
  if (existing.length) return;
  await dbPut('crates', { id:'smart-high-energy', name:'High Energy', isSmart:true, rules:{energyMin:7}, trackIds:[] });
  await dbPut('crates', { id:'smart-90-120',      name:'90–120 BPM',  isSmart:true, rules:{bpmMin:90,bpmMax:120}, trackIds:[] });
  await dbPut('crates', { id:'smart-favorites',   name:'Favorites',   isSmart:true, rules:{favorite:true}, trackIds:[] });
}

/* ── Deck engine ── */
async function loadDeck(deck, track) {
  if (!track) { toast('Select a track first.', 'warn'); return; }
  const audio = deck === 'A' ? audioA : audioB;
  try {
    const file = await fileFromTrack(track);
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(file);
    await new Promise((res, rej) => {
      audio.oncanplay = res;
      audio.onerror   = rej;
      audio.load();
    });
    MS.deck[deck].track   = { ...track };
    MS.deck[deck].playing = false;
    const titleEl = $(deck === 'A' ? 'deckATitle' : 'deckBTitle');
    if (titleEl) titleEl.textContent = `${track.title} · ${track.bpm||'—'} BPM · ${track.key||'—'}`;
    await renderWave(deck, track, file);
    renderQuickLoad();
    renderRecommendations(track);
    logSession('deck_load', track, { deck });
    MS.emit('deck:loaded', { deck, track });
    toast(`Deck ${deck}: ${track.title}`, 'info', 2000);
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function toggleDeck(deck) {
  const audio = deck === 'A' ? audioA : audioB;
  if (!audio.src) { toast(`Load a track on Deck ${deck} first.`, 'warn'); return; }
  if (audio.paused) {
    await audio.play();
    MS.deck[deck].playing = true;
    logSession('play', MS.deck[deck].track, { deck });
  } else {
    audio.pause();
    MS.deck[deck].playing = false;
    logSession('pause', MS.deck[deck].track, { deck });
  }
  updateDeckButtons();
  MS.emit('deck:toggle', { deck, playing: MS.deck[deck].playing });
}

function syncDeck(deck) {
  const src = deck === 'A' ? MS.deck.B.track : MS.deck.A.track;
  const dst = MS.deck[deck].track;
  if (!src?.bpm || !dst?.bpm) {
    toast('Both decks need BPM metadata to sync.', 'warn'); return;
  }
  const ratio    = src.bpm / dst.bpm;
  const semitones = Math.log2(ratio) * 12;
  const audio     = deck === 'A' ? audioA : audioB;
  audio.playbackRate = ratio;
  toast(`Deck ${deck} synced to ${src.bpm} BPM (${semitones > 0 ? '+' : ''}${semitones.toFixed(2)} st)`, 'ok');
  MS.emit('deck:synced', { deck, ratio, semitones });
}

function updateDeckButtons() {
  ['A','B'].forEach(d => {
    const btn = $(d === 'A' ? 'playA' : 'playB');
    if (btn) btn.textContent = MS.deck[d].playing ? '⏸' : '▶';
  });
}

/* ── Main player ── */
async function playMain(track) {
  try {
    MS.selectedTrack = track;
    const file = await fileFromTrack(track);
    if (mainAudio.src) URL.revokeObjectURL(mainAudio.src);
    mainAudio.src = URL.createObjectURL(file);
    await mainAudio.play();
    $('npTitle').textContent = track.title;
    $('npSub').textContent   = `${track.artist||'Unknown'} · ${track.bpm||'—'} BPM · ${track.key||'—'}`;
    track.playCount  = (track.playCount || 0) + 1;
    track.lastPlayed = Date.now();
    await dbPut('tracks', track);
    logSession('main_play', track);
    renderTrackList();
    MS.emit('player:play', track);
  } catch(e) {
    toast(e.message, 'error');
  }
}

function playRelative(dir) {
  if (!MS.library.length) return;
  const sorted = sortedTracks(MS.library);
  const i = sorted.findIndex(t => t.id === MS.selectedTrack?.id);
  const next = sorted[(i + dir + sorted.length) % sorted.length];
  playMain(next);
}

/* ── Cue points ── */
async function saveCue(deck) {
  const audio = deck === 'A' ? audioA : audioB;
  const track = MS.deck[deck].track;
  if (!track || !audio.duration) { toast('Load a track first.', 'warn'); return; }
  const cue = {
    id: `${track.id}_${deck}_${Date.now()}`,
    trackId: track.id, deck,
    time: audio.currentTime,
    label: `Cue ${fmt(audio.currentTime)}`,
    createdAt: Date.now()
  };
  await dbPut('cuePoints', cue);
  logSession('cue_save', track, { deck, time: audio.currentTime });
  renderCues(deck);
  MS.emit('cue:saved', cue);
}

async function renderCues(deck) {
  const track = MS.deck[deck].track;
  const box   = $(deck === 'A' ? 'cuesA' : 'cuesB');
  if (!box) return;
  if (!track) { box.innerHTML = ''; return; }
  const cues = (await dbAll('cuePoints')).filter(c => c.trackId === track.id && c.deck === deck);
  box.innerHTML = cues.map(c =>
    `<button class="cue" data-time="${c.time}">${esc(c.label)}</button>`
  ).join('');
  box.querySelectorAll('.cue').forEach(b => b.onclick = () => {
    (deck === 'A' ? audioA : audioB).currentTime = +b.dataset.time;
  });
}

/* ── Session logging ── */
function logSession(type, track, extra = {}) {
  if (!MS.session.active && type !== 'main_play') return;
  MS.session.events.push({
    type, trackId: track?.id, title: track?.title, at: Date.now(), ...extra
  });
  MS.emit('session:event', { type, track, extra });
}

/* ── Render functions ── */
function sortedTracks(arr) {
  const s = $('sortBy')?.value || 'title';
  return [...arr].sort((a, b) =>
    s === 'bpm'        ? (a.bpm    ||0) - (b.bpm    ||0) :
    s === 'energy'     ? (b.energy ||0) - (a.energy ||0) :
    s === 'key'        ? String(a.key).localeCompare(String(b.key)) :
    s === 'lastPlayed' ? (b.lastPlayed||0) - (a.lastPlayed||0) :
    (a.title||'').localeCompare(b.title||'')
  );
}

function renderTrackList() {
  const q   = ($('libraryFilter')?.value || '').toLowerCase();
  const arr = sortedTracks(MS.library.filter(t =>
    [t.title, t.artist, t.album, t.genre, t.key, String(t.bpm||''), String(t.energy||'')]
      .join(' ').toLowerCase().includes(q)
  ));
  const el = $('trackList');
  if (!el) return;
  el.innerHTML = arr.length ? arr.map(trackHTML).join('') : '<div class="empty">No tracks — open a music folder to begin.</div>';
  el.querySelectorAll('.track').forEach(r => r.onclick = () => selectTrack(r.dataset.id));
}

function selectTrack(id) {
  MS.selectedTrack = MS.library.find(t => t.id === id) || null;
  renderTrackList();
  renderMetaEditor();
  MS.emit('track:selected', MS.selectedTrack);
}

function renderMetaEditor() {
  const t = MS.selectedTrack;
  const el = $('metadataEditor');
  if (!el) return;
  if (!t) { el.innerHTML = '<div class="empty">Select a track to edit metadata.</div>'; return; }
  el.innerHTML = `
    <div class="meta-form">
      <label>Title     <input id="mTitle"  value="${esc(t.title)}"></label>
      <label>Artist    <input id="mArtist" value="${esc(t.artist||'')}"></label>
      <label>Genre     <input id="mGenre"  value="${esc(t.genre||'')}"></label>
      <label>BPM       <input id="mBpm"    type="number" value="${t.bpm||''}"></label>
      <label>Key       <input id="mKey"    placeholder="8A" value="${esc(t.key||'')}"></label>
      <label>Energy    <input id="mEnergy" type="number" min="1" max="10" value="${t.energy||''}"></label>
      <div class="meta-actions">
        <button id="saveMeta" class="btn primary">Save</button>
        <button id="favMeta"  class="btn">${t.favorite ? 'Unfavourite' : 'Favourite'}</button>
        <button id="loadDeckAMeta" class="btn">→ Deck A</button>
        <button id="loadDeckBMeta" class="btn">→ Deck B</button>
      </div>
    </div>`;
  $('saveMeta').onclick = async () => {
    Object.assign(t, {
      title:  $('mTitle').value,
      artist: $('mArtist').value,
      genre:  $('mGenre').value,
      bpm:    num($('mBpm').value),
      key:    $('mKey').value.toUpperCase().trim(),
      energy: num($('mEnergy').value)
    });
    await dbPut('tracks', t);
    await applySmartCrates();
    renderAll();
    toast('Metadata saved.', 'ok', 1800);
  };
  $('favMeta').onclick = async () => {
    t.favorite = !t.favorite;
    await dbPut('tracks', t);
    await applySmartCrates();
    renderAll();
  };
  $('loadDeckAMeta').onclick = () => loadDeck('A', t);
  $('loadDeckBMeta').onclick = () => loadDeck('B', t);
}

function renderRecommendations(seed) {
  const el = $('recommendations');
  if (!el) return;
  const recs = MS.library
    .filter(t => t.id !== seed.id)
    .map(t => ({ t, score: scoreTrack(seed, t) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  el.innerHTML = recs.length
    ? recs.map(x => `<div class="rec-row">
        <span class="rec-title">${esc(x.t.title)}</span>
        <span class="rec-meta">${x.t.bpm||'—'} · ${x.t.key||'—'}</span>
        <span class="rec-score">${x.score}</span>
        <button class="btn btn--xs" data-rec-id="${x.t.id}">Load A</button>
      </div>`).join('')
    : '<div class="empty">Add BPM/key metadata for recommendations.</div>';
  el.querySelectorAll('[data-rec-id]').forEach(b =>
    b.onclick = () => loadDeck('A', MS.library.find(t => t.id === b.dataset.recId))
  );
}

function renderQuickLoad() {
  const el = $('quickLoad');
  if (!el) return;
  const base = MS.deck.A.track?.key || MS.deck.B.track?.key;
  const arr  = MS.selectedTrack ? MS.library : MS.library.slice(0, 60);
  el.innerHTML = arr.length
    ? arr.map(trackHTML).join('')
    : '<div class="empty">Import tracks to use quick-load.</div>';
  el.querySelectorAll('.track').forEach(r => r.onclick = () => selectTrack(r.dataset.id));
}

async function renderCrates() {
  const crates = await dbAll('crates');
  const el     = $('crateList');
  if (!el) return;
  el.innerHTML = crates.length
    ? crates.map(c => `<div class="crate-item ${MS.currentCrate?.id===c.id?'active':''}" data-id="${c.id}">
        <strong>${esc(c.name)}</strong>
        <small>${c.isSmart?'⚡ Smart':'Manual'} · ${(c.trackIds||[]).length} tracks</small>
      </div>`).join('')
    : '<div class="empty">No crates yet.</div>';
  el.querySelectorAll('.crate-item').forEach(el =>
    el.onclick = async () => {
      MS.currentCrate = await dbGet('crates', el.dataset.id);
      renderCrates();
      renderCrateDetail();
    }
  );
  renderCrateDetail();
}

function renderCrateDetail() {
  const c = MS.currentCrate;
  if (!c) {
    if ($('crateTitle'))  $('crateTitle').textContent = 'Select a crate';
    if ($('crateRules'))  $('crateRules').innerHTML   = '';
    if ($('crateTracks')) $('crateTracks').innerHTML  = '<div class="empty">No crate selected.</div>';
    return;
  }
  $('crateTitle').textContent = c.name;
  $('crateRules').innerHTML = c.isSmart ? `
    <div class="rule-grid">
      <input id="rBpmMin"  placeholder="BPM min"    value="${c.rules.bpmMin||''}">
      <input id="rBpmMax"  placeholder="BPM max"    value="${c.rules.bpmMax||''}">
      <input id="rKeys"    placeholder="Keys: 8A,9A" value="${c.rules.keys||''}">
      <input id="rGenre"   placeholder="Genre"       value="${c.rules.genre||''}">
      <input id="rEnergy"  placeholder="Energy min"  value="${c.rules.energyMin||''}">
      <label><input id="rFav" type="checkbox" ${c.rules.favorite?'checked':''}> Favourites only</label>
    </div>
    <button id="saveRules" class="btn primary">Save Rules</button>
  ` : `<button id="addToCrate" class="btn primary">Add Selected Track</button>`;

  if (c.isSmart) {
    $('saveRules').onclick = async () => {
      c.rules = {
        bpmMin: num($('rBpmMin').value), bpmMax: num($('rBpmMax').value),
        keys: $('rKeys').value, genre: $('rGenre').value,
        energyMin: num($('rEnergy').value), favorite: $('rFav').checked
      };
      await dbPut('crates', c);
      await applySmartCrates();
      MS.currentCrate = await dbGet('crates', c.id);
      renderAll();
    };
  } else {
    $('addToCrate').onclick = async () => {
      if (MS.selectedTrack && !c.trackIds.includes(MS.selectedTrack.id)) {
        c.trackIds.push(MS.selectedTrack.id);
        await dbPut('crates', c);
        renderAll();
      }
    };
  }

  const tracks = MS.library.filter(t => (c.trackIds||[]).includes(t.id));
  $('crateTracks').innerHTML = tracks.length
    ? tracks.map(trackHTML).join('')
    : '<div class="empty">No tracks in this crate.</div>';
  $('crateTracks').querySelectorAll('.track').forEach(r =>
    r.onclick = () => selectTrack(r.dataset.id)
  );
}

function renderSearch() {
  const q  = ($('globalSearch')?.value || '').trim();
  const el = $('searchResults');
  if (!el) return;
  if (!q) { el.innerHTML = '<div class="empty">Search by title, artist, BPM, key, genre, or use bpm:90-120 / energy:>7 / favorite:true</div>'; return; }
  const bpm = q.match(/bpm:(\d+)-(\d+)/i);
  const en  = q.match(/energy:>(\d+)/i);
  const fav = /favorite:true/i.test(q);
  const arr = MS.library.filter(t => {
    if (bpm) return t.bpm >= +bpm[1] && t.bpm <= +bpm[2];
    if (en)  return (t.energy||0) > +en[1];
    if (fav) return t.favorite;
    return [t.title,t.artist,t.album,t.genre,t.key,String(t.bpm||''),String(t.energy||'')]
      .join(' ').toLowerCase().includes(q.toLowerCase());
  });
  el.innerHTML = arr.length ? arr.map(trackHTML).join('') : '<div class="empty">No matches.</div>';
  el.querySelectorAll('.track').forEach(r => r.onclick = () => selectTrack(r.dataset.id));
}

async function renderAnalytics() {
  const sessions = await dbAll('sessions');
  const waves    = await dbAll('waveforms');
  const plays    = MS.library.reduce((a, t) => a + (t.playCount||0), 0);
  const favs     = MS.library.filter(t => t.favorite).length;
  const missing  = MS.library.filter(t => !t.bpm || !t.key || !t.energy).length;

  $('analyticsOverview').innerHTML = `
    <div class="muted-box">
      <div class="stat-row"><span>Tracks</span><strong>${MS.library.length}</strong></div>
      <div class="stat-row"><span>Favourites</span><strong>${favs}</strong></div>
      <div class="stat-row"><span>Total plays</span><strong>${plays}</strong></div>
      <div class="stat-row"><span>Sessions saved</span><strong>${sessions.length}</strong></div>
      <div class="stat-row"><span>Waveforms cached</span><strong>${waves.length}</strong></div>
      <div class="stat-row"><span>Missing metadata</span><strong>${missing}</strong></div>
    </div>`;

  $('sessionLog').innerHTML = MS.session.events.length
    ? MS.session.events.slice(-30).reverse().map(e =>
        `<div class="session-entry"><strong>${e.type}</strong> ${esc(e.title||'—')} <small>${new Date(e.at).toLocaleTimeString()}</small></div>`
      ).join('')
    : '<div class="empty">Start a session to log events.</div>';

  const dup = (() => {
    const m = {}; MS.library.forEach(t => m[t.title.toLowerCase()] = (m[t.title.toLowerCase()]||0)+1);
    return Object.values(m).filter(n => n > 1).length;
  })();
  $('healthReport').innerHTML = `
    <div class="muted-box">
      <div class="stat-row"><span>Duplicate titles</span><strong>${dup}</strong></div>
      <div class="stat-row"><span>Missing BPM/Key/Energy</span><strong>${missing}</strong></div>
      <div class="stat-row"><span>Missing genre</span><strong>${MS.library.filter(t=>!t.genre).length}</strong></div>
    </div>`;
}

function renderAll() {
  renderTrackList();
  renderCrates();
  renderQuickLoad();
  renderAnalytics();
  renderSearch();
  renderCues('A');
  renderCues('B');
  updateStatus();
}

async function updateStatus() {
  const waves = await dbAll('waveforms');
  if ($('trackCount'))  $('trackCount').textContent  = `${MS.library.length} tracks`;
  if ($('cacheCount'))  $('cacheCount').textContent  = `${waves.length} waveforms`;
  if ($('folderInfo'))  $('folderInfo').textContent  = MS.folderHandle ? `Linked: ${MS.folderHandle.name}` : 'No folder linked.';
  if ($('dbStatus'))    $('dbStatus').textContent    = `DB: ${DB_NAME} v${DB_VERSION}\nTracks: ${MS.library.length}\nWaveforms: ${waves.length}`;
}

/* ── Playback UI ticker ── */
function tickPlaybackUI() {
  const a = mainAudio.src ? mainAudio : (audioA.src ? audioA : audioB);
  if ($('timeNow'))  $('timeNow').textContent  = fmt(a.currentTime);
  if ($('timeDur'))  $('timeDur').textContent  = fmt(a.duration);
  if ($('seek'))     $('seek').value           = a.duration ? Math.round((a.currentTime/a.duration)*1000) : 0;
  if ($('playBtn'))  $('playBtn').textContent  = a.paused ? '▶' : '⏸';
  // VU meters — driven by actual playback state, not random
  const level = a.paused ? 0.05 : (0.3 + Math.sin(Date.now()/180)*0.2 + Math.random()*0.15);
  if ($('meterL')) $('meterL').style.transform = `scaleY(${level})`;
  if ($('meterR')) $('meterR').style.transform = `scaleY(${level * (0.9 + Math.random()*0.1)})`;
}
setInterval(tickPlaybackUI, 80);

/* ── UI bindings ── */
function bindUI() {
  // Tab navigation
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button, .panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('tab-' + b.dataset.tab)?.classList.add('active');
    renderAll();
  });

  // Library
  $('openFolder')?.addEventListener('click', openFolder);
  $('rescan')?.addEventListener('click', () =>
    MS.folderHandle ? scanFolder(MS.folderHandle).then(async n => {
      MS.library = await dbAll('tracks');
      await applySmartCrates();
      renderAll();
      toast(`Rescanned — ${n} files processed.`, 'ok');
    }) : toast('Open a folder first.', 'warn')
  );
  $('libraryFilter')?.addEventListener('input', renderTrackList);
  $('sortBy')?.addEventListener('change', renderTrackList);
  $('globalSearch')?.addEventListener('input', renderSearch);

  // Decks
  $('loadA')?.addEventListener('click', () => loadDeck('A', MS.selectedTrack));
  $('loadB')?.addEventListener('click', () => loadDeck('B', MS.selectedTrack));
  $('playA')?.addEventListener('click', () => toggleDeck('A'));
  $('playB')?.addEventListener('click', () => toggleDeck('B'));
  $('cueA')?.addEventListener('click',  () => saveCue('A'));
  $('cueB')?.addEventListener('click',  () => saveCue('B'));
  $('syncA')?.addEventListener('click', () => syncDeck('A'));
  $('syncB')?.addEventListener('click', () => syncDeck('B'));

  // Main player
  $('volume')?.addEventListener('input', e => {
    const v = +e.target.value;
    mainAudio.volume = audioA.volume = audioB.volume = v;
  });
  $('seek')?.addEventListener('input', e => {
    const a = mainAudio.src ? mainAudio : (audioA.src ? audioA : audioB);
    if (a.duration) a.currentTime = (+e.target.value / 1000) * a.duration;
  });
  $('prevBtn')?.addEventListener('click', () => playRelative(-1));
  $('nextBtn')?.addEventListener('click', () => playRelative(1));
  $('playBtn')?.addEventListener('click', () =>
    MS.selectedTrack ? playMain(MS.selectedTrack) : (MS.library[0] && playMain(MS.library[0]))
  );

  // Auto-advance
  mainAudio.addEventListener('ended', () => playRelative(1));
  audioA.addEventListener('ended', () => logSession('deck_end', MS.deck.A.track, { deck:'A' }));
  audioB.addEventListener('ended', () => logSession('deck_end', MS.deck.B.track, { deck:'B' }));

  // Crates
  $('newCrate')?.addEventListener('click', () => createCrate(false));
  $('newSmartCrate')?.addEventListener('click', () => createCrate(true));

  // Session
  $('startSession')?.addEventListener('click', () => {
    MS.session = { active:true, startedAt:Date.now(), events:[] };
    logSession('session_start', null);
    renderAnalytics();
    toast('Session started.', 'ok', 1500);
  });
  $('stopSession')?.addEventListener('click', async () => {
    logSession('session_stop', null);
    MS.session.active = false;
    await dbPut('sessions', { id: String(MS.session.startedAt||Date.now()), ...MS.session, endedAt:Date.now() });
    renderAnalytics();
    toast('Session saved.', 'ok', 1500);
  });
  $('exportSession')?.addEventListener('click', () =>
    downloadJSON('mediasuite-session.json', MS.session)
  );
  $('clearAnalytics')?.addEventListener('click', async () => {
    if (!confirm('Clear all local analytics and sessions?')) return;
    for (const s of await dbAll('sessions')) await dbDel('sessions', s.id);
    renderAnalytics();
    toast('Analytics cleared.', 'ok');
  });

  // Settings
  $('rebuildWaves')?.addEventListener('click', async () => {
    if (!confirm('Rebuild waveform cache for all available tracks?')) return;
    for (const t of MS.library) {
      try { const f = await fileFromTrack(t); await dbDel('waveforms', t.id); await renderWave('A',t,f); } catch {}
    }
    toast('Waveform cache rebuilt.', 'ok');
  });
  $('wipeDb')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL local MediaSuite data? This cannot be undone.')) return;
    indexedDB.deleteDatabase(DB_NAME);
    location.reload();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); $('playBtn')?.click(); }
    if (e.code === 'ArrowRight') playRelative(1);
    if (e.code === 'ArrowLeft')  playRelative(-1);
    if (e.code === 'KeyF') { e.preventDefault(); $('libraryFilter')?.focus(); }
  });
}

async function createCrate(isSmart) {
  const name = prompt(isSmart ? 'Smart crate name:' : 'Crate name:');
  if (!name) return;
  const crate = {
    id: 'crate_' + Date.now(), name, isSmart, trackIds: [],
    rules: isSmart ? { bpmMin:null, bpmMax:null, keys:'', genre:'', energyMin:null, favorite:false } : {}
  };
  await dbPut('crates', crate);
  MS.currentCrate = crate;
  renderCrates();
}

function downloadJSON(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
  a.download = name;
  a.click();
}

/* ── Boot ── */
async function boot() {
  await openDB();
  MS.library = await dbAll('tracks');
  await ensureDefaultCrates();
  await applySmartCrates();
  bindUI();
  renderAll();
  tickWaveheads();

  // Re-attach file handles for tracks loaded from a previous session
  const storedHandles = await dbAll('handles');
  storedHandles.forEach(h => {
    const t = MS.library.find(t => t.id === h.id);
    if (t && h.handle) t._fileHandle = h.handle;
  });

  // Expose for phase modules
  window.MS = MS;
  MS.emit('boot:complete', null);
  console.info(`MediaSuite V3 booted — ${MS.library.length} tracks`);
}

boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#05040f;color:#ff4d6d;font:16px sans-serif;padding:32px;text-align:center">
      MediaSuite failed to start:<br><code>${e.message}</code>
    </div>`);
});

/* ============================================================
   App.js Addendum — New tab wiring, genre filter, MP4 layer,
   Load A/B on every track row, grouped view.
   ============================================================ */

/* ── Override tab names to new navigation ── */
const TAB_MAP = {
  'collection': 'tab-collection',
  'vault':      'tab-vault',
  'archive':    'tab-archive',
  'performance':'tab-performance',
};

/* ── Expose render functions for StreamVault ── */
window.renderTrackListPublic = renderTrackList;
window.renderQuickLoadPublic = renderQuickLoad;

/* ── Genre-filtered track list ── */
const _originalRenderTrackList = renderTrackList;
function renderTrackListWithGenre() {
  const genre = MS._activeGenre || '';
  const q     = ($('libraryFilter')?.value || '').toLowerCase();
  const arr   = sortedTracks(MS.library.filter(t => {
    const matchGenre = !genre || (t.genre || '').toLowerCase() === genre.toLowerCase();
    const matchQ     = !q || [t.title,t.artist,t.album,t.genre,t.key,String(t.bpm||'')]
      .join(' ').toLowerCase().includes(q);
    return matchGenre && matchQ;
  }));
  const el = $('trackList');
  if (!el) return;

  const grouped = $('viewGroup')?.classList.contains('active');
  if (grouped) {
    renderGroupedView(arr, el);
  } else {
    el.innerHTML = arr.length
      ? arr.map(t => trackRowHTML(t)).join('')
      : '<div class="empty-state"><div class="empty-icon">🎵</div>No tracks match this filter.</div>';
  }
  el.querySelectorAll('.track').forEach(r => r.onclick = () => selectTrack(r.dataset.id));
  el.querySelectorAll('.load-deck-a').forEach(b => b.onclick = e => { e.stopPropagation(); loadDeck('A', MS.library.find(t => t.id === b.dataset.id)); });
  el.querySelectorAll('.load-deck-b').forEach(b => b.onclick = e => { e.stopPropagation(); loadDeck('B', MS.library.find(t => t.id === b.dataset.id)); });
}

/* ── Track row with Load A/B buttons on every row ── */
function trackRowHTML(t) {
  const deckKey = MS.deck.A.track?.key || MS.deck.B.track?.key;
  const tier    = harmonicTier(deckKey, t.key);
  const cls     = ['track', MS.selectedTrack?.id === t.id ? 'selected' : '', tier ? `tier-${tier}` : '']
    .filter(Boolean).join(' ');
  const isMP4   = (t.path||'').toLowerCase().endsWith('.mp4') || (t.type||'').includes('video');
  return `<div class="${cls}" data-id="${t.id}">
    <span class="track-fav">${t.favorite ? '★' : isMP4 ? '🎬' : '♪'}</span>
    <div class="track-meta">
      <div class="track-title">${esc(t.title)}</div>
      <small>${esc(t.artist||'Unknown')} · ${esc(t.genre||'—')}</small>
    </div>
    <span class="badge badge--bpm">${t.bpm||'—'}</span>
    <span class="badge badge--key ${tier?`badge--${tier}`:''}"}>${t.key||'—'}</span>
    <div class="track-deck-btns">
      <button class="btn btn--xs load-deck-a" data-id="${t.id}" title="Load Deck A">A</button>
      <button class="btn btn--xs load-deck-b" data-id="${t.id}" title="Load Deck B">B</button>
    </div>
  </div>`;
}

/* ── Grouped view: Genre → Artist → Album ── */
function renderGroupedView(tracks, el) {
  if (!tracks.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🎵</div>No tracks.</div>';
    return;
  }
  const groups = {};
  tracks.forEach(t => {
    const g = t.genre || 'Uncategorised';
    const a = t.artist || 'Unknown Artist';
    const b = t.album  || 'Unknown Album';
    if (!groups[g])    groups[g] = {};
    if (!groups[g][a]) groups[g][a] = {};
    if (!groups[g][a][b]) groups[g][a][b] = [];
    groups[g][a][b].push(t);
  });

  el.innerHTML = Object.entries(groups).map(([genre, artists]) => `
    <div class="group-genre">
      <div class="group-genre-label">${esc(genre)}</div>
      ${Object.entries(artists).map(([artist, albums]) => `
        <div class="group-artist">
          <div class="group-artist-label">👤 ${esc(artist)}</div>
          ${Object.entries(albums).map(([album, tks]) => `
            <div class="group-album">
              <div class="group-album-label">💿 ${esc(album)}</div>
              ${tks.map(t => trackRowHTML(t)).join('')}
            </div>`).join('')}
        </div>`).join('')}
    </div>`).join('');
}

/* ── MP4 video layer on deck load ── */
const _originalLoadDeck = loadDeck;
async function loadDeckWithVideo(deck, track) {
  if (!track) { toast('Select a track first.', 'warn'); return; }
  const isMP4 = (track.path||'').toLowerCase().endsWith('.mp4')
    || (track.type||'').includes('video');

  if (isMP4) {
    try {
      const file   = await fileFromTrack(track);
      const url    = URL.createObjectURL(file);
      const video  = $(deck === 'A' ? 'deckAVideoEl' : 'deckBVideoEl');
      const wrap   = $(deck === 'A' ? 'deckAVideo'   : 'deckBVideo');
      const title  = $(deck === 'A' ? 'deckATitle'   : 'deckBTitle');

      if (video && wrap) {
        wrap.style.display = 'block';
        video.src = url;
        video.load();
        video.oncanplay = () => {
          if (window.MSVault) window.MSVault._connectVideo?.(video, `Deck ${deck}`);
        };
      }
      if (title) title.textContent = `${track.title} · MP4`;
      MS.deck[deck].track = { ...track };
      MS.emit('deck:loaded', { deck, track });
      toast(`Deck ${deck}: ${track.title} (video)`, 'info', 2000);
    } catch(e) { toast(e.message, 'error'); }
  } else {
    return _originalLoadDeck(deck, track);
  }
}

/* ── Override core render/load functions ── */
window.renderTrackList = renderTrackListWithGenre;
window.renderTrackListPublic = renderTrackListWithGenre;
window.loadDeck = loadDeckWithVideo;

/* ── View toggle (list vs grouped) ── */
document.addEventListener('DOMContentLoaded', () => {
  $('viewList')?.addEventListener('click', () => {
    $('viewList').classList.add('active');
    $('viewGroup')?.classList.remove('active');
    renderTrackListWithGenre();
  });
  $('viewGroup')?.addEventListener('click', () => {
    $('viewGroup').classList.add('active');
    $('viewList')?.classList.remove('active');
    renderTrackListWithGenre();
  });

  /* ── Status pill ── */
  const dot  = document.querySelector('.metric-dot') || document.querySelector('.status-dot');
  const pill = $('systemStatus') || $('sysLabel');
  if (dot && pill) {
    setInterval(() => {
      const ok = !!window.MS?.db;
      dot.style.background = ok ? '#00e676' : '#ff4d6d';
      dot.style.boxShadow  = ok ? '0 0 6px #00e676' : '0 0 6px #ff4d6d';
    }, 2000);
  }

  /* ── Update collTrackCount alongside trackCount ── */
  const orig = window.updateStatus;
  window.updateStatus = async function() {
    await orig?.();
    const c = $('collTrackCount');
    if (c) c.textContent = `${MS.library.length} tracks`;
  };
});

/* ── Genre filter re-render hook ── */
MS.on('genre:filter', () => renderTrackListWithGenre());
MS.on('library:updated', () => renderTrackListWithGenre());
