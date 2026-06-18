/* ============================================================
   MediaSuite V3 — Phase 26 DSP Saturation & Local Cutter
   Adds local-only DSP utilities, WaveShaper saturation, and WAV trim export.
   Designed to patch onto existing MediaSuite globals without breaking older phases.
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'mediasuite-db';
  const PHASE = 'phase-26';

  const state = {
    enabled: false,
    saturationEnabled: true,
    saturationDrive: 1.8,
    saturationNode: null,
    scratchWorkletReady: false,
    scratchNode: null,
    scratchVelocity: 1,
    scratchWet: 0,
    selectedTrack: null,
    trimStart: 0,
    trimEnd: 0,
    lastExportName: '',
    diagnostics: []
  };

  function log(message, extra) {
    const row = { time: new Date().toISOString(), phase: PHASE, message, extra: extra || null };
    state.diagnostics.unshift(row);
    state.diagnostics = state.diagnostics.slice(0, 80);
    console.info('[MediaSuite Phase 26]', message, extra || '');
    renderDiagnostics();
  }

  function audioContext() {
    return window.audioCtx || window.audioContext || window.MediaSuiteAudioContext || null;
  }

  function makeSaturationCurve(drive) {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = Math.max(0.1, Number(drive) || 1);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  function ensureSaturationNode() {
    const ctx = audioContext();
    if (!ctx) {
      log('AudioContext not found. Saturation node pending.');
      return null;
    }
    if (!state.saturationNode) {
      state.saturationNode = ctx.createWaveShaper();
      state.saturationNode.curve = makeSaturationCurve(state.saturationDrive);
      state.saturationNode.oversample = '4x';
      log('WaveShaper saturation node created before limiter chain.');
    }
    return state.saturationNode;
  }

  function updateSaturation() {
    const node = ensureSaturationNode();
    if (!node) return;
    node.curve = makeSaturationCurve(state.saturationDrive);
    node.oversample = '4x';
    log(`Saturation updated: ${state.saturationEnabled ? 'ON' : 'OFF'}, drive ${state.saturationDrive}`);
  }

  async function initScratchWorklet() {
    const ctx = audioContext();
    if (!ctx || !ctx.audioWorklet) {
      state.scratchWorkletReady = false;
      log('AudioWorklet unavailable. Scratch fallback mode active.');
      return false;
    }
    try {
      await ctx.audioWorklet.addModule('worklets/vinyl-scratch-processor.js');
      state.scratchNode = new AudioWorkletNode(ctx, 'vinyl-scratch-processor');
      state.scratchNode.parameters.get('scratchVelocity')?.setValueAtTime(state.scratchVelocity, ctx.currentTime);
      state.scratchNode.parameters.get('scratchWet')?.setValueAtTime(state.scratchWet, ctx.currentTime);
      state.scratchWorkletReady = true;
      log('Vinyl scratch AudioWorklet initialized.');
      return true;
    } catch (err) {
      state.scratchWorkletReady = false;
      log('AudioWorklet scratch initialization failed; fallback mode active.', String(err));
      return false;
    }
  }

  function setScratchParams(velocity, wet) {
    const ctx = audioContext();
    state.scratchVelocity = Number(velocity);
    state.scratchWet = Number(wet);
    if (ctx && state.scratchNode) {
      state.scratchNode.parameters.get('scratchVelocity')?.setTargetAtTime(state.scratchVelocity, ctx.currentTime, 0.006);
      state.scratchNode.parameters.get('scratchWet')?.setTargetAtTime(state.scratchWet, ctx.currentTime, 0.006);
    }
    log(`Scratch params updated: velocity=${state.scratchVelocity}, wet=${state.scratchWet}`);
  }

  function wavEncode(audioBuffer, startSec, endSec) {
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(audioBuffer.length, Math.floor(endSec * sampleRate));
    const frames = Math.max(0, end - start);
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function str(offset, s) { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }

    str(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    const channelData = [];
    for (let ch = 0; ch < channels; ch++) channelData.push(audioBuffer.getChannelData(ch));

    for (let i = start; i < end; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function getSelectedAudioBuffer() {
    // Expected integrations may expose current buffer under one of these names.
    const candidates = [
      window.currentAudioBuffer,
      window.activeAudioBuffer,
      window.deckA?.buffer,
      window.deckB?.buffer,
      window.MediaSuite?.activeAudioBuffer,
      window.MediaSuite?.decks?.a?.buffer,
      window.MediaSuite?.decks?.b?.buffer
    ];
    const found = candidates.find(Boolean);
    if (found && typeof found.getChannelData === 'function') return found;
    throw new Error('No decoded AudioBuffer found. Load/select a track first.');
  }

  async function exportTrimmedWav() {
    try {
      const audioBuffer = await getSelectedAudioBuffer();
      const dur = audioBuffer.duration || 0;
      const start = Math.max(0, Math.min(Number(state.trimStart) || 0, dur));
      const end = Math.max(start + 0.01, Math.min(Number(state.trimEnd) || dur, dur));
      const blob = wavEncode(audioBuffer, start, end);
      const name = buildExportName(start, end);
      state.lastExportName = name;

      if (window.currentDirectoryHandle && window.currentDirectoryHandle.getFileHandle) {
        const fileHandle = await window.currentDirectoryHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        log(`Trimmed WAV written to active folder: ${name}`);
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        log(`Trimmed WAV saved: ${name}`);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        log(`Trimmed WAV downloaded: ${name}`);
      }
    } catch (err) {
      log('Trim export failed.', String(err));
      alert('Trim export failed: ' + (err && err.message ? err.message : err));
    }
  }

  function buildExportName(start, end) {
    const base = (state.selectedTrack?.name || window.npTitle?.textContent || 'mediasuite-cut')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'mediasuite-cut';
    return `${base}-${start.toFixed(2)}-${end.toFixed(2)}.wav`;
  }

  function injectStyles() {
    if (document.getElementById('phase26Styles')) return;
    const css = document.createElement('style');
    css.id = 'phase26Styles';
    css.textContent = `
      .phase26-panel{margin:12px;padding:14px;border:1px solid rgba(0,229,255,.18);border-radius:18px;background:rgba(255,255,255,.035);backdrop-filter:blur(18px);color:#eeeeff}
      .phase26-title{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#00e5ff;margin-bottom:10px}
      .phase26-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .phase26-card{border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:10px;background:rgba(0,0,0,.14)}
      .phase26-card label{display:block;font-size:10px;color:rgba(238,238,255,.55);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
      .phase26-card input[type=range],.phase26-card input[type=number]{width:100%}
      .phase26-btn{border:1px solid rgba(0,229,255,.22);background:rgba(0,229,255,.12);color:#00e5ff;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:700;margin:4px 4px 0 0;cursor:pointer}
      .phase26-btn:hover{background:rgba(0,229,255,.2)}
      .phase26-log{max-height:120px;overflow:auto;font-family:monospace;font-size:10px;color:rgba(238,238,255,.6);line-height:1.45;margin-top:8px}
      .phase26-status{font-size:11px;color:rgba(238,238,255,.65);margin-top:6px}
    `;
    document.head.appendChild(css);
  }

  function injectUI() {
    if (document.getElementById('phase26Panel')) return;
    injectStyles();
    const host = document.querySelector('#tab-archive .archive-editor') || document.querySelector('#tab-deck') || document.querySelector('.workspace') || document.body;
    const panel = document.createElement('section');
    panel.id = 'phase26Panel';
    panel.className = 'phase26-panel';
    panel.innerHTML = `
      <div class="phase26-title">Phase 26 — DSP Saturation & Local Cutter</div>
      <div class="phase26-grid">
        <div class="phase26-card">
          <label>Soft Saturation Drive</label>
          <input id="phase26Drive" type="range" min="0.1" max="8" step="0.1" value="1.8" />
          <div class="phase26-status" id="phase26DriveText">Drive: 1.8</div>
          <button class="phase26-btn" id="phase26ToggleSat">Saturation ON</button>
        </div>
        <div class="phase26-card">
          <label>Vinyl Scratch Worklet</label>
          <input id="phase26ScratchVel" type="range" min="-4" max="4" step="0.01" value="1" />
          <input id="phase26ScratchWet" type="range" min="0" max="1" step="0.01" value="0" />
          <div class="phase26-status" id="phase26ScratchText">Velocity: 1.00 · Wet: 0.00</div>
          <button class="phase26-btn" id="phase26InitScratch">Initialize Scratch DSP</button>
        </div>
        <div class="phase26-card">
          <label>Local WAV Cutter</label>
          <input id="phase26TrimStart" type="number" min="0" step="0.01" placeholder="Start seconds" />
          <input id="phase26TrimEnd" type="number" min="0" step="0.01" placeholder="End seconds" />
          <button class="phase26-btn" id="phase26ExportWav">Export Trimmed WAV</button>
          <div class="phase26-status">Writes locally through active folder handle when available.</div>
        </div>
      </div>
      <div class="phase26-log" id="phase26Log"></div>
    `;
    host.appendChild(panel);

    document.getElementById('phase26Drive')?.addEventListener('input', (e) => {
      state.saturationDrive = Number(e.target.value);
      document.getElementById('phase26DriveText').textContent = `Drive: ${state.saturationDrive.toFixed(1)}`;
      updateSaturation();
    });
    document.getElementById('phase26ToggleSat')?.addEventListener('click', (e) => {
      state.saturationEnabled = !state.saturationEnabled;
      e.currentTarget.textContent = state.saturationEnabled ? 'Saturation ON' : 'Saturation OFF';
      updateSaturation();
    });
    document.getElementById('phase26InitScratch')?.addEventListener('click', initScratchWorklet);
    const scratchChange = () => {
      const vel = Number(document.getElementById('phase26ScratchVel')?.value || 1);
      const wet = Number(document.getElementById('phase26ScratchWet')?.value || 0);
      document.getElementById('phase26ScratchText').textContent = `Velocity: ${vel.toFixed(2)} · Wet: ${wet.toFixed(2)}`;
      setScratchParams(vel, wet);
    };
    document.getElementById('phase26ScratchVel')?.addEventListener('input', scratchChange);
    document.getElementById('phase26ScratchWet')?.addEventListener('input', scratchChange);
    document.getElementById('phase26TrimStart')?.addEventListener('input', (e) => state.trimStart = Number(e.target.value || 0));
    document.getElementById('phase26TrimEnd')?.addEventListener('input', (e) => state.trimEnd = Number(e.target.value || 0));
    document.getElementById('phase26ExportWav')?.addEventListener('click', exportTrimmedWav);
  }

  function renderDiagnostics() {
    const el = document.getElementById('phase26Log');
    if (!el) return;
    el.innerHTML = state.diagnostics.slice(0, 10).map(d => `<div>${d.time.split('T')[1].replace('Z','')} — ${escapeHtml(d.message)}</div>`).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function init() {
    state.enabled = true;
    injectUI();
    ensureSaturationNode();
    log('Phase 26 initialized. Local DSP and cutter tools ready.');
  }

  window.MediaSuitePhase26 = {
    state,
    init,
    ensureSaturationNode,
    updateSaturation,
    initScratchWorklet,
    setScratchParams,
    exportTrimmedWav,
    wavEncode
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
