/* ============================================================
   MediaSuite V3 — Phase 27: Phase Analysis & Delta Backup
   - Conservative cross-correlation phase drift estimation
   - Manual soft sync tightening
   - Delta-compressed .868 backup payloads
   - Unified AudioWorklet scaffold with native fallback
   ============================================================ */
(function () {
  'use strict';

  const PHASE27_VERSION = '27.0.0';
  const DEFAULT_WINDOW = 2048;
  const MAX_LAG = 256;
  const MICRO_NUDGE_MAX = 0.004;
  const NUDGE_DECAY_MS = 650;

  const state = window.MediaSuitePhase27 = window.MediaSuitePhase27 || {
    version: PHASE27_VERSION,
    enabled: true,
    lastDriftSamples: 0,
    lastDriftMs: 0,
    lastCorrelation: 0,
    lastAnalysisAt: 0,
    workletReady: false,
    workletFallback: true,
    deltaBackupReady: true,
    lastBackupBytes: 0,
    lastDeltaKeys: 0,
    status: 'Phase 27 ready'
  };

  function $(id) { return document.getElementById(id); }

  function logStatus(msg) {
    state.status = msg;
    const el = $('phase27Status');
    if (el) el.textContent = msg;
    if (window.renderState) {
      window.renderState.phase27Status = msg;
      window.renderState.phase27DriftMs = state.lastDriftMs;
      window.renderState.phase27Correlation = state.lastCorrelation;
    }
  }

  function ensurePanel() {
    if ($('phase27Panel')) return;
    const target = $('mixerCenter') || document.querySelector('.mixer-pod') || document.querySelector('.workspace') || document.body;
    const panel = document.createElement('div');
    panel.id = 'phase27Panel';
    panel.className = 'phase27-panel glass-pod';
    panel.innerHTML = `
      <div class="phase27-hdr">PHASE 27 · PHASE ANALYSIS & DELTA BACKUP</div>
      <div class="phase27-grid">
        <div class="phase27-card">
          <span class="phase27-label">Phase Drift</span>
          <strong id="phase27Drift">0.00 ms</strong>
        </div>
        <div class="phase27-card">
          <span class="phase27-label">Correlation</span>
          <strong id="phase27Corr">0.000</strong>
        </div>
        <div class="phase27-card">
          <span class="phase27-label">Worklet</span>
          <strong id="phase27Worklet">Fallback</strong>
        </div>
      </div>
      <div class="phase27-actions">
        <button class="glass-btn accent" id="phase27AnalyzeBtn">Analyze Phase</button>
        <button class="glass-btn" id="phase27TightenBtn">Tighten Sync</button>
        <button class="glass-btn" id="phase27BackupBtn">Write Delta .868</button>
      </div>
      <div class="phase27-status" id="phase27Status">Phase 27 ready</div>
    `;
    target.appendChild(panel);
    $('phase27AnalyzeBtn')?.addEventListener('click', analyzePhaseFromDecks);
    $('phase27TightenBtn')?.addEventListener('click', () => softTightenSync());
    $('phase27BackupBtn')?.addEventListener('click', () => exportDelta868Backup());
  }

  function normalizeWindow(input, size = DEFAULT_WINDOW) {
    const out = new Float32Array(size);
    if (!input || input.length === 0) return out;
    const len = Math.min(size, input.length);
    let mean = 0;
    for (let i = 0; i < len; i++) mean += input[i];
    mean /= len || 1;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const v = input[i] - mean;
      out[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
    return out;
  }

  function crossCorrelate(a, b, maxLag = MAX_LAG) {
    const x = normalizeWindow(a);
    const y = normalizeWindow(b);
    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < x.length; i++) {
        const j = i + lag;
        if (j >= 0 && j < y.length) {
          sum += x[i] * y[j];
          count++;
        }
      }
      const score = count ? sum / count : -Infinity;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    return { lagSamples: bestLag, correlation: Number(bestScore.toFixed(4)) };
  }

  function getAudioCtx() {
    return window.audioCtx || window.audioContext || window.MediaSuiteAudioContext || null;
  }

  function getDeckBuffer(deckKey) {
    const candidates = [
      window[`deck${deckKey?.toUpperCase?.()}Buffer`],
      window[`deck${deckKey?.toUpperCase?.()}`]?.buffer,
      window.decks?.[deckKey]?.buffer,
      window.deckState?.[deckKey]?.buffer,
      window.MediaSuiteDecks?.[deckKey]?.buffer
    ];
    return candidates.find(Boolean) || null;
  }

  function getDeckTime(deckKey) {
    const d = window.decks?.[deckKey] || window.deckState?.[deckKey] || window.MediaSuiteDecks?.[deckKey] || {};
    return Number(d.currentTime || d.playhead || d.offset || 0);
  }

  function sliceBufferWindow(buffer, timeSeconds, size = DEFAULT_WINDOW) {
    if (!buffer || typeof buffer.getChannelData !== 'function') return null;
    const sr = buffer.sampleRate || 44100;
    const start = Math.max(0, Math.floor((timeSeconds || 0) * sr));
    const channel = buffer.getChannelData(0);
    const out = new Float32Array(size);
    for (let i = 0; i < size; i++) out[i] = channel[start + i] || 0;
    return out;
  }

  function analyzePhaseFromDecks() {
    const aBuf = getDeckBuffer('a');
    const bBuf = getDeckBuffer('b');
    if (!aBuf || !bBuf) {
      logStatus('Load Deck A and Deck B before phase analysis.');
      return null;
    }
    const aWin = sliceBufferWindow(aBuf, getDeckTime('a'));
    const bWin = sliceBufferWindow(bBuf, getDeckTime('b'));
    const result = crossCorrelate(aWin, bWin);
    const sr = aBuf.sampleRate || bBuf.sampleRate || 44100;
    state.lastDriftSamples = result.lagSamples;
    state.lastDriftMs = Number(((result.lagSamples / sr) * 1000).toFixed(3));
    state.lastCorrelation = result.correlation;
    state.lastAnalysisAt = Date.now();
    updateMeters();
    logStatus(`Phase drift estimated: ${state.lastDriftMs} ms @ corr ${state.lastCorrelation}`);
    return result;
  }

  function updateMeters() {
    const drift = $('phase27Drift');
    const corr = $('phase27Corr');
    const worklet = $('phase27Worklet');
    if (drift) drift.textContent = `${state.lastDriftMs.toFixed(3)} ms`;
    if (corr) corr.textContent = `${Number(state.lastCorrelation || 0).toFixed(4)}`;
    if (worklet) worklet.textContent = state.workletReady ? 'Ready' : 'Fallback';
  }

  function findTargetPlaybackRateNode(deckKey = 'b') {
    const d = window.decks?.[deckKey] || window.deckState?.[deckKey] || window.MediaSuiteDecks?.[deckKey] || {};
    return d.source?.playbackRate || d.playbackRate || null;
  }

  function softTightenSync(deckKey = 'b') {
    const result = analyzePhaseFromDecks();
    if (!result) return;
    const audioCtx = getAudioCtx();
    const rate = findTargetPlaybackRateNode(deckKey);
    const magnitude = Math.min(Math.abs(state.lastDriftMs) / 100, MICRO_NUDGE_MAX);
    const direction = state.lastDriftSamples > 0 ? -1 : 1;
    const nudge = 1 + direction * magnitude;

    if (rate && audioCtx && typeof rate.setValueAtTime === 'function') {
      const now = audioCtx.currentTime;
      const current = Number(rate.value || 1);
      rate.cancelScheduledValues?.(now);
      rate.setValueAtTime(current, now);
      rate.linearRampToValueAtTime(nudge, now + 0.015);
      rate.linearRampToValueAtTime(1, now + NUDGE_DECAY_MS / 1000);
      logStatus(`Soft sync nudge applied to Deck ${deckKey.toUpperCase()}: ${nudge.toFixed(5)} → 1.00000`);
    } else {
      logStatus('PlaybackRate node unavailable. Phase analysis only; no nudge applied.');
    }
  }

  function stripRedundantTrackFields(track) {
    const out = {};
    const keep = ['id','name','path','size','lastModified','duration','bpm','key','camelotKey','energy','genre','mood','artist','album','favorite','playCount','lastPlayed','cuePoints','beatGrid'];
    keep.forEach(k => {
      if (track && track[k] !== undefined && track[k] !== null && track[k] !== '') out[k] = track[k];
    });
    return out;
  }

  function makeDeltaPayload(dbState) {
    const tracks = Array.isArray(dbState?.tracks) ? dbState.tracks.map(stripRedundantTrackFields) : [];
    const crates = Array.isArray(dbState?.crates) ? dbState.crates : [];
    const playlists = Array.isArray(dbState?.playlists) ? dbState.playlists : [];
    const settings = dbState?.settings || {};
    const payload = {
      schema: 'mediasuite-library.868.delta',
      version: PHASE27_VERSION,
      createdAt: new Date().toISOString(),
      app: 'MediaSuite V3',
      delta: {
        tracks,
        crates,
        playlists,
        settings,
        midiMappings: dbState?.midiMappings || [],
        diagnostics: dbState?.diagnostics || {},
      }
    };
    state.lastDeltaKeys = tracks.length + crates.length + playlists.length;
    return payload;
  }

  async function gzipBlobFromJson(obj) {
    const text = JSON.stringify(obj);
    if ('CompressionStream' in window) {
      const stream = new Blob([text], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      return new Blob([blob], { type: 'application/octet-stream' });
    }
    return new Blob([text], { type: 'application/json' });
  }

  async function collectBasicLibraryState() {
    const stateObj = {
      tracks: window.libraryTracks || window.tracks || window.MediaSuiteLibrary?.tracks || [],
      crates: window.crates || window.MediaSuiteLibrary?.crates || [],
      playlists: window.playlists || window.MediaSuiteLibrary?.playlists || [],
      settings: window.settings || window.MediaSuiteSettings || {},
      midiMappings: window.midiMappings || window.MediaSuiteMidiMappings || [],
      diagnostics: {
        exportedBy: 'Phase 27 Delta Backup',
        phaseDriftMs: state.lastDriftMs,
        workletReady: state.workletReady,
        userAgent: navigator.userAgent
      }
    };
    return stateObj;
  }

  async function getWritableDirectoryHandle() {
    const candidates = [
      window.rootDirectoryHandle,
      window.directoryHandle,
      window.MediaSuiteDirectoryHandle,
      window.activeDirectoryHandle
    ].filter(Boolean);
    for (const h of candidates) {
      try {
        if (h && typeof h.getFileHandle === 'function') return h;
      } catch (_) {}
    }
    if (window.showDirectoryPicker) {
      return await window.showDirectoryPicker({ mode: 'readwrite' });
    }
    return null;
  }

  async function exportDelta868Backup() {
    try {
      const libraryState = await collectBasicLibraryState();
      const payload = makeDeltaPayload(libraryState);
      const blob = await gzipBlobFromJson(payload);
      state.lastBackupBytes = blob.size;

      const dir = await getWritableDirectoryHandle();
      if (!dir) throw new Error('No writable directory handle available.');
      const fileHandle = await dir.getFileHandle('mediasuite-library.868', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      logStatus(`Delta .868 backup written: ${blob.size} bytes, ${state.lastDeltaKeys} records.`);
    } catch (err) {
      console.warn('[Phase27] Delta backup failed:', err);
      logStatus(`Delta backup failed: ${err.message || err}`);
    }
  }

  async function initUnifiedWorkletScaffold() {
    const audioCtx = getAudioCtx();
    if (!audioCtx || !audioCtx.audioWorklet) {
      state.workletReady = false;
      state.workletFallback = true;
      updateMeters();
      return false;
    }
    try {
      await audioCtx.audioWorklet.addModule('worklets/phase27-unified-matrix-processor.js');
      const node = new AudioWorkletNode(audioCtx, 'phase27-unified-matrix', {
        numberOfInputs: 3,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      window.phase27UnifiedWorkletNode = node;
      state.workletReady = true;
      state.workletFallback = false;
      node.port.onmessage = (event) => {
        if (event.data?.type === 'meter') {
          state.workletMeter = event.data.value;
        }
      };
      logStatus('Unified worklet scaffold initialized. Existing fallback routing preserved.');
      updateMeters();
      return true;
    } catch (err) {
      console.warn('[Phase27] Worklet scaffold unavailable:', err);
      state.workletReady = false;
      state.workletFallback = true;
      updateMeters();
      return false;
    }
  }

  window.MediaSuitePhase27.analyzePhase = analyzePhaseFromDecks;
  window.MediaSuitePhase27.tightenSync = softTightenSync;
  window.MediaSuitePhase27.exportDelta868Backup = exportDelta868Backup;
  window.MediaSuitePhase27.initUnifiedWorkletScaffold = initUnifiedWorkletScaffold;

  document.addEventListener('DOMContentLoaded', () => {
    ensurePanel();
    setTimeout(initUnifiedWorkletScaffold, 800);
    setInterval(() => {
      if (window.renderState && typeof window.renderState === 'object') {
        window.renderState.phase27 = {
          driftMs: state.lastDriftMs,
          correlation: state.lastCorrelation,
          workletReady: state.workletReady,
          lastBackupBytes: state.lastBackupBytes
        };
      }
    }, 1000);
  });
})();
