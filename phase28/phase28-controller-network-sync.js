/* ============================================================
   MediaSuite V3 — Phase 28 Controller & Network Sync Lab
   WebHID scanner, WebRTC master-clock lab, safe relay settings.
   100% client-side. No bundled proxy. No CORS bypass.
============================================================ */
(function () {
  const PHASE = 'phase28';

  const state = (window.MediaSuitePhase28 = window.MediaSuitePhase28 || {
    hidSupported: !!navigator.hid,
    rtcSupported: !!window.RTCPeerConnection,
    relayUrl: localStorage.getItem('mediasuite.relayUrl') || '',
    hidDevices: [],
    lastHidPacket: null,
    jogVelocity: 0,
    masterMode: false,
    replicaMode: false,
    peer: null,
    channel: null,
    clockSamples: [],
    driftMs: 0,
    latencyMs: 0,
    lastClockPacket: null,
    diagnostics: []
  });

  function log(msg, data) {
    const entry = { ts: new Date().toISOString(), msg, data: data || null };
    state.diagnostics.unshift(entry);
    state.diagnostics = state.diagnostics.slice(0, 80);
    renderDiagnostics();
    console.log('[MediaSuite Phase 28]', msg, data || '');
  }

  function ensureRenderState() {
    window.renderState = window.renderState || {};
    window.renderState.phase28 = window.renderState.phase28 || {
      jogVelocity: 0,
      hidConnected: false,
      clockDriftMs: 0,
      networkLatencyMs: 0,
      replicaActive: false,
      masterActive: false
    };
    return window.renderState.phase28;
  }

  function injectStyles() {
    if (document.getElementById('phase28-style')) return;
    const style = document.createElement('style');
    style.id = 'phase28-style';
    style.textContent = `
      .phase28-panel{margin:12px;padding:14px;border:1px solid rgba(0,229,255,.22);border-radius:18px;background:rgba(255,255,255,.035);backdrop-filter:blur(18px);color:#eeeeff}
      .phase28-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
      .phase28-card{border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;background:rgba(0,0,0,.18)}
      .phase28-title{font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:#00e5ff;margin-bottom:8px}
      .phase28-btn{border:1px solid rgba(0,229,255,.22);background:rgba(0,229,255,.10);color:#eeeeff;border-radius:10px;padding:8px 10px;margin:3px;font-weight:700;font-size:12px}
      .phase28-btn:hover{background:rgba(0,229,255,.18)}
      .phase28-input,.phase28-textarea{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#eeeeff;border-radius:10px;padding:8px;margin:4px 0;font-family:monospace;font-size:12px}
      .phase28-textarea{min-height:90px;resize:vertical}
      .phase28-meter{height:8px;border-radius:20px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0}
      .phase28-meter>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#00e5ff,#f0007a)}
      .phase28-small{font-size:11px;color:rgba(238,238,255,.62);line-height:1.45}
      .phase28-diagnostics{max-height:150px;overflow:auto;font-family:monospace;font-size:10px;color:rgba(238,238,255,.65)}
    `;
    document.head.appendChild(style);
  }

  function mountPanel() {
    injectStyles();
    if (document.getElementById('phase28-panel')) return;
    const target = document.querySelector('#tab-deck, #deck, main, .workspace') || document.body;
    const panel = document.createElement('section');
    panel.id = 'phase28-panel';
    panel.className = 'phase28-panel';
    panel.innerHTML = `
      <div class="phase28-title">Phase 28 — Controller & Network Sync Lab</div>
      <div class="phase28-grid">
        <div class="phase28-card">
          <div class="phase28-title">WebHID Controller Scanner</div>
          <button class="phase28-btn" id="p28-hid-connect">Connect HID Controller</button>
          <button class="phase28-btn" id="p28-hid-list">List Paired Devices</button>
          <div class="phase28-small" id="p28-hid-status">HID support: ${state.hidSupported ? 'available' : 'not available'}</div>
          <div class="phase28-meter"><span id="p28-jog-meter"></span></div>
          <div class="phase28-small">Jog velocity feeds renderState.phase28 and scratch worklet hooks when available. MIDI fallback remains active.</div>
        </div>
        <div class="phase28-card">
          <div class="phase28-title">WebRTC Master Clock</div>
          <button class="phase28-btn" id="p28-master-create">Create Master Offer</button>
          <button class="phase28-btn" id="p28-replica-create">Create Replica Answer</button>
          <button class="phase28-btn" id="p28-align">Manual Align</button>
          <textarea class="phase28-textarea" id="p28-signal" placeholder="Paste offer/answer signaling text here"></textarea>
          <div class="phase28-small" id="p28-clock-status">RTC support: ${state.rtcSupported ? 'available' : 'not available'}</div>
        </div>
        <div class="phase28-card">
          <div class="phase28-title">Safe Stream Relay Setting</div>
          <input class="phase28-input" id="p28-relay" placeholder="Optional user-owned relay URL" value="${escapeHtml(state.relayUrl)}" />
          <button class="phase28-btn" id="p28-save-relay">Save Relay URL</button>
          <div class="phase28-small">This does not bypass CORS by itself. Use only a relay you own or are allowed to use. Blocked streams show diagnostics instead of forced loading.</div>
        </div>
        <div class="phase28-card">
          <div class="phase28-title">Diagnostics</div>
          <div class="phase28-small">Latency: <span id="p28-latency">0</span> ms · Drift: <span id="p28-drift">0</span> ms</div>
          <div class="phase28-diagnostics" id="p28-diag"></div>
        </div>
      </div>
    `;
    target.appendChild(panel);
    wirePanel();
    log('Phase 28 panel mounted');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function wirePanel() {
    document.getElementById('p28-hid-connect')?.addEventListener('click', connectHid);
    document.getElementById('p28-hid-list')?.addEventListener('click', listHidDevices);
    document.getElementById('p28-master-create')?.addEventListener('click', createMasterOffer);
    document.getElementById('p28-replica-create')?.addEventListener('click', createReplicaAnswer);
    document.getElementById('p28-align')?.addEventListener('click', manualAlign);
    document.getElementById('p28-save-relay')?.addEventListener('click', () => {
      const value = document.getElementById('p28-relay')?.value.trim() || '';
      state.relayUrl = value;
      localStorage.setItem('mediasuite.relayUrl', value);
      log('Relay URL saved', value ? 'configured' : 'cleared');
    });
  }

  async function connectHid() {
    if (!navigator.hid) return log('WebHID unavailable in this browser');
    try {
      const devices = await navigator.hid.requestDevice({ filters: [] });
      for (const device of devices) attachHid(device);
      state.hidDevices = devices;
      updateHidStatus();
      log('HID devices connected', devices.map(d => d.productName));
    } catch (err) {
      log('HID connection cancelled/failed', err.message);
    }
  }

  async function listHidDevices() {
    if (!navigator.hid) return log('WebHID unavailable');
    const devices = await navigator.hid.getDevices();
    devices.forEach(attachHid);
    state.hidDevices = devices;
    updateHidStatus();
    log('Paired HID devices', devices.map(d => d.productName));
  }

  async function attachHid(device) {
    try {
      if (!device.opened) await device.open();
      device.removeEventListener?.('inputreport', onHidInput);
      device.addEventListener('inputreport', onHidInput);
      ensureRenderState().hidConnected = true;
    } catch (err) {
      log('Failed opening HID device', err.message);
    }
  }

  function onHidInput(event) {
    const bytes = new Uint8Array(event.data.buffer);
    const velocity = parseJogVelocity(bytes);
    state.lastHidPacket = Array.from(bytes.slice(0, 12));
    state.jogVelocity = velocity;
    const rs = ensureRenderState();
    rs.jogVelocity = velocity;
    // Optional hook for Phase 26/27 scratch worklets.
    if (window.MediaSuiteScratchWorklet?.setVelocity) {
      window.MediaSuiteScratchWorklet.setVelocity(velocity);
    }
    updateJogMeter();
  }

  function parseJogVelocity(bytes) {
    if (!bytes || bytes.length === 0) return 0;
    // Generic high-res relative parser. Vendors differ; this is a safe normalized fallback.
    let raw = 0;
    if (bytes.length >= 2) raw = (bytes[0] << 8) | bytes[1];
    else raw = bytes[0];
    if (raw > 32767) raw -= 65536;
    const normalized = Math.max(-1, Math.min(1, raw / 2048));
    return Number(normalized.toFixed(4));
  }

  function updateHidStatus() {
    const el = document.getElementById('p28-hid-status');
    if (el) el.textContent = `HID devices: ${state.hidDevices.length || 0} · ${state.hidDevices.map(d => d.productName).join(', ') || 'none'}`;
  }

  function updateJogMeter() {
    const meter = document.getElementById('p28-jog-meter');
    if (meter) meter.style.width = `${Math.min(100, Math.abs(state.jogVelocity) * 100)}%`;
  }

  async function createPeer(isMaster) {
    if (!window.RTCPeerConnection) throw new Error('RTCPeerConnection unavailable');
    const pc = new RTCPeerConnection({ iceServers: [] });
    state.peer = pc;
    pc.oniceconnectionstatechange = () => log('RTC state', pc.iceConnectionState);
    if (isMaster) {
      const channel = pc.createDataChannel('mediasuite-clock');
      setupChannel(channel, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      return pc.localDescription;
    } else {
      pc.ondatachannel = ev => setupChannel(ev.channel, false);
      const signal = parseSignal();
      await pc.setRemoteDescription(signal);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIce(pc);
      return pc.localDescription;
    }
  }

  async function createMasterOffer() {
    try {
      state.masterMode = true;
      state.replicaMode = false;
      const desc = await createPeer(true);
      setSignal(desc);
      ensureRenderState().masterActive = true;
      log('Master offer created');
    } catch (err) { log('Master offer failed', err.message); }
  }

  async function createReplicaAnswer() {
    try {
      state.replicaMode = true;
      state.masterMode = false;
      const desc = await createPeer(false);
      setSignal(desc);
      ensureRenderState().replicaActive = true;
      log('Replica answer created');
    } catch (err) { log('Replica answer failed', err.message); }
  }

  function parseSignal() {
    const txt = document.getElementById('p28-signal')?.value.trim();
    if (!txt) throw new Error('No signaling text pasted');
    return JSON.parse(txt);
  }
  function setSignal(desc) {
    const el = document.getElementById('p28-signal');
    if (el) el.value = JSON.stringify(desc);
  }
  function waitIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const t = setTimeout(resolve, 1600);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      });
    });
  }

  function setupChannel(channel, isMaster) {
    state.channel = channel;
    channel.onopen = () => {
      log('RTC data channel open', isMaster ? 'master' : 'replica');
      if (isMaster) startClockBroadcast(channel);
    };
    channel.onmessage = ev => handleClockPacket(ev.data);
  }

  function getAudioTime() {
    return window.audioCtx?.currentTime || window.MediaSuiteAudioContext?.currentTime || performance.now() / 1000;
  }

  function startClockBroadcast(channel) {
    const loop = () => {
      if (!channel || channel.readyState !== 'open' || !state.masterMode) return;
      const packet = {
        type: 'clock',
        sentAt: performance.now(),
        audioTime: getAudioTime(),
        bpm: window.MediaSuiteSyncMaster?.bpm || window.currentBPM || 120,
        downbeat: window.MediaSuiteSyncMaster?.lastDownbeat || 0
      };
      channel.send(JSON.stringify(packet));
      setTimeout(loop, 120);
    };
    loop();
  }

  function handleClockPacket(raw) {
    try {
      const packet = JSON.parse(raw);
      if (packet.type !== 'clock') return;
      const now = performance.now();
      const latency = Math.max(0, now - packet.sentAt);
      const localAudioTime = getAudioTime();
      const remoteEstimated = packet.audioTime + latency / 2000; // half RTT approximation.
      const driftMs = (remoteEstimated - localAudioTime) * 1000;
      state.latencyMs = Number(latency.toFixed(1));
      state.driftMs = Number(driftMs.toFixed(1));
      state.lastClockPacket = packet;
      const rs = ensureRenderState();
      rs.networkLatencyMs = state.latencyMs;
      rs.clockDriftMs = state.driftMs;
      updateClockStatus();
      if (window.MediaSuitePhase27?.setExternalDrift) {
        window.MediaSuitePhase27.setExternalDrift(state.driftMs);
      }
    } catch (err) { log('Bad RTC packet', err.message); }
  }

  function manualAlign() {
    log('Manual network align requested', { driftMs: state.driftMs });
    if (window.MediaSuitePhase27?.tightenSync) {
      window.MediaSuitePhase27.tightenSync({ externalDriftMs: state.driftMs, soft: true });
    }
  }

  function updateClockStatus() {
    const lat = document.getElementById('p28-latency');
    const drift = document.getElementById('p28-drift');
    const status = document.getElementById('p28-clock-status');
    if (lat) lat.textContent = state.latencyMs;
    if (drift) drift.textContent = state.driftMs;
    if (status) status.textContent = `RTC: ${state.channel?.readyState || 'not connected'} · mode: ${state.masterMode ? 'master' : state.replicaMode ? 'replica' : 'idle'}`;
  }

  function renderDiagnostics() {
    const el = document.getElementById('p28-diag');
    if (!el) return;
    el.innerHTML = state.diagnostics.slice(0, 20).map(d => `<div>${escapeHtml(d.ts)} — ${escapeHtml(d.msg)} ${d.data ? escapeHtml(JSON.stringify(d.data)) : ''}</div>`).join('');
  }

  // Safe helper for external stream attempts. Does not bypass CORS.
  window.MediaSuitePhase28LoadStream = async function(url) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      log('Stream blocked or failed', { url, error: err.message, relayConfigured: !!state.relayUrl });
      if (!state.relayUrl) throw err;
      const relayUrl = state.relayUrl.replace(/\/$/, '') + '?url=' + encodeURIComponent(url);
      log('Trying user-configured relay', relayUrl);
      const relayRes = await fetch(relayUrl, { mode: 'cors' });
      if (!relayRes.ok) throw new Error(`Relay HTTP ${relayRes.status}`);
      return await relayRes.arrayBuffer();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPanel);
  else mountPanel();
})();
