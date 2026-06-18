/* ============================================================
   MediaSuite V3 Phase 24 — GPU Visuals & Reverb Matrix
   Client-side only. No network calls. Safe fallbacks included.
   ============================================================ */
(function () {
  'use strict';

  const PHASE = 'Phase 24';
  const DB_NAME = 'mediasuite-v3';
  const IR_STORE = 'impulseResponses';

  const state = {
    hub: null,
    hubReady: false,
    gpuMode: 'canvas',
    gl: null,
    visualCanvas: null,
    analyser: null,
    freqData: null,
    reverb: {
      enabled: false,
      preset: 'Studio',
      wet: 0.22,
      sends: { a: 0, b: 0 },
      convolver: null,
      wetGain: null,
      dryGain: null,
      input: null,
      output: null,
      impulseBuffer: null
    }
  };

  const IR_PRESETS = {
    Studio: { seconds: 0.55, decay: 2.2 },
    Hall: { seconds: 1.8, decay: 3.8 },
    Arena: { seconds: 3.2, decay: 5.2 }
  };

  function log(level, message, data) {
    const payload = { level, message: `[${PHASE}] ${message}`, data: data || null };
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](payload.message, payload.data || '');
    if (state.hub) state.hub.port.postMessage({ type: 'diagnostic:add', payload });
    window.MediaSuitePhase24Diagnostics = window.MediaSuitePhase24Diagnostics || [];
    window.MediaSuitePhase24Diagnostics.push({ ...payload, ts: Date.now() });
  }

  function getAudioCtx() {
    return window.audioCtx || window.audioContext || window.MediaSuiteAudioContext || null;
  }

  function connectHub() {
    if (!('SharedWorker' in window)) {
      log('warn', 'SharedWorker unavailable; using single-window fallback');
      return;
    }
    try {
      state.hub = new SharedWorker('mediasuite-hub.sharedworker.js');
      state.hub.port.start();
      state.hub.port.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === 'hub:ready') {
          state.hubReady = true;
          updateStatus('hub', `Hub online · ${payload.activeWindowCount || 1} window`);
        }
        if (type === 'hub:window-count') updateStatus('hub', `Hub online · ${payload.count} windows`);
        if (type === 'renderState:patch' && window.renderState) Object.assign(window.renderState, payload || {});
      };
      state.hub.port.postMessage({ type: 'hub:get-state' });
      log('info', 'SharedWorker hub initialized');
    } catch (err) {
      log('warn', 'SharedWorker hub failed; continuing without multi-tab sync', err.message);
    }
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 24);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IR_STORE)) db.createObjectStore(IR_STORE, { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGet(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function dbPut(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    });
  }

  function makeImpulse(ctx, presetName) {
    const p = IR_PRESETS[presetName] || IR_PRESETS.Studio;
    const length = Math.max(1, Math.floor(ctx.sampleRate * p.seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, p.decay);
      }
    }
    return buffer;
  }

  async function loadImpulse(ctx, presetName) {
    try {
      const cached = await dbGet(IR_STORE, presetName);
      if (cached && cached.channels && cached.sampleRate) {
        const length = cached.channels[0].length;
        const buffer = ctx.createBuffer(cached.channels.length, length, cached.sampleRate);
        cached.channels.forEach((arr, ch) => buffer.copyToChannel(new Float32Array(arr), ch));
        return buffer;
      }
    } catch (err) {
      log('warn', 'Impulse cache read failed', err.message);
    }
    const buffer = makeImpulse(ctx, presetName);
    try {
      const channels = [];
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(Array.from(buffer.getChannelData(ch)));
      await dbPut(IR_STORE, { name: presetName, sampleRate: buffer.sampleRate, channels, createdAt: Date.now() });
    } catch (err) {
      log('warn', 'Impulse cache write failed', err.message);
    }
    return buffer;
  }

  async function initReverb() {
    const ctx = getAudioCtx();
    if (!ctx) {
      updateStatus('reverb', 'Waiting for AudioContext');
      return null;
    }
    if (state.reverb.input) return state.reverb;
    const input = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    const convolver = ctx.createConvolver();
    const output = ctx.createGain();
    dryGain.gain.value = 1 - state.reverb.wet;
    wetGain.gain.value = state.reverb.wet;
    input.connect(dryGain).connect(output);
    input.connect(convolver).connect(wetGain).connect(output);
    try { output.connect(ctx.destination); } catch (_) {}
    state.reverb = { ...state.reverb, input, dryGain, wetGain, convolver, output };
    convolver.buffer = await loadImpulse(ctx, state.reverb.preset);
    updateStatus('reverb', `${state.reverb.preset} · wet ${Math.round(state.reverb.wet * 100)}%`);
    log('info', 'Reverb matrix initialized');
    return state.reverb;
  }

  async function setReverbPreset(name) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    await initReverb();
    state.reverb.preset = name;
    state.reverb.convolver.buffer = await loadImpulse(ctx, name);
    updateStatus('reverb', `${name} · wet ${Math.round(state.reverb.wet * 100)}%`);
  }

  function setReverbWet(value) {
    state.reverb.wet = Number(value);
    if (state.reverb.dryGain && state.reverb.wetGain) {
      state.reverb.dryGain.gain.value = 1 - state.reverb.wet;
      state.reverb.wetGain.gain.value = state.reverb.wet;
    }
    updateStatus('reverb', `${state.reverb.preset} · wet ${Math.round(state.reverb.wet * 100)}%`);
  }

  function setDeckReverbSend(deck, value) {
    state.reverb.sends[deck] = Number(value);
    window.MediaSuiteReverbSends = { ...(window.MediaSuiteReverbSends || {}), [deck]: Number(value) };
    if (state.hub) state.hub.port.postMessage({ type: 'renderState:update', payload: { reverbSends: state.reverb.sends } });
  }

  function initWebGLVisualizer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, preserveDrawingBuffer: false });
    if (!gl) return false;
    state.gl = gl;
    state.gpuMode = 'webgl';
    updateStatus('gpu', 'WebGL visualizer active');
    return true;
  }

  async function detectWebGPU() {
    if (!('gpu' in navigator)) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      updateStatus('gpu', 'WebGPU detected · WebGL path active');
      return true;
    } catch (_) {
      return false;
    }
  }

  function drawCanvasFallback(ctx2d, data, w, h) {
    ctx2d.clearRect(0, 0, w, h);
    const bars = Math.min(96, data.length);
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = data[Math.floor(i * data.length / bars)] / 255;
      const bh = Math.max(2, v * h * 0.9);
      ctx2d.fillStyle = `rgba(${Math.floor(0 + v * 80)}, ${Math.floor(210 + v * 45)}, 255, ${0.25 + v * 0.7})`;
      ctx2d.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
    }
  }

  function drawWebGL(data) {
    const gl = state.gl;
    if (!gl) return;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    const avg = data.reduce((a, b) => a + b, 0) / (data.length * 255);
    gl.clearColor(avg * 0.02, avg * 0.45, avg * 0.65, 0.22);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function startVisualizer() {
    const canvas = document.getElementById('phase24Visualizer') || state.visualCanvas;
    if (!canvas) return;
    state.visualCanvas = canvas;
    const ctx2d = canvas.getContext('2d');
    initWebGLVisualizer(canvas);
    detectWebGPU();
    function frame() {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 120;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const analyser = window.masterAnalyser || window.MediaSuiteAnalyser || state.analyser;
      if (analyser && analyser.frequencyBinCount) {
        if (!state.freqData || state.freqData.length !== analyser.frequencyBinCount) state.freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(state.freqData);
      } else {
        state.freqData = state.freqData || new Uint8Array(128);
        for (let i = 0; i < state.freqData.length; i++) state.freqData[i] = Math.floor(40 + Math.sin(Date.now() / 180 + i / 4) * 35 + Math.random() * 12);
      }
      if (state.gpuMode === 'webgl') drawWebGL(state.freqData);
      else if (ctx2d) drawCanvasFallback(ctx2d, state.freqData, canvas.width, canvas.height);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function updateStatus(key, text) {
    const el = document.querySelector(`[data-phase24-status="${key}"]`);
    if (el) el.textContent = text;
    if (window.renderState) window.renderState[`phase24_${key}`] = text;
  }

  function injectUI() {
    if (document.getElementById('phase24Panel')) return;
    const host = document.getElementById('mixerCenter') || document.querySelector('.mixer-pod') || document.body;
    const panel = document.createElement('section');
    panel.id = 'phase24Panel';
    panel.className = 'phase24-panel glass-pod';
    panel.innerHTML = `
      <div class="phase24-head">
        <strong>Phase 24</strong>
        <span>GPU Visuals · Reverb Matrix · Hub Sync</span>
      </div>
      <canvas id="phase24Visualizer" class="phase24-visualizer" aria-label="GPU visualizer"></canvas>
      <div class="phase24-grid">
        <div class="phase24-card"><label>Shared Hub</label><span data-phase24-status="hub">Initializing</span></div>
        <div class="phase24-card"><label>Visualizer</label><span data-phase24-status="gpu">Canvas fallback ready</span></div>
        <div class="phase24-card"><label>Reverb</label><span data-phase24-status="reverb">Not initialized</span></div>
      </div>
      <div class="phase24-controls">
        <label class="phase24-control">Space
          <select id="phase24ReverbPreset">
            <option>Studio</option><option>Hall</option><option>Arena</option>
          </select>
        </label>
        <label class="phase24-control">Wet
          <input id="phase24ReverbWet" type="range" min="0" max="1" step="0.01" value="0.22" />
        </label>
        <label class="phase24-control">Deck A Send
          <input id="phase24SendA" type="range" min="0" max="1" step="0.01" value="0" />
        </label>
        <label class="phase24-control">Deck B Send
          <input id="phase24SendB" type="range" min="0" max="1" step="0.01" value="0" />
        </label>
        <button id="phase24InitReverb" class="phase24-btn">Enable Reverb Matrix</button>
      </div>`;
    host.appendChild(panel);

    document.getElementById('phase24InitReverb')?.addEventListener('click', initReverb);
    document.getElementById('phase24ReverbPreset')?.addEventListener('change', (e) => setReverbPreset(e.target.value));
    document.getElementById('phase24ReverbWet')?.addEventListener('input', (e) => setReverbWet(e.target.value));
    document.getElementById('phase24SendA')?.addEventListener('input', (e) => setDeckReverbSend('a', e.target.value));
    document.getElementById('phase24SendB')?.addEventListener('input', (e) => setDeckReverbSend('b', e.target.value));
  }

  function exposeAPI() {
    window.MediaSuitePhase24 = {
      state,
      connectHub,
      initReverb,
      setReverbPreset,
      setReverbWet,
      setDeckReverbSend,
      startVisualizer,
      log
    };
  }

  function boot() {
    exposeAPI();
    injectUI();
    connectHub();
    startVisualizer();
    updateStatus('gpu', 'Canvas/WebGL fallback ready');
    log('info', 'Phase 24 boot complete');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
