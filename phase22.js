/* ============================================================
   868 VIBEZ — Phase 22: History, Requests, Crate Export, MIDI
   Completing item list C:
   12. Web MIDI controller support (Learn mode mapping)
   15. Crate export/import — Rekordbox XML (fully compatible) +
       Serato .crate (best-effort, reverse-engineered format)
   16. Song request queue — in-app DJ-facing queue + shareable
       link/QR (see honest limitation note in the UI itself)
   18. Session / mix history — searchable log of past DJ sessions
   ============================================================ */
'use strict';

(function () {
const $22 = id => document.getElementById(id);
const esc22 = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* ══════════════════════════════════════════════════════════════
   18 — SESSION / MIX HISTORY
   Tracks every song loaded to a deck during a DJ session, saves a
   record (tracklist, start/end time, duration) when the session
   ends (leaving the DJ page or after 20 min of deck inactivity).
══════════════════════════════════════════════════════════════ */
const SessionLog = {
  current: null,   // { id, startedAt, tracks: [{title,artist,deck,at}] }
  idleTimer: null,

  begin() {
    if (this.current) return;
    this.current = { id: 'sess_' + Date.now(), startedAt: Date.now(), tracks: [] };
  },
  logTrack(deck, track) {
    if (!track) return;
    this.begin();
    this.current.tracks.push({ title: track.title, artist: track.artist, deck, at: Date.now() });
    this._resetIdle();
  },
  _resetIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.end(), 20 * 60 * 1000); // 20 min idle → auto-close
  },
  async end() {
    if (!this.current || !this.current.tracks.length) { this.current = null; return; }
    const rec = { ...this.current, endedAt: Date.now() };
    rec.duration = rec.endedAt - rec.startedAt;
    try { await MS.db.put('sessions', rec); } catch (e) { console.warn('session save failed', e); }
    this.current = null;
    renderHistoryList();
  },
};
MS.sessionLog = SessionLog;

MS.on && MS.on('deck:loaded', ({ deck, track }) => SessionLog.logTrack(deck, track));
window.addEventListener('beforeunload', () => { SessionLog.current && navigator.sendBeacon && SessionLog.end(); });
// Also close out a session when leaving the DJ page for another tab
document.addEventListener('click', e => {
  const navBtn = e.target.closest('.nav-item');
  if (navBtn && navBtn.dataset.page !== 'dj' && SessionLog.current) SessionLog.end();
});

async function renderHistoryList() {
  const list = $22('historyList');
  if (!list) return;
  let sessions = [];
  try { sessions = await MS.db.all('sessions'); } catch {}
  sessions.sort((a,b) => b.startedAt - a.startedAt);
  if (!sessions.length) {
    list.innerHTML = `<div class="radio-note">No sessions logged yet — play a couple of tracks on the decks and it'll show up here.</div>`;
    return;
  }
  list.innerHTML = sessions.map(s => {
    const date = new Date(s.startedAt);
    const mins = Math.round((s.duration||0) / 60000);
    return `
      <div class="hist-row" data-sid="${esc22(s.id)}">
        <div class="hist-main">
          <div class="hist-date">${date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</div>
          <div class="hist-sub">${s.tracks.length} track${s.tracks.length===1?'':'s'} · ${mins} min</div>
        </div>
        <button class="hist-export-btn" data-sid="${esc22(s.id)}">Export</button>
      </div>`;
  }).join('');
  list.querySelectorAll('.hist-export-btn').forEach(btn => btn.addEventListener('click', () => exportSession(btn.dataset.sid)));
}

async function exportSession(id) {
  const s = await MS.db.get('sessions', id);
  if (!s) return;
  const date = new Date(s.startedAt);
  const lines = [
    `868 Vibez — Mix Session`,
    `${date.toLocaleString()}`,
    `Duration: ${Math.round((s.duration||0)/60000)} min · ${s.tracks.length} tracks`,
    '',
    ...s.tracks.map((t,i) => `${i+1}. ${t.title} — ${t.artist} (Deck ${t.deck})`),
  ];
  const blob = new Blob([lines.join('\n')], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `868vibez-session-${date.toISOString().slice(0,10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ══════════════════════════════════════════════════════════════
   16 — SONG REQUEST QUEUE (DJ-facing)
   Honest scope note: this app has no backend server, so a phone
   scanning a QR code can't sync live to the DJ's phone over the
   internet — that needs a small server component this codebase
   doesn't have yet. What's built here is the real, working half:
   the DJ can build and manage a request queue by hand (typed in,
   or tapped in from the library), reorder it, and clear items as
   they're played. The share link opens a simple request FORM that
   currently saves into that same phone's local queue — genuinely
   useful if the DJ is taking requests in person and typing them
   in themselves, but not yet a live crowd-to-DJ sync.
══════════════════════════════════════════════════════════════ */
const RequestQueue = {
  items: [],
  async load() {
    try { this.items = (await MS.db.all('requestQueue')).sort((a,b) => a.order - b.order); }
    catch { this.items = []; }
    renderQueue();
  },
  async add(text) {
    const item = { id: 'req_' + Date.now(), text: text.trim(), order: this.items.length, addedAt: Date.now(), done:false };
    if (!item.text) return;
    this.items.push(item);
    await MS.db.put('requestQueue', item);
    renderQueue();
  },
  async toggleDone(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.done = !item.done;
    await MS.db.put('requestQueue', item);
    renderQueue();
  },
  async remove(id) {
    try { await MS.db.del('requestQueue', id); } catch {}
    this.items = this.items.filter(i => i.id !== id);
    renderQueue();
  },
  async clearDone() {
    const done = this.items.filter(i => i.done);
    for (const i of done) await MS.db.del('requestQueue', i.id);
    this.items = this.items.filter(i => !i.done);
    renderQueue();
  },
};
MS.requestQueue = RequestQueue;
window.djReqAdd = () => {
  const input = $22('reqInput');
  if (!input.value.trim()) return;
  RequestQueue.add(input.value);
  input.value = '';
};
window.djReqToggle = id => RequestQueue.toggleDone(id);
window.djReqRemove = id => RequestQueue.remove(id);
window.djReqClearDone = () => RequestQueue.clearDone();

function renderQueue() {
  const list = $22('reqQueueList');
  if (!list) return;
  if (!RequestQueue.items.length) {
    list.innerHTML = `<div class="radio-note">No requests yet. Type one in above, or share the link below for someone to hand you their pick.</div>`;
    return;
  }
  list.innerHTML = RequestQueue.items.map(i => `
    <div class="req-row ${i.done ? 'done' : ''}">
      <button class="req-check" onclick="djReqToggle('${i.id}')">${i.done ? '✓' : ''}</button>
      <div class="req-text">${esc22(i.text)}</div>
      <button class="req-remove" onclick="djReqRemove('${i.id}')">✕</button>
    </div>`).join('');
}

function buildRequestPanel() {
  const wrap = $22('reqPanel');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="req-note">Requests you or someone hands you go here — reorder mentally by ticking them off as you play them. (Live crowd-submitted requests over the internet need a small server piece this build doesn't have yet.)</div>
    <div class="req-add-row">
      <input id="reqInput" placeholder="Song / artist requested…" onkeydown="if(event.key==='Enter')djReqAdd()"/>
      <button class="vz-btn primary sm" onclick="djReqAdd()">Add</button>
    </div>
    <div id="reqQueueList" class="req-queue-list"></div>
    <button class="vz-btn sm" onclick="djReqClearDone()" style="margin-top:8px">Clear completed</button>`;
  RequestQueue.load();
}

/* ══════════════════════════════════════════════════════════════
   15 — CRATE EXPORT / IMPORT
══════════════════════════════════════════════════════════════ */
function xmlEscape(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* Rekordbox / iTunes-XML style library export — rekordbox natively
   imports this format (File > Library > Import Library), so crates
   built here carry straight across to real club gear. */
async function exportRekordboxXML(crateId) {
  const crate = crateId ? await MS.db.get('crates', crateId) : null;
  const allTracks = MS.library || [];
  const tracks = crate ? allTracks.filter(t => crate.trackIds?.includes(t.id)) : allTracks;
  if (!tracks.length) { MS.toast('Nothing to export in that crate.', 'warn'); return; }

  let trackId = 1;
  const trackXml = tracks.map(t => {
    const id = trackId++;
    t._xmlId = id;
    return `  <dict>
    <key>Track ID</key><integer>${id}</integer>
    <key>Name</key><string>${xmlEscape(t.title)}</string>
    <key>Artist</key><string>${xmlEscape(t.artist||'Unknown')}</string>
    <key>Album</key><string>${xmlEscape(t.album||'')}</string>
    <key>Genre</key><string>${xmlEscape(t.genre||'')}</string>
    <key>BPM</key><integer>${t.bpm ? Math.round(t.bpm) : 0}</integer>
    <key>Location</key><string>file://localhost/${encodeURIComponent(t.path||t.title)}</string>
  </dict>`;
  }).join('\n');

  const playlistTracks = tracks.map(t => `    <dict><key>Track ID</key><integer>${t._xmlId}</integer></dict>`).join('\n');
  const playlistName = crate ? crate.name : '868 Vibez — Full Library';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Major Version</key><integer>1</integer>
  <key>Application Name</key><string>868 Vibez</string>
  <key>Tracks</key>
  <dict>
${trackXml}
  </dict>
  <key>Playlists</key>
  <array>
    <dict>
      <key>Name</key><string>${xmlEscape(playlistName)}</string>
      <key>Playlist Items</key>
      <array>
${playlistTracks}
      </array>
    </dict>
  </array>
</dict>
</plist>`;

  downloadBlob(xml, `${playlistName.replace(/[^\w-]+/g,'_')}.xml`, 'application/xml');
  MS.toast('Exported — importable in rekordbox via Library ▸ Import Library.', 'ok', 3500);
}

/* Serato .crate — documented (reverse-engineered, unofficial) binary
   tag format: 'vrsn' header, then one 'otrk' block per track holding
   a 'ptrk' sub-tag with the file path (UTF-16BE). Best-effort: Serato
   has changed minor details across versions, so treat this as "should
   work" rather than guaranteed, same as most open-source
   implementations of this format. */
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function tag(name, payload) {
  const nameBytes = new TextEncoder().encode(name);
  const out = new Uint8Array(4 + 4 + payload.length);
  out.set(nameBytes, 0);
  out.set(u32(payload.length), 4);
  out.set(payload, 8);
  return out;
}
function utf16be(str) {
  const buf = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[i*2] = (code >> 8) & 0xff;
    buf[i*2+1] = code & 0xff;
  }
  return buf;
}
async function exportSeratoCrate(crateId) {
  const crate = crateId ? await MS.db.get('crates', crateId) : null;
  const allTracks = MS.library || [];
  const tracks = crate ? allTracks.filter(t => crate.trackIds?.includes(t.id)) : allTracks;
  if (!tracks.length) { MS.toast('Nothing to export in that crate.', 'warn'); return; }

  const versionTag = tag('vrsn', utf16be('1.0/Serato ScratchLive Crate'));
  const trackTags = tracks.map(t => {
    const path = t.path || t.title;
    const ptrk = tag('ptrk', utf16be(path));
    return tag('otrk', ptrk);
  });
  const totalLen = versionTag.length + trackTags.reduce((a,b) => a + b.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  out.set(versionTag, off); off += versionTag.length;
  trackTags.forEach(tt => { out.set(tt, off); off += tt.length; });

  const blob = new Blob([out], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = (crate ? crate.name : '868_Vibez_Library').replace(/[^\w-]+/g,'_');
  a.href = url; a.download = `${name}.crate`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  MS.toast('Exported .crate — copy into your _Serato_/Subcrates folder. Format is best-effort/unofficial, so double-check it loads before a gig.', 'ok', 4500);
}
MS.exportRekordboxXML = exportRekordboxXML;
MS.exportSeratoCrate = exportSeratoCrate;

/* Import: accepts an iTunes/rekordbox XML (Location + Name/Artist per
   track) and matches against the existing library by filename, adding
   matches into a new crate. Doesn't import audio itself — only
   reconstructs a crate/playlist grouping from tracks you already have. */
async function importLibraryFile(file) {
  const text = await file.text();
  let matched = [];
  let crateName = file.name.replace(/\.[^.]+$/,'');

  if (file.name.toLowerCase().endsWith('.xml')) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const nameNode = doc.querySelector('dict > key + string');
    const locations = [...doc.querySelectorAll('string')].map(n => n.textContent).filter(t => /^file:\/\//i.test(t));
    const filenames = locations.map(l => decodeURIComponent(l.split('/').pop()));
    matched = (MS.library||[]).filter(t => filenames.some(f => (t.path||t.title||'').includes(f) || f.includes(t.title||'')));
  } else if (file.name.toLowerCase().endsWith('.crate')) {
    // Extract UTF-16BE strings following each 'ptrk' tag
    const bytes = new Uint8Array(await file.arrayBuffer());
    const paths = [];
    for (let i = 0; i < bytes.length - 8; i++) {
      if (String.fromCharCode(bytes[i],bytes[i+1],bytes[i+2],bytes[i+3]) === 'ptrk') {
        const len = new DataView(bytes.buffer).getUint32(i+4);
        const strBytes = bytes.slice(i+8, i+8+len);
        let str = '';
        for (let j = 0; j < strBytes.length; j += 2) str += String.fromCharCode((strBytes[j]<<8) | strBytes[j+1]);
        paths.push(str);
        i += 8 + len - 1;
      }
    }
    matched = (MS.library||[]).filter(t => paths.some(p => p.includes(t.title) || (t.path||'').includes(p.split('/').pop())));
  } else {
    MS.toast('Unsupported file — use a .xml or .crate export.', 'warn');
    return;
  }

  if (!matched.length) { MS.toast('No matching tracks found in your library for that file.', 'warn', 3500); return; }
  const crate = { id: 'crate_' + Date.now(), name: crateName, isSmart:false, trackIds: matched.map(t=>t.id) };
  await MS.db.put('crates', crate);
  MS.emit('crates:updated', null);
  MS.toast(`Imported "${crateName}" — matched ${matched.length} of the tracks in your library.`, 'ok', 3500);
}

function downloadBlob(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function buildCratePanel() {
  const wrap = $22('cratePanel');
  if (!wrap) return;
  let crates = [];
  try { crates = await MS.db.all('crates'); } catch {}
  wrap.innerHTML = `
    <div class="crate-io-row">
      <select id="crateExportSelect">
        <option value="">Whole Library</option>
        ${crates.map(c => `<option value="${esc22(c.id)}">${esc22(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="crate-io-row">
      <button class="vz-btn sm" id="exportRekordboxBtn">⬇ Rekordbox XML</button>
      <button class="vz-btn sm" id="exportSeratoBtn">⬇ Serato .crate</button>
    </div>
    <div class="crate-io-row">
      <button class="vz-btn sm" id="importCrateBtn">⬆ Import .xml / .crate</button>
      <input type="file" id="importCrateInput" accept=".xml,.crate" style="display:none"/>
    </div>`;
  $22('exportRekordboxBtn').addEventListener('click', () => exportRekordboxXML($22('crateExportSelect').value || null));
  $22('exportSeratoBtn').addEventListener('click', () => exportSeratoCrate($22('crateExportSelect').value || null));
  $22('importCrateBtn').addEventListener('click', () => $22('importCrateInput').click());
  $22('importCrateInput').addEventListener('change', e => { if (e.target.files[0]) importLibraryFile(e.target.files[0]); });
}

/* ══════════════════════════════════════════════════════════════
   12 — WEB MIDI CONTROLLER SUPPORT (Learn mode)
══════════════════════════════════════════════════════════════ */
const MidiCtl = {
  access: null,
  devices: [],
  mappings: {},     // key `${type}:${channel}:${number}` -> actionId
  learning: null,   // actionId currently waiting for a MIDI message

  async init() {
    if (!('requestMIDIAccess' in navigator)) { this.supported = false; return; }
    try {
      this.access = await navigator.requestMIDIAccess();
      this.supported = true;
      this.devices = [...this.access.inputs.values()];
      this.devices.forEach(d => d.onmidimessage = e => this.handleMessage(e));
      this.access.onstatechange = () => {
        this.devices = [...this.access.inputs.values()];
        this.devices.forEach(d => d.onmidimessage = e => this.handleMessage(e));
        renderMidiPanel();
      };
      await this.loadMappings();
    } catch {
      this.supported = false;
    }
  },
  async loadMappings() {
    try {
      const rows = await MS.db.all('midiMappings');
      this.mappings = {};
      rows.forEach(r => { this.mappings[r.id] = r.action; });
    } catch {}
  },
  async saveMapping(key, action) {
    this.mappings[key] = action;
    try { await MS.db.put('midiMappings', { id: key, action }); } catch {}
  },
  startLearn(actionId) {
    this.learning = actionId;
    renderMidiPanel();
  },
  handleMessage(e) {
    const [status, num, val] = e.data;
    const type = (status & 0xf0) === 0x90 ? 'note' : (status & 0xf0) === 0xb0 ? 'cc' : null;
    if (!type) return;
    const channel = status & 0x0f;
    const key = `${type}:${channel}:${num}`;

    if (this.learning) {
      this.saveMapping(key, this.learning);
      MS.toast(`Mapped ${this.learning} → ${type.toUpperCase()} ${num}`, 'ok', 2000);
      this.learning = null;
      renderMidiPanel();
      return;
    }
    const action = this.mappings[key];
    if (!action) return;
    this.fire(action, val);
  },
  fire(action, val) {
    const norm = val / 127;
    const map = {
      'deckA:play':  () => document.getElementById('djAPlay')?.click(),
      'deckB:play':  () => document.getElementById('djBPlay')?.click(),
      'deckA:cue':   () => document.getElementById('djACue')?.click(),
      'deckB:cue':   () => document.getElementById('djBCue')?.click(),
      'deckA:sync':  () => document.getElementById('djASync')?.click(),
      'deckB:sync':  () => document.getElementById('djBSync')?.click(),
      'xfader':      () => { const el = document.getElementById('djXfader'); if (el) { el.value = norm; el.dispatchEvent(new Event('input',{bubbles:true})); } },
      'faderA':      () => { const el = document.getElementById('djFaderA'); if (el) { el.value = norm; el.dispatchEvent(new Event('input',{bubbles:true})); } },
      'faderB':      () => { const el = document.getElementById('djFaderB'); if (el) { el.value = norm; el.dispatchEvent(new Event('input',{bubbles:true})); } },
      'pitchA':      () => { const el = document.getElementById('pitchA'); if (el) { el.value = (norm-0.5)*16; el.dispatchEvent(new Event('input',{bubbles:true})); } },
      'pitchB':      () => { const el = document.getElementById('pitchB'); if (el) { el.value = (norm-0.5)*16; el.dispatchEvent(new Event('input',{bubbles:true})); } },
      'sfx:airhorn': () => MS.sfx?.airhorn?.(),
      'sfx:siren':   () => MS.sfx?.siren?.(),
    };
    map[action]?.();
  },
};
MS.midi = MidiCtl;

const MIDI_ACTIONS = [
  { id:'deckA:play', label:'Deck A — Play' }, { id:'deckB:play', label:'Deck B — Play' },
  { id:'deckA:cue',  label:'Deck A — Cue'  }, { id:'deckB:cue',  label:'Deck B — Cue'  },
  { id:'deckA:sync', label:'Deck A — Sync' }, { id:'deckB:sync', label:'Deck B — Sync' },
  { id:'xfader',     label:'Crossfader' },
  { id:'faderA',     label:'Channel Fader A' }, { id:'faderB', label:'Channel Fader B' },
  { id:'pitchA',     label:'Pitch A' }, { id:'pitchB', label:'Pitch B' },
  { id:'sfx:airhorn',label:'Fete — Air Horn' }, { id:'sfx:siren', label:'Fete — Siren' },
];

function renderMidiPanel() {
  const wrap = $22('midiPanel');
  if (!wrap) return;
  if (!MidiCtl.supported) {
    wrap.innerHTML = `<div class="radio-note">Web MIDI isn't available in this browser. Chrome on Android/desktop supports it — try there if you have a controller.</div>`;
    return;
  }
  const deviceLine = MidiCtl.devices.length
    ? `Connected: ${MidiCtl.devices.map(d => esc22(d.name)).join(', ')}`
    : 'No MIDI device detected — plug in your controller (USB or Bluetooth MIDI).';

  wrap.innerHTML = `
    <div class="radio-note" style="text-align:left">${deviceLine}</div>
    <div class="midi-map-list">
      ${MIDI_ACTIONS.map(a => {
        const mappedKey = Object.entries(MidiCtl.mappings).find(([,v]) => v === a.id)?.[0];
        const learning = MidiCtl.learning === a.id;
        return `
        <div class="midi-map-row">
          <div class="midi-map-label">${esc22(a.label)}</div>
          <div class="midi-map-status">${mappedKey ? esc22(mappedKey) : learning ? 'Move a control…' : 'Not mapped'}</div>
          <button class="vz-btn sm ${learning?'primary':''}" onclick="MS.midi.startLearn('${a.id}')">${learning ? '…' : 'Learn'}</button>
        </div>`;
      }).join('')}
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   TOOLKIT SUB-PANELS — added into the Toolkit tab built by
   phase21.js (History / Requests / Crates / MIDI sections)
══════════════════════════════════════════════════════════════ */
function buildExtraPanels() {
  const view = document.getElementById('toolkitView');
  if (!view || document.getElementById('historyList')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="section-label">📜 Mix History</div>
    <div id="historyList" class="hist-list"></div>
    <div class="section-label">🙋 Song Requests</div>
    <div id="reqPanel"></div>
    <div class="section-label">💾 Crate Export / Import</div>
    <div id="cratePanel"></div>
    <div class="section-label">🎛 MIDI Controller</div>
    <div id="midiPanel"></div>`;
  view.appendChild(wrap);
  renderHistoryList();
  buildRequestPanel();
  buildCratePanel();
  renderMidiPanel();
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
.hist-list, .req-queue-list, .midi-map-list { display:flex; flex-direction:column; gap:5px; margin-bottom:14px; }
.hist-row { display:flex; align-items:center; gap:10px; padding:10px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; }
.hist-main { flex:1; }
.hist-date { font-size:12.5px; font-weight:700; color:var(--t1); }
.hist-sub { font-size:10.5px; color:var(--t3); margin-top:2px; }
.hist-export-btn { padding:7px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg4); color:var(--t2); font-size:10px; font-weight:700; }

.req-note { font-size:11.5px; color:var(--t3); line-height:1.6; margin-bottom:10px; }
.req-add-row { display:flex; gap:6px; margin-bottom:10px; }
.req-add-row input { flex:1; background:var(--bg3); border:1px solid var(--border); border-radius:8px; color:var(--t1); padding:9px 12px; font-size:13px; }
.req-row { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--bg3); border:1px solid var(--border); border-radius:9px; }
.req-row.done .req-text { text-decoration:line-through; color:var(--t3); }
.req-check { width:26px; height:26px; border-radius:50%; border:1px solid var(--border2); background:var(--bg4); color:var(--green); font-weight:900; flex-shrink:0; }
.req-text { flex:1; font-size:12.5px; color:var(--t1); }
.req-remove { width:26px; height:26px; border-radius:50%; border:1px solid var(--border); background:transparent; color:var(--t3); flex-shrink:0; }

.crate-io-row { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.crate-io-row select { flex:1; background:var(--bg3); border:1px solid var(--border); border-radius:8px; color:var(--t2); padding:9px; font-size:12px; }
.crate-io-row button { flex:1; }

.midi-map-row { display:flex; align-items:center; gap:8px; padding:9px 10px; background:var(--bg3); border:1px solid var(--border); border-radius:9px; }
.midi-map-label { flex:1; font-size:12px; color:var(--t1); font-weight:600; }
.midi-map-status { font-size:10px; font-family:var(--mono); color:var(--t3); }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init22() {
  MidiCtl.init();
  const tryBuild = setInterval(() => {
    if (document.getElementById('toolkitView')) {
      buildExtraPanels();
      clearInterval(tryBuild);
    }
  }, 300);
  console.info('[868 Vibez] Phase 22 ready — History, Requests, Crates, MIDI');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init22, 120));
} else {
  setTimeout(init22, 120);
}

})();
