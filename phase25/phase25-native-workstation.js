/* ============================================================
   MediaSuite V3 — Phase 25 Native Workstation Persistence
   Local-only .868 library export/import, AudioWorklet scaffold,
   cue-routing diagnostics, and Vault-compatible sync schema.
   ============================================================ */
(function(){
  'use strict';

  const PHASE = '25';
  const FILE_NAME = 'mediasuite-library.868';
  const DB_NAMES = ['MediaSuiteDB', 'mediasuite-db', 'media-suite-db'];

  const state = {
    lastExportAt: null,
    autoExport: false,
    directoryHandle: null,
    cueRouting: {
      supported: false,
      maxChannelCount: 0,
      mode: 'stereo-fallback',
      warning: ''
    },
    worklet: {
      supported: false,
      loaded: false,
      fallback: true,
      error: null
    }
  };

  function log(...args){ console.log('[MediaSuite Phase 25]', ...args); }
  function warn(...args){ console.warn('[MediaSuite Phase 25]', ...args); }

  function nowISO(){ return new Date().toISOString(); }

  async function openAnyDB(){
    if (!('indexedDB' in window)) return null;
    const candidates = DB_NAMES;
    for (const name of candidates){
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('phase25')) db.createObjectStore('phase25', { keyPath: 'key' });
          };
        });
        return db;
      } catch(e){ }
    }
    return null;
  }

  async function readStore(db, storeName){
    if (!db || !db.objectStoreNames.contains(storeName)) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function savePhase25Setting(key, value){
    const db = await openAnyDB();
    if (!db || !db.objectStoreNames.contains('phase25')) return;
    await new Promise((resolve) => {
      const tx = db.transaction('phase25', 'readwrite');
      tx.objectStore('phase25').put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function buildLibraryBundle(){
    const db = await openAnyDB();
    const stores = db ? Array.from(db.objectStoreNames) : [];
    const read = async (names) => {
      for (const n of names){
        if (stores.includes(n)) return await readStore(db, n);
      }
      return [];
    };

    const bundle = {
      schema: '868.mediasuite.library',
      schemaVersion: 1,
      app: 'MediaSuite',
      phase: PHASE,
      exportedAt: nowISO(),
      localOnly: true,
      compatibility: {
        vault: true,
        filename: FILE_NAME,
        notes: 'Designed for 868 Vault local-file ingestion and MediaSuite restore.'
      },
      data: {
        tracks: await read(['tracks','library','trackIndex']),
        metadata: await read(['metadata','trackMetadata']),
        playlists: await read(['playlists']),
        crates: await read(['crates','smartCrates']),
        smartCrateRules: await read(['smartCrateRules','crateRules']),
        hotCues: await read(['hotCues','cuePoints']),
        beatGrids: await read(['beatGrids','beatgrid']),
        midiMappings: await read(['midiMappings','midi']),
        settings: await read(['settings','phase25']),
        diagnostics: {
          cueRouting: state.cueRouting,
          worklet: state.worklet,
          userAgent: navigator.userAgent,
          exportedAt: nowISO()
        }
      }
    };
    return bundle;
  }

  function downloadBlob(blob, filename){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function exportLibraryFile(){
    const bundle = await buildLibraryBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/vnd.868.mediasuite+json' });

    if (state.directoryHandle && state.directoryHandle.getFileHandle){
      try {
        const handle = await state.directoryHandle.getFileHandle(FILE_NAME, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        state.lastExportAt = nowISO();
        renderPhase25Status(`Saved ${FILE_NAME} to linked folder.`);
        return;
      } catch(e){ warn('Directory write failed; falling back to download.', e); }
    }

    downloadBlob(blob, FILE_NAME);
    state.lastExportAt = nowISO();
    renderPhase25Status(`Downloaded ${FILE_NAME}.`);
  }

  async function importLibraryFile(file){
    const text = await file.text();
    const json = JSON.parse(text);
    if (json.schema !== '868.mediasuite.library') throw new Error('Invalid .868 MediaSuite schema.');
    await savePhase25Setting('lastImportedBundle', json);
    renderPhase25Status(`Imported ${file.name}. Restore staging saved locally.`);
  }

  async function chooseSyncFolder(){
    if (!window.showDirectoryPicker) {
      renderPhase25Status('Folder write access is unsupported in this browser. Download export mode will be used.');
      return;
    }
    state.directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await savePhase25Setting('directoryName', state.directoryHandle.name || 'Linked Folder');
    renderPhase25Status(`Linked folder: ${state.directoryHandle.name || 'Local folder'}`);
  }

  function detectCueRouting(audioCtx){
    const dest = audioCtx && audioCtx.destination;
    const max = dest ? (dest.maxChannelCount || dest.channelCount || 2) : 0;
    state.cueRouting.maxChannelCount = max;
    if (dest && max >= 4){
      try {
        dest.channelCount = 4;
        dest.channelCountMode = 'explicit';
        state.cueRouting.supported = true;
        state.cueRouting.mode = 'hardware-4ch';
        state.cueRouting.warning = '';
      } catch(e){
        state.cueRouting.supported = false;
        state.cueRouting.mode = 'stereo-fallback';
        state.cueRouting.warning = '4-channel hardware exists but browser refused explicit routing.';
      }
    } else {
      state.cueRouting.supported = false;
      state.cueRouting.mode = 'stereo-fallback';
      state.cueRouting.warning = 'Only stereo output detected. Hardware headphone cue is unavailable.';
    }
    return state.cueRouting;
  }

  async function initAudioWorklet(audioCtx){
    state.worklet.supported = !!(audioCtx && audioCtx.audioWorklet && window.isSecureContext);
    if (!state.worklet.supported){
      state.worklet.fallback = true;
      state.worklet.error = 'AudioWorklet unavailable or insecure context.';
      return state.worklet;
    }
    try {
      await audioCtx.audioWorklet.addModule('phase25/worklets/mediasuite-phase25-processor.js');
      state.worklet.loaded = true;
      state.worklet.fallback = false;
      state.worklet.error = null;
    } catch(e){
      state.worklet.loaded = false;
      state.worklet.fallback = true;
      state.worklet.error = String(e && e.message || e);
    }
    return state.worklet;
  }

  function injectPanel(){
    if (document.getElementById('phase25Panel')) return;
    const panel = document.createElement('section');
    panel.id = 'phase25Panel';
    panel.className = 'glass-pod phase25-panel';
    panel.innerHTML = `
      <div class="phase25-head">
        <strong>Phase 25 Native Workstation Persistence</strong>
        <span id="phase25Status">Ready</span>
      </div>
      <div class="phase25-grid">
        <button class="glass-btn" id="phase25ChooseFolder">Link Sync Folder</button>
        <button class="glass-btn accent" id="phase25Export">Export mediasuite-library.868</button>
        <label class="glass-btn phase25-import-label">Import .868<input id="phase25Import" type="file" accept=".868,application/json" hidden></label>
        <button class="glass-btn" id="phase25Diagnostics">Run Diagnostics</button>
      </div>
      <div class="phase25-diagnostics" id="phase25DiagnosticsOut"></div>
    `;
    const target = document.querySelector('#tab-archive .archive-layout') || document.querySelector('.workspace') || document.body;
    target.prepend(panel);

    document.getElementById('phase25ChooseFolder').addEventListener('click', chooseSyncFolder);
    document.getElementById('phase25Export').addEventListener('click', exportLibraryFile);
    document.getElementById('phase25Diagnostics').addEventListener('click', runDiagnostics);
    document.getElementById('phase25Import').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try { await importLibraryFile(file); }
      catch(err){ renderPhase25Status(`Import failed: ${err.message}`); }
    });
  }

  function renderPhase25Status(msg){
    const el = document.getElementById('phase25Status');
    if (el) el.textContent = msg;
    log(msg);
  }

  function runDiagnostics(){
    const out = document.getElementById('phase25DiagnosticsOut');
    const audioCtx = window.audioCtx || window.__mediaSuiteAudioCtx || null;
    if (audioCtx) detectCueRouting(audioCtx);
    const report = {
      phase: PHASE,
      time: nowISO(),
      secureContext: window.isSecureContext,
      fileSystemAccess: !!window.showDirectoryPicker,
      indexedDB: !!window.indexedDB,
      audioWorklet: state.worklet,
      cueRouting: state.cueRouting
    };
    if (out) out.textContent = JSON.stringify(report, null, 2);
    return report;
  }

  function startAutoSerializer(){
    setInterval(async () => {
      if (!state.autoExport || !state.directoryHandle) return;
      try { await exportLibraryFile(); }
      catch(e){ warn('Auto serializer failed', e); }
    }, 5 * 60 * 1000);
  }

  window.MediaSuitePhase25 = {
    state,
    buildLibraryBundle,
    exportLibraryFile,
    importLibraryFile,
    chooseSyncFolder,
    detectCueRouting,
    initAudioWorklet,
    runDiagnostics
  };

  document.addEventListener('DOMContentLoaded', () => {
    injectPanel();
    startAutoSerializer();
    setTimeout(runDiagnostics, 500);
  });
})();
