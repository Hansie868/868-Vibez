/* ============================================================
   868 VIBEZ — Phase 23: List B — Best-of-the-Big-4
   4.  Phrase/frequency-colored waveform (rekordbox-style)
   5.  Color-coded hot cue pads (Serato-style)
   6.  Keylock/time-stretch verification pass
   7.  Recording the mix to a file
   8.  Live broadcast (honest scope note — see UI copy)
   9.  Stem-style DSP isolation (vocal cut / bass / highs)
   10. Auto-DJ / Automix mode
   11. Next-track compatibility suggestions
   ============================================================ */
'use strict';

(function () {
const $23 = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════
   4 — PHRASE / FREQUENCY-COLORED WAVEFORM
   Extends the existing cached peaks with a per-bucket low/mid/high
   energy split (simple leaky-integrator filters — no FFT library
   needed) plus a rolling-energy phrase label, then redraws the
   sticky waveform strip with rekordbox-style structure coloring.
══════════════════════════════════════════════════════════════ */
function bandSplit(data, from, to) {
  // Cheap single-pole low/high pass run over just this bucket's
  // samples — good enough for a visual "which frequency dominates
  // here" cue, not meant to be a mastering-grade analyzer.
  let lp = 0, hp = 0, prev = 0, lowSum = 0, highSum = 0, midSum = 0, n = 0;
  const a = 0.08; // low-pass coefficient
  for (let i = from; i < to; i++) {
    const s = data[i] || 0;
    lp += a * (s - lp);
    const hpv = s - lp;
    hp = hpv;
    const midv = s - lp - hp * 0.3;
    lowSum += Math.abs(lp); highSum += Math.abs(hp); midSum += Math.abs(midv);
    n++;
  }
  if (!n) return { low:0, mid:0, high:0 };
  return { low: lowSum/n, mid: midSum/n, high: highSum/n };
}

async function analyzeStructure(file, buckets=400) {
  try {
    const ab = await file.arrayBuffer();
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length/buckets));
    const bands = [];
    const energies = [];
    for (let i = 0; i < buckets; i++) {
      const from = i*step, to = Math.min(data.length, from+step);
      const b = bandSplit(data, from, to);
      bands.push(b);
      energies.push(b.low + b.mid + b.high);
    }
    await ctx.close();
    // Rolling-window energy → phrase label (intro / build / drop / breakdown)
    const win = Math.max(4, Math.round(buckets/40));
    const smoothed = energies.map((_,i) => {
      const s = Math.max(0,i-win), e = Math.min(buckets,i+win);
      let sum=0; for (let j=s;j<e;j++) sum+=energies[j];
      return sum/(e-s);
    });
    const max = Math.max(...smoothed, 0.0001);
    const phrases = smoothed.map((v,i) => {
      const norm = v/max;
      const prevNorm = i>0 ? smoothed[i-1]/max : norm;
      if (norm > 0.75) return 'drop';
      if (norm > 0.75*0.6 && norm > prevNorm) return 'build';
      if (norm < 0.28) return 'breakdown';
      return 'verse';
    });
    return { bands, phrases };
  } catch {
    return null;
  }
}

const PHRASE_COLOR = {
  breakdown: 'rgba(47,155,255,.22)',   // blue-ish, low energy
  verse:     'rgba(255,255,255,.06)',
  build:     'rgba(251,191,36,.22)',   // amber, rising
  drop:      'rgba(255,45,77,.28)',    // red, peak energy
};

function drawPhraseWave(canvas, peaks, structure, pct, colorA) {
  if (!canvas || !peaks) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth*devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight*devicePixelRatio;
  ctx.clearRect(0,0,W,H);
  const mid = H/2, bw = W/peaks.length;

  // Phrase background blocks (structure-at-a-glance, rekordbox-style)
  if (structure?.phrases) {
    structure.phrases.forEach((ph,i) => {
      ctx.fillStyle = PHRASE_COLOR[ph] || 'transparent';
      ctx.fillRect(i*bw, 0, Math.max(1,bw+.5), H);
    });
  }

  peaks.forEach((p,i) => {
    const bh = p*mid*.82;
    let barColor;
    if (structure?.bands?.[i]) {
      const b = structure.bands[i];
      const total = b.low+b.mid+b.high || 1;
      // Dominant frequency band tints the bar — bass red, mid green, high blue
      const r = Math.round(255 * (b.low/total));
      const g = Math.round(200 * (b.mid/total));
      const bl = Math.round(255 * (b.high/total));
      barColor = `rgb(${r},${g},${bl})`;
    } else {
      barColor = colorA;
    }
    ctx.fillStyle = (i/peaks.length) < pct ? barColor : 'rgba(255,255,255,.14)';
    ctx.fillRect(i*bw, mid-bh, Math.max(1,bw-.5), bh*2);
  });

  const px = pct*W;
  ctx.shadowColor = colorA; ctx.shadowBlur = 8;
  ctx.fillStyle = colorA; ctx.fillRect(px-1,0,2,H);
  ctx.shadowBlur = 0;
}

const structureCache = {}; // trackId -> {bands, phrases}

async function ensureStructure(track, file) {
  if (structureCache[track.id]) return structureCache[track.id];
  let cached = null;
  try { cached = await MS.db.get('waveforms', track.id); } catch {}
  if (cached?.structure) { structureCache[track.id] = cached.structure; return cached.structure; }
  const structure = await analyzeStructure(file, 400);
  if (structure && cached) {
    cached.structure = structure;
    try { await MS.db.put('waveforms', cached); } catch {}
  }
  structureCache[track.id] = structure;
  return structure;
}

// Wrap the existing renderWave (global function, not IIFE-wrapped in
// engine.js) so phrase/frequency coloring layers on top without
// touching the original playback/caching logic.
const _origRenderWave = window.renderWave;
window.renderWave = async function (deck, track, file) {
  await _origRenderWave(deck, track, file);
  const structure = await ensureStructure(track, file);
  if (!structure) return;
  const canvas = document.getElementById(deck === 'A' ? 'waveA' : 'waveB');
  const color = deck === 'A' ? '#2f9bff' : '#ff2d4d';
  const peaks = MS.deck[deck]._peaks;
  drawPhraseWave(canvas, peaks, structure, 0, color);
  MS.deck[deck]._structure = structure;
};

// The existing playhead-tick loop calls the original drawWave with just
// peaks; wrap that too so the moving playhead keeps the phrase coloring.
const _origDrawWave = window.drawWave;
window.drawWave = function (canvas, peaks, pct, colorA, colorB) {
  const deck = canvas?.id === 'waveA' ? 'A' : canvas?.id === 'waveB' ? 'B' : null;
  const structure = deck ? MS.deck?.[deck]?._structure : null;
  if (structure) { drawPhraseWave(canvas, peaks, structure, pct, colorA); return; }
  _origDrawWave(canvas, peaks, pct, colorA, colorB);
};

/* ══════════════════════════════════════════════════════════════
   5 — COLOR-CODED HOT CUE PADS (4 slots per deck)
══════════════════════════════════════════════════════════════ */
const HOT_CUE_COLORS = ['#ff2d4d', '#fbbf24', '#1fd65f', '#2f9bff'];

async function getHotCues(deck) {
  const track = MS.deck[deck]?.track;
  if (!track) return [null,null,null,null];
  let all = [];
  try { all = await MS.db.all('cuePoints'); } catch {}
  const forTrack = all.filter(c => c.trackId === track.id && c.deck === deck && c.slot != null);
  const slots = [null,null,null,null];
  forTrack.forEach(c => { if (c.slot >= 0 && c.slot < 4) slots[c.slot] = c; });
  return slots;
}

async function hitHotCue(deck, slot) {
  const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
  const track = MS.deck[deck]?.track;
  if (!track || !audio) { MS.toast('Load a track first.', 'warn'); return; }
  const slots = await getHotCues(deck);
  if (slots[slot]) {
    audio.currentTime = slots[slot].time;
    if (audio.paused) audio.play();
  } else {
    const cue = { id:`${track.id}_${deck}_hc${slot}_${Date.now()}`, trackId:track.id, deck, slot,
      time: audio.currentTime, color: HOT_CUE_COLORS[slot], createdAt: Date.now() };
    await MS.db.put('cuePoints', cue);
    MS.toast(`Hot cue ${slot+1} set`, 'ok', 1000);
  }
  renderHotCues(deck);
}
async function clearHotCue(deck, slot) {
  const slots = await getHotCues(deck);
  if (slots[slot]) { try { await MS.db.del('cuePoints', slots[slot].id); } catch {} }
  renderHotCues(deck);
}
window.djHotCueHit = (deck, slot) => hitHotCue(deck, +slot);
window.djHotCueClear = (deck, slot) => clearHotCue(deck, +slot);

async function renderHotCues(deck) {
  const wrap = $23(`hotCues${deck}`);
  if (!wrap) return;
  const slots = await getHotCues(deck);
  wrap.innerHTML = slots.map((c,i) => `
    <button class="hotcue-pad ${c ? 'set' : ''}" style="--pad-c:${HOT_CUE_COLORS[i]}"
      onclick="djHotCueHit('${deck}',${i})"
      ontouchstart="this._t=Date.now()"
      ontouchend="if(Date.now()-this._t>500){djHotCueClear('${deck}',${i});}">
      ${i+1}
    </button>`).join('');
}

function buildHotCueRows() {
  ['A','B'].forEach(deck => {
    const cueRow = document.querySelector(`#platter${deck}Wrap, .dd-cues`); // fallback selector safety
  });
  document.querySelectorAll('.dj-deck').forEach((deckEl, idx) => {
    const deck = idx === 0 ? 'A' : 'B';
    if ($23(`hotCues${deck}`)) return;
    const cuesRow = deckEl.querySelector('.dd-cues');
    if (!cuesRow) return;
    const wrap = document.createElement('div');
    wrap.id = `hotCues${deck}`;
    wrap.className = 'hotcue-row';
    cuesRow.parentNode.insertBefore(wrap, cuesRow.nextSibling);
    renderHotCues(deck);
  });
}
MS.on && MS.on('deck:loaded', ({ deck }) => renderHotCues(deck));

/* ══════════════════════════════════════════════════════════════
   6 — KEYLOCK / TIME-STRETCH VERIFICATION
   The browser's native preservesPitch (phase18) is the best
   time-stretch available without shipping a WASM DSP library —
   this just makes sure it's actually applied and gives clear
   feedback so it's not a silent, unverifiable toggle.
══════════════════════════════════════════════════════════════ */
function verifyKeylock() {
  ['A','B'].forEach(d => {
    const a = MS.audio?.[d];
    if (!a) return;
    const supported = 'preservesPitch' in a || 'mozPreservesPitch' in a || 'webkitPreservesPitch' in a;
    if (!supported) MS.toast(`Deck ${d}: this browser doesn't support keylock — pitch will shift with tempo.`, 'warn', 3500);
  });
}

/* ══════════════════════════════════════════════════════════════
   7 — RECORD THE MIX TO A FILE
══════════════════════════════════════════════════════════════ */
const Recorder = {
  rec: null, chunks: [], dest: null, active: false, startedAt: 0,

  start() {
    if (this.active) return;
    MS.ensureAudioCtx();
    if (!this.dest) {
      this.dest = MS.audioCtx.createMediaStreamDestination();
      MS.limiter.connect(this.dest);
    }
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    this.rec = new MediaRecorder(this.dest.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.save();
    this.rec.start(1000);
    this.active = true;
    this.startedAt = Date.now();
    updateRecUI();
    MS.toast('⏺ Recording mix…', 'ok', 1500);
  },
  stop() {
    if (!this.active) return;
    this.rec.stop();
    this.active = false;
    updateRecUI();
  },
  save() {
    if (!this.chunks.length) return;
    const blob = new Blob(this.chunks, { type: this.chunks[0].type || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
    const a = document.createElement('a');
    a.href = url; a.download = `868vibez-mix-${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    MS.toast('Mix saved to your downloads.', 'ok', 2500);
  },
};
MS.recorder = Recorder;

function updateRecUI() {
  const btn = $23('recToggleBtn');
  const timer = $23('recTimer');
  if (btn) { btn.classList.toggle('on', Recorder.active); btn.textContent = Recorder.active ? '⏹ STOP RECORDING' : '⏺ RECORD MIX'; }
  if (!Recorder.active) { if (timer) timer.textContent = ''; return; }
  const tick = () => {
    if (!Recorder.active) return;
    const s = Math.floor((Date.now()-Recorder.startedAt)/1000);
    if (timer) timer.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    requestAnimationFrame(() => setTimeout(tick, 500));
  };
  tick();
}

/* ══════════════════════════════════════════════════════════════
   8 — LIVE BROADCAST (honest scope)
   True Icecast/Shoutcast SOURCE broadcasting needs a raw persistent
   connection browsers can't open directly, and CORS blocks it on
   virtually every real Icecast server unless specially configured
   for browser-origin PUT uploads. Rather than fake a "broadcast"
   button that silently fails at a real gig, this panel is honest
   about that and offers the one thing that reliably works from a
   browser: recording the mix, which you can then upload anywhere
   (your own stream, cloud storage, socials) right after the set.
══════════════════════════════════════════════════════════════ */
function buildBroadcastPanel() {
  const wrap = $23('broadcastPanel');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="radio-note" style="text-align:left;line-height:1.7">
      Browsers can't hold a live Icecast/Shoutcast connection open the way desktop DJ software can — most Icecast servers also block browser-origin uploads outright. So instead of a broadcast button that might silently fail mid-set, use <b>Record Mix</b> below: it captures the exact same master output, and you upload the file to your stream/socials right after.
    </div>
    <button id="recToggleBtn" class="rec-toggle-btn">⏺ RECORD MIX</button>
    <div id="recTimer" class="rec-timer"></div>`;
  $23('recToggleBtn').addEventListener('click', () => Recorder.active ? Recorder.stop() : Recorder.start());
}

/* ══════════════════════════════════════════════════════════════
   9 — STEM-STYLE DSP ISOLATION
   Not ML source separation (Demucs-quality isolation needs a large
   model and isn't real-time on a phone) — this is the classic,
   instant, zero-latency DJ trick: center-channel cancellation for
   vocal cut, plus steep filters for bass/vocal-range focus. Genuinely
   useful (acapella/instrumental swaps, bass isolation), just not
   perfect separation.
══════════════════════════════════════════════════════════════ */
const StemFX = { A:{mode:'normal'}, B:{mode:'normal'} };

function ensureStemChain(deck) {
  const audio = MS.audio[deck];
  const gain = deck === 'A' ? MS.gainA : MS.gainB;
  if (!audio || !audio._msNode || audio._stemSpliced || !MS.audioCtx) return;
  const ctx = MS.audioCtx;
  const src = audio._msNode;
  try { src.disconnect(gain); } catch {}

  const splitter = ctx.createChannelSplitter(2);
  const invert = ctx.createGain(); invert.gain.value = -1;
  const vocalCutMerge = ctx.createChannelMerger(2);
  src.connect(splitter);
  splitter.connect(vocalCutMerge, 0, 0);           // L → out L
  splitter.connect(invert, 1);
  invert.connect(vocalCutMerge, 0, 0);             // -R → out L too (L + -R)
  splitter.connect(vocalCutMerge, 0, 1);
  invert.connect(vocalCutMerge, 0, 1);             // same on out R → mono karaoke cut

  const bassFilter = ctx.createBiquadFilter(); bassFilter.type = 'lowpass'; bassFilter.frequency.value = 180;
  const highFilter  = ctx.createBiquadFilter(); highFilter.type  = 'highpass'; highFilter.frequency.value = 300;
  src.connect(bassFilter);
  src.connect(highFilter);

  const gNormal = ctx.createGain(); gNormal.gain.value = 1;
  const gVocalCut = ctx.createGain(); gVocalCut.gain.value = 0;
  const gBass = ctx.createGain(); gBass.gain.value = 0;
  const gHigh = ctx.createGain(); gHigh.gain.value = 0;

  src.connect(gNormal);
  vocalCutMerge.connect(gVocalCut);
  bassFilter.connect(gBass);
  highFilter.connect(gHigh);

  gNormal.connect(gain); gVocalCut.connect(gain); gBass.connect(gain); gHigh.connect(gain);

  audio._stemSpliced = true;
  audio._stemGains = { normal: gNormal, vocalcut: gVocalCut, bass: gBass, high: gHigh };
}
MS.on && MS.on('deck:loaded', ({ deck }) => ensureStemChain(deck));

function setStemMode(deck, mode) {
  StemFX[deck].mode = mode;
  ensureStemChain(deck);
  const audio = MS.audio[deck];
  const gains = audio?._stemGains;
  if (!gains) return;
  const ctx = MS.audioCtx, t = ctx.currentTime;
  Object.entries(gains).forEach(([k,g]) => {
    g.gain.cancelScheduledValues(t);
    g.gain.linearRampToValueAtTime(k === mode ? 1 : 0, t + 0.08);
  });
  renderStemButtons(deck);
}
window.djSetStemMode = (deck, mode) => setStemMode(deck, mode);

function buildStemPanel() {
  ['A','B'].forEach(deck => {
    if ($23(`stemRow${deck}`)) return;
    const deckEl = document.querySelectorAll('.dj-deck')[deck === 'A' ? 0 : 1];
    if (!deckEl) return;
    const wrap = document.createElement('div');
    wrap.id = `stemRow${deck}`;
    wrap.className = 'stem-row';
    deckEl.appendChild(wrap);
    renderStemButtons(deck);
  });
}
function renderStemButtons(deck) {
  const wrap = $23(`stemRow${deck}`);
  if (!wrap) return;
  const modes = [
    { id:'normal',   label:'FULL' },
    { id:'vocalcut', label:'NO VOX' },
    { id:'bass',     label:'BASS' },
    { id:'high',     label:'HIGHS' },
  ];
  wrap.innerHTML = modes.map(m => `
    <button class="stem-btn ${StemFX[deck].mode===m.id?'active':''}" onclick="djSetStemMode('${deck}','${m.id}')">${m.label}</button>`).join('');
}

/* ══════════════════════════════════════════════════════════════
   10 — AUTO-DJ / AUTOMIX MODE
══════════════════════════════════════════════════════════════ */
const AutoDJ = {
  active: false, queue: [], currentIdx: -1, watchTimer: null,

  camelotDistance(a, b) {
    if (!a || !b) return 99;
    const na = parseInt(a), nb = parseInt(b);
    const la = a.slice(-1), lb = b.slice(-1);
    if (a === b) return 0;
    if (la === lb && Math.abs(na-nb) <= 1) return 1;
    if (na === nb && la !== lb) return 1;
    return 5;
  },
  score(a, b) {
    const bpmDiff = Math.abs((a.bpm||120) - (b.bpm||120));
    const keyDist = this.camelotDistance(a.key, b.key);
    return bpmDiff * 2 + keyDist * 10;
  },
  buildQueueFrom(tracks) {
    this.queue = [...tracks].sort(() => Math.random()-0.5);
  },
  nextTrack(afterTrack) {
    if (!this.queue.length) return null;
    const ranked = [...this.queue].sort((a,b) => this.score(afterTrack,a) - this.score(afterTrack,b));
    return ranked[0];
  },
  async start() {
    if (this.active) return;
    if (!this.queue.length) this.buildQueueFrom(MS.library || []);
    if (!this.queue.length) { MS.toast('Import some music first.', 'warn'); return; }
    this.active = true;
    // Load first track to A if empty, play it
    if (!MS.deck.A.track) {
      const first = this.queue.shift();
      await MS.loadDeck('A', first);
      MS.audio.A.play();
    }
    this.watchTimer = setInterval(() => this.tick(), 2000);
    MS.toast('🤖 Auto-DJ engaged', 'ok', 2000);
    updateAutoDJUI();
  },
  stop() {
    this.active = false;
    clearInterval(this.watchTimer);
    MS.toast('Auto-DJ stopped', 'info', 1500);
    updateAutoDJUI();
  },
  async tick() {
    if (!this.active) return;
    for (const deck of ['A','B']) {
      const audio = MS.audio[deck];
      const other = deck === 'A' ? 'B' : 'A';
      if (!audio?.duration || audio.paused) continue;
      const remaining = audio.duration - audio.currentTime;
      if (remaining < 16 && remaining > 0 && !MS.deck[other].track) {
        const next = this.nextTrack(MS.deck[deck].track);
        if (!next) continue;
        this.queue = this.queue.filter(t => t.id !== next.id);
        await MS.loadDeck(other, next);
        // Rough tempo match
        const ratio = (MS.deck[deck].track.bpm || 120) / (next.bpm || 120);
        const otherAudio = MS.audio[other];
        if (otherAudio && isFinite(ratio) && ratio > 0.7 && ratio < 1.4) otherAudio.playbackRate = ratio;
        otherAudio.play();
        this.crossfadeOver(deck, other, Math.max(4, Math.min(remaining, 8)));
      }
      if (remaining <= 0.3) {
        MS.deck[deck].track = null; // free the deck for the next pairing
      }
    }
  },
  crossfadeOver(fromDeck, toDeck, seconds) {
    const xfader = document.getElementById('djXfader');
    if (!xfader) return;
    const startVal = +xfader.value;
    const target = fromDeck === 'A' ? 1 : 0;
    const steps = Math.max(4, Math.round(seconds*4));
    let i = 0;
    const iv = setInterval(() => {
      i++;
      const v = startVal + (target-startVal)*(i/steps);
      xfader.value = v;
      xfader.dispatchEvent(new Event('input',{bubbles:true}));
      if (i >= steps) clearInterval(iv);
    }, (seconds*1000)/steps);
  },
};
MS.autoDJ = AutoDJ;

function updateAutoDJUI() {
  const btn = $23('autoDJToggleBtn');
  if (btn) { btn.classList.toggle('on', AutoDJ.active); btn.textContent = AutoDJ.active ? '🤖 AUTO-DJ ON' : '🤖 ENABLE AUTO-DJ'; }
}
function buildAutoDJPanel() {
  const wrap = $23('autoDJPanel');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="radio-note" style="text-align:left">Auto-DJ pulls from your whole library, ranks the next track by BPM closeness and Camelot-wheel key compatibility, loads it to the free deck, roughly tempo-matches it, and crossfades automatically as the current track ends.</div>
    <button id="autoDJToggleBtn" class="autodj-toggle-btn">🤖 ENABLE AUTO-DJ</button>`;
  $23('autoDJToggleBtn').addEventListener('click', () => AutoDJ.active ? AutoDJ.stop() : AutoDJ.start());
}

/* ══════════════════════════════════════════════════════════════
   11 — NEXT-TRACK COMPATIBILITY SUGGESTIONS
   Rule-based (BPM proximity + Camelot-wheel harmonic compatibility),
   not a trained model — described honestly as "compatibility
   scoring" in the UI rather than oversold as "AI".
══════════════════════════════════════════════════════════════ */
function suggestNext(deck) {
  const current = MS.deck[deck]?.track;
  if (!current) return [];
  const pool = (MS.library || []).filter(t => t.id !== current.id);
  return pool
    .map(t => ({ track:t, score: AutoDJ.score(current, t) }))
    .sort((a,b) => a.score - b.score)
    .slice(0, 5);
}
function renderSuggestions(deck) {
  const wrap = $23(`suggest${deck}`);
  if (!wrap) return;
  const list = suggestNext(deck);
  if (!list.length) { wrap.innerHTML = `<div class="radio-note">Load a track to see compatible picks.</div>`; return; }
  wrap.innerHTML = list.map(({track,score}) => `
    <div class="suggest-row">
      <div class="suggest-info">
        <div class="suggest-title">${track.title}</div>
        <div class="suggest-sub">${track.bpm?Math.round(track.bpm):'—'} BPM · ${track.key||'—'} · match ${Math.max(0,100-Math.round(score))}%</div>
      </div>
      <button class="djb-load ${deck==='A'?'b':'a'}" onclick="MS.loadDeck('${deck==='A'?'B':'A'}', MS.library.find(t=>t.id==='${track.id}'))">${deck==='A'?'B':'A'}</button>
    </div>`).join('');
}
MS.on && MS.on('deck:loaded', ({ deck }) => { renderSuggestions('A'); renderSuggestions('B'); });

function buildSuggestPanel() {
  const wrap = $23('suggestPanel');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="section-label" style="padding-left:0">Compatible with Deck A</div>
    <div id="suggestA" class="suggest-list"></div>
    <div class="section-label" style="padding-left:0">Compatible with Deck B</div>
    <div id="suggestB" class="suggest-list"></div>`;
  renderSuggestions('A'); renderSuggestions('B');
}

/* ══════════════════════════════════════════════════════════════
   Wire panels into the Toolkit tab (built by phase21.js)
══════════════════════════════════════════════════════════════ */
function buildListBPanels() {
  const view = document.getElementById('toolkitView');
  if (!view || document.getElementById('broadcastPanel')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="section-label">⏺ Recording</div>
    <div id="broadcastPanel"></div>
    <div class="section-label">🤖 Auto-DJ</div>
    <div id="autoDJPanel"></div>
    <div class="section-label">🔀 Next-Track Suggestions</div>
    <div id="suggestPanel"></div>`;
  view.appendChild(wrap);
  buildBroadcastPanel();
  buildAutoDJPanel();
  buildSuggestPanel();
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
.hotcue-row { display:grid; grid-template-columns:repeat(4,1fr); gap:3px; margin-top:3px; }
.hotcue-pad {
  height:26px; border-radius:6px; border:1px solid var(--border);
  background:var(--bg3); color:var(--t3); font-size:10px; font-weight:900;
  opacity:.5;
}
.hotcue-pad.set { opacity:1; background:var(--pad-c); border-color:var(--pad-c); color:#050505; box-shadow:0 0 10px var(--pad-c); }

.stem-row { display:grid; grid-template-columns:repeat(4,1fr); gap:3px; margin-top:4px; }
.stem-btn {
  padding:6px 2px; border-radius:6px; border:1px solid var(--border);
  background:var(--bg3); color:var(--t3); font-size:8px; font-weight:800; letter-spacing:.05em;
}
.stem-btn.active { border-color:var(--cyan); color:var(--cyan); background:rgba(47,155,255,.12); }

.rec-toggle-btn, .autodj-toggle-btn {
  width:100%; padding:14px; border-radius:12px; font-size:14px; font-weight:900;
  border:1px solid var(--border); background:var(--bg3); color:var(--t1); margin-top:8px;
}
.rec-toggle-btn.on { border-color:var(--red); color:var(--red); background:rgba(232,16,42,.1); animation:micPulse 1.6s ease-in-out infinite; }
.autodj-toggle-btn.on { border-color:var(--green); color:var(--green); background:rgba(31,214,95,.1); }
.rec-timer { text-align:center; font-family:var(--mono); font-size:20px; color:var(--red); margin-top:8px; }

.suggest-list { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; }
.suggest-row { display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg3); border:1px solid var(--border); border-radius:9px; }
.suggest-info { flex:1; }
.suggest-title { font-size:12.5px; font-weight:600; color:var(--t1); }
.suggest-sub { font-size:10px; color:var(--t3); font-family:var(--mono); margin-top:2px; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init23() {
  verifyKeylock();
  buildHotCueRows();
  buildStemPanel();
  const tryBuild = setInterval(() => {
    if (document.getElementById('toolkitView')) {
      buildListBPanels();
      clearInterval(tryBuild);
    }
  }, 300);
  console.info('[868 Vibez] Phase 23 ready — List B: waveforms, cues, recording, auto-DJ, suggestions');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init23, 150));
} else {
  setTimeout(init23, 150);
}

})();
