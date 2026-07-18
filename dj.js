/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — dj.js  (Tab 4 — DJ Console)
   Rotate-to-enter (portrait shows branded hint). Sub-tabs:
   DECKS | MUSIC | TOOLKIT | MORE.
   Decks screen scrolls down to reveal, in the specified order:
   loops → hot cues → pitch fine controls → EQ + filter.
   Spinning 868 emblem on both platters. Red A / Blue B.
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const E = VZ.engine;
const fmt = s => { s = Math.max(0, s|0); return `${(s/60)|0}:${String(s%60).padStart(2,'0')}`; };

/* ─────────── DECKS SUB-TAB ─────────── */
function deckHTML(d) {
  const color = d === 'A' ? 'a' : 'b';
  return `
  <div class="deck ${color}">
    <div class="deck-title" id="deckTitle${d}">Load a track</div>
    <div class="platter ${color}" id="platter${d}"><img src="icons/vinyl-art.jpg" alt=""/></div>
    <div class="deck-time"><span id="deckCur${d}">0:00</span><span id="deckDur${d}">0:00</span></div>
    <div class="deck-main-row">
      <button class="deck-play ${color}" id="deckPlay${d}">▶</button>
      <button class="deck-cue" id="deckCue${d}">CUE</button>
      <div class="deck-vol-wrap"><span class="ctl-lbl">VOL</span>
        <input type="range" class="v-fader" id="deckVol${d}" min="0" max="1" step="0.01" value="1"/></div>
    </div>
  </div>`;
}

function decksHTML() {
  return `
  <div class="decks-screen" id="decksScreen">
    <div class="decks-top">
      ${deckHTML('A')}
      <div class="mixer">
        <button class="loadbtn a" id="loadABtn">LOAD A</button>
        <button class="loadbtn b" id="loadBBtn">LOAD B</button>
        <div class="xf-row"><span class="xa">A</span>
          <input type="range" id="xfader" min="0" max="1" step="0.01" value="0.5"/>
          <span class="xb">B</span></div>
        <button class="recbtn" id="recBtn">● REC</button>
      </div>
      ${deckHTML('B')}
    </div>
    <div class="scroll-hint">⌄ more controls ⌄</div>

    <!-- Scroll-down features, in the specified order -->
    <div class="feat-block">
      <div class="feat-title">LOOPS</div>
      <div class="feat-two-col">
        ${['A','B'].map(d => `
          <div class="feat-col ${d === 'A' ? 'a' : 'b'}">
            <div class="feat-deck-lbl">DECK ${d}</div>
            <div class="btn-row">
              <button class="cbtn" data-loop="in:${d}">IN</button>
              <button class="cbtn" data-loop="out:${d}">OUT</button>
              <button class="cbtn" data-loop="exit:${d}" id="loopExit${d}">EXIT</button>
            </div>
            <div class="btn-row">
              <button class="cbtn" data-loop="half:${d}">½×</button>
              <button class="cbtn" data-loop="dbl:${d}">2×</button>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="feat-block">
      <div class="feat-title">HOT CUES <span class="feat-hint">tap empty = set · tap = jump · hold = clear</span></div>
      <div class="feat-two-col">
        ${['A','B'].map(d => `
          <div class="feat-col ${d === 'A' ? 'a' : 'b'}">
            <div class="feat-deck-lbl">DECK ${d}</div>
            <div class="cue-grid">
              ${[0,1,2,3].map(i => `<button class="cue-pad c${i}" data-cue="${d}:${i}" id="cue${d}${i}">${i + 1}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="feat-block">
      <div class="feat-title">PITCH</div>
      <div class="feat-two-col">
        ${['A','B'].map(d => `
          <div class="feat-col ${d === 'A' ? 'a' : 'b'}">
            <div class="feat-deck-lbl">DECK ${d} <span id="pitchVal${d}" class="pitch-val">0.0%</span></div>
            <input type="range" class="h-fader" id="pitch${d}" min="-8" max="8" step="0.1" value="0"/>
            <div class="btn-row">
              <button class="cbtn on" data-keylock="${d}" id="keylock${d}">🔒 KEYLOCK</button>
              <button class="cbtn" data-pitchreset="${d}">RESET</button>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="feat-block">
      <div class="feat-title">EQ + FILTER</div>
      <div class="feat-two-col">
        ${['A','B'].map(d => `
          <div class="feat-col ${d === 'A' ? 'a' : 'b'}">
            <div class="feat-deck-lbl">DECK ${d}</div>
            ${['hi','mid','lo'].map(b => `
              <div class="eq-row"><span class="ctl-lbl">${b.toUpperCase()}</span>
                <input type="range" class="h-fader" data-eq="${d}:${b}" min="-12" max="12" step="0.5" value="0"/></div>`).join('')}
            <div class="eq-row"><span class="ctl-lbl">FILT</span>
              <input type="range" class="h-fader filt" data-filter="${d}" min="-1" max="1" step="0.01" value="0"/></div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function wireDecks(root) {
  ['A','B'].forEach(d => {
    root.querySelector(`#deckPlay${d}`).addEventListener('click', () => E.toggleDeck(d));
    root.querySelector(`#deckCue${d}`).addEventListener('click', () => E.cueDeck(d));
    root.querySelector(`#deckVol${d}`).addEventListener('input', e => E.setDeckVol(d, +e.target.value));
    root.querySelector(`#pitch${d}`).addEventListener('input', e => {
      E.setPitch(d, +e.target.value);
      root.querySelector(`#pitchVal${d}`).textContent = (+e.target.value).toFixed(1) + '%';
    });
  });
  root.querySelector('#xfader').addEventListener('input', e => E.setXfade(+e.target.value));
  root.querySelector('#loadABtn').addEventListener('click', () => showSub('music', 'A'));
  root.querySelector('#loadBBtn').addEventListener('click', () => showSub('music', 'B'));
  root.querySelector('#recBtn').addEventListener('click', () => {
    const btn = root.querySelector('#recBtn');
    if (E.rec.active) { E.rec.stop(); btn.classList.remove('on'); btn.textContent = '● REC'; VZ.toast('Recording saved to downloads.', 'ok'); }
    else { E.ensureCtx(); E.rec.start(); btn.classList.add('on'); btn.textContent = '■ STOP'; VZ.toast('Recording your mix…', 'ok'); }
  });
  root.querySelectorAll('[data-loop]').forEach(b => b.addEventListener('click', () => {
    const [act, d] = b.dataset.loop.split(':');
    if (act === 'in') E.loopIn(d);
    if (act === 'out') E.loopOut(d);
    if (act === 'exit') E.loopExit(d);
    if (act === 'half') E.loopResize(d, 0.5);
    if (act === 'dbl') E.loopResize(d, 2);
  }));
  root.querySelectorAll('[data-cue]').forEach(b => {
    const [d, i] = b.dataset.cue.split(':');
    let holdT = null;
    b.addEventListener('touchstart', () => { holdT = setTimeout(() => { E.clearCue(d, +i); holdT = 'cleared'; }, 650); }, { passive: true });
    b.addEventListener('touchend', () => { if (holdT !== 'cleared') { clearTimeout(holdT); E.hotCue(d, +i); } holdT = null; });
    b.addEventListener('click', e => { if ('ontouchstart' in window) { e.preventDefault(); return; } E.hotCue(d, +i); });
  });
  root.querySelectorAll('[data-keylock]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.keylock;
    E.setKeylock(d, !E.deck[d].keylock);
    b.classList.toggle('on', E.deck[d].keylock);
  }));
  root.querySelectorAll('[data-pitchreset]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.pitchreset;
    const el = root.querySelector(`#pitch${d}`);
    el.value = 0; E.setPitch(d, 0);
    root.querySelector(`#pitchVal${d}`).textContent = '0.0%';
  }));
  root.querySelectorAll('[data-eq]').forEach(el => el.addEventListener('input', () => {
    const [d, band] = el.dataset.eq.split(':');
    E.ensureCtx(); E.setEQ(d, band, +el.value);
  }));
  root.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('input', () => {
    E.ensureCtx(); E.setFilter(el.dataset.filter, +el.value);
  }));
}

function refreshDeckState(d) {
  const deck = E.deck[d];
  const title = $(`deckTitle${d}`); if (title) title.textContent = deck.track ? deck.track.title : 'Load a track';
  const play = $(`deckPlay${d}`); if (play) play.textContent = deck.playing ? '⏸' : '▶';
  $(`platter${d}`)?.classList.toggle('spinning', deck.playing);
  $(`loopExit${d}`)?.classList.toggle('on', !!deck.loop?.end);
  [0,1,2,3].forEach(i => $(`cue${d}${i}`)?.classList.toggle('set', deck.cues[i] != null));
}
E.on('deck:loaded', refreshDeckState);
E.on('deck:state', refreshDeckState);
E.on('deck:loop', refreshDeckState);
E.on('deck:cues', refreshDeckState);
setInterval(() => ['A','B'].forEach(d => {
  const a = E.el[d]; if (!a) return;
  const c = $(`deckCur${d}`), du = $(`deckDur${d}`);
  if (c) c.textContent = fmt(a.currentTime); if (du) du.textContent = fmt(a.duration || 0);
}), 500);

/* ─────────── MUSIC SUB-TAB (song browser, its own tab per spec) ─────────── */
let musicTarget = 'A', musicQuery = '';
function musicHTML() {
  return `
  <div class="music-screen">
    <div class="music-head">
      <span class="ctl-lbl">LOAD TO</span>
      <button class="tgt a ${musicTarget === 'A' ? 'on' : ''}" id="tgtA">DECK A</button>
      <button class="tgt b ${musicTarget === 'B' ? 'on' : ''}" id="tgtB">DECK B</button>
      <input id="musicSearch" placeholder="Search songs…" value="${esc(musicQuery)}"/>
    </div>
    <div class="music-list" id="musicList"></div>
  </div>`;
}
function renderMusicList() {
  const box = $('musicList'); if (!box) return;
  const q = musicQuery.toLowerCase();
  let tracks = VZ.libraryCore.tracks;
  if (q) tracks = tracks.filter(t => t.title.toLowerCase().includes(q) || t.path.toLowerCase().includes(q));
  const crates = VZ.lists.crates;
  box.innerHTML = `
    ${crates.length ? `<div class="sec-label">Crates</div>` + crates.map(c => `
      <div class="music-crate" data-crate="${c.id}">📦 ${esc(c.name)} <span>${c.trackIds.length}</span></div>`).join('') : ''}
    <div class="sec-label">All Songs · ${tracks.length}</div>
    ${tracks.length ? tracks.map(t => `
      <div class="music-row" data-load="${t.id}">
        <div class="music-main">
          <div class="music-title">${esc(t.title)}</div>
          <div class="music-sub">${esc(t.path.includes('/') ? t.path.split('/').slice(0,-1).join('/') : '')}${t.bpm ? ` · ${t.bpm} BPM` : ''}</div>
        </div>
        <button class="mini-load a" data-d="A" data-t="${t.id}">A</button>
        <button class="mini-load b" data-d="B" data-t="${t.id}">B</button>
      </div>`).join('') : `<div class="lib-empty">No songs yet — add a folder in the Library tab.</div>`}`;
  const load = async (d, id) => {
    const t = VZ.libraryCore.tracks.find(x => x.id === id); if (!t) return;
    try { await E.loadDeck(d, t); VZ.toast(`Deck ${d}: ${t.title}`, 'ok', 1600); }
    catch (e) { VZ.toast(e.message, 'error', 3000); }
  };
  box.querySelectorAll('.music-row').forEach(r => r.addEventListener('click', e => {
    if (e.target.closest('.mini-load')) return;
    load(musicTarget, r.dataset.load);
  }));
  box.querySelectorAll('.mini-load').forEach(b => b.addEventListener('click', () => load(b.dataset.d, b.dataset.t)));
  box.querySelectorAll('.music-crate').forEach(c => c.addEventListener('click', () => {
    const crate = crates.find(x => x.id === c.dataset.crate);
    musicQuery = '';
    const ids = new Set(crate.trackIds);
    const sub = VZ.libraryCore.tracks.filter(t => ids.has(t.id));
    box.innerHTML = `<div class="sec-label">📦 ${esc(crate.name)} <button class="mini-add" id="crateBack">← All</button></div>` +
      sub.map(t => `
        <div class="music-row" data-load="${t.id}">
          <div class="music-main"><div class="music-title">${esc(t.title)}</div></div>
          <button class="mini-load a" data-d="A" data-t="${t.id}">A</button>
          <button class="mini-load b" data-d="B" data-t="${t.id}">B</button>
        </div>`).join('');
    $('crateBack').addEventListener('click', renderMusicList);
    box.querySelectorAll('.music-row').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('.mini-load')) load(musicTarget, r.dataset.load); }));
    box.querySelectorAll('.mini-load').forEach(b => b.addEventListener('click', () => load(b.dataset.d, b.dataset.t)));
  }));
}
function wireMusic(root) {
  root.querySelector('#tgtA').addEventListener('click', () => { musicTarget = 'A'; root.querySelector('#tgtA').classList.add('on'); root.querySelector('#tgtB').classList.remove('on'); });
  root.querySelector('#tgtB').addEventListener('click', () => { musicTarget = 'B'; root.querySelector('#tgtB').classList.add('on'); root.querySelector('#tgtA').classList.remove('on'); });
  root.querySelector('#musicSearch').addEventListener('input', e => { musicQuery = e.target.value; renderMusicList(); });
  renderMusicList();
}

/* ─────────── TOOLKIT SUB-TAB (soundboard · mic · recording) ─────────── */
function toolkitHTML() {
  return `
  <div class="toolkit-screen">
    <div class="sec-label">🎉 Fete Soundboard</div>
    <div class="sfx-grid">
      ${[['airhorn','🎺','Air Horn'],['siren','🚨','Siren'],['rewind','⏪','Rewind'],['bring','🔥','Bring Back'],['bomb','💣','Bomb'],['whistle','📯','Whistle']]
        .map(([id, ico, lbl]) => `<button class="sfx-pad" data-sfx="${id}"><span class="sfx-ico">${ico}</span><span class="sfx-lbl">${lbl}</span></button>`).join('')}
    </div>
    <div class="sec-label">🎤 Mic / Hype</div>
    <button class="btn wide" id="micBtn">🎤 ENABLE MIC</button>
    <div class="eq-row" style="margin-top:8px"><span class="ctl-lbl">LEVEL</span>
      <input type="range" class="h-fader" id="micLevel" min="0" max="1.6" step="0.02" value="1"/></div>
    <button class="btn wide ghost" id="duckBtn" disabled>Auto-Duck Music While Talking</button>
  </div>`;
}
function wireToolkit(root) {
  root.querySelectorAll('.sfx-pad').forEach(b => b.addEventListener('click', () => {
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 180);
    try { E.sfx[b.dataset.sfx](); } catch (e) { VZ.logError('sfx', e); }
  }));
  const micBtn = root.querySelector('#micBtn'), duckBtn = root.querySelector('#duckBtn');
  micBtn.addEventListener('click', async () => {
    try {
      const on = await E.mic.toggle();
      micBtn.classList.toggle('rec', on);
      micBtn.textContent = on ? '🎤 MIC LIVE — tap to stop' : '🎤 ENABLE MIC';
      duckBtn.disabled = !on;
      if (!on) duckBtn.classList.remove('on');
    } catch { VZ.toast('Mic access denied or unavailable.', 'error'); }
  });
  root.querySelector('#micLevel').addEventListener('input', e => E.mic.setLevel(+e.target.value));
  duckBtn.addEventListener('click', () => { E.mic.setDuck(!E.mic.ducking); duckBtn.classList.toggle('on', E.mic.ducking); });
}

/* ─────────── MORE SUB-TAB (MIDI · history · requests · Auto-DJ · export) ─────────── */
const DJx = VZ.dj = { session: null };
DJx.logSession = function (d, track) {
  if (!this.session) this.session = { id: 's_' + Date.now(), startedAt: Date.now(), tracks: [] };
  this.session.tracks.push({ title: track.title, deck: d, at: Date.now() });
};
DJx.endSession = async function () {
  if (!this.session?.tracks.length) { this.session = null; return; }
  const s = { ...this.session, endedAt: Date.now() };
  s.duration = s.endedAt - s.startedAt;
  await VZ.db.put('sessions', s);
  this.session = null;
};
document.addEventListener('vz:tab', e => { if (e.detail !== 'dj') DJx.endSession(); });

/* Auto-DJ */
const AutoDJ = {
  on: false, busy: false,
  tick() {
    if (!this.on || this.busy) return;
    ['A','B'].forEach(d => {
      const a = E.el[d], deck = E.deck[d];
      if (!deck.playing || !a?.duration) return;
      const remain = a.duration - a.currentTime;
      if (remain < 12) this.transition(d);
    });
  },
  async transition(fromDeck) {
    this.busy = true;
    const to = fromDeck === 'A' ? 'B' : 'A';
    try {
      const cur = E.deck[fromDeck].track;
      const pool = VZ.libraryCore.tracks.filter(t => t.id !== cur?.id);
      if (!pool.length) { this.busy = false; return; }
      let next;
      if (cur?.bpm) {
        next = pool.filter(t => t.bpm).sort((a, b) => Math.abs(a.bpm - cur.bpm) - Math.abs(b.bpm - cur.bpm))[0];
      }
      next = next || pool[Math.floor(Math.random() * pool.length)];
      await E.loadDeck(to, next);
      await E.toggleDeck(to);
      // 8-second crossfade
      const steps = 40; let i = 0;
      const from0 = fromDeck === 'A' ? 0 : 1;
      const iv = setInterval(() => {
        i++;
        E.setXfade(from0 + (i / steps) * (fromDeck === 'A' ? 1 : -1));
        const xf = $('xfader'); if (xf) xf.value = from0 + (i / steps) * (fromDeck === 'A' ? 1 : -1);
        if (i >= steps) {
          clearInterval(iv);
          E.el[fromDeck].pause(); E.deck[fromDeck].playing = false; E.emit('deck:state', fromDeck);
          this.busy = false;
        }
      }, 200);
    } catch (e) { VZ.logError('autodj', e); this.busy = false; }
  },
};
setInterval(() => AutoDJ.tick(), 2000);

/* MIDI */
const Midi = {
  supported: 'requestMIDIAccess' in navigator,
  maps: {}, learning: null,
  ACTIONS: [
    ['playA','Deck A Play'],['playB','Deck B Play'],['cueA','Deck A Cue'],['cueB','Deck B Cue'],
    ['xf','Crossfader'],['volA','Vol A'],['volB','Vol B'],['pitchA','Pitch A'],['pitchB','Pitch B'],
    ['airhorn','Air Horn'],
  ],
  async init() {
    if (!this.supported) return;
    try {
      const rows = await VZ.db.all('midi');
      rows.forEach(r => this.maps[r.id] = r.action);
      const access = await navigator.requestMIDIAccess();
      const bind = () => [...access.inputs.values()].forEach(inp => inp.onmidimessage = e => this.onMsg(e));
      bind(); access.onstatechange = bind;
    } catch (e) { VZ.logError('midi', e); }
  },
  async onMsg(e) {
    const [st, num, val] = e.data;
    const type = (st & 0xf0) === 0x90 ? 'n' : (st & 0xf0) === 0xb0 ? 'c' : null;
    if (!type) return;
    const key = `${type}${st & 15}:${num}`;
    if (this.learning) {
      this.maps[key] = this.learning;
      await VZ.db.put('midi', { id: key, action: this.learning });
      VZ.toast(`Mapped → ${key}`, 'ok', 1600);
      this.learning = null; renderMore();
      return;
    }
    const act = this.maps[key]; if (!act) return;
    const norm = val / 127;
    const fire = {
      playA: () => E.toggleDeck('A'), playB: () => E.toggleDeck('B'),
      cueA: () => E.cueDeck('A'), cueB: () => E.cueDeck('B'),
      xf: () => { E.setXfade(norm); const el = $('xfader'); if (el) el.value = norm; },
      volA: () => E.setDeckVol('A', norm), volB: () => E.setDeckVol('B', norm),
      pitchA: () => E.setPitch('A', (norm - .5) * 16), pitchB: () => E.setPitch('B', (norm - .5) * 16),
      airhorn: () => val > 0 && E.sfx.airhorn(),
    };
    fire[act]?.();
  },
};

/* Requests */
const Req = {
  items: [],
  async load() { this.items = await VZ.db.all('requests'); },
  async add(text) {
    const r = { id: 'r_' + Date.now(), text: text.trim(), done: false, at: Date.now() };
    this.items.push(r); await VZ.db.put('requests', r);
  },
  async toggle(id) { const r = this.items.find(x => x.id === id); if (r) { r.done = !r.done; await VZ.db.put('requests', r); } },
  async clearDone() { for (const r of this.items.filter(x => x.done)) await VZ.db.del('requests', r.id); this.items = this.items.filter(x => !x.done); },
};

/* Crate export (Rekordbox XML solid; Serato best-effort) */
function xmlEsc(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function dl(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportRekordbox(crate) {
  const tracks = crate.trackIds.map(id => VZ.libraryCore.tracks.find(t => t.id === id)).filter(Boolean);
  if (!tracks.length) { VZ.toast('That crate is empty.', 'warn'); return; }
  let tid = 0;
  const tx = tracks.map(t => { tid++; t._x = tid; return `  <dict><key>Track ID</key><integer>${tid}</integer><key>Name</key><string>${xmlEsc(t.title)}</string><key>BPM</key><integer>${t.bpm||0}</integer><key>Location</key><string>file://localhost/${encodeURIComponent(t.path)}</string></dict>`; }).join('\n');
  const px = tracks.map(t => `    <dict><key>Track ID</key><integer>${t._x}</integer></dict>`).join('\n');
  dl(`<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Application Name</key><string>868 Vibez</string><key>Tracks</key><dict>\n${tx}\n</dict><key>Playlists</key><array><dict><key>Name</key><string>${xmlEsc(crate.name)}</string><key>Playlist Items</key><array>\n${px}\n</array></dict></array></dict></plist>`,
    `${crate.name.replace(/[^\w-]+/g,'_')}.xml`, 'application/xml');
  VZ.toast('Exported — import in rekordbox via Library ▸ Import Library.', 'ok', 3200);
}
function exportSerato(crate) {
  const tracks = crate.trackIds.map(id => VZ.libraryCore.tracks.find(t => t.id === id)).filter(Boolean);
  if (!tracks.length) { VZ.toast('That crate is empty.', 'warn'); return; }
  const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
  const u16be = str => { const b = new Uint8Array(str.length * 2); for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); b[i*2] = c >> 8; b[i*2+1] = c & 255; } return b; };
  const tag = (name, payload) => { const nb = new TextEncoder().encode(name); const out = new Uint8Array(8 + payload.length); out.set(nb); out.set(u32(payload.length), 4); out.set(payload, 8); return out; };
  const parts = [tag('vrsn', u16be('1.0/Serato ScratchLive Crate')), ...tracks.map(t => tag('otrk', tag('ptrk', u16be(t.path))))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total); let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  dl(new Blob([out]), `${crate.name.replace(/[^\w-]+/g,'_')}.crate`, 'application/octet-stream');
  VZ.toast('Exported .crate (unofficial format — test-load it before a gig).', 'ok', 3800);
}

async function renderMore() {
  const box = $('djMoreBody'); if (!box) return;
  const sessions = (await VZ.db.all('sessions')).sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
  const crates = VZ.lists.crates;
  box.innerHTML = `
    <div class="sec-label">🤖 Auto-DJ</div>
    <button class="btn wide ${AutoDJ.on ? 'rec' : ''}" id="autoDjBtn">${AutoDJ.on ? '■ AUTO-DJ ON — tap to stop' : '▶ Start Auto-DJ'}</button>
    <div class="lib-note">Loads the closest-BPM song to the free deck and crossfades as each track ends. Analyze BPMs in Library for smarter picks.</div>

    <div class="sec-label">📜 Mix History</div>
    ${sessions.length ? sessions.map(s => `
      <div class="lib-row"><span class="lib-ico">📜</span>
        <div class="lib-main"><div class="lib-title">${new Date(s.startedAt).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} ${new Date(s.startedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="lib-sub">${s.tracks.length} tracks · ${Math.round((s.duration||0)/60000)} min</div></div>
        <button class="lib-x" data-exp-sess="${s.id}">⬇</button></div>`).join('') : `<div class="lib-empty sm">Play some tracks on the decks and sessions appear here.</div>`}

    <div class="sec-label">🙋 Song Requests</div>
    <div class="req-add"><input id="reqInput" placeholder="Song / artist requested…"/><button class="btn" id="reqAddBtn">Add</button></div>
    ${Req.items.map(r => `<div class="lib-row ${r.done ? 'done' : ''}"><button class="lib-x chk" data-req-t="${r.id}">${r.done ? '✓' : '○'}</button><div class="lib-main"><div class="lib-title ${r.done ? 'strike' : ''}">${esc(r.text)}</div></div></div>`).join('')}
    ${Req.items.some(r => r.done) ? `<button class="btn ghost wide" id="reqClear">Clear completed</button>` : ''}

    <div class="sec-label">💾 Crate Export</div>
    ${crates.length ? crates.map(c => `
      <div class="lib-row"><span class="lib-ico">📦</span>
        <div class="lib-main"><div class="lib-title">${esc(c.name)}</div><div class="lib-sub">${c.trackIds.length} tracks</div></div>
        <button class="lib-x" data-exp-rb="${c.id}" title="Rekordbox">RB</button>
        <button class="lib-x" data-exp-sr="${c.id}" title="Serato">SR</button></div>`).join('') : `<div class="lib-empty sm">Make a crate in Library first.</div>`}

    <div class="sec-label">🎛 MIDI Controller</div>
    ${!Midi.supported ? `<div class="lib-note">Web MIDI isn't available in this browser.</div>` :
      Midi.ACTIONS.map(([id, lbl]) => {
        const mapped = Object.entries(Midi.maps).find(([, v]) => v === id)?.[0];
        return `<div class="lib-row"><div class="lib-main"><div class="lib-title">${lbl}</div><div class="lib-sub">${Midi.learning === id ? 'Move a control now…' : mapped || 'Not mapped'}</div></div><button class="lib-x" data-learn="${id}">${Midi.learning === id ? '…' : 'Learn'}</button></div>`;
      }).join('')}`;

  box.querySelector('#autoDjBtn').addEventListener('click', () => { AutoDJ.on = !AutoDJ.on; if (AutoDJ.on) E.ensureCtx(); renderMore(); });
  box.querySelector('#reqAddBtn').addEventListener('click', async () => {
    const inp = box.querySelector('#reqInput');
    if (inp.value.trim()) { await Req.add(inp.value); inp.value = ''; renderMore(); }
  });
  box.querySelector('#reqClear')?.addEventListener('click', async () => { await Req.clearDone(); renderMore(); });
  box.querySelectorAll('[data-req-t]').forEach(b => b.addEventListener('click', async () => { await Req.toggle(b.dataset.reqT); renderMore(); }));
  box.querySelectorAll('[data-learn]').forEach(b => b.addEventListener('click', () => { Midi.learning = b.dataset.learn; renderMore(); }));
  box.querySelectorAll('[data-exp-rb]').forEach(b => b.addEventListener('click', () => exportRekordbox(crates.find(c => c.id === b.dataset.expRb))));
  box.querySelectorAll('[data-exp-sr]').forEach(b => b.addEventListener('click', () => exportSerato(crates.find(c => c.id === b.dataset.expSr))));
  box.querySelectorAll('[data-exp-sess]').forEach(b => b.addEventListener('click', async () => {
    const s = sessions.find(x => x.id === b.dataset.expSess);
    dl(`868 Vibez — Mix Session\n${new Date(s.startedAt).toLocaleString()}\n\n` + s.tracks.map((t, i) => `${i + 1}. ${t.title} (Deck ${t.deck})`).join('\n'),
      `868vibez-session-${new Date(s.startedAt).toISOString().slice(0,10)}.txt`, 'text/plain');
  }));
}

/* ─────────── SUB-TAB SHELL ─────────── */
let currentSub = 'decks';
function showSub(sub, deckTarget) {
  currentSub = sub;
  if (deckTarget) musicTarget = deckTarget;
  document.querySelectorAll('.dj-subtab').forEach(b => b.classList.toggle('on', b.dataset.sub === sub));
  const body = $('djBody');
  if (sub === 'decks') { body.innerHTML = decksHTML(); wireDecks(body); ['A','B'].forEach(refreshDeckState); }
  if (sub === 'music') { body.innerHTML = musicHTML(); wireMusic(body); }
  if (sub === 'toolkit') { body.innerHTML = toolkitHTML(); wireToolkit(body); }
  if (sub === 'more') { body.innerHTML = `<div class="more-screen" id="djMoreBody"></div>`; renderMore(); }
}
VZ.djShowSub = showSub;

document.addEventListener('DOMContentLoaded', async () => {
  await Req.load();
  Midi.init();
  document.querySelectorAll('.dj-subtab').forEach(b => b.addEventListener('click', () => showSub(b.dataset.sub)));
  showSub('decks');
  E.on('library:changed', () => { if (currentSub === 'music') renderMusicList(); });
});
})();
