/* ============================================================
   MEDIASUITE V3 — PHASE 10 INTELLIGENCE & LIBRARY OS
   Client-only patch. No cloud calls. No external dependencies.
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'MediaSuitePhase10DB';
  const DB_VERSION = 1;
  const STORE = {
    sets: 'aiSets',
    health: 'libraryHealth',
    beatGrids: 'beatGrids',
    memoryCues: 'memoryCues',
    profiles: 'performanceProfiles',
    ecosystem: 'ecosystemHooks'
  };

  const state = {
    db: null,
    tab: 'setbuilder',
    tracks: [],
    activeProfile: localStorage.getItem('ms_phase10_profile') || 'Mobile DJ'
  };

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.values(STORE).forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function put(store, value) {
    if (!state.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function getAll(store) {
    if (!state.db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function idOf(track) {
    return track?.id || track?.fingerprint || track?.pathId || [track?.name || track?.title || 'track', track?.size || 0, track?.lastModified || 0].join('_');
  }

  function normalizeTrack(raw, idx) {
    const meta = raw?.metadata || raw?.meta || {};
    const name = raw?.name || raw?.title || raw?.filename || `Track ${idx + 1}`;
    const bpm = Number(raw?.bpm || meta.bpm || 0);
    const key = String(raw?.key || raw?.camelotKey || meta.key || meta.camelotKey || '').toUpperCase();
    const energy = Number(raw?.energy || meta.energy || 0);
    const genre = String(raw?.genre || meta.genre || '').trim();
    return { ...raw, id: idOf(raw), name, bpm, key, energy, genre, playCount: Number(raw?.playCount || 0), lastPlayed: raw?.lastPlayed || null };
  }

  function harvestTracks() {
    const pools = [window.MediaSuiteLibrary, window.mediaSuiteLibrary, window.libraryTracks, window.tracks, window.trackLibrary, window.APP_STATE?.tracks, window.state?.tracks];
    const found = pools.find(Array.isArray) || [];
    state.tracks = found.map(normalizeTrack);
    if (!state.tracks.length) {
      // DOM fallback for installer previews.
      const items = [...document.querySelectorAll('[data-track-id], .file-item, .track-row')];
      state.tracks = items.map((el, idx) => normalizeTrack({
        id: el.dataset.trackId || `dom_${idx}`,
        name: el.dataset.name || el.querySelector('.file-item-name,.track-name')?.textContent?.trim() || el.textContent.trim().slice(0, 80),
        bpm: el.dataset.bpm,
        key: el.dataset.key,
        energy: el.dataset.energy,
        genre: el.dataset.genre
      }, idx));
    }
    return state.tracks;
  }

  function camelotDistance(a, b) {
    if (!a || !b) return 99;
    const ma = String(a).match(/^(\d{1,2})(A|B)$/i);
    const mb = String(b).match(/^(\d{1,2})(A|B)$/i);
    if (!ma || !mb) return 99;
    const na = Number(ma[1]), nb = Number(mb[1]);
    const la = ma[2].toUpperCase(), lb = mb[2].toUpperCase();
    if (na === nb && la === lb) return 0;
    const diff = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
    if (diff === 1 && la === lb) return 1;
    if (na === nb && la !== lb) return 1;
    return diff + (la === lb ? 0 : 1);
  }

  function scoreTrack(track, seed, intent) {
    let score = 0;
    if (seed?.bpm && track.bpm) score += Math.max(0, 40 - Math.abs(track.bpm - seed.bpm) * 2);
    if (seed?.key && track.key) score += Math.max(0, 30 - camelotDistance(seed.key, track.key) * 12);
    if (seed?.energy && track.energy) score += Math.max(0, 20 - Math.abs(track.energy - seed.energy) * 3);
    if (seed?.genre && track.genre && seed.genre.toLowerCase() === track.genre.toLowerCase()) score += 18;
    if (intent === 'warmup') score += Math.max(0, 15 - Math.abs((track.energy || 4) - 4) * 4);
    if (intent === 'peak') score += Math.max(0, ((track.energy || 0) - 6) * 4);
    if (intent === 'wedding' && /soca|dancehall|reggae|chutney|pop/i.test(track.genre || track.name)) score += 8;
    return Math.round(score);
  }

  function buildSet({ intent, minutes, genre }) {
    const tracks = harvestTracks();
    const targetCount = Math.max(8, Math.min(80, Math.round((Number(minutes) || 60) / 4)));
    const seed = {
      bpm: intent === 'warmup' ? 96 : intent === 'peak' ? 124 : 110,
      key: '',
      energy: intent === 'warmup' ? 4 : intent === 'peak' ? 8 : 6,
      genre
    };
    const ranked = tracks
      .filter(t => !genre || (t.genre || t.name || '').toLowerCase().includes(genre.toLowerCase()))
      .map(t => ({ ...t, _score: scoreTrack(t, seed, intent) }))
      .sort((a, b) => b._score - a._score || (a.bpm || 999) - (b.bpm || 999))
      .slice(0, targetCount);
    const record = { id: `set_${Date.now()}`, intent, minutes, genre, createdAt: Date.now(), tracks: ranked.map(t => t.id) };
    put(STORE.sets, record).catch(console.warn);
    return ranked;
  }

  function recommendations() {
    const tracks = harvestTracks();
    const deckSeed = window.MediaSuitePhase7?.activeDeckTrack || window.MediaSuitePhase8?.activeDeckTrack || tracks[0] || {};
    const seed = normalizeTrack(deckSeed, 0);
    return tracks.filter(t => t.id !== seed.id)
      .map(t => ({ ...t, _score: scoreTrack(t, seed, 'recommend') }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 12);
  }

  function libraryHealth() {
    const tracks = harvestTracks();
    const seen = new Map();
    let missingBpm = 0, missingKey = 0, missingEnergy = 0, duplicates = 0;
    tracks.forEach(t => {
      if (!t.bpm) missingBpm++;
      if (!t.key) missingKey++;
      if (!t.energy) missingEnergy++;
      const sig = `${(t.name || '').toLowerCase()}_${t.size || ''}`;
      if (seen.has(sig)) duplicates++; else seen.set(sig, true);
    });
    const health = { id: 'latest', total: tracks.length, missingBpm, missingKey, missingEnergy, duplicates, checkedAt: Date.now() };
    put(STORE.health, health).catch(console.warn);
    return health;
  }

  function createBeatGrid(trackId, bpm, offsetSec = 0, durationSec = 240) {
    const beat = 60 / Math.max(1, Number(bpm) || 120);
    const beats = [];
    for (let t = offsetSec; t < durationSec; t += beat) beats.push(Number(t.toFixed(4)));
    const grid = { id: trackId, trackId, bpm: Number(bpm) || 120, offsetSec, beats, updatedAt: Date.now() };
    put(STORE.beatGrids, grid).catch(console.warn);
    return grid;
  }

  function saveMemoryCue(trackId, label, timeSec) {
    const cue = { id: `${trackId}_${label}`, trackId, label, timeSec: Number(timeSec) || 0, updatedAt: Date.now() };
    put(STORE.memoryCues, cue).catch(console.warn);
    return cue;
  }

  function saveProfile(name) {
    const profile = {
      id: name,
      name,
      createdAt: Date.now(),
      eq: {
        hiA: val('hiEqA'), midA: val('midEqA'), lowA: val('lowEqA'),
        hiB: val('hiEqB'), midB: val('midEqB'), lowB: val('lowEqB')
      },
      mixer: { crossfader: val('crossfader'), masterGain: val('masterGain') },
      phase9: window.MediaSuitePhase9?.midiMappings || null
    };
    state.activeProfile = name;
    localStorage.setItem('ms_phase10_profile', name);
    put(STORE.profiles, profile).catch(console.warn);
    render();
  }

  function val(id) { return document.getElementById(id)?.value ?? null; }

  function exportEcosystemHook(kind) {
    const payload = {
      id: `${kind}_${Date.now()}`,
      kind,
      app: 'MediaSuite',
      timestamp: Date.now(),
      profile: state.activeProfile,
      libraryHealth: libraryHealth(),
      notes: kind === 'vault' ? 'Ready for 868 Vault metadata backup.' : kind === 'billboard' ? 'Ready for artist/podcast promotion packages.' : kind === 'linkmeh' ? 'Ready for event/playlist sharing.' : 'Ready for 868 Vision media bridge.'
    };
    put(STORE.ecosystem, payload).catch(console.warn);
    downloadJSON(payload, `mediasuite-${kind}-hook.json`);
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function trackRow(t) {
    return `<div class="phase10-track"><div><b>${escapeHTML(t.name || 'Untitled')}</b><small>${t.bpm || '—'} BPM · ${t.key || '—'} · Energy ${t.energy || '—'} · ${escapeHTML(t.genre || 'Unknown')}</small></div><span class="phase10-score">${t._score ?? ''}</span></div>`;
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function renderSetBuilder() {
    return `<div class="phase10-card"><h4>AI Set Builder</h4><p class="phase10-muted">Builds a local playlist using BPM progression, Camelot compatibility, energy curve, and genre matching.</p><div class="phase10-row"><select class="phase10-select" id="p10Intent"><option value="warmup">Warm Up</option><option value="peak">Peak Hour</option><option value="wedding">Wedding / Event</option><option value="closing">Closing Set</option></select><input class="phase10-input" id="p10Minutes" type="number" value="60" min="15" max="240" /></div><div class="phase10-row"><input class="phase10-input" id="p10Genre" placeholder="Genre filter e.g. Soca, Dancehall" /><button class="phase10-btn" id="p10BuildSet">Build</button></div><div class="phase10-result" id="p10SetResult"></div></div><div class="phase10-card"><h4>Recommended Next Tracks</h4><p class="phase10-muted">Ranks tracks against the active deck/seed track.</p><button class="phase10-btn" id="p10Recommend">Generate Recommendations</button><div class="phase10-result" id="p10RecResult"></div></div>`;
  }

  function renderLibraryOS() {
    const h = libraryHealth();
    return `<div class="phase10-card"><h4>Library Health Engine</h4><div class="phase10-health-grid"><div class="phase10-stat"><b>${h.total}</b><span>Total Tracks</span></div><div class="phase10-stat"><b>${h.duplicates}</b><span>Duplicates</span></div><div class="phase10-stat"><b>${h.missingBpm}</b><span>Missing BPM</span></div><div class="phase10-stat"><b>${h.missingKey}</b><span>Missing Key</span></div><div class="phase10-stat"><b>${h.missingEnergy}</b><span>Missing Energy</span></div><div class="phase10-stat"><b>${new Date(h.checkedAt).toLocaleTimeString()}</b><span>Checked</span></div></div><div class="phase10-row"><button class="phase10-btn" id="p10HealthRefresh">Refresh</button><button class="phase10-btn pink" id="p10ExportHealth">Export Report</button></div></div><div class="phase10-card"><h4>Auto Crate Generator</h4><p class="phase10-muted">Creates local smart-crate definitions based on library health and metadata patterns.</p><button class="phase10-btn" id="p10AutoCrates">Generate Smart Crate Pack</button><div class="phase10-result" id="p10CrateResult"></div></div>`;
  }

  function renderPerformance() {
    const first = harvestTracks()[0] || { id: 'manual_track', bpm: 120, name: 'Manual Track' };
    return `<div class="phase10-card"><h4>Beat Grid Editor Foundation</h4><p class="phase10-muted">Stores beat-grid markers for quantize, sync, loops, and slicer correction.</p><div class="phase10-row"><input class="phase10-input" id="p10GridTrack" value="${escapeHTML(first.id)}" /><input class="phase10-input" id="p10GridBpm" type="number" value="${first.bpm || 120}" /></div><div class="phase10-grid-editor" id="p10GridPreview"></div><div class="phase10-row"><button class="phase10-btn" id="p10SaveGrid">Save Grid</button><button class="phase10-btn" id="p10PreviewGrid">Preview</button></div></div><div class="phase10-card"><h4>Memory Cue System</h4><div class="phase10-row"><input class="phase10-input" id="p10CueLabel" placeholder="Intro / Drop / Outro" /><input class="phase10-input" id="p10CueTime" type="number" placeholder="Time seconds" /></div><button class="phase10-btn" id="p10SaveCue">Save Memory Cue</button><div class="phase10-result" id="p10CueResult"></div></div><div class="phase10-card"><h4>Performance Profiles</h4><p class="phase10-muted">Stores EQ, mixer, layout, and MIDI-control preferences.</p><span class="phase10-profile-badge">Active: ${escapeHTML(state.activeProfile)}</span><div class="phase10-row"><select class="phase10-select" id="p10Profile"><option>Wedding DJ</option><option>Club DJ</option><option>Radio DJ</option><option>Mobile DJ</option></select><button class="phase10-btn" id="p10SaveProfile">Save</button></div></div>`;
  }

  function renderMedia() {
    return `<div class="phase10-card"><h4>Media Expansion Layer</h4><p class="phase10-muted">Adds local-first records for Radio, Podcasts, and Audiobooks without starting a cloud streaming business.</p><div class="phase10-row"><input class="phase10-input" id="p10MediaUrl" placeholder="RSS feed, radio URL, audiobook file note" /></div><div class="phase10-row"><button class="phase10-btn" id="p10SaveRadio">Save Radio</button><button class="phase10-btn" id="p10SavePodcast">Save Podcast</button><button class="phase10-btn" id="p10SaveBook">Save Audiobook</button></div><div class="phase10-result" id="p10MediaResult"></div></div><div class="phase10-card"><h4>Studio Export Prep</h4><p class="phase10-muted">Prepares local mix-session export metadata for future WAV/MP3 rendering and LUFS analysis.</p><button class="phase10-btn" id="p10ExportSession">Export Session Manifest</button></div>`;
  }

  function renderEcosystem() {
    return `<div class="phase10-card"><h4>868 Ecosystem Hooks</h4><p class="phase10-muted">Exports safe local JSON bridge packets for future integration with Vault, Billboard, Linkmeh, and Vision.</p><div class="phase10-row"><button class="phase10-btn" data-hook="vault">868 Vault</button><button class="phase10-btn" data-hook="billboard">868 Billboard</button></div><div class="phase10-row"><button class="phase10-btn" data-hook="linkmeh">Linkmeh</button><button class="phase10-btn" data-hook="vision">868 Vision</button></div></div>`;
  }

  function render() {
    const body = document.getElementById('phase10Body');
    if (!body) return;
    const map = { setbuilder: renderSetBuilder, library: renderLibraryOS, performance: renderPerformance, media: renderMedia, ecosystem: renderEcosystem };
    body.innerHTML = (map[state.tab] || renderSetBuilder)();
    document.querySelectorAll('.phase10-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.tab));
    bindTabActions();
  }

  function bindTabActions() {
    const $ = (id) => document.getElementById(id);
    $('p10BuildSet')?.addEventListener('click', () => {
      const result = buildSet({ intent: $('p10Intent').value, minutes: $('p10Minutes').value, genre: $('p10Genre').value });
      $('p10SetResult').innerHTML = result.length ? result.map(trackRow).join('') : '<p class="phase10-muted">No matching tracks found.</p>';
    });
    $('p10Recommend')?.addEventListener('click', () => {
      const result = recommendations();
      $('p10RecResult').innerHTML = result.length ? result.map(trackRow).join('') : '<p class="phase10-muted">No library tracks found.</p>';
    });
    $('p10HealthRefresh')?.addEventListener('click', render);
    $('p10ExportHealth')?.addEventListener('click', () => downloadJSON(libraryHealth(), 'mediasuite-library-health.json'));
    $('p10AutoCrates')?.addEventListener('click', () => {
      const pack = [
        { name: 'Warm Up Tracks', isSmart: true, rules: { energyMax: 5, bpmMax: 110 } },
        { name: 'Peak Hour', isSmart: true, rules: { energyMin: 7 } },
        { name: 'Harmonic Matches', isSmart: true, rules: { requireCamelotKey: true } },
        { name: 'Missing Metadata', isSmart: true, rules: { missingAny: ['bpm', 'key', 'energy'] } }
      ];
      downloadJSON({ id: `smart_crates_${Date.now()}`, crates: pack }, 'mediasuite-smart-crate-pack.json');
      $('p10CrateResult').innerHTML = '<p class="phase10-muted">Smart crate pack exported.</p>';
    });
    $('p10PreviewGrid')?.addEventListener('click', previewGrid);
    $('p10SaveGrid')?.addEventListener('click', () => {
      const grid = createBeatGrid($('p10GridTrack').value, $('p10GridBpm').value, 0, 240);
      previewGrid(grid);
    });
    $('p10SaveCue')?.addEventListener('click', () => {
      const trackId = $('p10GridTrack')?.value || 'manual_track';
      const cue = saveMemoryCue(trackId, $('p10CueLabel').value || 'Cue', $('p10CueTime').value || 0);
      $('p10CueResult').innerHTML = `<p class="phase10-muted">Saved ${escapeHTML(cue.label)} at ${cue.timeSec}s.</p>`;
    });
    $('p10SaveProfile')?.addEventListener('click', () => saveProfile($('p10Profile').value));
    ['p10SaveRadio','p10SavePodcast','p10SaveBook'].forEach(id => $(id)?.addEventListener('click', () => {
      const kind = id.replace('p10Save','').toLowerCase();
      const url = $('p10MediaUrl').value.trim();
      const rec = { id: `${kind}_${Date.now()}`, kind, url, createdAt: Date.now() };
      put(STORE.ecosystem, rec).catch(console.warn);
      $('p10MediaResult').innerHTML = `<p class="phase10-muted">Saved ${kind} reference locally.</p>`;
    }));
    $('p10ExportSession')?.addEventListener('click', () => downloadJSON({ id: `session_${Date.now()}`, app: 'MediaSuite', activeProfile: state.activeProfile, createdAt: Date.now(), note: 'Future export/LUFS analysis manifest.' }, 'mediasuite-session-manifest.json'));
    document.querySelectorAll('[data-hook]').forEach(btn => btn.addEventListener('click', () => exportEcosystemHook(btn.dataset.hook)));
  }

  function previewGrid(grid) {
    const box = document.getElementById('p10GridPreview');
    if (!box) return;
    const bpm = Number(document.getElementById('p10GridBpm')?.value || 120);
    const g = grid?.beats ? grid : createBeatGrid(document.getElementById('p10GridTrack')?.value || 'manual_track', bpm, 0, 16);
    box.innerHTML = '';
    g.beats.slice(0, 32).forEach((beat) => {
      const line = document.createElement('div');
      line.className = 'phase10-grid-line';
      line.style.left = `${(beat / 16) * 100}%`;
      box.appendChild(line);
    });
  }

  function mount() {
    if (document.getElementById('phase10Panel')) return;
    const launcher = document.createElement('button');
    launcher.id = 'phase10Launcher';
    launcher.className = 'phase10-launcher';
    launcher.textContent = 'Phase 10';
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'phase10Panel';
    panel.className = 'phase10-panel';
    panel.innerHTML = `<div class="phase10-head"><div class="phase10-title">Phase 10 · Intelligence OS</div><button class="phase10-close" id="phase10Close">✕</button></div><div class="phase10-tabs"><button class="phase10-tab active" data-tab="setbuilder">Set Builder</button><button class="phase10-tab" data-tab="library">Library OS</button><button class="phase10-tab" data-tab="performance">Performance</button><button class="phase10-tab" data-tab="media">Media</button><button class="phase10-tab" data-tab="ecosystem">Ecosystem</button></div><div class="phase10-body" id="phase10Body"></div>`;
    document.body.appendChild(panel);

    launcher.addEventListener('click', () => { panel.classList.add('active'); launcher.classList.add('hidden'); render(); });
    document.getElementById('phase10Close').addEventListener('click', () => { panel.classList.remove('active'); launcher.classList.remove('hidden'); });
    document.querySelectorAll('.phase10-tab').forEach(btn => btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); }));
    render();
  }

  window.MediaSuitePhase10 = {
    harvestTracks,
    buildSet,
    recommendations,
    libraryHealth,
    createBeatGrid,
    saveMemoryCue,
    saveProfile,
    exportEcosystemHook
  };

  openDB().then(db => { state.db = db; mount(); }).catch(err => { console.warn('Phase10 DB failed:', err); mount(); });
})();
