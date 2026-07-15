/* ============================================================
   868 VIBEZ — Phase 18: Radio Engine + DJ Pro
   1. Live Radio     — dedicated audio element that BYPASSES the
                       Web Audio graph. Cross-origin radio streams
                       routed through createMediaElementSource()
                       output pure silence in Chrome when the
                       server doesn't send CORS headers — this is
                       exactly why every radio station appeared
                       "broken". Radio now plays direct → speakers.
   2. Station List   — reliable HTTPS stations + add-your-own
                       (custom stations persist in localStorage).
   3. DJ Track Browser — scrollable song browser INSIDE the DJ
                       console (landscape). Tap LOAD on a deck or
                       the Browse tab → full library + streams +
                       radio, searchable, sortable, tap to load.
   4. Pro DJ features (best of Serato / rekordbox / VirtualDJ):
       • Keylock (Master Tempo) — pitch slider changes tempo
         without chipmunking the key (preservesPitch)
       • Auto-Loop 4 beats + ½x / 2x loop halve & double
       • Beat-jump ±4 beats
       • 3-band EQ (LOW / MID / HI) per deck
       • Color Filter sweep per deck (LP ◀ center ▶ HP)
   ============================================================ */
'use strict';

(function () {

const $18  = id => document.getElementById(id);
const esc18 = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* ══════════════════════════════════════════════════════════════
   1 + 2 — LIVE RADIO ENGINE
══════════════════════════════════════════════════════════════ */

const BUILTIN_STATIONS = [
  { id:'rp-main',   name:'Radio Paradise — Main Mix', genre:'Eclectic Rock',    url:'https://stream.radioparadise.com/mp3-192' },
  { id:'rp-mellow', name:'Radio Paradise — Mellow',   genre:'Chill / Downtempo',url:'https://stream.radioparadise.com/mellow-192' },
  { id:'rp-rock',   name:'Radio Paradise — Rock',     genre:'Rock',             url:'https://stream.radioparadise.com/rock-192' },
  { id:'sf-groove', name:'SomaFM — Groove Salad',     genre:'Ambient / Chill',  url:'https://ice1.somafm.com/groovesalad-128-mp3' },
  { id:'sf-beat',   name:'SomaFM — Beat Blender',     genre:'Deep House',       url:'https://ice1.somafm.com/beatblender-128-mp3' },
  { id:'sf-trip',   name:'SomaFM — The Trip',         genre:'Prog House/Trance',url:'https://ice1.somafm.com/thetrip-128-mp3' },
  { id:'sf-agent',  name:'SomaFM — Secret Agent',     genre:'Lounge / Spy Jazz',url:'https://ice1.somafm.com/secretagent-128-mp3' },
  { id:'sf-defcon', name:'SomaFM — DEF CON Radio',    genre:'Electronic',       url:'https://ice1.somafm.com/defcon-128-mp3' },
  { id:'sf-metal',  name:'SomaFM — Metal Detector',   genre:'Metal',            url:'https://ice1.somafm.com/metal-128-mp3' },
  { id:'sf-reggae', name:'SomaFM — Heavyweight Reggae', genre:'Reggae / Dub',   url:'https://ice1.somafm.com/reggae-128-mp3' },
];

const Radio = {
  el: null,               // dedicated <audio> — NEVER touched by Web Audio
  current: null,          // station object currently playing / loading
  state: 'idle',          // idle | loading | playing | error
  tt: [],                 // Trinidad & Tobago stations from radio-browser.info
  ttState: 'idle',        // idle | loading | ready | error

  /* ── Trinidad & Tobago directory (radio-browser.info, free/open API) ──
     Same station database the popular radio apps use. Returns live-checked
     stream URLs, so stations stay current without hardcoding anything.
     Only https:// streams are kept — http:// ones are blocked as mixed
     content on the HTTPS deployment and would silently fail. */
  RB_SERVERS: [
    'https://de1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info',
    'https://at1.api.radio-browser.info',
  ],

  async loadTT(force = false) {
    if (this.ttState === 'loading') return;
    // 24h cache so the list appears instantly on later visits
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem('vz_tt_stations') || 'null');
        if (c && Date.now() - c.at < 864e5 && c.list?.length) {
          this.tt = c.list; this.ttState = 'ready'; renderRadioSection(); return;
        }
      } catch {}
    }
    this.ttState = 'loading';
    renderRadioSection();
    const path = '/json/stations/search?countrycode=TT&hidebroken=true&order=clickcount&reverse=true&limit=120';
    for (const server of this.RB_SERVERS) {
      try {
        const res = await fetch(server + path, { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) continue;
        const raw = await res.json();
        const seen = new Set();
        this.tt = raw
          .map(s => ({ ...s, streamUrl: s.url_resolved || s.url }))
          .filter(s => /^https:\/\//i.test(s.streamUrl) && !s.hls)  // https + non-HLS (plain <audio>-playable)
          .filter(s => { const k = s.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .map(s => ({
            id: 'tt_' + s.stationuuid,
            name: s.name.trim(),
            genre: (s.tags || '').split(',').slice(0, 3).join(' · ') || 'Trinidad & Tobago',
            url: s.streamUrl,
            favicon: /^https:\/\//i.test(s.favicon || '') ? s.favicon : '',
            bitrate: s.bitrate || 0,
          }));
        this.ttState = 'ready';
        localStorage.setItem('vz_tt_stations', JSON.stringify({ at: Date.now(), list: this.tt }));
        renderRadioSection();
        return;
      } catch { /* try next mirror */ }
    }
    this.ttState = 'error';
    renderRadioSection();
  },

  _custom() {
    try { return JSON.parse(localStorage.getItem('vz_custom_stations') || '[]'); }
    catch { return []; }
  },
  _saveCustom(list) { localStorage.setItem('vz_custom_stations', JSON.stringify(list)); },

  stations() { return [...this.tt, ...BUILTIN_STATIONS, ...this._custom()]; },

  addCustom(name, url) {
    if (!/^https:\/\//i.test(url)) { MS.toast('Station URL must start with https:// (http:// is blocked on secure sites).', 'warn', 4200); return false; }
    const list = this._custom();
    list.push({ id:'custom_' + Date.now(), name: name || url.split('/')[2], genre:'Custom', url, custom:true });
    this._saveCustom(list);
    renderRadioSection();
    MS.toast('Station added.', 'ok');
    return true;
  },

  removeCustom(id) {
    this._saveCustom(this._custom().filter(s => s.id !== id));
    if (this.current?.id === id) this.stop();
    renderRadioSection();
  },

  _ensureEl() {
    if (this.el) return this.el;
    const a = new Audio();
    a.preload = 'none';
    a.volume  = 1;
    a.addEventListener('playing', () => { this.state = 'playing'; renderRadioSection(); });
    a.addEventListener('waiting', () => { this.state = 'loading'; renderRadioSection(); });
    a.addEventListener('error',   () => {
      if (this.state === 'idle') return;             // errors from .stop() teardown
      this.state = 'error';
      MS.toast(`Station unreachable: ${this.current?.name || ''}`, 'error', 3500);
      renderRadioSection();
    });
    this.el = a;
    return a;
  },

  play(station) {
    const a = this._ensureEl();
    // Stop everything else — one sound source at a time.
    try { MS.audio?.main?.pause(); MS.audio?.A?.pause(); MS.audio?.B?.pause(); } catch {}
    if (MS.deck) { MS.deck.A.playing = false; MS.deck.B.playing = false; }
    this.current = station;
    this.state = 'loading';
    renderRadioSection();
    a.src = station.url;
    a.load();
    a.play().then(() => {
      this.state = 'playing';
      MS.toast(`📻 ${station.name}`, 'ok', 2200);
      renderRadioSection();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: station.name, artist: '868 Vibez Radio', album: station.genre });
      }
    }).catch(e => {
      this.state = 'error';
      MS.toast(`Couldn't play ${station.name}: ${e.message}`, 'error', 3500);
      renderRadioSection();
    });
  },

  stop() {
    if (!this.el) return;
    this.state = 'idle';
    this.el.pause();
    this.el.removeAttribute('src');
    try { this.el.load(); } catch {}
    this.current = null;
    renderRadioSection();
  },

  toggle(id) {
    const st = this.stations().find(s => s.id === id);
    if (!st) return;
    (this.current?.id === id && this.state !== 'error' && this.state !== 'idle') ? this.stop() : this.play(st);
  },
};
window.MS && (MS.radio = Radio);

/* If anything else starts playing, kill the radio. */
document.addEventListener('play', e => {
  if (Radio.el && e.target !== Radio.el && Radio.state !== 'idle') Radio.stop();
}, true);

/* ── Radio UI on the Stream page ── */
let ttQuery = '';
function stationRow(s) {
  const isCur   = Radio.current?.id === s.id;
  const playing = isCur && Radio.state === 'playing';
  const loading = isCur && Radio.state === 'loading';
  const err     = isCur && Radio.state === 'error';
  const icon = s.favicon
    ? `<img src="${esc18(s.favicon)}" class="radio-fav" loading="lazy" onerror="this.outerHTML='<span class=\\'si-pip pip-live\\'></span>'"/>`
    : `<span class="si-pip pip-live" style="${playing ? 'animation:radioPulse 1.1s infinite' : ''}"></span>`;
  return `
    <div class="source-item ${playing ? 'radio-live' : ''}">
      ${icon}
      <div class="si-info">
        <div class="si-name">${esc18(s.name)}</div>
        <div class="si-meta">${esc18(s.genre)}${s.bitrate ? ` · ${s.bitrate}k` : ''}${playing ? ' · <span style="color:var(--green)">ON AIR</span>' : loading ? ' · connecting…' : err ? ' · <span style="color:var(--red)">error</span>' : ''}</div>
      </div>
      <div class="si-actions">
        <button class="si-btn ${playing ? 'radio-stop' : ''}" onclick="MS.radio.toggle('${s.id}')">${playing ? '⏹' : loading ? '…' : '▶'}</button>
        ${s.custom ? `<button class="si-btn" onclick="MS.radio.removeCustom('${s.id}')" title="Remove">✕</button>` : ''}
      </div>
    </div>`;
}

function renderRadioSection() {
  let wrap = $18('radioSection');
  if (!wrap) {
    const anchor = document.querySelector('[data-subview="explore"] .section-label'); // "Browse Free Music Portals"
    if (!anchor) return;
    wrap = document.createElement('div');
    wrap.id = 'radioSection';
    anchor.parentNode.insertBefore(wrap, anchor);
  }

  const q = ttQuery.toLowerCase();
  const tt = q ? Radio.tt.filter(s => s.name.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)) : Radio.tt;
  const ttBody =
    Radio.ttState === 'loading' ? `<div class="radio-note">Loading Trinidad &amp; Tobago stations…</div>` :
    Radio.ttState === 'error'   ? `<div class="radio-note">Couldn't reach the station directory. <button class="vz-btn sm" onclick="MS.radio.loadTT(true)">Retry</button></div>` :
    !Radio.tt.length            ? `<div class="radio-note"><button class="vz-btn sm" onclick="MS.radio.loadTT()">Load T&amp;T Stations</button></div>` :
    tt.map(stationRow).join('') || `<div class="radio-note">No stations match "${esc18(ttQuery)}".</div>`;

  wrap.innerHTML = `
    <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>🇹🇹 Trinidad &amp; Tobago Radio${Radio.tt.length ? ` · ${Radio.tt.length}` : ''}</span>
      <button class="vz-btn sm" id="radioTTRefresh" style="font-size:9px;padding:3px 8px" title="Refresh station list">↻</button>
    </div>
    ${Radio.tt.length > 6 ? `<input id="radioTTSearch" placeholder="Search T&amp;T stations…" value="${esc18(ttQuery)}"/>` : ''}
    <div class="source-list" id="radioTTList">${ttBody}</div>

    <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>📻 World Radio</span>
      <button class="vz-btn sm" id="radioAddBtn" style="font-size:9px;padding:3px 8px">+ Add Station</button>
    </div>
    <div class="source-list" id="radioList">
      ${[...BUILTIN_STATIONS, ...Radio._custom()].map(stationRow).join('')}
    </div>`;

  $18('radioTTRefresh').onclick = () => Radio.loadTT(true);
  const search = $18('radioTTSearch');
  if (search) {
    search.oninput = e => { ttQuery = e.target.value; renderRadioSection(); };
    if (ttQuery) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }
  const add = $18('radioAddBtn');
  if (add) add.onclick = () => {
    const url  = prompt('Station stream URL (must be https://…):');
    if (!url) return;
    const name = prompt('Station name:') || '';
    Radio.addCustom(name.trim(), url.trim());
  };
}

/* ══════════════════════════════════════════════════════════════
   3 — DJ TRACK BROWSER  (scroll & pick songs in landscape)
══════════════════════════════════════════════════════════════ */

let browserTarget = 'A';   // which deck a plain row-tap loads to
let browserSort   = 'folder';
let browserQuery  = '';

/* The browser is a DOCK that lives BELOW the console inside the same
   scroll container (.dj-content). While mixing, drag/scroll down and
   your music is right there — grouped by folder — with the waveform
   strip staying pinned to the top so the mix never leaves your sight. */
function buildBrowser() {
  const content = document.querySelector('#page-dj .dj-content');
  if (!content || $18('djBrowser')) return;

  const el = document.createElement('div');
  el.id = 'djBrowser';
  el.innerHTML = `
    <div class="djb-grip"><span></span>MUSIC — scroll for library<span></span></div>
    <div class="djb-head">
      <div class="djb-target">
        <span style="font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--t3)">LOAD&nbsp;TO</span>
        <button class="djb-tbtn a active" id="djbTargetA">DECK A</button>
        <button class="djb-tbtn b" id="djbTargetB">DECK B</button>
      </div>
      <input id="djbSearch" placeholder="Search tracks…"/>
      <select id="djbSort">
        <option value="folder">Folders</option>
        <option value="name">Name</option>
        <option value="bpm">BPM</option>
        <option value="key">Key</option>
        <option value="recent">Recent</option>
      </select>
      <button id="djbTop" class="djb-close" title="Back to decks">▲</button>
    </div>
    <div class="djb-list" id="djbList"></div>`;
  content.appendChild(el);   // after decks/fx/eq views → below the console

  $18('djbTop').onclick    = () => content.scrollTo({ top: 0, behavior: 'smooth' });
  $18('djbSearch').oninput = e => { browserQuery = e.target.value.toLowerCase(); renderBrowserList(); };
  $18('djbSort').onchange  = e => { browserSort = e.target.value; renderBrowserList(); };
  $18('djbTargetA').onclick = () => setBrowserTarget('A');
  $18('djbTargetB').onclick = () => setBrowserTarget('B');

  // Hint chevron pinned at the bottom edge of the console screenful
  const page = $18('page-dj');
  if (page && !$18('djScrollHint')) {
    const hint = document.createElement('div');
    hint.id = 'djScrollHint';
    hint.textContent = '⌄ music ⌄';
    hint.addEventListener('click', () => openBrowser());
    page.appendChild(hint);            // .page is positioned → hint stays put
    content.addEventListener('scroll', () => {
      hint.classList.toggle('hidden', content.scrollTop > 30);
    }, { passive: true });
  }

  // Mini play/pause buttons pinned on the (sticky) waveform strip —
  // control both decks even while scrolled deep into the music dock
  const strip = $18('djWaveStrip');
  if (strip && !$18('wavePlayA')) {
    ['A','B'].forEach(d => {
      const b = document.createElement('button');
      b.id = `wavePlay${d}`;
      b.className = 'wave-mini-play';
      b.textContent = '▶';
      b.addEventListener('click', e => { e.stopPropagation(); MS.toggleDeck(d); });
      strip.appendChild(b);
    });
    MS.on('deck:toggle', ({ deck, playing }) => {
      const b = $18(`wavePlay${deck}`);
      if (b) b.textContent = playing ? '⏸' : '▶';
    });
  }
  renderBrowserList();
}

function setBrowserTarget(d) {
  browserTarget = d;
  $18('djbTargetA')?.classList.toggle('active', d === 'A');
  $18('djbTargetB')?.classList.toggle('active', d === 'B');
}

/* "Open" = scroll the dock into view (targeted at a deck if given) */
function openBrowser(targetDeck) {
  buildBrowser();
  if (targetDeck) setBrowserTarget(targetDeck);
  renderBrowserList();
  $18('djBrowser')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.openDJBrowser = openBrowser;

function sortedTracks() {
  let list = [...(MS.library || [])];
  if (browserQuery) list = list.filter(t =>
    (t.title || '').toLowerCase().includes(browserQuery) ||
    (t.artist || '').toLowerCase().includes(browserQuery) ||
    (t.genre || '').toLowerCase().includes(browserQuery));
  const by = {
    folder: (a,b) => folderOf(a).localeCompare(folderOf(b)) || (a.title||'').localeCompare(b.title||''),
    name:   (a,b) => (a.title||'').localeCompare(b.title||''),
    bpm:    (a,b) => (a.bpm||999) - (b.bpm||999),
    key:    (a,b) => (a.key||'zz').localeCompare(b.key||'zz'),
    recent: (a,b) => (b.lastPlayed||b.dateImported||0) - (a.lastPlayed||a.dateImported||0),
  };
  return list.sort(by[browserSort] || by.name);
}

/* Folder = the directory part of the track's imported path.
   "Soca 2024/Machel - Song.mp3" → "Soca 2024". Root files → "Music". */
function folderOf(t) {
  const p = t.path || '';
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : 'Music';
}

const collapsedFolders = new Set(JSON.parse(localStorage.getItem('vz_dj_collapsed') || '[]'));
function toggleFolder(name) {
  collapsedFolders.has(name) ? collapsedFolders.delete(name) : collapsedFolders.add(name);
  localStorage.setItem('vz_dj_collapsed', JSON.stringify([...collapsedFolders]));
  renderBrowserList();
}
window.djToggleFolder = toggleFolder;

function trackRow(t) {
  return `
    <div class="djb-row" data-tid="${esc18(t.id)}">
      <div class="djb-main">
        <div class="djb-title">${esc18(t.title)}</div>
        <div class="djb-sub">${esc18(t.artist || 'Unknown')}</div>
      </div>
      <span class="djb-badge bpm">${t.bpm ? Math.round(t.bpm) : '—'}<small>BPM</small></span>
      <span class="djb-badge key">${esc18(t.key || '—')}</span>
      <button class="djb-load a" data-deck="A" data-tid="${esc18(t.id)}">A</button>
      <button class="djb-load b" data-deck="B" data-tid="${esc18(t.id)}">B</button>
    </div>`;
}

function renderBrowserList() {
  const box = $18('djbList');
  if (!box) return;
  const tracks = sortedTracks();

  let trackRows;
  if (!tracks.length) {
    trackRows = `<div class="djb-empty">No tracks in your library yet.<br><span style="font-size:11px;color:var(--t3)">Go to Library → Open Folder to import your music, then come back here.</span></div>`;
  } else if (browserSort === 'folder' && !browserQuery) {
    // Group by folder, collapsible — scroll through your folders like a crate wall
    const groups = new Map();
    tracks.forEach(t => {
      const f = folderOf(t);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(t);
    });
    trackRows = [...groups.entries()].map(([folder, list]) => {
      const closed = collapsedFolders.has(folder);
      return `
        <div class="djb-folder ${closed ? 'closed' : ''}" onclick="djToggleFolder('${esc18(folder).replace(/'/g,"\\'")}')">
          <span class="djb-folder-chev">${closed ? '▸' : '▾'}</span>
          📁 ${esc18(folder)}
          <span class="djb-folder-count">${list.length}</span>
        </div>
        ${closed ? '' : list.map(trackRow).join('')}`;
    }).join('');
  } else {
    trackRows = tracks.map(trackRow).join('');
  }

  const streams = (window.PRESEEDED_STREAMS || []).filter(s => s.type !== 'mp4');
  const radios  = (MS.stream?.all?.() || Radio.stations());

  box.innerHTML = `
    <div class="djb-group">LIBRARY · ${tracks.length}</div>${trackRows}
    ${streams.length ? `<div class="djb-group">STREAMS</div>` + streams.map((s,i) => `
      <div class="djb-row" data-stream="${i}">
        <div class="djb-main"><div class="djb-title">${esc18(s.name)}</div><div class="djb-sub">Stream · ${s.type.toUpperCase()}</div></div>
        <button class="djb-load a" data-deck="A" data-stream="${i}">A</button>
        <button class="djb-load b" data-deck="B" data-stream="${i}">B</button>
      </div>`).join('') : ''}
    <div class="djb-group">LIVE RADIO</div>
    ${radios.map(r => `
      <div class="djb-row" data-radio="${esc18(r.id)}">
        <div class="djb-main"><div class="djb-title">📻 ${esc18(r.name)}</div><div class="djb-sub">${esc18(r.genre)}</div></div>
        <button class="djb-load a" data-deck="A" data-radio="${esc18(r.id)}">A</button>
        <button class="djb-load b" data-deck="B" data-radio="${esc18(r.id)}">B</button>
      </div>`).join('')}`;

  box.querySelectorAll('.djb-load').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    loadFromBrowser(btn.dataset.deck, btn);
  }));
  box.querySelectorAll('.djb-row').forEach(row => row.addEventListener('click', () => loadFromBrowser(browserTarget, row)));
}

function loadFromBrowser(deck, el) {
  const tid = el.dataset.tid, si = el.dataset.stream, rid = el.dataset.radio;
  if (tid) {
    const t = MS.library.find(x => x.id === tid);
    if (t) MS.loadDeck(deck, t);
  } else if (si != null) {
    const s = (window.PRESEEDED_STREAMS || [])[+si];
    if (s) MS.loadStreamToDeck(deck, s.url, s.type);
  } else if (rid) {
    const r = (MS.stream?.all?.() || Radio.stations()).find(x => x.id === rid);
    if (r) MS.loadStreamToDeck(deck, r.url, 'live');
  }
  const row = el.closest('.djb-row') || el;
  row.classList.add('loaded-flash');
  setTimeout(() => row.classList.remove('loaded-flash'), 600);
}

/* Rewire the deck LOAD buttons: open the browser targeted at that deck
   (old behaviour required pre-selecting a track on the Library page). */
function rewireLoadButtons() {
  ['A','B'].forEach(d => {
    const old = $18(`dj${d}Load`);
    if (!old) return;
    const btn = old.cloneNode(true);          // strips previous listeners
    old.parentNode.replaceChild(btn, old);
    btn.textContent = 'LOAD ≡';
    btn.addEventListener('click', () => openBrowser(d));
  });
}

/* Browse button in the DJ subtab bar */
function addBrowseTab() {
  const bar = document.querySelector('.dj-subtabs');
  if (!bar || $18('djBrowseTab')) return;
  const b = document.createElement('button');
  b.className = 'dj-stab';
  b.id = 'djBrowseTab';
  b.textContent = '≡ Browse';
  b.addEventListener('click', () => openBrowser());
  bar.appendChild(b);
}

MS.on && MS.on('library:updated', () => renderBrowserList());

/* ══════════════════════════════════════════════════════════════
   4 — PRO DJ FEATURES
══════════════════════════════════════════════════════════════ */

const Pro = {
  A: { keylock:true, loop:null, loopBeats:4, eq:{lo:null,mid:null,hi:null}, filter:null },
  B: { keylock:true, loop:null, loopBeats:4, eq:{lo:null,mid:null,hi:null}, filter:null },
};

function deckAudio(d) { return d === 'A' ? MS.audio?.A : MS.audio?.B; }
function deckBpm(d)   { return MS.deck?.[d]?.track?.bpm || null; }
function beatLen(d)   { const b = deckBpm(d); return b ? 60 / b : 0.5; } // 0.5s fallback ≈ 120 BPM

/* — Keylock — */
function applyKeylock(d) {
  const a = deckAudio(d);
  if (!a) return;
  const on = Pro[d].keylock;
  a.preservesPitch = on;
  a.mozPreservesPitch = on;
  a.webkitPreservesPitch = on;
  const btn = $18(`djKeylock${d}`);
  if (btn) { btn.classList.toggle('on', on); btn.textContent = on ? '🔒 KEY' : '🔓 KEY'; }
}

/* — Loops — */
function toggleLoop(d) {
  const a = deckAudio(d);
  if (!a || !a.duration) { MS.toast(`Load a track on Deck ${d} first.`, 'warn'); return; }
  if (Pro[d].loop) { Pro[d].loop = null; }
  else {
    const len = beatLen(d) * Pro[d].loopBeats;
    Pro[d].loop = { start: a.currentTime, end: Math.min(a.duration, a.currentTime + len) };
    MS.toast(`Deck ${d}: ${Pro[d].loopBeats}-beat loop`, 'ok', 1400);
  }
  updateLoopUI(d);
}
function resizeLoop(d, factor) {
  Pro[d].loopBeats = Math.min(32, Math.max(0.5, Pro[d].loopBeats * factor));
  if (Pro[d].loop) {
    Pro[d].loop.end = Pro[d].loop.start + beatLen(d) * Pro[d].loopBeats;
  }
  updateLoopUI(d);
}
function updateLoopUI(d) {
  const btn = $18(`djLoop${d}`);
  if (btn) {
    btn.classList.toggle('on', !!Pro[d].loop);
    btn.textContent = `LOOP ${Pro[d].loopBeats % 1 ? Pro[d].loopBeats.toFixed(1) : Pro[d].loopBeats}`;
  }
}
setInterval(() => {                    // loop enforcement
  ['A','B'].forEach(d => {
    const L = Pro[d].loop, a = deckAudio(d);
    if (L && a && !a.paused && a.currentTime >= L.end) a.currentTime = L.start;
  });
}, 25);

/* — Beat jump — */
function beatJump(d, beats) {
  const a = deckAudio(d);
  if (!a || !a.duration) return;
  a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + beatLen(d) * beats));
}

/* — 3-band EQ + color filter per deck —
   The engine wires: gainA → limiter, gainB → limiter.
   We splice per-deck chains in AFTER the deck gain:
   gain → filter(sweep) → lowShelf → midPeak → highShelf → limiter.
   Faders / crossfader keep working untouched (they set gain values). */
function buildDeckChains() {
  const ctx = MS.audioCtx;
  if (!ctx || !MS.limiter || Pro.A.filter) return;   // already built or too early
  ['A','B'].forEach(d => {
    const gain = d === 'A' ? MS.gainA : MS.gainB;
    if (!gain) return;
    const filter = ctx.createBiquadFilter(); filter.type = 'allpass'; filter.frequency.value = 1000;
    const lo  = ctx.createBiquadFilter(); lo.type = 'lowshelf';  lo.frequency.value = 200;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking';  mid.frequency.value = 1000; mid.Q.value = 0.8;
    const hi  = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4000;
    try { gain.disconnect(MS.limiter); } catch {}
    gain.connect(filter); filter.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(MS.limiter);
    Pro[d].filter = filter;
    Pro[d].eq = { lo, mid, hi };
  });
}
MS.on && MS.on('audio:ready', buildDeckChains);

function setEQ(d, band, db) {
  buildDeckChains();
  const n = Pro[d].eq[band];
  if (n) n.gain.value = db;
}
function setFilter(d, v) {              // v: -1 … 0 … +1
  buildDeckChains();
  const f = Pro[d].filter;
  if (!f) return;
  if (Math.abs(v) < 0.06) { f.type = 'allpass'; f.frequency.value = 1000; f.Q.value = 0.0001; return; }
  if (v < 0) {                          // low-pass sweep: closes as v → -1
    f.type = 'lowpass';
    f.frequency.value = 22000 * Math.pow(0.006, -v); // 22k → ~130 Hz
  } else {                              // high-pass sweep: rises as v → +1
    f.type = 'highpass';
    f.frequency.value = 20 * Math.pow(400, v);       // 20 → ~8 kHz
  }
  f.Q.value = 0.9;
}

/* — Inject pro control rows into each deck — */
function injectProControls() {
  ['A','B'].forEach(d => {
    const deckEl = $18(`dj${d}PadToggle`)?.parentElement;
    if (!deckEl || $18(`djProRow${d}`)) return;
    const wrap = document.createElement('div');
    wrap.id = `djProRow${d}`;
    wrap.className = 'dj-pro-wrap';
    wrap.innerHTML = `
      <div class="dj-pro-row">
        <button class="dd-btn pro" id="djKeylock${d}">🔒 KEY</button>
        <button class="dd-btn pro" id="djJumpBack${d}">⏮ 4</button>
        <button class="dd-btn pro loop" id="djLoop${d}">LOOP 4</button>
        <button class="dd-btn pro" id="djLoopHalf${d}">½×</button>
        <button class="dd-btn pro" id="djLoopDbl${d}">2×</button>
        <button class="dd-btn pro" id="djJumpFwd${d}">4 ⏭</button>
      </div>
      <div class="dj-eq-row">
        ${['hi','mid','lo'].map(b => `
          <div class="dj-eq-band">
            <span class="dj-eq-lbl">${b.toUpperCase()}</span>
            <input type="range" class="dj-eq-slider" id="djEQ${d}${b}" min="-12" max="12" step="0.5" value="0"/>
          </div>`).join('')}
      </div>
      <div class="dj-filter-row">
        <span class="dj-eq-lbl">LP ◀ FILTER ▶ HP</span>
        <input type="range" id="djFilter${d}" min="-1" max="1" step="0.01" value="0"/>
      </div>`;
    deckEl.appendChild(wrap);

    $18(`djKeylock${d}`).addEventListener('click', () => { Pro[d].keylock = !Pro[d].keylock; applyKeylock(d); });
    $18(`djLoop${d}`).addEventListener('click',     () => toggleLoop(d));
    $18(`djLoopHalf${d}`).addEventListener('click', () => resizeLoop(d, 0.5));
    $18(`djLoopDbl${d}`).addEventListener('click',  () => resizeLoop(d, 2));
    $18(`djJumpBack${d}`).addEventListener('click', () => beatJump(d, -4));
    $18(`djJumpFwd${d}`).addEventListener('click',  () => beatJump(d, +4));
    ['hi','mid','lo'].forEach(b => $18(`djEQ${d}${b}`).addEventListener('input', e => setEQ(d, b, +e.target.value)));
    $18(`djFilter${d}`).addEventListener('input', e => setFilter(d, +e.target.value));
    $18(`djFilter${d}`).addEventListener('dblclick', e => { e.target.value = 0; setFilter(d, 0); });
    applyKeylock(d);
  });
}

/* Keylock must re-apply every time a new track lands on the deck
   (a fresh src resets nothing, but be safe) */
MS.on && MS.on('deck:loaded', ({ deck }) => { applyKeylock(deck); Pro[deck].loop = null; updateLoopUI(deck); });

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
@keyframes radioPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.75)} }
.source-item.radio-live { border-color:rgba(0,230,118,.4); background:rgba(0,230,118,.05); }
.si-btn.radio-stop { border-color:var(--red); color:var(--red); }
.radio-fav {
  width:30px; height:30px; border-radius:7px; object-fit:cover;
  background:var(--bg3); flex-shrink:0; border:1px solid var(--border);
}
.radio-note { color:var(--t3); font-size:11.5px; padding:12px 8px; text-align:center; }
#radioTTSearch {
  width:calc(100% - 32px); margin:0 16px 8px;
  background:var(--bg3); border:1px solid var(--border);
  border-radius:8px; color:var(--t1); padding:8px 12px; font-size:12.5px; outline:none;
  display:block;
}
#radioTTSearch:focus { border-color:var(--cyan); }

/* Decks gain a scrollbar so pro controls are always reachable */
.dj-deck { overflow-y:auto !important; }

/* ── DJ scroll-down layout ──
   .dj-content is the single scroll surface. The console (decks view)
   fills exactly one screenful; the music dock sits below it. The
   waveform strip is sticky so the mix stays visible while digging. */
@media (orientation:landscape) {
  .twin-decks.active, .fx-pad-view.active, #geqView.active {
    flex:none !important;
    min-height:calc(100svh - 88px);
  }
  .dj-wave-strip {
    position:sticky; top:0; z-index:20;
    background:rgba(5,5,5,.92); backdrop-filter:blur(6px);
  }
}
/* Mini deck play buttons pinned on the waveform strip — pause/resume
   either deck even while scrolled deep into the music dock */
.wave-mini-play {
  position:absolute; top:50%; transform:translateY(-50%);
  width:34px; height:34px; border-radius:50%;
  border:1px solid; background:rgba(5,5,5,.72);
  font-size:13px; cursor:pointer; z-index:2;
  display:grid; place-items:center;
}
#wavePlayA { left:6px;  color:var(--cyan); border-color:rgba(47,155,255,.5); }
#wavePlayB { right:6px; color:var(--mag);  border-color:rgba(255,45,77,.5); }

/* Scroll hint chevron at the bottom of the console screenful */
#djScrollHint {
  position:absolute; bottom:4px; left:50%; transform:translateX(-50%);
  z-index:15; font-size:9px; font-weight:800; letter-spacing:.18em;
  color:var(--t3); text-transform:uppercase; cursor:pointer;
  padding:4px 14px; border-radius:12px; background:rgba(5,5,5,.6);
  animation:hintBob 1.8s ease-in-out infinite;
  transition:opacity .25s;
}
#djScrollHint.hidden { opacity:0; pointer-events:none; }
@keyframes hintBob { 0%,100%{transform:translate(-50%,0)} 50%{transform:translate(-50%,4px)} }

/* ── DJ Music Dock (below the console) ── */
#djBrowser {
  min-height:calc(100svh - 88px);
  display:flex; flex-direction:column;
  background:linear-gradient(rgba(255,255,255,.02), transparent 60px), var(--bg);
  border-top:1px solid var(--border);
}
.djb-grip {
  display:flex; align-items:center; justify-content:center; gap:10px;
  padding:7px 0 3px; font-size:8px; font-weight:900; letter-spacing:.2em;
  color:var(--t3); text-transform:uppercase;
}
.djb-grip span { width:34px; height:3px; border-radius:2px; background:var(--border2); }
.djb-head {
  display:flex; align-items:center; gap:8px;
  padding:6px 12px 8px; border-bottom:1px solid var(--border);
  flex-shrink:0; flex-wrap:wrap;
  position:sticky; top:47px; z-index:10;
  background:rgba(5,5,5,.94); backdrop-filter:blur(6px);
}
.djb-target { display:flex; align-items:center; gap:5px; }
.djb-tbtn {
  border:1px solid var(--border); background:var(--bg3); color:var(--t3);
  border-radius:8px; padding:9px 13px; font-size:11px; font-weight:900; cursor:pointer;
}
.djb-tbtn.a.active { border-color:var(--cyan); color:var(--cyan); background:rgba(47,155,255,.12); }
.djb-tbtn.b.active { border-color:var(--mag);  color:var(--mag);  background:rgba(255,45,77,.12); }
#djbSearch {
  flex:1; min-width:110px; background:var(--bg3); border:1px solid var(--border);
  border-radius:8px; color:var(--t1); padding:9px 12px; font-size:13px; outline:none;
}
#djbSort {
  background:var(--bg3); border:1px solid var(--border); color:var(--t2);
  border-radius:8px; padding:9px 6px; font-size:12px;
}
.djb-close {
  border:1px solid var(--border); background:var(--bg3); color:var(--t2);
  border-radius:8px; width:38px; height:38px; font-size:14px; cursor:pointer; flex-shrink:0;
}
.djb-list { flex:1; padding:4px 8px 40px; }
.djb-group {
  font-size:9px; font-weight:900; letter-spacing:.12em; color:var(--t3);
  padding:14px 6px 5px;
}
.djb-folder {
  display:flex; align-items:center; gap:8px;
  padding:11px 10px; margin-top:4px; border-radius:9px;
  background:var(--bg2); border:1px solid var(--border);
  font-size:12.5px; font-weight:700; color:var(--t1); cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.djb-folder:active { background:var(--bg3); }
.djb-folder-chev { color:var(--t3); font-size:10px; width:12px; }
.djb-folder-count {
  margin-left:auto; font-family:var(--mono); font-size:10px; color:var(--t3);
  background:var(--bg3); border-radius:5px; padding:2px 7px;
}
.djb-row {
  display:flex; align-items:center; gap:8px;
  padding:10px 8px; border-radius:9px; cursor:pointer;
  border:1px solid transparent;
  min-height:48px; -webkit-tap-highlight-color:transparent;
}
.djb-row:active { background:var(--bg3); }
.djb-row.loaded-flash { border-color:var(--green); background:rgba(0,230,118,.08); }
.djb-main { flex:1; min-width:0; }
.djb-title { font-size:13px; font-weight:600; color:var(--t1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.djb-sub   { font-size:10.5px; color:var(--t3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.djb-badge {
  font-family:var(--mono); font-size:10px; color:var(--yellow);
  background:var(--bg3); border:1px solid var(--border);
  border-radius:5px; padding:3px 6px; flex-shrink:0; min-width:34px; text-align:center;
}
.djb-badge small { font-size:6px; display:block; color:var(--t3); letter-spacing:.08em; }
.djb-badge.key { color:var(--cyan); }
.djb-load {
  width:42px; height:42px; border-radius:9px; font-weight:900; font-size:13px;
  cursor:pointer; flex-shrink:0; border:1px solid var(--border); background:var(--bg3);
  -webkit-tap-highlight-color:transparent;
}
.djb-load:active { transform:scale(.92); }
.djb-load.a { color:var(--cyan); border-color:rgba(47,155,255,.4); }
.djb-load.b { color:var(--mag);  border-color:rgba(255,45,77,.4); }
.djb-empty { text-align:center; color:var(--t2); padding:34px 20px; font-size:13px; line-height:1.7; }

/* Bigger transport touch targets on the decks */
.dd-btn { min-height:38px; font-size:10px; }
.dd-play { min-height:44px; font-size:17px; }

/* ── Pro controls ── */
.dj-pro-wrap { display:flex; flex-direction:column; gap:4px; margin-top:4px; flex-shrink:0; }
.dj-pro-row { display:grid; grid-template-columns:repeat(6,1fr); gap:3px; }
.dd-btn.pro { font-size:8px; padding:5px 2px; }
.dd-btn.pro.on, .dd-btn.pro.loop.on { border-color:var(--green); color:var(--green); background:rgba(0,230,118,.1); }
#djKeylockA.on, #djKeylockB.on { border-color:var(--yellow); color:var(--yellow); background:rgba(251,191,36,.1); }
.dj-eq-row { display:flex; gap:6px; }
.dj-eq-band { flex:1; display:flex; align-items:center; gap:4px; }
.dj-eq-lbl { font-size:7px; font-weight:800; letter-spacing:.08em; color:var(--t3); flex-shrink:0; width:auto; }
.dj-eq-slider { flex:1; height:14px; accent-color:var(--cyan); min-width:0; }
.dj-filter-row { display:flex; align-items:center; gap:6px; }
.dj-filter-row input { flex:1; accent-color:var(--mag); height:14px; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init18() {
  ['A','B','main'].forEach(k => { const a = MS.audio?.[k]; if (a) a.crossOrigin = 'anonymous'; });
  ['A','B'].forEach(k => {
    const a = MS.audio?.[k];
    if (a) a.addEventListener('error', () => {
      if (a.src && /^https?:/.test(a.src) && MS.deck?.[k]?.track?.source === 'stream') {
        MS.toast(`Deck ${k}: this station can't be mixed (no CORS) — play it from the Stream tab instead.`, 'warn', 4200);
      }
    });
  });
  // Phase 19 replaced the Stream tab entirely (MS.stream owns T&T + World
  // Radio now) — the old renderRadioSection()/Radio.loadTT() here would
  // just be a redundant duplicate fetch against a page section that no
  // longer exists, so it's skipped.
  buildBrowser();
  rewireLoadButtons();
  addBrowseTab();
  injectProControls();
  console.info('[868 Vibez] Phase 18 ready — Radio + DJ Pro');
}
// app-ui.js binds its handlers on DOMContentLoaded; run after it.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init18, 0));
} else {
  setTimeout(init18, 0);
}

})();
