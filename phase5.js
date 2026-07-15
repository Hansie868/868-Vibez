/* ============================================================
   868 VIBEZ — Phase 5: Audio Engine Improvements
   1. Spectrum Analyser Visualiser — canvas frequency display
   2. Soft Saturation              — WaveShaperNode warmth
   3. Audio Diagnostics            — latency, buffer, levels
   ============================================================ */
'use strict';

/* ══ 1. SPECTRUM ANALYSER ══ */
const Visualiser = {
  _analyser: null,
  _raf: null,
  _canvas: null,
  _ctx: null,

  init() {
    const audioCtx = MS.ensureAudioCtx();
    if (!audioCtx || this._analyser) return;
    this._analyser = audioCtx.createAnalyser();
    this._analyser.fftSize = 256;
    this._analyser.smoothingTimeConstant = 0.8;
    // Tap off limiter output
    try { MS.limiter.connect(this._analyser); } catch {}
    MS._analyser = this._analyser;
  },

  attach(canvasId) {
    this._canvas = document.getElementById(canvasId);
    if (!this._canvas) return;
    this._ctx = this._canvas.getContext('2d');
    if (!this._analyser) this.init();
    this.start();
  },

  start() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const draw = () => {
      this._raf = requestAnimationFrame(draw);
      if (!this._canvas || !this._analyser) return;
      const c = this._ctx;
      const W = this._canvas.width  = this._canvas.offsetWidth  * devicePixelRatio;
      const H = this._canvas.height = this._canvas.offsetHeight * devicePixelRatio;
      const data = new Uint8Array(this._analyser.frequencyBinCount);
      this._analyser.getByteFrequencyData(data);

      c.clearRect(0, 0, W, H);
      const barW = W / data.length * 2.5;
      const skip  = Math.floor(data.length / (W / barW));

      for (let i = 0; i < data.length; i += skip) {
        const val  = data[i] / 255;
        const barH = val * H;
        const hue  = 180 + val * 60; // cyan → magenta
        c.fillStyle = `hsla(${hue},100%,${50+val*30}%,${0.7+val*0.3})`;
        c.fillRect(i/skip * barW, H - barH, barW - 1, barH);
      }

      // Peak line
      const peak = Math.max(...data) / 255;
      if (peak > 0.01) {
        c.fillStyle = `rgba(0,229,255,0.4)`;
        c.fillRect(0, H - peak * H, W, 1);
      }
    };
    draw();
  },

  stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }
};
MS.visualiser = Visualiser;

/* ══ 2. SOFT SATURATION — WaveShaperNode ══ */
const Saturation = {
  _node: null,
  _wet:  null,
  _dry:  null,
  amount: 0, // 0 = off, 1 = full

  init() {
    const ctx = MS.ensureAudioCtx();
    if (!ctx || this._node) return;
    this._node = ctx.createWaveShaper();
    this._wet  = ctx.createGain();
    this._dry  = ctx.createGain();
    this._node.connect(this._wet);
    this._wet.connect(MS.limiter);
    this._dry.gain.value = 1;
    this._wet.gain.value = 0;
    // Tap gainM → saturation
    try {
      MS.gainM.connect(this._node);
      MS.gainM.connect(this._dry);
      this._dry.connect(MS.limiter);
    } catch {}
    MS._satNode = this._node;
  },

  _curve(amount) {
    const n = 256, k = amount * 100;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = k ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
    }
    return curve;
  },

  set(amount) {
    this.amount = Math.max(0, Math.min(1, amount));
    if (!this._node) this.init();
    if (!this._node) return;
    this._node.curve    = this._curve(this.amount);
    this._wet.gain.value = this.amount * 0.4;
    this._dry.gain.value = 1 - this.amount * 0.3;
    localStorage.setItem('vz_saturation', this.amount);
    MS.emit('saturation:changed', this.amount);
  },

  load() {
    const saved = parseFloat(localStorage.getItem('vz_saturation') || '0');
    if (saved > 0) { this.init(); this.set(saved); }
  }
};
MS.saturation = Saturation;

/* ══ 3. AUDIO DIAGNOSTICS ══ */
const AudioDiag = {
  _data: { latency: 0, bufferUnderruns: 0, peakLevel: 0, sampleRate: 0, state: 'idle' },

  measure() {
    const ctx = MS.audioCtx;
    if (!ctx) return this._data;
    this._data.latency    = ((ctx.outputLatency || ctx.baseLatency || 0) * 1000).toFixed(1);
    this._data.sampleRate = ctx.sampleRate;
    this._data.state      = ctx.state;
    if (MS._analyser) {
      const data = new Uint8Array(MS._analyser.frequencyBinCount);
      MS._analyser.getByteFrequencyData(data);
      this._data.peakLevel = (Math.max(...data) / 255 * 100).toFixed(1);
    }
    return this._data;
  },

  report() {
    const d = this.measure();
    return `Latency: ${d.latency}ms | Rate: ${d.sampleRate}Hz | Peak: ${d.peakLevel}% | State: ${d.state}`;
  }
};
MS.audioDiag = AudioDiag;

/* ══ UI — inject visualiser canvas + controls ══ */
document.addEventListener('DOMContentLoaded', () => {

  // Inject spectrum canvas below vinyl on Now Playing
  const npSeekWrap = document.querySelector('.np-seek-wrap');
  if (npSeekWrap) {
    const vizWrap = document.createElement('div');
    vizWrap.id = 'vizWrap';
    vizWrap.style.cssText = 'padding:0 20px 8px;background:var(--bg);flex-shrink:0;display:none';
    vizWrap.innerHTML = `<canvas id="specCanvas" style="width:100%;height:48px;border-radius:10px;background:rgba(0,0,0,.3);display:block"></canvas>`;
    npSeekWrap.before(vizWrap);
  }

  // Saturation slider in Audio Presets tab
  const eqPresetView = document.querySelector('.eq-preset-view');
  if (eqPresetView) {
    const satRow = document.createElement('div');
    satRow.style.cssText = 'margin-bottom:16px';
    satRow.innerHTML = `
      <div class="section-label" style="padding:0 0 8px">Saturation / Warmth</div>
      <div style="display:flex;align-items:center;gap:12px;padding:0 4px">
        <span style="font-size:11px;color:var(--t3)">Off</span>
        <input type="range" id="satSlider" min="0" max="1" step="0.05" value="0" style="flex:1;accent-color:var(--orange)">
        <span style="font-size:11px;color:var(--t3)">Warm</span>
        <span id="satVal" style="font-size:10px;font-family:monospace;color:var(--orange);width:30px;text-align:right">0%</span>
      </div>`;
    const firstLabel = eqPresetView.querySelector('.section-label');
    if (firstLabel) firstLabel.before(satRow);
  }

  // Diagnostics in settings area
  const diagBtn = document.getElementById('rebuildWaves');
  if (diagBtn) {
    const db = document.createElement('button');
    db.className = 'vz-btn btn--xs sm';
    db.textContent = '📊 Diagnostics';
    db.onclick = () => {
      Visualiser.init();
      const r = AudioDiag.report();
      MS.toast(r, 'info', 4000);
    };
    diagBtn.after(db);
  }

  // Wire visualiser toggle
  const vizToggle = document.createElement('button');
  vizToggle.className = 'np-action-btn';
  vizToggle.id = 'vizToggleBtn';
  vizToggle.innerHTML = `<span style="font-size:22px">📊</span><span>Spectrum</span>`;
  vizToggle.onclick = () => {
    const wrap = document.getElementById('vizWrap');
    if (!wrap) return;
    const show = wrap.style.display === 'none';
    wrap.style.display = show ? 'block' : 'none';
    if (show) {
      Visualiser.init();
      Visualiser.attach('specCanvas');
    } else {
      Visualiser.stop();
    }
  };
  const npActions = document.querySelector('.np-actions');
  if (npActions) npActions.appendChild(vizToggle);

  // Wire saturation slider
  document.getElementById('satSlider')?.addEventListener('input', e => {
    const v = +e.target.value;
    Saturation.init();
    Saturation.set(v);
    const val = document.getElementById('satVal');
    if (val) val.textContent = Math.round(v * 100) + '%';
  });

  // Load saved saturation
  MS.on('audio:ready', () => Saturation.load());
  MS.on('player:play', () => {
    Visualiser.init();
    // Auto-show spectrum if already open
    const wrap = document.getElementById('vizWrap');
    if (wrap?.style.display !== 'none') Visualiser.attach('specCanvas');
  });

  console.info('[Phase5] Audio Engine Improvements active');
});
