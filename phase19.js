/* ============================================================
   868 VIBEZ — Phase 19: Rebuild Pass
   1. Android-safe import wiring (Songs / Folder buttons)
   2. Spinning vinyl artwork — splash, Player disc, DJ decks A/B
   3. Clean Stream/Radio tab — T&T stations by frequency with
      Call/WhatsApp, World Radio limited to Radio Paradise x3
   4. Removed: mini-player bar, swipe-between-pages, Video tab
      remnants, all portal/pre-seeded/SomaFM stream content
   ============================================================ */
'use strict';

(function () {
const $19 = id => document.getElementById(id);
const esc19 = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* ══════════════════════════════════════════════════════════════
   1 — ANDROID-SAFE IMPORT
══════════════════════════════════════════════════════════════ */
function wireImportButtons() {
  const folderInput = $19('importFolderInput');
  const songsInput  = $19('importSongsInput');
  const hasFSA = 'showDirectoryPicker' in window;

  async function pickFolder() {
    if (hasFSA) { await MS.openFolder(); return; }
    folderInput.value = '';
    folderInput.click();
  }
  async function pickSongs() {
    songsInput.value = '';
    songsInput.click();
  }

  folderInput?.addEventListener('change', async e => {
    MS.toast('Importing folder…', 'info', 1600);
    await MS.importFileList(e.target.files, true);
  });
  songsInput?.addEventListener('change', async e => {
    MS.toast('Importing songs…', 'info', 1600);
    await MS.importFileList(e.target.files, false);
  });

  ['npAddSongsBtn'].forEach(id => $19(id)?.addEventListener('click', pickSongs));
  ['npAddFolderBtn'].forEach(id => $19(id)?.addEventListener('click', pickFolder));
  $19('libAddSongs')?.addEventListener('click', pickSongs);

  // libOpenFolder already has a click listener wired in app-ui.js that
  // calls MS.openFolder() directly — that fails silently on Android
  // (shows a toast, does nothing else). Replace it with the smart picker.
  const oldLibBtn = $19('libOpenFolder');
  if (oldLibBtn) {
    const btn = oldLibBtn.cloneNode(true);
    oldLibBtn.parentNode.replaceChild(btn, oldLibBtn);
    btn.addEventListener('click', async () => { await pickFolder(); refreshLibrary?.(); });
  }
}

/* ══════════════════════════════════════════════════════════════
   2 — SPINNING VINYL ARTWORK
══════════════════════════════════════════════════════════════ */
function setSpin(el, spinning) {
  if (!el) return;
  el.classList.toggle('spinning', !!spinning);
}

function updateVinylSpin() {
  // Main player disc spins with the main audio element
  const mainPlaying = MS.audio?.main && !MS.audio.main.paused && !MS.audio.main.ended;
  setSpin($19('npVinylDisc'), mainPlaying);

  // DJ deck art spins per-deck with its own playing state
  setSpin($19('djPlatterArtA'), MS.deck?.A?.playing);
  setSpin($19('djPlatterArtB'), MS.deck?.B?.playing);
}
setInterval(updateVinylSpin, 300);
MS.on && MS.on('player:play', () => setTimeout(updateVinylSpin, 60));
MS.on && MS.on('deck:toggle', () => setTimeout(updateVinylSpin, 60));
MS.on && MS.on('deck:loaded', () => setTimeout(updateVinylSpin, 60));
document.addEventListener('play',  () => setTimeout(updateVinylSpin, 60), true);
document.addEventListener('pause', () => setTimeout(updateVinylSpin, 60), true);

/* ══════════════════════════════════════════════════════════════
   3 — REMOVE: mini-player bar, swipe nav
══════════════════════════════════════════════════════════════ */
function killMiniPlayer() {
  const mp = $19('miniPlayer');
  if (mp) mp.remove();
  // buildMiniPlayer/updateMiniPlayer (phase2.js) run on an interval and
  // on DOMContentLoaded — neutralize them so the bar can't reappear.
  window.buildMiniPlayer  = () => {};
  window.updateMiniPlayer = () => {};
}

function killSwipeNav() {
  MS.swipeNav?.disable?.();
  // Belt-and-braces: if anything re-enables it later, disable again.
  setInterval(() => MS.swipeNav?.disable?.(), 4000);
}

/* ══════════════════════════════════════════════════════════════
   4 — CLEAN STREAM / RADIO TAB
   T&T stations only, sorted by broadcast frequency, each with a
   Call + WhatsApp button. World Radio limited to the 3 Radio
   Paradise stations. Everything else (portals, pre-seeded demo
   tracks, SomaFM, in-app browser) is gone.
══════════════════════════════════════════════════════════════ */
const WORLD_RADIO = [
  { id:'rp-main',   name:'Radio Paradise — Main Mix', genre:'Eclectic Rock',     url:'https://stream.radioparadise.com/mp3-192' },
  { id:'rp-mellow', name:'Radio Paradise — Mellow',   genre:'Chill / Downtempo', url:'https://stream.radioparadise.com/mellow-192' },
  { id:'rp-rock',   name:'Radio Paradise — Rock',     genre:'Rock',              url:'https://stream.radioparadise.com/rock-192' },
];

const RB_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

const StreamHub = {
  tt: [],
  ttState: 'idle',       // idle | loading | ready | error
  current: null,
  state: 'idle',
  el: null,

  /* Pull a broadcast frequency (e.g. 96.1) out of a station's name so
     the list can be sorted the way T&T listeners actually think about
     their dial, low to high. Stations with no parseable frequency sort
     to the bottom. */
  freqOf(name) {
    const m = name.match(/(\d{2,3}(?:\.\d)?)\s*(?:FM|fm)?\b/);
    return m ? parseFloat(m[1]) : 9999;
  },

  async loadTT(force = false) {
    if (this.ttState === 'loading') return;
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem('vz_tt_stations_v2') || 'null');
        if (c && Date.now() - c.at < 864e5 && c.list?.length) {
          this.tt = c.list; this.ttState = 'ready'; renderStreamPage(); return;
        }
      } catch {}
    }
    this.ttState = 'loading';
    renderStreamPage();
    const path = '/json/stations/search?countrycode=TT&hidebroken=true&order=clickcount&reverse=true&limit=120';
    for (const server of RB_SERVERS) {
      try {
        const res = await fetch(server + path, { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) continue;
        const raw = await res.json();
        const seen = new Set();
        this.tt = raw
          .map(s => ({ ...s, streamUrl: s.url_resolved || s.url }))
          .filter(s => /^https:\/\//i.test(s.streamUrl) && !s.hls)
          .filter(s => { const k = s.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .map(s => {
            const name = s.name.trim();
            return {
              id: 'tt_' + s.stationuuid,
              name,
              freq: this.freqOf(name),
              genre: (s.tags || '').split(',').slice(0, 3).join(' · ') || 'Trinidad & Tobago',
              url: s.streamUrl,
              homepage: /^https?:\/\//i.test(s.homepage || '') ? s.homepage : '',
              favicon: /^https:\/\//i.test(s.favicon || '') ? s.favicon : '',
            };
          })
          .sort((a, b) => a.freq - b.freq);
        this.ttState = 'ready';
        localStorage.setItem('vz_tt_stations_v2', JSON.stringify({ at: Date.now(), list: this.tt }));
        renderStreamPage();
        return;
      } catch { /* try next mirror */ }
    }
    this.ttState = 'error';
    renderStreamPage();
  },

  all() { return [...this.tt, ...WORLD_RADIO]; },

  _ensureEl() {
    if (this.el) return this.el;
    const a = new Audio();
    a.preload = 'none';
    a.crossOrigin = 'anonymous';
    a.addEventListener('playing', () => { this.state = 'playing'; renderStreamPage(); });
    a.addEventListener('waiting', () => { this.state = 'loading'; renderStreamPage(); });
    a.addEventListener('error', () => {
      if (this.state === 'idle') return;
      this.state = 'error';
      MS.toast(`Station unreachable: ${this.current?.name || ''}`, 'error', 3500);
      renderStreamPage();
    });
    this.el = a;
    return a;
  },

  play(station) {
    const a = this._ensureEl();
    try { MS.audio?.main?.pause(); MS.audio?.A?.pause(); MS.audio?.B?.pause(); } catch {}
    if (MS.deck) { MS.deck.A.playing = false; MS.deck.B.playing = false; }
    this.current = station;
    this.state = 'loading';
    renderStreamPage();
    a.src = station.url;
    a.load();
    a.play().then(() => {
      this.state = 'playing';
      MS.toast(`📻 ${station.name}`, 'ok', 2000);
      renderStreamPage();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: station.name, artist: '868 Vibez Radio', album: station.genre });
      }
    }).catch(e => {
      this.state = 'error';
      MS.toast(`Couldn't play ${station.name}.`, 'error', 3200);
      renderStreamPage();
    });
  },

  stop() {
    if (!this.el) return;
    this.state = 'idle';
    this.el.pause();
    this.el.removeAttribute('src');
    try { this.el.load(); } catch {}
    this.current = null;
    renderStreamPage();
  },

  toggle(id) {
    const st = this.all().find(s => s.id === id);
    if (!st) return;
    (this.current?.id === id && this.state !== 'error' && this.state !== 'idle') ? this.stop() : this.play(st);
  },
};
window.MS && (MS.stream = StreamHub);
document.addEventListener('play', e => {
  if (StreamHub.el && e.target !== StreamHub.el && StreamHub.state !== 'idle') StreamHub.stop();
}, true);

/* ── Per-station Call/WhatsApp numbers ──
   Researched against each station's own website/social media where
   possible. Radio-browser.info station names vary in exact wording, so
   matching is done by keyword pattern rather than exact string.

   Three tiers:
   - confirmed: matches the station's own official website/social page
   - partial:   phone confirmed independently; WhatsApp not verified
                anywhere, or numbers come from directories rather than
                the station itself
   - unverified: nothing independent corroborates this number — shown
                 with a clear warning before the person taps Call/WhatsApp

   A user-entered number (via the 📞+ editor) always overrides these. */
const CONTACT_DB = [
  { match: /slam/i,                    tier: 'confirmed', phone: '+18686241005', wa: '+18687077526' },
  { match: /vibe\s*ct/i,                tier: 'confirmed', phone: '+18686235105', wa: '+18683881051' },
  { match: /boom\s*champions/i,         tier: 'confirmed', phone: '+18686276937', wa: '+18683229494' },
  { match: /talk\s*city/i,              tier: 'confirmed', phone: '+18686224911', wa: '+18683944911' },
  { match: /^next\s*99/i,               tier: 'confirmed', phone: '+18686283006', wa: '+18683104991' },
  { match: /sangeet/i,                  tier: 'confirmed', phone: '+18686230106', wa: '+18683431061' },
  { match: /radio\s*90\.?5/i,           tier: 'confirmed', phone: '+18686229050', wa: '+18683649050' },
  { match: /sky\s*99\.?5/i,             tier: 'confirmed', phone: '+18686252759', wa: '+18683339950' },
  { match: /bacchanal/i,                tier: 'confirmed', phone: '+18686852260', wa: '' },
  { match: /the\s*street|street\s*91/i, tier: 'confirmed', phone: '+18686390791', wa: '' },

  { match: /isaac/i,                    tier: 'partial', phone: '+18686221981', wa: '+18682751981' },
  { match: /sweet\s*(fm)?\s*100/i,      tier: 'partial', phone: '+18686284100', wa: '+18683484100' },
  { match: /103\s*fm|^103\b/i,          tier: 'partial', phone: '+18686289222', wa: '+18686284103' },
  { match: /ultimate\s*one|95\.?1/i,    tier: 'partial', phone: '+18686252095', wa: '+18683949595' },
  { match: /music\s*radio\s*97/i,       tier: 'partial', phone: '+18686229797', wa: '+18683249797' },

  { match: /wack/i,                     tier: 'partial', phone: '+18686529774', wa: '' },
  { match: /tambrin/i,                  tier: 'partial', phone: '+18686393437', wa: '' },
  { match: /hott\s*93/i,                tier: 'partial', phone: '+18686258426', wa: '' },
  { match: /star\s*94\.?7|star\s*947/i, tier: 'partial', phone: '+18686282947', wa: '' },
  { match: /w\s*107/i,                  tier: 'partial', phone: '+18686284107', wa: '' },
  { match: /power\s*102/i,              tier: 'partial', phone: '+18686276937', wa: '' },
  { match: /heartbeat/i,                tier: 'partial', phone: '+18682223104', wa: '' },
  { match: /jaagriti/i,                 tier: 'partial', phone: '+18686632250', wa: '' },
  { match: /wefm|96\.?1/i,              tier: 'partial', phone: '+18686286044', wa: '' },
  { match: /i\s*95\.?5/i,               tier: 'partial', phone: '+18686284955', wa: '' },

  { match: /freedom\s*106/i,            tier: 'unverified', phone: '+18686273223', wa: '+18683061065' },
  { match: /107\.?7.*music.*life/i,     tier: 'unverified', phone: '+18686289107', wa: '' },
  { match: /iconic\s*104\.?7/i,         tier: 'unverified', phone: '+18686283131', wa: '+18683299979' },
];

function lookupContact(name) {
  const hit = CONTACT_DB.find(c => c.match.test(name));
  return hit || null;
}

function getContact(id) {
  try { return JSON.parse(localStorage.getItem('vz_station_contacts') || '{}')[id] || ''; }
  catch { return ''; }
}
function setContact(id, num) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem('vz_station_contacts') || '{}'); } catch {}
  if (num) all[id] = num; else delete all[id];
  localStorage.setItem('vz_station_contacts', JSON.stringify(all));
}
function editContact(id, name) {
  const current = getContact(id) || lookupContact(name)?.phone || '';
  const input = prompt(`WhatsApp / phone number for ${name}\n(include country code, e.g. +18686281234)`, current);
  if (input === null) return;
  setContact(id, input.trim());
  renderStreamPage();
}
window.djEditContact = editContact;

function acknowledgeUnverified(id, name, phone, wa, action) {
  const ok = confirm(`${name}'s number hasn't been independently confirmed — it may be wrong or outdated.\n\nContinue to ${action === 'call' ? 'call' : 'WhatsApp'} ${phone}?`);
  if (!ok) return;
  if (action === 'call') location.href = `tel:${phone}`;
  else window.open(`https://wa.me/${(wa || phone).replace(/[^\d+]/g,'').replace(/^\+/,'')}`, '_blank');
}
window.djAckUnverified = acknowledgeUnverified;

function stationRow(s) {
  const isCur   = StreamHub.current?.id === s.id;
  const playing = isCur && StreamHub.state === 'playing';
  const loading = isCur && StreamHub.state === 'loading';
  const err     = isCur && StreamHub.state === 'error';
  const icon = s.favicon
    ? `<img src="${esc19(s.favicon)}" class="radio-fav" loading="lazy" onerror="this.style.display='none'"/>`
    : `<span class="radio-fav radio-fav-fallback">📻</span>`;

  const userContact = getContact(s.id);
  const dbEntry = lookupContact(s.name);
  const nameEsc = esc19(s.name).replace(/'/g,"\\'");

  let actions;
  if (userContact) {
    // User explicitly set/edited this — always trusted, full buttons
    actions = `
      <a class="radio-icon-btn call" href="tel:${esc19(userContact)}" title="Call">📞</a>
      <a class="radio-icon-btn wa" href="https://wa.me/${esc19(userContact.replace(/[^\d+]/g,'').replace(/^\+/,''))}" target="_blank" rel="noopener" title="WhatsApp">💬</a>`;
  } else if (dbEntry && dbEntry.tier !== 'unverified') {
    actions = `
      <a class="radio-icon-btn call" href="tel:${esc19(dbEntry.phone)}" title="Call">📞</a>
      ${dbEntry.wa ? `<a class="radio-icon-btn wa" href="https://wa.me/${esc19(dbEntry.wa.replace(/[^\d+]/g,'').replace(/^\+/,''))}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}`;
  } else if (dbEntry && dbEntry.tier === 'unverified') {
    actions = `
      <button class="radio-icon-btn unverified" title="Unverified number — tap to confirm before using" onclick="djAckUnverified('${s.id}','${nameEsc}','${dbEntry.phone}','${dbEntry.wa}','call')">📞?</button>
      ${dbEntry.wa ? `<button class="radio-icon-btn unverified" title="Unverified number — tap to confirm before using" onclick="djAckUnverified('${s.id}','${nameEsc}','${dbEntry.phone}','${dbEntry.wa}','wa')">💬?</button>` : ''}`;
  } else {
    actions = `<button class="radio-icon-btn add-contact" onclick="djEditContact('${s.id}','${nameEsc}')" title="Add phone/WhatsApp number">📞+</button>`;
  }

  return `
    <div class="radio-row ${playing ? 'on-air' : ''}">
      ${icon}
      <div class="radio-info">
        <div class="radio-name">${esc19(s.name)}</div>
        <div class="radio-meta">${esc19(s.genre)}${playing ? ' · <span class="on-air-tag">ON AIR</span>' : loading ? ' · connecting…' : err ? ' · <span class="err-tag">unreachable</span>' : ''}</div>
      </div>
      <div class="radio-actions">
        ${actions}
        <button class="radio-play-btn" onclick="MS.stream.toggle('${s.id}')">${playing ? '⏹' : loading ? '…' : '▶'}</button>
      </div>
    </div>`;
}

function renderStreamPage() {
  const ttList = $19('radioTTList');
  const worldList = $19('radioWorldList');
  const ttCount = $19('ttCount');
  if (!ttList || !worldList) return;

  ttCount.textContent = StreamHub.tt.length ? ` · ${StreamHub.tt.length}` : '';

  ttList.innerHTML =
    StreamHub.ttState === 'loading' ? `<div class="radio-note">Loading Trinidad &amp; Tobago stations…</div>` :
    StreamHub.ttState === 'error'   ? `<div class="radio-note">Couldn't reach the station directory.<br><button class="vz-btn sm" onclick="MS.stream.loadTT(true)">Retry</button></div>` :
    !StreamHub.tt.length             ? `<div class="radio-note"><button class="vz-btn sm" onclick="MS.stream.loadTT(true)">Load Stations</button></div>` :
    StreamHub.tt.map(stationRow).join('');

  worldList.innerHTML = WORLD_RADIO.map(stationRow).join('');
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
/* ── Vinyl spin (Player disc + DJ platters) ── */
@keyframes vinylSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.np-vinyl-art-img {
  position:absolute; inset:6%; border-radius:50%; object-fit:cover;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.08), 0 0 30px rgba(0,0,0,.5);
}
.np-vinyl-hole {
  position:absolute; top:50%; left:50%; width:10%; height:10%;
  transform:translate(-50%,-50%); border-radius:50%;
  background:#050505; box-shadow:0 0 0 2px rgba(255,255,255,.15);
  z-index:2;
}
#npVinylDisc.spinning .np-vinyl-art-img { animation: vinylSpin 2.6s linear infinite; }

.dd-platter-art {
  position:absolute; inset:10%; border-radius:50%; overflow:hidden;
  pointer-events:none; z-index:0;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.06);
}
.dd-platter-art img { width:100%; height:100%; object-fit:cover; opacity:.85; }
.dd-platter-art.spinning img { animation: vinylSpin 2.6s linear infinite; }
.dd-platter { position:relative; }
.dd-platter canvas { position:relative; z-index:1; }

/* ── Stream / Radio page ── */
#page-stream { background:var(--bg); }
.radio-hero { padding:20px 20px 4px; }
.radio-hero-kicker {
  font-size:11px; font-weight:900; letter-spacing:.18em; color:var(--red, #e81010);
}
.radio-hero-title {
  font-size:30px; font-weight:900; color:var(--t1); letter-spacing:-.01em; margin-top:2px;
}
.radio-scroll { flex:1; overflow-y:auto; padding:8px 16px 90px; }
.section-count { color:var(--t3); font-weight:600; }
.radio-list { display:flex; flex-direction:column; gap:2px; margin-bottom:6px; }
.radio-row {
  display:flex; align-items:center; gap:12px;
  padding:12px 4px; border-bottom:1px solid var(--border);
}
.radio-row.on-air { background:rgba(0,230,118,.05); }
.radio-fav {
  width:44px; height:44px; border-radius:10px; object-fit:cover;
  background:var(--bg3); flex-shrink:0; border:1px solid var(--border);
}
.radio-fav-fallback { display:flex; align-items:center; justify-content:center; font-size:18px; }
.radio-info { flex:1; min-width:0; }
.radio-name { font-size:14.5px; font-weight:700; color:var(--t1); }
.radio-meta { font-size:11.5px; color:var(--t3); margin-top:2px; }
.on-air-tag { color:var(--green,#00e676); font-weight:800; }
.err-tag { color:var(--red,#e81010); }
.radio-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.radio-icon-btn {
  width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:16px; text-decoration:none; border:1px solid var(--border); background:var(--bg3); color:var(--t2);
  cursor:pointer;
}
.radio-icon-btn.call { color:#3b82f6; border-color:rgba(59,130,246,.4); }
.radio-icon-btn.wa   { color:#25d366; border-color:rgba(37,211,102,.4); }
.radio-icon-btn.unverified { color:var(--yellow); border-color:rgba(251,191,36,.4); font-size:9px; }
.radio-icon-btn.add-contact { font-size:11px; font-weight:800; color:var(--t3); }
.radio-play-btn {
  width:44px; height:44px; border-radius:50%; border:1px solid var(--border);
  background:var(--bg3); color:var(--t1); font-size:16px; cursor:pointer;
}
.radio-row.on-air .radio-play-btn { border-color:var(--green,#00e676); color:var(--green,#00e676); }
.radio-note { color:var(--t3); font-size:12.5px; padding:20px 4px; text-align:center; line-height:2; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init19() {
  wireImportButtons();
  killMiniPlayer();
  killSwipeNav();
  renderStreamPage();
  StreamHub.loadTT();
  updateVinylSpin();
  console.info('[868 Vibez] Phase 19 ready — rebuild pass');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init19, 30));
} else {
  setTimeout(init19, 30);
}

})();
