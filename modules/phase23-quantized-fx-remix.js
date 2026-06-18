/* ============================================================
   MediaSuite V3 — Phase 23 Quantized FX & Remix Engine
   Local-first client-side module.
   Adds:
   - SyncMaster soft beat-grid phase sync
   - Quantized send/return tempo delay rack
   - 4-slot AudioBuffer remix stash matrix
   ============================================================ */
(function () {
  'use strict';

  const P23 = {
    enabled: true,
    sync: {
      masterDeck: 'A',
      targetDeck: 'B',
      active: false,
      snapWindowMs: 80,
      maxNudge: 0.018,
      lastCorrectionAt: 0
    },
    fx: {
      A: null,
      B: null,
      beatDivision: 4,
      feedback: 0.28,
      lowpassHz: 3600,
      wet: 0.22,
      sendA: 0,
      sendB: 0
    },
    stash: Array.from({ length: 4 }, (_, i) => ({
      id: i,
      buffer: null,
      source: null,
      gain: null,
      active: false,
      loop: true,
      label: `Slot ${i + 1}`,
      deck: null,
      duration: 0,
      createdAt: null
    })),
    render: {
      syncStatus: 'Idle',
      fxStatus: 'Ready',
      stashStatus: 'Empty'
    }
  };

  window.MediaSuitePhase23 = P23;

  function getAudioCtx() {
    return window.audioCtx || window.AudioContextInstance || window.msAudioCtx || null;
  }

  function getDeck(deck) {
    const key = String(deck || 'A').toUpperCase();
    return (window.decks && (window.decks[key] || window.decks[key.toLowerCase()])) ||
      window[`deck${key}`] ||
      window[`deck${key.toLowerCase()}`] ||
      null;
  }

  function getDeckBpm(deck) {
    const d = getDeck(deck);
    const meta = d && (d.metadata || d.track || d.currentTrack || {});
    const bpm = Number(meta.bpm || d?.bpm || window[`deck${deck}Bpm`] || 120);
    return Number.isFinite(bpm) && bpm > 20 ? bpm : 120;
  }

  function getDeckBuffer(deck) {
    const d = getDeck(deck);
    return d?.buffer || d?.audioBuffer || d?.decodedBuffer || d?.currentBuffer || null;
  }

  function getDeckTime(deck) {
    const d = getDeck(deck);
    if (typeof d?.getCurrentTime === 'function') return d.getCurrentTime();
    if (Number.isFinite(d?.currentTime)) return d.currentTime;
    if (d?.audio && Number.isFinite(d.audio.currentTime)) return d.audio.currentTime;
    return 0;
  }

  function setDeckPlaybackRate(deck, rate) {
    const d = getDeck(deck);
    if (!d) return;
    const safe = Math.max(0.85, Math.min(1.15, rate));
    if (d.source && d.source.playbackRate) d.source.playbackRate.setTargetAtTime(safe, getAudioCtx()?.currentTime || 0, 0.015);
    if (d.audio) d.audio.playbackRate = safe;
    d.playbackRate = safe;
  }

  function seekDeck(deck, time) {
    const d = getDeck(deck);
    const safe = Math.max(0, Number(time) || 0);
    if (!d) return;
    if (typeof d.seek === 'function') d.seek(safe);
    else if (d.audio) d.audio.currentTime = safe;
    else d.currentTime = safe;
  }

  function beatSeconds(deck) {
    return 60 / getDeckBpm(deck);
  }

  function beatPhase(deck) {
    const bs = beatSeconds(deck);
    const t = getDeckTime(deck);
    return (t % bs) / bs;
  }

  function shortestPhaseDelta(masterPhase, targetPhase) {
    let d = masterPhase - targetPhase;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  }

  function softSyncTick() {
    if (!P23.sync.active) return;
    const now = performance.now();
    if (now - P23.sync.lastCorrectionAt < 120) return;
    P23.sync.lastCorrectionAt = now;

    const m = P23.sync.masterDeck;
    const t = P23.sync.targetDeck;
    const delta = shortestPhaseDelta(beatPhase(m), beatPhase(t));
    const correction = Math.max(-P23.sync.maxNudge, Math.min(P23.sync.maxNudge, delta * 0.035));
    setDeckPlaybackRate(t, 1 + correction);
    P23.render.syncStatus = `Soft sync ${m} → ${t} | Δ ${(delta * 100).toFixed(1)}%`;
  }

  function snapSync() {
    const m = P23.sync.masterDeck;
    const t = P23.sync.targetDeck;
    const bs = beatSeconds(t);
    const targetTime = getDeckTime(t);
    const delta = shortestPhaseDelta(beatPhase(m), beatPhase(t));
    const newTime = targetTime + delta * bs;
    seekDeck(t, newTime);
    setDeckPlaybackRate(t, 1);
    P23.render.syncStatus = `Snap synced ${t} to ${m}`;
  }

  function createDelayRack(deck) {
    const ctx = getAudioCtx();
    if (!ctx) return null;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delay = ctx.createDelay(4.0);
    const feedback = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    const output = ctx.createGain();

    lowpass.type = 'lowpass';
    lowpass.frequency.value = P23.fx.lowpassHz;
    feedback.gain.value = P23.fx.feedback;
    wet.gain.value = P23.fx.wet;
    dry.gain.value = 1;
    delay.delayTime.value = beatSeconds(deck) / (P23.fx.beatDivision / 4);

    input.connect(dry).connect(output);
    input.connect(delay);
    delay.connect(lowpass).connect(wet).connect(output);
    lowpass.connect(feedback).connect(delay);

    return { input, dry, wet, delay, feedback, lowpass, output, deck };
  }

  function ensureFxRacks() {
    if (!P23.fx.A) P23.fx.A = createDelayRack('A');
    if (!P23.fx.B) P23.fx.B = createDelayRack('B');
    updateFxParams();
  }

  function updateFxParams() {
    ['A', 'B'].forEach(deck => {
      const rack = P23.fx[deck];
      if (!rack) return;
      const ctx = getAudioCtx();
      const at = ctx?.currentTime || 0;
      const div = Number(P23.fx.beatDivision) || 4;
      const delayTime = beatSeconds(deck) * (4 / div);
      rack.delay.delayTime.setTargetAtTime(Math.max(0.02, Math.min(2.5, delayTime)), at, 0.015);
      rack.feedback.gain.setTargetAtTime(Math.max(0, Math.min(0.88, P23.fx.feedback)), at, 0.015);
      rack.lowpass.frequency.setTargetAtTime(Math.max(250, Math.min(12000, P23.fx.lowpassHz)), at, 0.015);
      rack.wet.gain.setTargetAtTime(Math.max(0, Math.min(1, P23.fx.wet)), at, 0.015);
    });
    P23.render.fxStatus = `Delay ${P23.fx.beatDivision}/4 | FB ${(P23.fx.feedback * 100).toFixed(0)}% | Wet ${(P23.fx.wet * 100).toFixed(0)}%`;
  }

  function captureSlice(slotIndex, deck) {
    const ctx = getAudioCtx();
    const source = getDeckBuffer(deck);
    if (!ctx || !source) {
      P23.render.stashStatus = 'No decoded buffer available for capture';
      return;
    }
    const bpm = getDeckBpm(deck);
    const seconds = 60 / bpm * 4;
    const startTime = getDeckTime(deck);
    const sampleRate = source.sampleRate;
    const start = Math.max(0, Math.floor(startTime * sampleRate));
    const length = Math.min(source.length - start, Math.floor(seconds * sampleRate));
    if (length <= 0) return;

    const out = ctx.createBuffer(source.numberOfChannels, length, sampleRate);
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      const src = source.getChannelData(ch).subarray(start, start + length);
      out.copyToChannel(src, ch, 0);
    }
    const slot = P23.stash[slotIndex];
    stopSlot(slotIndex);
    slot.buffer = out;
    slot.deck = deck;
    slot.duration = out.duration;
    slot.createdAt = Date.now();
    slot.label = `${deck} ${out.duration.toFixed(1)}s`;
    P23.render.stashStatus = `Captured ${slot.label} into Slot ${slotIndex + 1}`;
    renderPadStates();
  }

  function triggerSlot(slotIndex) {
    const ctx = getAudioCtx();
    const slot = P23.stash[slotIndex];
    if (!ctx || !slot || !slot.buffer) return;
    stopSlot(slotIndex, false);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = slot.buffer;
    src.loop = !!slot.loop;
    gain.gain.value = 0.85;
    src.connect(gain);
    const dest = window.masterLimiterInput || window.masterGainNode || ctx.destination;
    gain.connect(dest);
    src.start();
    slot.source = src;
    slot.gain = gain;
    slot.active = true;
    src.onended = () => { slot.active = false; renderPadStates(); };
    P23.render.stashStatus = `Playing Slot ${slotIndex + 1}`;
    renderPadStates();
  }

  function stopSlot(slotIndex, update = true) {
    const slot = P23.stash[slotIndex];
    if (!slot) return;
    try { if (slot.source) slot.source.stop(); } catch (_) {}
    try { if (slot.source) slot.source.disconnect(); } catch (_) {}
    try { if (slot.gain) slot.gain.disconnect(); } catch (_) {}
    slot.source = null;
    slot.gain = null;
    slot.active = false;
    if (update) renderPadStates();
  }

  function clearSlot(slotIndex) {
    stopSlot(slotIndex, false);
    const slot = P23.stash[slotIndex];
    Object.assign(slot, { buffer: null, source: null, gain: null, active: false, label: `Slot ${slotIndex + 1}`, deck: null, duration: 0, createdAt: null });
    renderPadStates();
  }

  function mountUI() {
    if (document.getElementById('phase23Panel')) return;
    const host = document.getElementById('mixerCenter') || document.querySelector('.mixer-pod') || document.body;
    const panel = document.createElement('div');
    panel.id = 'phase23Panel';
    panel.className = 'phase23-panel glass-pod';
    panel.innerHTML = `
      <div class="phase23-title">PHASE 23 · QUANTIZED FX & REMIX</div>
      <div class="phase23-row">
        <button class="phase23-btn" id="p23SyncToggle">Soft Sync</button>
        <button class="phase23-btn" id="p23SnapSync">Snap Sync</button>
        <select class="phase23-select" id="p23Master"><option>A Master</option><option>B Master</option></select>
      </div>
      <div class="phase23-status" id="p23SyncStatus">Idle</div>
      <div class="phase23-row">
        <label>Delay</label>
        <select class="phase23-select" id="p23DelayDiv"><option value="4">1/4</option><option value="8">1/8</option><option value="16">1/16</option></select>
        <label>Wet</label><input id="p23Wet" type="range" min="0" max="1" step="0.01" value="0.22">
      </div>
      <div class="phase23-row">
        <label>Feedback</label><input id="p23Feedback" type="range" min="0" max="0.88" step="0.01" value="0.28">
        <label>LPF</label><input id="p23Lowpass" type="range" min="250" max="12000" step="50" value="3600">
      </div>
      <div class="phase23-status" id="p23FxStatus">Ready</div>
      <div class="phase23-pad-grid" id="p23PadGrid"></div>
      <div class="phase23-status" id="p23StashStatus">Empty</div>
    `;
    host.appendChild(panel);

    document.getElementById('p23SyncToggle')?.addEventListener('click', () => {
      P23.sync.active = !P23.sync.active;
      document.getElementById('p23SyncToggle').classList.toggle('active', P23.sync.active);
      if (!P23.sync.active) setDeckPlaybackRate(P23.sync.targetDeck, 1);
    });
    document.getElementById('p23SnapSync')?.addEventListener('click', snapSync);
    document.getElementById('p23Master')?.addEventListener('change', e => {
      P23.sync.masterDeck = e.target.value.startsWith('B') ? 'B' : 'A';
      P23.sync.targetDeck = P23.sync.masterDeck === 'A' ? 'B' : 'A';
    });
    document.getElementById('p23DelayDiv')?.addEventListener('change', e => { P23.fx.beatDivision = Number(e.target.value); updateFxParams(); });
    document.getElementById('p23Wet')?.addEventListener('input', e => { P23.fx.wet = Number(e.target.value); updateFxParams(); });
    document.getElementById('p23Feedback')?.addEventListener('input', e => { P23.fx.feedback = Number(e.target.value); updateFxParams(); });
    document.getElementById('p23Lowpass')?.addEventListener('input', e => { P23.fx.lowpassHz = Number(e.target.value); updateFxParams(); });

    renderPadStates();
  }

  function renderPadStates() {
    const grid = document.getElementById('p23PadGrid');
    if (!grid) return;
    grid.innerHTML = P23.stash.map((slot, i) => `
      <div class="p23-pad ${slot.active ? 'active' : ''} ${slot.buffer ? 'loaded' : ''}">
        <div class="p23-pad-label">${slot.label}</div>
        <div class="p23-pad-actions">
          <button data-act="cap" data-i="${i}">CAP</button>
          <button data-act="play" data-i="${i}">PLAY</button>
          <button data-act="stop" data-i="${i}">STOP</button>
          <button data-act="clear" data-i="${i}">CLR</button>
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const act = btn.dataset.act;
      const deck = P23.sync.masterDeck || 'A';
      if (act === 'cap') captureSlice(i, deck);
      if (act === 'play') triggerSlot(i);
      if (act === 'stop') stopSlot(i);
      if (act === 'clear') clearSlot(i);
    }));
  }

  function rafLoop() {
    softSyncTick();
    const rs = window.renderState || {};
    rs.phase23 = Object.assign(rs.phase23 || {}, P23.render);
    const s = document.getElementById('p23SyncStatus'); if (s) s.textContent = P23.render.syncStatus;
    const f = document.getElementById('p23FxStatus'); if (f) f.textContent = P23.render.fxStatus;
    const st = document.getElementById('p23StashStatus'); if (st) st.textContent = P23.render.stashStatus;
    requestAnimationFrame(rafLoop);
  }

  window.MediaSuitePhase23API = {
    ensureFxRacks,
    updateFxParams,
    snapSync,
    captureSlice,
    triggerSlot,
    stopSlot,
    clearSlot
  };

  document.addEventListener('DOMContentLoaded', () => {
    mountUI();
    setTimeout(ensureFxRacks, 700);
    requestAnimationFrame(rafLoop);
    console.info('[MediaSuite Phase 23] Quantized FX & Remix Engine loaded');
  });
})();
