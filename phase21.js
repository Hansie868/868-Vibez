/* ============================================================
   868 VIBEZ — Phase 21: Fete Toolkit + Onboarding
   From the "gaps none of the big 4 cover" list:
   13. Fete soundboard — airhorn/siren/rewind/bring-it-back, synthesized
       live via Web Audio (no copyrighted samples needed or shipped)
   14. Mic input for hype/MC — live mic mixed over the music with its
       own fader and optional auto-ducking
   17. First-run onboarding — guided flow on first-ever launch
   ============================================================ */
'use strict';

(function () {
const $21 = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════
   AUDIO CHAIN EXTENSION — soundboard + mic get their own gain
   nodes feeding into the same master limiter everything else uses,
   so they're always in the mix and covered by the limiter.
══════════════════════════════════════════════════════════════ */
function ensureFeteChain() {
  if (!MS.audioCtx || !MS.limiter || MS.gainSFX) return;
  MS.gainSFX = MS.audioCtx.createGain();
  MS.gainSFX.gain.value = 0.9;
  MS.gainSFX.connect(MS.limiter);

  MS.gainMic = MS.audioCtx.createGain();
  MS.gainMic.gain.value = 1.0;
  MS.gainMic.connect(MS.limiter);
}
MS.on && MS.on('audio:ready', ensureFeteChain);

/* ══════════════════════════════════════════════════════════════
   13 — FETE SOUNDBOARD (synthesized, no sample files needed)
══════════════════════════════════════════════════════════════ */
function noiseBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const SFX = {
  airhorn() {
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    [349.23, 261.63].forEach((freq, i) => {          // classic dual-tone fete horn
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
      g.gain.setValueAtTime(0.5, t0 + 1.1);
      g.gain.linearRampToValueAtTime(0, t0 + 1.4);
      osc.connect(g); g.connect(MS.gainSFX);
      osc.start(t0 + i * 0.02); osc.stop(t0 + 1.5);
    });
  },
  siren() {
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t0);
    for (let i = 0; i < 4; i++) {
      osc.frequency.setValueAtTime(500, t0 + i * 0.5);
      osc.frequency.linearRampToValueAtTime(1200, t0 + i * 0.5 + 0.25);
      osc.frequency.linearRampToValueAtTime(500, t0 + i * 0.5 + 0.5);
    }
    g.gain.setValueAtTime(0.4, t0 + 1.9);
    g.gain.linearRampToValueAtTime(0, t0 + 2.1);
    osc.connect(g); g.connect(MS.gainSFX);
    osc.start(t0); osc.stop(t0 + 2.1);
  },
  rewind() {
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.8);
    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.Q.value = 6;
    filt.frequency.setValueAtTime(200, t0);
    filt.frequency.exponentialRampToValueAtTime(3000, t0 + 0.75);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t0);
    g.gain.linearRampToValueAtTime(0, t0 + 0.8);
    src.connect(filt); filt.connect(g); g.connect(MS.gainSFX);
    src.start(t0); src.stop(t0 + 0.8);
  },
  bringItBack() {                                    // rising riser + snap
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(1800, t0 + 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.01, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.85);
    g.gain.linearRampToValueAtTime(0, t0 + 1.0);
    osc.connect(g); g.connect(MS.gainSFX);
    osc.start(t0); osc.stop(t0 + 1.0);

    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.15);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.5, t0 + 0.95);
    g2.gain.linearRampToValueAtTime(0, t0 + 1.1);
    src.connect(hp); hp.connect(g2); g2.connect(MS.gainSFX);
    src.start(t0 + 0.95); src.stop(t0 + 1.1);
  },
  bomb() {                                            // low noise burst, explosion-ish
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 1.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t0);
    lp.frequency.exponentialRampToValueAtTime(80, t0 + 1.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.01, t0 + 1.2);
    src.connect(lp); lp.connect(g); g.connect(MS.gainSFX);
    src.start(t0); src.stop(t0 + 1.2);
  },
  whistle() {
    MS.ensureAudioCtx(); ensureFeteChain();
    const ctx = MS.audioCtx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t0);
    osc.frequency.linearRampToValueAtTime(2600, t0 + 0.15);
    osc.frequency.linearRampToValueAtTime(1800, t0 + 0.3);
    osc.frequency.linearRampToValueAtTime(2600, t0 + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t0);
    g.gain.setValueAtTime(0.3, t0 + 0.45);
    g.gain.linearRampToValueAtTime(0, t0 + 0.6);
    osc.connect(g); g.connect(MS.gainSFX);
    osc.start(t0); osc.stop(t0 + 0.6);
  },
};
MS.sfx = SFX;

function buildSoundboard() {
  const grid = $21('feteSoundGrid');
  if (!grid) return;
  const pads = [
    { id:'airhorn',     label:'🎺 Air Horn',   color:'#ff2d4d' },
    { id:'siren',       label:'🚨 Siren',      color:'#fbbf24' },
    { id:'rewind',      label:'⏪ Rewind',     color:'#2f9bff' },
    { id:'bringItBack', label:'🔥 Bring Back', color:'#22c55e' },
    { id:'bomb',        label:'💣 Bomb',       color:'#8b5cf6' },
    { id:'whistle',     label:'📯 Whistle',    color:'#ff2d4d' },
  ];
  grid.innerHTML = pads.map(p => `
    <button class="fete-pad" data-fx="${p.id}" style="--pad-color:${p.color}">
      <span class="fete-pad-icon">${p.label.split(' ')[0]}</span>
      <span class="fete-pad-label">${p.label.split(' ').slice(1).join(' ')}</span>
    </button>`).join('');
  grid.querySelectorAll('.fete-pad').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.add('hit');
      setTimeout(() => btn.classList.remove('hit'), 200);
      SFX[btn.dataset.fx]?.();
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   14 — MIC INPUT FOR HYPE/MC
══════════════════════════════════════════════════════════════ */
const Mic = {
  stream: null, source: null, active: false, ducking: false,

  async toggle() {
    if (this.active) { this.stop(); return; }
    try {
      MS.ensureAudioCtx(); ensureFeteChain();
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true } });
      this.source = MS.audioCtx.createMediaStreamSource(this.stream);
      this.source.connect(MS.gainMic);
      this.active = true;
      MS.toast('🎤 Mic live', 'ok', 1500);
      updateMicUI();
    } catch (e) {
      MS.toast('Mic access denied or unavailable.', 'error', 3000);
    }
  },
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.source?.disconnect(); } catch {}
    this.stream = null; this.source = null; this.active = false;
    this.setDuck(false);
    MS.toast('Mic off', 'info', 1200);
    updateMicUI();
  },
  setLevel(v) { if (MS.gainMic) MS.gainMic.gain.value = v; },
  setDuck(on) {
    this.ducking = on;
    const targets = [MS.gainA, MS.gainB, MS.gainM].filter(Boolean);
    const ctx = MS.audioCtx;
    if (!ctx) return;
    targets.forEach(g => {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.linearRampToValueAtTime(on ? 0.35 : 1, ctx.currentTime + 0.25);
    });
  },
};
MS.mic = Mic;

function updateMicUI() {
  const btn = $21('micToggleBtn');
  const duck = $21('micDuckBtn');
  if (btn) { btn.classList.toggle('on', Mic.active); btn.textContent = Mic.active ? '🎤 MIC LIVE' : '🎤 ENABLE MIC'; }
  if (duck) duck.disabled = !Mic.active;
}

function buildMicPanel() {
  const wrap = $21('feteMicPanel');
  if (!wrap) return;
  wrap.innerHTML = `
    <button id="micToggleBtn" class="mic-toggle-btn">🎤 ENABLE MIC</button>
    <div class="mic-level-row">
      <span class="mic-lbl">LEVEL</span>
      <input type="range" id="micLevel" min="0" max="1.6" step="0.02" value="1"/>
    </div>
    <button id="micDuckBtn" class="mic-duck-btn" disabled>Auto-Duck Music While Talking</button>`;
  $21('micToggleBtn').addEventListener('click', () => Mic.toggle());
  $21('micLevel').addEventListener('input', e => Mic.setLevel(+e.target.value));
  $21('micDuckBtn').addEventListener('click', () => {
    Mic.setDuck(!Mic.ducking);
    $21('micDuckBtn').classList.toggle('on', Mic.ducking);
  });
}

/* ══════════════════════════════════════════════════════════════
   TOOLKIT TAB — wire into the existing dj-subtabs bar
══════════════════════════════════════════════════════════════ */
function buildToolkitTab() {
  const bar = document.querySelector('.dj-subtabs');
  const content = document.querySelector('#page-dj .dj-content');
  if (!bar || !content || $21('toolkitView')) return;

  const btn = document.createElement('button');
  btn.className = 'dj-stab';
  btn.dataset.djsub = 'toolkit';
  btn.textContent = '🎉 Toolkit';
  bar.appendChild(btn);

  const view = document.createElement('div');
  view.id = 'toolkitView';
  view.className = 'toolkit-view';
  view.innerHTML = `
    <div class="section-label">🎉 Fete Soundboard</div>
    <div class="fete-sound-grid" id="feteSoundGrid"></div>
    <div class="section-label">🎤 Mic / Hype</div>
    <div id="feteMicPanel" class="fete-mic-panel"></div>`;
  // Insert right after the FX pad view so it sits alongside the other subviews
  const fxView = document.querySelector('#fxPadView');
  fxView?.parentNode.insertBefore(view, fxView.nextSibling);

  btn.addEventListener('click', () => {
    document.querySelectorAll('.dj-stab').forEach(b => b.classList.toggle('active', b === btn));
    ['twinDecksView','fxPadView','geqView'].forEach(id => $21(id)?.classList.remove('active'));
    view.classList.add('active');
  });
  // When any of the original 3 tabs is clicked, hide the toolkit view too
  document.querySelectorAll('.dj-stab[data-djsub]').forEach(b => {
    if (b === btn) return;
    b.addEventListener('click', () => view.classList.remove('active'));
  });

  buildSoundboard();
  buildMicPanel();
}

/* ══════════════════════════════════════════════════════════════
   17 — FIRST-RUN ONBOARDING
══════════════════════════════════════════════════════════════ */
const ONBOARD_KEY = 'vz_onboarded_v1';

const ONBOARD_STEPS = [
  { icon:'🎵', title:'Welcome to 868 Vibez', body:"Your music, your vibe, your world. Let's get you set up — this takes less than a minute." },
  { icon:'📁', title:'Add Your Music', body:'Tap Songs or Folder on the Player page to bring in your music. Everything you add stays on your device.' },
  { icon:'📻', title:'Live T&T Radio', body:'The Stream tab has Trinidad & Tobago stations sorted by frequency, plus Call/WhatsApp buttons straight to the station.' },
  { icon:'🎧', title:'The DJ Booth', body:'Rotate your phone sideways to enter the DJ console — twin decks, pro effects, and a fete soundboard for the airhorn.' },
];

function buildOnboarding() {
  if (localStorage.getItem(ONBOARD_KEY)) return;
  if ($21('onboardOverlay')) return;

  let step = 0;
  const el = document.createElement('div');
  el.id = 'onboardOverlay';
  el.innerHTML = `
    <div class="ob-card">
      <div class="ob-icon" id="obIcon"></div>
      <div class="ob-title" id="obTitle"></div>
      <div class="ob-body" id="obBody"></div>
      <div class="ob-dots" id="obDots"></div>
      <div class="ob-actions">
        <button class="ob-skip" id="obSkip">Skip</button>
        <button class="ob-next" id="obNext">Next</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  function render() {
    const s = ONBOARD_STEPS[step];
    $21('obIcon').textContent = s.icon;
    $21('obTitle').textContent = s.title;
    $21('obBody').textContent = s.body;
    $21('obDots').innerHTML = ONBOARD_STEPS.map((_,i) => `<span class="ob-dot ${i===step?'active':''}"></span>`).join('');
    $21('obNext').textContent = step === ONBOARD_STEPS.length - 1 ? "Let's Go" : 'Next';
  }
  function finish() {
    localStorage.setItem(ONBOARD_KEY, '1');
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }
  $21('obNext').addEventListener('click', () => {
    if (step === ONBOARD_STEPS.length - 1) { finish(); return; }
    step++; render();
  });
  $21('obSkip').addEventListener('click', finish);
  render();
}

/* Show onboarding right after the splash is dismissed, not before —
   avoids stacking two full-screen overlays on top of each other. */
function watchForSplashDismiss() {
  const splash = $21('splash');
  if (!splash) { buildOnboarding(); return; }
  const check = setInterval(() => {
    if (!document.getElementById('splash')) {
      clearInterval(check);
      setTimeout(buildOnboarding, 300);
    }
  }, 200);
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
/* ── Toolkit tab ── */
.toolkit-view { display:none; flex:1; flex-direction:column; padding:10px 12px 24px; overflow-y:auto; }
.toolkit-view.active { display:flex; }

.fete-sound-grid {
  display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
  margin-bottom:16px;
}
.fete-pad {
  aspect-ratio:1.3; border-radius:14px;
  border:1px solid var(--border); background:var(--bg3);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
  cursor:pointer; -webkit-tap-highlight-color:transparent;
  transition:transform .08s, box-shadow .15s;
  color:var(--pad-color, var(--t1));
}
.fete-pad-icon { font-size:26px; }
.fete-pad-label { font-size:9px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--t2); }
.fete-pad:active, .fete-pad.hit {
  transform:scale(.92);
  box-shadow:0 0 22px var(--pad-color, var(--cyan));
  border-color:var(--pad-color, var(--cyan));
}

.fete-mic-panel { display:flex; flex-direction:column; gap:10px; }
.mic-toggle-btn {
  padding:14px; border-radius:12px; font-size:14px; font-weight:900;
  border:1px solid var(--border); background:var(--bg3); color:var(--t1);
  cursor:pointer;
}
.mic-toggle-btn.on { border-color:var(--red); color:var(--red); background:rgba(232,16,42,.1); animation:micPulse 1.6s ease-in-out infinite; }
@keyframes micPulse { 0%,100%{box-shadow:0 0 0 rgba(232,16,42,0)} 50%{box-shadow:0 0 18px rgba(232,16,42,.4)} }
.mic-level-row { display:flex; align-items:center; gap:10px; }
.mic-lbl { font-size:9px; font-weight:800; color:var(--t3); letter-spacing:.1em; flex-shrink:0; }
.mic-level-row input { flex:1; accent-color:var(--red); height:20px; }
.mic-duck-btn {
  padding:12px; border-radius:12px; font-size:11px; font-weight:700;
  border:1px solid var(--border); background:var(--bg3); color:var(--t2);
  cursor:pointer;
}
.mic-duck-btn:disabled { opacity:.4; }
.mic-duck-btn.on { border-color:var(--green); color:var(--green); background:rgba(31,214,95,.1); }

/* ── Onboarding overlay ── */
#onboardOverlay {
  position:fixed; inset:0; z-index:500;
  background:rgba(4,4,4,.88); backdrop-filter:blur(10px);
  display:flex; align-items:center; justify-content:center;
  padding:24px; transition:opacity .3s;
}
#onboardOverlay.out { opacity:0; pointer-events:none; }
.ob-card {
  width:100%; max-width:360px; text-align:center;
  background:var(--bg2); border:1px solid var(--border2);
  border-radius:20px; padding:32px 24px 24px;
  box-shadow:0 20px 60px rgba(0,0,0,.6);
}
.ob-icon { font-size:44px; margin-bottom:14px; }
.ob-title { font-family:var(--font-display,var(--font)); font-size:20px; font-weight:800; margin-bottom:10px; }
.ob-body { font-size:13.5px; color:var(--t2); line-height:1.6; margin-bottom:20px; }
.ob-dots { display:flex; justify-content:center; gap:6px; margin-bottom:22px; }
.ob-dot { width:6px; height:6px; border-radius:50%; background:var(--t4); transition:all .2s; }
.ob-dot.active { width:18px; border-radius:3px; background:var(--red); }
.ob-actions { display:flex; gap:10px; }
.ob-skip { flex:1; padding:12px; border-radius:10px; border:1px solid var(--border); background:transparent; color:var(--t3); font-size:12px; font-weight:700; }
.ob-next { flex:2; padding:12px; border-radius:10px; border:none; background:var(--red); color:#fff; font-size:13px; font-weight:800; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init21() {
  buildToolkitTab();
  watchForSplashDismiss();
  console.info('[868 Vibez] Phase 21 ready — Fete Toolkit + Onboarding');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init21, 60));
} else {
  setTimeout(init21, 60);
}

})();
