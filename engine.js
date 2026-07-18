/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — engine.js
   ONE audio engine. Built from day one knowing decks, main player,
   radio, soundboard, mic and recording all exist — no splicing.

   Graph:  gainMain ┐
           gainA    ├→ limiter → destination
           gainB    │         └→ recorder tap
           gainSFX  │
           gainMic  ┘
   Radio plays through its OWN element OUTSIDE the graph (cross-
   origin streams without CORS go silent inside Web Audio — learned
   the hard way in v1).
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const E = VZ.engine = {
  ctx: null, limiter: null,
  gains: {},               // main, A, B, sfx, mic
  el: {},                  // main, A, B  (audio elements in the graph)
  radioEl: null,           // dedicated, never touches the graph
  deck: { A: { track: null, playing: false, cues: [null,null,null,null], loop: null, keylock: true },
          B: { track: null, playing: false, cues: [null,null,null,null], loop: null, keylock: true } },
  mainTrack: null,
  _listeners: {},
  on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
  emit(ev, d) { (this._listeners[ev] || []).forEach(fn => { try { fn(d); } catch (e) { VZ.logError('event:' + ev, e); } }); },
};

/* ── Build the whole graph once ── */
E.ensureCtx = function () {
  if (E.ctx) { if (E.ctx.state === 'suspended') E.ctx.resume(); return E.ctx; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.15;
  limiter.connect(ctx.destination);
  ['main', 'A', 'B', 'sfx', 'mic'].forEach(k => {
    const g = ctx.createGain(); g.connect(limiter); E.gains[k] = g;
  });
  // Per-deck FX chain: gain → filter → lo → mid → hi → limiter
  ['A', 'B'].forEach(d => {
    const g = E.gains[d]; g.disconnect();
    const filter = ctx.createBiquadFilter(); filter.type = 'allpass'; filter.frequency.value = 1000;
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4000;
    g.connect(filter); filter.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(limiter);
    E.deck[d].fx = { filter, lo, mid, hi };
  });
  E.ctx = ctx; E.limiter = limiter;
  // Wire the three graph elements
  ['main', 'A', 'B'].forEach(k => {
    const a = new Audio();
    a.crossOrigin = 'anonymous'; a.preload = 'metadata';
    const src = ctx.createMediaElementSource(a);
    src.connect(E.gains[k]);
    E.el[k] = a;
  });
  E.el.main.addEventListener('ended', () => E.emit('main:ended'));
  ['A','B'].forEach(d => {
    E.el[d].addEventListener('ended', () => { E.deck[d].playing = false; E.emit('deck:state', d); });
    E.el[d].addEventListener('error', () => { if (E.el[d].src) VZ.toast(`Deck ${d}: couldn't load that audio.`, 'error'); });
  });
  return ctx;
};

/* ── Exclusivity: one sound source at a time across the 3 systems ── */
E.stopRadio = function () {
  if (!E.radioEl) return;
  E.radioEl.pause(); E.radioEl.removeAttribute('src');
  try { E.radioEl.load(); } catch {}
  E.emit('radio:state', null);
};
E.stopDecks = function () { ['A','B'].forEach(d => { E.el[d]?.pause(); E.deck[d].playing = false; }); E.emit('deck:state', 'A'); E.emit('deck:state', 'B'); };
E.stopMain = function () { E.el.main?.pause(); E.emit('main:state'); };

/* ── Main player ── */
E.playMain = async function (track) {
  E.ensureCtx(); E.stopRadio(); E.stopDecks();
  const file = await VZ.libraryCore.fileForTrack(track);
  if (E.el.main._url) URL.revokeObjectURL(E.el.main._url);
  const url = URL.createObjectURL(file);
  E.el.main._url = url; E.el.main.src = url;
  E.mainTrack = track;
  await E.el.main.play();
  E.emit('main:state');
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist || '868 Vibez', album: '868 Vibez' });
    navigator.mediaSession.setActionHandler('play', () => E.toggleMain());
    navigator.mediaSession.setActionHandler('pause', () => E.toggleMain());
    navigator.mediaSession.setActionHandler('previoustrack', () => VZ.player.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => VZ.player.next());
  }
};
E.toggleMain = async function () {
  if (!E.el.main?.src) return;
  if (E.el.main.paused) { E.stopRadio(); E.stopDecks(); await E.el.main.play(); }
  else E.el.main.pause();
  E.emit('main:state');
};

/* ── Decks ── */
E.loadDeck = async function (d, track) {
  E.ensureCtx();
  const file = await VZ.libraryCore.fileForTrack(track);
  const a = E.el[d];
  if (a._url) URL.revokeObjectURL(a._url);
  const url = URL.createObjectURL(file);
  a._url = url; a.src = url;
  a.preservesPitch = E.deck[d].keylock;
  a.mozPreservesPitch = E.deck[d].keylock;
  E.deck[d].track = track; E.deck[d].playing = false; E.deck[d].loop = null;
  const cueRec = await VZ.db.get('cues', track.id).catch(() => null);
  E.deck[d].cues = cueRec?.cues || [null,null,null,null];
  E.emit('deck:loaded', d);
  VZ.dj?.logSession?.(d, track);
};
E.toggleDeck = async function (d) {
  const a = E.el[d];
  if (!a?.src) { VZ.toast(`Load a track on Deck ${d} first.`, 'warn'); return; }
  if (a.paused) { E.stopRadio(); E.stopMain(); await a.play(); E.deck[d].playing = true; }
  else { a.pause(); E.deck[d].playing = false; }
  E.emit('deck:state', d);
};
E.cueDeck = function (d) {
  const a = E.el[d]; if (!a?.src) return;
  a.currentTime = 0;
  if (!a.paused) return;
  E.emit('deck:state', d);
};
E.setPitch = function (d, pct) {         // pct: -8..8
  const a = E.el[d]; if (!a) return;
  a.playbackRate = 1 + pct / 100;
  E.emit('deck:pitch', d);
};
E.setKeylock = function (d, on) {
  E.deck[d].keylock = on;
  const a = E.el[d]; if (!a) return;
  a.preservesPitch = on; a.mozPreservesPitch = on;
};
E.setEQ = function (d, band, db) { const n = E.deck[d].fx?.[band]; if (n) n.gain.value = db; };
E.setFilter = function (d, v) {          // -1..1 : LP..bypass..HP
  const f = E.deck[d].fx?.filter; if (!f) return;
  if (Math.abs(v) < 0.06) { f.type = 'allpass'; f.frequency.value = 1000; f.Q.value = 0.0001; return; }
  if (v < 0) { f.type = 'lowpass'; f.frequency.value = 22000 * Math.pow(0.006, -v); }
  else { f.type = 'highpass'; f.frequency.value = 20 * Math.pow(400, v); }
  f.Q.value = 0.9;
};
/* Loops */
E.loopIn  = function (d) { const a = E.el[d]; if (!a?.duration) return; E.deck[d].loop = { start: a.currentTime, end: null }; E.emit('deck:loop', d); };
E.loopOut = function (d) { const L = E.deck[d].loop, a = E.el[d]; if (!L || !a?.duration) return; L.end = Math.max(L.start + 0.1, a.currentTime); E.emit('deck:loop', d); };
E.loopExit = function (d) { E.deck[d].loop = null; E.emit('deck:loop', d); };
E.loopResize = function (d, f) { const L = E.deck[d].loop; if (!L?.end) return; L.end = L.start + (L.end - L.start) * f; E.emit('deck:loop', d); };
setInterval(() => {
  ['A','B'].forEach(d => {
    const L = E.deck[d].loop, a = E.el[d];
    if (L?.end && a && !a.paused && a.currentTime >= L.end) a.currentTime = L.start;
  });
}, 25);
/* Hot cues */
E.hotCue = async function (d, i) {
  const a = E.el[d]; if (!a?.duration) return;
  const deck = E.deck[d];
  if (deck.cues[i] == null) {
    deck.cues[i] = a.currentTime;
    if (deck.track) await VZ.db.put('cues', { id: deck.track.id, cues: deck.cues });
  } else {
    a.currentTime = deck.cues[i];
  }
  E.emit('deck:cues', d);
};
E.clearCue = async function (d, i) {
  const deck = E.deck[d];
  deck.cues[i] = null;
  if (deck.track) await VZ.db.put('cues', { id: deck.track.id, cues: deck.cues });
  E.emit('deck:cues', d);
};
E.setDeckVol = function (d, v) { if (E.gains[d]) E.gains[d].gain.value = v; };
E.setXfade = function (v) {              // 0 (A) .. 1 (B), equal-power
  if (!E.gains.A) return;
  E.gains.A.gain.value = Math.cos(v * Math.PI / 2);
  E.gains.B.gain.value = Math.cos((1 - v) * Math.PI / 2);
};

/* ── Radio (outside the graph) ── */
E.playRadio = function (station, onState) {
  E.stopMain(); E.stopDecks();
  if (!E.radioEl) {
    E.radioEl = new Audio(); E.radioEl.preload = 'none';
  }
  const a = E.radioEl;
  a.onplaying = () => onState?.('playing');
  a.onwaiting = () => onState?.('loading');
  a.onerror = () => onState?.('error');
  a.src = station.url; a.load();
  return a.play();
};

/* ── Soundboard (synthesized) ── */
function noiseBuf(sec) { const c = E.ctx; const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
E.sfx = {
  airhorn() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; [349.23, 261.63].forEach((f, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .03); g.gain.setValueAtTime(.5, t + 1.1); g.gain.linearRampToValueAtTime(0, t + 1.4); o.connect(g); g.connect(E.gains.sfx); o.start(t + i * .02); o.stop(t + 1.5); }); },
  siren() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sawtooth'; const g = c.createGain(); g.gain.setValueAtTime(.4, t); for (let i = 0; i < 4; i++) { o.frequency.setValueAtTime(500, t + i * .5); o.frequency.linearRampToValueAtTime(1200, t + i * .5 + .25); o.frequency.linearRampToValueAtTime(500, t + i * .5 + .5); } g.gain.setValueAtTime(.4, t + 1.9); g.gain.linearRampToValueAtTime(0, t + 2.1); o.connect(g); g.connect(E.gains.sfx); o.start(t); o.stop(t + 2.1); },
  rewind() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = noiseBuf(.8); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(3000, t + .75); const g = c.createGain(); g.gain.setValueAtTime(.35, t); g.gain.linearRampToValueAtTime(0, t + .8); s.connect(f); f.connect(g); g.connect(E.gains.sfx); s.start(t); s.stop(t + .8); },
  bring() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(1800, t + .9); const g = c.createGain(); g.gain.setValueAtTime(.01, t); g.gain.exponentialRampToValueAtTime(.45, t + .85); g.gain.linearRampToValueAtTime(0, t + 1); o.connect(g); g.connect(E.gains.sfx); o.start(t); o.stop(t + 1); },
  bomb() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = noiseBuf(1.2); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(80, t + 1.1); const g = c.createGain(); g.gain.setValueAtTime(.6, t); g.gain.exponentialRampToValueAtTime(.01, t + 1.2); s.connect(f); f.connect(g); g.connect(E.gains.sfx); s.start(t); s.stop(t + 1.2); },
  whistle() { E.ensureCtx(); const c = E.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1800, t); o.frequency.linearRampToValueAtTime(2600, t + .15); o.frequency.linearRampToValueAtTime(1800, t + .3); o.frequency.linearRampToValueAtTime(2600, t + .45); const g = c.createGain(); g.gain.setValueAtTime(.3, t); g.gain.setValueAtTime(.3, t + .45); g.gain.linearRampToValueAtTime(0, t + .6); o.connect(g); g.connect(E.gains.sfx); o.start(t); o.stop(t + .6); },
};

/* ── Mic ── */
E.mic = {
  stream: null, node: null, active: false, ducking: false,
  async toggle() {
    if (this.active) { this.stop(); return false; }
    E.ensureCtx();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.node = E.ctx.createMediaStreamSource(this.stream);
    this.node.connect(E.gains.mic);
    this.active = true;
    return true;
  },
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.node?.disconnect(); } catch {}
    this.stream = this.node = null; this.active = false;
    this.setDuck(false);
  },
  setLevel(v) { E.gains.mic.gain.value = v; },
  setDuck(on) {
    this.ducking = on;
    ['main','A','B'].forEach(k => {
      const g = E.gains[k]; if (!g || !E.ctx) return;
      g.gain.cancelScheduledValues(E.ctx.currentTime);
      g.gain.linearRampToValueAtTime(on ? 0.35 : 1, E.ctx.currentTime + 0.25);
    });
  },
};

/* ── Recording ── */
E.rec = {
  recorder: null, chunks: [], startedAt: 0,
  start() {
    E.ensureCtx();
    const dest = E.ctx.createMediaStreamDestination();
    E.limiter.connect(dest);
    this.recorder = new MediaRecorder(dest.stream);
    this.chunks = [];
    this.recorder.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `868vibez-mix-${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      try { E.limiter.disconnect(dest); } catch {}
    };
    this.recorder.start();
    this.startedAt = Date.now();
  },
  stop() { this.recorder?.state !== 'inactive' && this.recorder?.stop(); },
  get active() { return this.recorder && this.recorder.state === 'recording'; },
};
})();
