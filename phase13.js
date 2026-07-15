/* ============================================================
   868 VIBEZ — Phase 13: Auto DJ Mode

   Sequences through a crate in harmonic/BPM-compatible order
   and crossfades between decks automatically — no new audio
   engines invented, purely orchestrates what already exists:
     - MS.camelot (harmonic scoring, Phase 0/engine.js)
     - MS.loadDeck / MS.toggleDeck (engine.js)
     - MS.gainA / MS.gainB (Web Audio gain nodes, engine.js)
     - MS.djXfader / crossfader (DJ page UI)
     - MS.syncDeck (BPM matching, engine.js)
   ============================================================ */
'use strict';

const AutoDJ = {

  active:       false,
  crateId:      null,
  playOrder:    [],   // ordered list of track objects for this session
  cursor:       -1,   // index into playOrder of the track currently "live"
  liveDeck:     null, // 'A' | 'B' — which deck is currently audible
  nextDeck:     null, // the deck loaded with the upcoming track
  FADE_SECONDS: 8,    // crossfade duration between tracks
  TRIGGER_BEFORE: 10, // start the transition this many seconds before track end
  _tickHandle:  null,
  _transitioning: false,

  /* ── Build the play order from a crate using harmonic + BPM scoring ── */
  async buildOrder(crateId) {
    const crate = await MS.db.get('crates', crateId);
    if (!crate) { MS.toast('Crate not found.', 'error'); return []; }

    const pool = MS.library.filter(t => (crate.trackIds || []).includes(t.id) && t.source !== 'stream');
    if (pool.length < 2) { MS.toast('Need at least 2 tracks with local audio.', 'warn'); return []; }

    // Greedy nearest-neighbour walk using the existing scoreTrack() engine —
    // start from the first track, always jump to the best-scoring unplayed
    // candidate (harmonic key match + close BPM + same genre weighting).
    const remaining = [...pool];
    const ordered   = [remaining.shift()];

    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      let bestIdx = 0, bestScore = -Infinity;
      remaining.forEach((candidate, i) => {
        const score = MS.camelot.scoreTrack(last, candidate);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      });
      ordered.push(remaining.splice(bestIdx, 1)[0]);
    }

    return ordered;
  },

  /* ── Start an Auto DJ session from a crate ── */
  async start(crateId) {
    if (this.active) { MS.toast('Auto DJ already running.', 'warn'); return; }

    this.playOrder = await this.buildOrder(crateId);
    if (this.playOrder.length < 2) return;

    this.crateId = crateId;
    this.active  = true;
    this.cursor  = 0;
    this.liveDeck = 'A';
    this.nextDeck = 'B';

    // Show the DJ page so the visual feedback is meaningful
    if (typeof showPage === 'function') showPage('dj');

    await MS.loadDeck('A', this.playOrder[0]);
    this._setCrossfaderRaw(0); // fully on A
    await MS.toggleDeck('A');

    this._renderStatus();
    this._startTick();
    MS.toast(`🤖 Auto DJ started — ${this.playOrder.length} tracks queued`, 'ok', 2500);
    MS.emit('autodj:started', { count: this.playOrder.length });
  },

  stop() {
    this.active = false;
    this._stopTick();
    this._transitioning = false;
    MS.toast('Auto DJ stopped.', 'info');
    this._renderStatus();
    MS.emit('autodj:stopped', null);
  },

  skipNext() {
    if (!this.active || this._transitioning) return;
    this._beginTransition(true); // force=true, ignore the time-remaining trigger window
  },

  /* ── Core loop: watch the live deck's remaining time ── */
  _startTick() {
    this._stopTick();
    this._tickHandle = setInterval(() => this._tick(), 500);
  },
  _stopTick() {
    if (this._tickHandle) clearInterval(this._tickHandle);
    this._tickHandle = null;
  },

  async _tick() {
    if (!this.active || this._transitioning) return;
    const audio = this.liveDeck === 'A' ? MS.audio.A : MS.audio.B;
    if (!audio?.duration) return;

    const remaining = audio.duration - audio.currentTime;
    this._renderStatus(remaining);

    if (remaining <= this.TRIGGER_BEFORE && remaining > 0) {
      this._beginTransition(false);
    }
  },

  /* ── Load the next track onto the standby deck and crossfade into it ── */
  async _beginTransition(force) {
    if (this._transitioning) return;
    if (this.cursor + 1 >= this.playOrder.length) {
      // End of session — let the current track finish, then stop
      this._transitioning = true;
      MS.toast('🤖 Last track in set — Auto DJ will stop after this.', 'info', 3000);
      const audio = this.liveDeck === 'A' ? MS.audio.A : MS.audio.B;
      audio?.addEventListener('ended', () => this.stop(), { once: true });
      return;
    }

    this._transitioning = true;
    const nextTrack = this.playOrder[this.cursor + 1];
    const incoming  = this.nextDeck;
    const outgoing  = this.liveDeck;

    try {
      await MS.loadDeck(incoming, nextTrack);

      // BPM-match the incoming deck to the outgoing one if both have BPM data
      const outTrack = this.playOrder[this.cursor];
      if (outTrack?.bpm && nextTrack?.bpm) {
        MS.syncDeck(incoming);
      }

      await MS.toggleDeck(incoming); // start playing under the (still silent) gain

      this._crossfadeOverTime(outgoing, incoming, this.FADE_SECONDS);

      // After the fade completes, stop the outgoing deck and rotate state
      setTimeout(async () => {
        const outAudio = outgoing === 'A' ? MS.audio.A : MS.audio.B;
        outAudio?.pause();
        this.cursor++;
        this.liveDeck = incoming;
        this.nextDeck = outgoing;
        this._transitioning = false;
        MS.emit('autodj:transition', { from: outTrack, to: nextTrack });
      }, this.FADE_SECONDS * 1000 + 200);

    } catch (e) {
      console.warn('[AutoDJ] Transition failed:', e.message);
      this._transitioning = false;
    }
  },

  /* ── Smooth crossfade between two decks using the existing gain nodes
       and, if present, the visual crossfader slider on the DJ page. ── */
  _crossfadeOverTime(fromDeck, toDeck, seconds) {
    const ctx = MS.audioCtx;
    if (!ctx) return;

    const fromGain = fromDeck === 'A' ? MS.gainA : MS.gainB;
    const toGain   = toDeck   === 'A' ? MS.gainA : MS.gainB;
    const now = ctx.currentTime;

    fromGain.gain.cancelScheduledValues(now);
    toGain.gain.cancelScheduledValues(now);
    fromGain.gain.setValueAtTime(fromGain.gain.value, now);
    toGain.gain.setValueAtTime(toGain.gain.value, now);
    fromGain.gain.linearRampToValueAtTime(0, now + seconds);
    toGain.gain.linearRampToValueAtTime(1, now + seconds);

    // Animate the visual crossfader slider in step, purely cosmetic feedback
    const slider = document.getElementById('djXfader');
    if (slider) {
      const startVal = toDeck === 'B' ? 0 : 1;
      const endVal   = toDeck === 'B' ? 1 : 0;
      const startT   = performance.now();
      const animate  = () => {
        if (!this.active) return;
        const t = Math.min(1, (performance.now() - startT) / (seconds * 1000));
        slider.value = startVal + (endVal - startVal) * t;
        if (t < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  },

  _setCrossfaderRaw(val) {
    const slider = document.getElementById('djXfader');
    if (slider) slider.value = val;
    // AUDIT FIX: this must match app-ui.js's manual crossfader handler
    // EXACTLY (Math.cos/Math.sin equal-power curve, no branching) — the
    // original branched version here hard-clamped each deck to gain=1
    // for half the slider range, which silently disagreed with the
    // manual handler and caused an audible level jump the instant a
    // user touched the slider mid-session.
    if (MS.gainA) MS.gainA.gain.value = Math.cos(val * Math.PI / 2);
    if (MS.gainB) MS.gainB.gain.value = Math.sin(val * Math.PI / 2);
  },

  /* ── Status panel rendering ── */
  _renderStatus(remaining) {
    const el = document.getElementById('autoDjStatus');
    if (!el) return;

    if (!this.active) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';

    const current = this.playOrder[this.cursor];
    const next     = this.playOrder[this.cursor + 1];
    const remStr   = remaining != null ? `${Math.floor(remaining/60)}:${String(Math.floor(remaining%60)).padStart(2,'0')}` : '—';

    el.innerHTML = `
      <div class="adj-pulse"></div>
      <div class="adj-info">
        <div class="adj-now">🤖 ${esc13(current?.title || '—')}</div>
        <div class="adj-next">${next ? `Next: ${esc13(next.title)} ${this._matchBadge(current, next)}` : 'Last track'} · ${remStr} left</div>
      </div>
      <button class="vz-btn sm" id="adjSkipBtn">Skip ⏭</button>
      <button class="vz-btn sm danger" id="adjStopBtn">Stop</button>`;

    document.getElementById('adjSkipBtn')?.addEventListener('click', () => this.skipNext());
    document.getElementById('adjStopBtn')?.addEventListener('click', () => this.stop());
  },

  _matchBadge(a, b) {
    if (!a?.key || !b?.key) return '';
    const tier = MS.camelot.harmonicTier(a.key, b.key);
    if (tier === 'perfect')  return '⚡';
    if (tier === 'harmonic') return '♪';
    return '';
  }
};

function esc13(s='') { return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

MS.autoDJ = AutoDJ;

/* ══════════════════════════════════════════════════════════════
   UI — status bar on DJ page, "Auto DJ" trigger on crate cards
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* Status bar injected at the top of the DJ twin-decks view */
  const twinDecks = document.getElementById('twinDecksView');
  if (twinDecks && !document.getElementById('autoDjStatus')) {
    const bar = document.createElement('div');
    bar.id = 'autoDjStatus';
    bar.className = 'adj-bar';
    bar.style.display = 'none';
    twinDecks.before(bar);
  }

  /* Add an "Auto DJ" button to every crate card opened from Library */
  const _origOpenCrate = window._openCrate;
  window._openCrate = async function (id) {
    if (_origOpenCrate) await _origOpenCrate(id);
    const sheet = document.getElementById('extractedSheet');
    const head  = sheet?.querySelector('.es-head');
    if (head && !document.getElementById('adjStartBtn')) {
      const btn = document.createElement('button');
      btn.id = 'adjStartBtn';
      btn.className = 'vz-btn sm primary';
      btn.textContent = '🤖 Auto DJ';
      btn.style.marginRight = '8px';
      btn.onclick = async () => {
        sheet.classList.remove('open');
        await AutoDJ.start(id);
      };
      head.insertBefore(btn, head.lastElementChild);
    }
  };

  /* Add Auto DJ entry point to Smart Crates list rendered in Library Playlists */
  MS.on('crates:updated', () => {
    setTimeout(() => {
      document.querySelectorAll('.playlist-item[onclick*="_openCrate"]').forEach(row => {
        if (row.dataset.adjWired) return;
        row.dataset.adjWired = '1';
      });
    }, 200);
  });

  /* Stop Auto DJ cleanly if user manually interacts with deck transport
     while it's running, to avoid fighting the engine. */
  ['djAPlay','djBPlay','djALoad','djBLoad'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      if (AutoDJ.active) {
        AutoDJ.stop();
        MS.toast('Auto DJ stopped — manual control taken.', 'info', 2000);
      }
    });
  });

  /* CSS */
  const style = document.createElement('style');
  style.textContent = `
    .adj-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; margin: 6px 8px 0;
      background: rgba(0,229,255,.06);
      border: 1px solid rgba(0,229,255,.25);
      border-radius: 12px;
      flex-shrink: 0;
    }
    .adj-pulse {
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--cyan); box-shadow: 0 0 8px var(--cyan);
      animation: pip-pulse 1.4s ease-in-out infinite;
      flex-shrink: 0;
    }
    .adj-info { flex: 1; min-width: 0; }
    .adj-now  { font-size: 12px; font-weight: 700; color: var(--cyan); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .adj-next { font-size: 10px; color: var(--t3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(style);

  console.info('[Phase13] Auto DJ Mode active');
});
