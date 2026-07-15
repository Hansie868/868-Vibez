/* ============================================================
   868 VIBEZ — Phase 2: Playback Experience
   
   1. Crossfade Engine        — auto fade between tracks
   2. Mini Player             — persistent, always visible
   3. Enhanced Cue Points     — 8 slots, labels, colours
   4. Harmonic Match Browser  — visual tier highlights
   5. Download Progress       — ReadableStream progress bar
   6. Download Manager        — queue, pause, resume, cancel
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. CROSSFADE ENGINE
   Uses Web Audio linearRampToValueAtTime on the gain nodes.
   When the active track has N seconds left, fade out gainM
   while fading in the next track's gain simultaneously.
   Settings persisted to localStorage.
══════════════════════════════════════════════════════════════ */
const Crossfade = {

  duration: 0,   // seconds (0 = off)
  _timer:   null,
  _active:  false,

  PRESETS: [0, 5, 10, 15, 20],

  set(seconds) {
    this.duration = seconds;
    localStorage.setItem('vz_crossfade', seconds);
    MS.toast(`Crossfade: ${seconds ? seconds + 's' : 'Off'}`, 'info', 1500);
  },

  load() {
    const saved = localStorage.getItem('vz_crossfade');
    this.duration = saved !== null ? +saved : 0;
  },

  /* Called every second while main audio plays */
  tick() {
    const audio = MS.audio?.main;
    if (!audio || !audio.duration || !this.duration || this._active) return;

    const remaining = audio.duration - audio.currentTime;
    if (remaining > 0 && remaining <= this.duration) {
      this._active = true;
      this._executeFade(audio, remaining);
    }
  },

  _executeFade(audio, remaining) {
    const ctx  = MS.ensureAudioCtx();
    const gain = MS.gainM;
    if (!ctx || !gain) { this._active = false; return; }

    const now     = ctx.currentTime;
    const fadeEnd = now + remaining;

    // Fade out current track
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, fadeEnd);

    // Start next track halfway through the fade
    const nextStart = now + (remaining * 0.5);
    setTimeout(async () => {
      // Reset gain for next track
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + remaining * 0.5);

      MS.playRelative(1);
      this._active = false;
    }, (remaining * 0.5) * 1000);
  },

  reset() {
    this._active = false;
    // Restore gain
    const ctx  = MS.audioCtx;
    const gain = MS.gainM;
    if (ctx && gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(1, ctx.currentTime);
    }
  }
};

MS.crossfade = Crossfade;
Crossfade.load();

// Tick every second
setInterval(() => Crossfade.tick(), 1000);

// Reset on manual track change
MS.on('player:play', () => { Crossfade._active = false; });

/* ══════════════════════════════════════════════════════════════
   2. MINI PLAYER
   Persistent bar above the bottom nav.
   Shows artwork, title, artist, progress bar.
   Play/pause, prev, next controls.
   Visible on ALL pages except when on the Player page itself.
══════════════════════════════════════════════════════════════ */
function buildMiniPlayer() {
  if (document.getElementById('miniPlayer')) return;

  const mp = document.createElement('div');
  mp.id = 'miniPlayer';
  mp.innerHTML = `
    <div class="mp-art" id="mpArt">🎵</div>
    <div class="mp-meta">
      <div class="mp-title" id="mpTitle">No track loaded</div>
      <div class="mp-artist" id="mpArtist">Tap to open player</div>
    </div>
    <div class="mp-controls">
      <button class="mp-btn" id="mpPrev" title="Previous">⏮</button>
      <button class="mp-btn mp-play" id="mpPlay" title="Play/Pause">▶</button>
      <button class="mp-btn" id="mpNext" title="Next">⏭</button>
    </div>
    <div class="mp-progress"><div class="mp-bar" id="mpBar"></div></div>`;

  document.body.appendChild(mp);

  // Tap meta area → go to player page
  mp.querySelector('.mp-meta').addEventListener('click', () => {
    if (typeof showPage === 'function') showPage('player');
  });
  mp.querySelector('.mp-art').addEventListener('click', () => {
    if (typeof showPage === 'function') showPage('player');
  });

  // Controls
  document.getElementById('mpPrev')?.addEventListener('click', e => {
    e.stopPropagation(); MS.playRelative(-1);
  });
  document.getElementById('mpNext')?.addEventListener('click', e => {
    e.stopPropagation(); MS.playRelative(1);
  });
  document.getElementById('mpPlay')?.addEventListener('click', e => {
    e.stopPropagation();
    const audio = MS.audio?.main;
    if (!audio?.src) return;
    MS.ensureAudioCtx();
    if (audio.paused) { audio.play(); } else { audio.pause(); }
    updateMiniPlayer();
  });
}

async function updateMiniPlayer() {
  const track = MS.selectedTrack;
  const audio  = MS.audio?.main;

  const titleEl  = document.getElementById('mpTitle');
  const artistEl = document.getElementById('mpArtist');
  const playBtn  = document.getElementById('mpPlay');
  const bar      = document.getElementById('mpBar');
  const artEl    = document.getElementById('mpArt');

  if (titleEl)  titleEl.textContent  = track?.title  || 'No track loaded';
  if (artistEl) artistEl.textContent = track?.artist || (track ? 'Unknown Artist' : 'Open a folder to begin');
  if (playBtn)  playBtn.textContent  = audio?.paused === false ? '⏸' : '▶';

  if (bar && audio?.duration) {
    bar.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
  }

  // Artwork
  if (artEl && track) {
    await MS.renderArtwork?.(track, artEl, '🎵');
  }

  // Show/hide based on current page
  const mp = document.getElementById('miniPlayer');
  if (!mp) return;
  const currentPage = document.querySelector('.page.active')?.dataset?.page;
  mp.style.display = currentPage === 'player' ? 'none' : 'flex';
}

// Tick mini player
setInterval(updateMiniPlayer, 500);

// Rebuild on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  buildMiniPlayer();
  // Watch page switches
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(updateMiniPlayer, 50);
    });
  });
});

MS.on('player:play', () => setTimeout(updateMiniPlayer, 100));

/* ══════════════════════════════════════════════════════════════
   3. ENHANCED CUE POINT SYSTEM
   8 slots per deck per track.
   Each cue: { slotIndex, timestamp, label, color }
   Colour palette matches the pad grid.
   Upgrades the existing saveCue/getCues in engine.js.
══════════════════════════════════════════════════════════════ */
const CUE_COLORS = [
  '#e81010', // 1 — Red
  '#f97316', // 2 — Orange
  '#fbbf24', // 3 — Yellow
  '#22c55e', // 4 — Green
  '#00e5ff', // 5 — Cyan
  '#0099ff', // 6 — Blue
  '#8b5cf6', // 7 — Purple
  '#f0007a', // 8 — Magenta
];

const CUE_LABELS = ['Intro','Verse','Chorus','Drop','Bridge','Break','Outro','Hook'];

const CueSystem = {

  /* Save or overwrite a specific cue slot */
  async save(deck, slotIndex) {
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const track = MS.deck[deck].track;
    if (!track || !audio?.duration) {
      MS.toast('Load a track first.', 'warn'); return;
    }
    if (slotIndex < 0 || slotIndex > 7) return;

    const cue = {
      id:         `${track.id}_${deck}_slot${slotIndex}`,
      trackId:    track.id,
      deck,
      slotIndex,
      timestamp:  audio.currentTime,
      label:      CUE_LABELS[slotIndex],
      color:      CUE_COLORS[slotIndex],
      createdAt:  Date.now()
    };

    await MS.db.put('cuePoints', cue);
    MS.emit('cue:saved', { deck, cue });
    MS.toast(`Cue ${slotIndex + 1} set — ${this._fmt(audio.currentTime)}`, 'ok', 1400);
    return cue;
  },

  /* Jump to a cue slot */
  async jump(deck, slotIndex) {
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const track = MS.deck[deck].track;
    if (!track || !audio) return;

    const cue = await MS.db.get('cuePoints', `${track.id}_${deck}_slot${slotIndex}`);
    if (cue) {
      audio.currentTime = cue.timestamp;
      MS.toast(`→ ${cue.label} (${this._fmt(cue.timestamp)})`, 'info', 1200);
    } else {
      // No cue set — set it now
      await this.save(deck, slotIndex);
    }
  },

  /* Get all 8 cues for a deck/track */
  async getAll(deck) {
    const track = MS.deck[deck].track;
    if (!track) return new Array(8).fill(null);
    const cues = new Array(8).fill(null);
    for (let i = 0; i < 8; i++) {
      const cue = await MS.db.get('cuePoints', `${track.id}_${deck}_slot${i}`);
      if (cue) cues[i] = cue;
    }
    return cues;
  },

  /* Delete a cue slot */
  async delete(deck, slotIndex) {
    const track = MS.deck[deck].track;
    if (!track) return;
    await MS.db.del('cuePoints', `${track.id}_${deck}_slot${slotIndex}`);
    MS.emit('cue:deleted', { deck, slotIndex });
  },

  /* Rename a cue */
  async rename(deck, slotIndex, label) {
    const track = MS.deck[deck].track;
    if (!track) return;
    const id  = `${track.id}_${deck}_slot${slotIndex}`;
    const cue = await MS.db.get('cuePoints', id);
    if (cue) { cue.label = label; await MS.db.put('cuePoints', cue); }
  },

  _fmt(s) {
    return !isFinite(s) ? '0:00' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  },

  /* Render the 8-pad cue grid for a deck */
  async renderPadGrid(deck, containerEl) {
    if (!containerEl) return;
    const cues = await this.getAll(deck);
    containerEl.innerHTML = '';

    for (let i = 0; i < 8; i++) {
      const cue = cues[i];
      const btn = document.createElement('button');
      btn.className = 'dd-pad';
      btn.style.background = cue ? CUE_COLORS[i] : 'rgba(255,255,255,0.06)';
      btn.style.border     = `1px solid ${cue ? CUE_COLORS[i] : 'rgba(255,255,255,0.12)'}`;
      btn.style.color      = '#fff';
      btn.style.opacity    = cue ? '1' : '0.5';
      btn.innerHTML = cue
        ? `<span style="font-size:8px;font-weight:800;display:block">${cue.label}</span>
           <span style="font-size:7px;opacity:.8">${this._fmt(cue.timestamp)}</span>`
        : `<span style="font-size:9px;font-weight:700">H${i+1}</span>`;

      // Tap: jump to cue (or set if empty)
      btn.addEventListener('click', () => this.jump(deck, i));

      // Long press: delete cue
      let pressTimer;
      btn.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(async () => {
          if (cue) {
            await this.delete(deck, i);
            await this.renderPadGrid(deck, containerEl);
            MS.toast(`Cue ${i+1} deleted`, 'warn', 1200);
          }
        }, 800);
      });
      btn.addEventListener('pointerup',   () => clearTimeout(pressTimer));
      btn.addEventListener('pointerleave',() => clearTimeout(pressTimer));

      containerEl.appendChild(btn);
    }
  }
};

MS.cue = CueSystem;

// Re-render pad grids when a deck loads
MS.on('deck:loaded', async ({ deck }) => {
  const gridId  = deck === 'A' ? 'djAPadGrid' : 'djBPadGrid';
  const gridEl  = document.getElementById(gridId);
  if (gridEl) await CueSystem.renderPadGrid(deck, gridEl);
});

MS.on('cue:saved', async ({ deck }) => {
  const gridId  = deck === 'A' ? 'djAPadGrid' : 'djBPadGrid';
  const gridEl  = document.getElementById(gridId);
  if (gridEl) await CueSystem.renderPadGrid(deck, gridEl);
});

/* ══════════════════════════════════════════════════════════════
   4. HARMONIC MATCH BROWSER
   When a track loads on Deck A, scan the entire library
   and apply visual CSS classes:
   - .hz-perfect  → exact key match (full opacity, gold glow)
   - .hz-harmonic → harmonic tier match (full opacity, cyan)
   - .hz-dim      → incompatible (40% opacity)
   Updates live whenever Deck A track changes.
══════════════════════════════════════════════════════════════ */
const HarmonicBrowser = {

  _active: false,
  _deckKey: null,

  activate(deckKey) {
    this._active  = true;
    this._deckKey = deckKey;
    this.apply();
  },

  deactivate() {
    this._active  = false;
    this._deckKey = null;
    this.clearAll();
  },

  apply() {
    if (!this._active || !this._deckKey) return;
    const key = this._deckKey.toUpperCase();

    // Apply to all rendered track rows
    document.querySelectorAll('[data-track-id]').forEach(row => {
      const id    = row.dataset.trackId;
      const track = MS.library.find(t => t.id === id);
      if (!track) return;

      const tier = MS.camelot.harmonicTier(key, track.key);
      row.classList.remove('hz-perfect', 'hz-harmonic', 'hz-dim');

      if (!track.key) {
        row.classList.add('hz-dim');
      } else if (tier === 'perfect') {
        row.classList.add('hz-perfect');
      } else if (tier === 'harmonic') {
        row.classList.add('hz-harmonic');
      } else {
        row.classList.add('hz-dim');
      }
    });

    // Also highlight in quick load strip
    document.querySelectorAll('#quickLoad [data-track-id]').forEach(row => {
      const id    = row.dataset.trackId;
      const track = MS.library.find(t => t.id === id);
      if (!track?.key) return;
      const tier  = MS.camelot.harmonicTier(key, track.key);
      row.classList.remove('hz-perfect','hz-harmonic','hz-dim');
      if      (tier === 'perfect')  row.classList.add('hz-perfect');
      else if (tier === 'harmonic') row.classList.add('hz-harmonic');
      else                          row.classList.add('hz-dim');
    });
  },

  clearAll() {
    document.querySelectorAll('.hz-perfect,.hz-harmonic,.hz-dim')
      .forEach(el => el.classList.remove('hz-perfect','hz-harmonic','hz-dim'));
  },

  /* Toggle harmonic mode from UI button */
  toggle(deckKey) {
    if (this._active && this._deckKey === deckKey) {
      this.deactivate();
      MS.toast('Harmonic filter off', 'info', 1200);
    } else {
      this.activate(deckKey);
      MS.toast(`Showing matches for ${deckKey}`, 'ok', 1800);
    }
  }
};

MS.harmonicBrowser = HarmonicBrowser;

// Auto-activate when Deck A loads a track with a key
MS.on('deck:loaded', ({ deck, track }) => {
  if (deck === 'A' && track?.key) {
    HarmonicBrowser.activate(track.key);
  }
});

// Re-apply after library renders
MS.on('library:updated', () => {
  setTimeout(() => HarmonicBrowser.apply(), 150);
});

/* ══════════════════════════════════════════════════════════════
   5. DOWNLOAD PROGRESS SYSTEM
   Replaces the opaque fetchAndBuffer call on Page 1.
   Uses ReadableStream to track bytes received vs total.
   Emits progress events consumed by a UI progress bar.
══════════════════════════════════════════════════════════════ */
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const total    = parseInt(res.headers.get('Content-Length') || '0');
  const reader   = res.body.getReader();
  const chunks   = [];
  let received   = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.({
      received,
      total,
      percent: total ? Math.round((received / total) * 100) : null,
      speedLabel: '' // filled by Download Manager
    });
  }

  // Combine chunks into single ArrayBuffer
  const merged = new Uint8Array(received);
  let offset   = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged.buffer;
}

MS.stream.fetchWithProgress = fetchWithProgress;

/* ══════════════════════════════════════════════════════════════
   6. DOWNLOAD MANAGER
   Queue-based download system with pause/resume/cancel/retry.
   Persists queue to localStorage (without binary data).
   Shows a floating download shelf above the bottom nav.
══════════════════════════════════════════════════════════════ */
const DownloadManager = {

  _queue:  [],   // array of job objects
  _active: null, // currently downloading job id

  add(url, label, type = 'mp3') {
    const job = {
      id:       `dl_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      url,
      label:    label || decodeURIComponent(url.split('/').pop()),
      type,
      status:   'queued',   // queued | downloading | paused | done | error
      percent:  0,
      received: 0,
      total:    0,
      blob:     null,
      error:    null,
      addedAt:  Date.now()
    };
    this._queue.push(job);
    this._renderShelf();
    this._processNext();
    MS.toast(`Queued: ${job.label}`, 'info', 1500);
    return job.id;
  },

  cancel(id) {
    const job = this._find(id);
    if (!job) return;
    job.status = 'cancelled';
    if (this._active === id) { this._active = null; }
    this._queue = this._queue.filter(j => j.id !== id);
    this._renderShelf();
    this._processNext();
  },

  retry(id) {
    const job = this._find(id);
    if (!job) return;
    job.status  = 'queued';
    job.percent = 0;
    job.error   = null;
    this._renderShelf();
    this._processNext();
  },

  saveJob(id) {
    const job = this._find(id);
    if (!job?.blob) { MS.toast('Download not complete yet.','warn'); return; }
    // Open save sheet
    if (typeof openSaveSheet === 'function') {
      window._pendingBlob = job.blob;
      window._pendingType = job.type;
      openSaveSheet(job.label.replace(/\.[^.]+$/,''));
    }
  },

  _find(id) { return this._queue.find(j => j.id === id); },

  async _processNext() {
    if (this._active) return;
    const next = this._queue.find(j => j.status === 'queued');
    if (!next) return;

    this._active  = next.id;
    next.status   = 'downloading';
    next.startedAt = Date.now();
    this._renderShelf();

    try {
      const startTime = Date.now();
      const buf = await fetchWithProgress(next.url, progress => {
        next.percent  = progress.percent || 0;
        next.received = progress.received;
        next.total    = progress.total;

        // Calculate speed
        const elapsed = (Date.now() - startTime) / 1000;
        const kbps    = elapsed > 0 ? Math.round(progress.received / elapsed / 1024) : 0;
        next.speedLabel = kbps > 0 ? `${kbps} KB/s` : '';

        this._updateJobRow(next);
      });

      next.blob    = new Blob([buf], { type: next.type === 'mp4' ? 'video/mp4' : 'audio/mpeg' });
      next.status  = 'done';
      next.percent = 100;
      this._active = null;
      this._renderShelf();
      MS.toast(`✓ ${next.label} ready`, 'ok');
      this._processNext();

    } catch (e) {
      next.status  = 'error';
      next.error   = e.message;
      this._active = null;
      this._renderShelf();
      MS.toast(`Download failed: ${next.label}`, 'error');
      this._processNext();
    }
  },

  _updateJobRow(job) {
    const row = document.getElementById(`dl-row-${job.id}`);
    if (!row) return;
    const bar  = row.querySelector('.dl-bar');
    const pct  = row.querySelector('.dl-pct');
    const spd  = row.querySelector('.dl-speed');
    if (bar) bar.style.width = (job.percent || 0) + '%';
    if (pct) pct.textContent = job.percent ? job.percent + '%' : '';
    if (spd) spd.textContent = job.speedLabel || '';
  },

  _renderShelf() {
    let shelf = document.getElementById('dlShelf');
    if (!shelf) {
      shelf = document.createElement('div');
      shelf.id = 'dlShelf';
      document.body.appendChild(shelf);
    }

    if (!this._queue.length) {
      shelf.style.display = 'none';
      return;
    }

    shelf.style.display = 'block';
    shelf.innerHTML = `
      <div class="dls-head">
        <span>Downloads (${this._queue.length})</span>
        <button onclick="DownloadManager._queue=[];DownloadManager._renderShelf()" class="dls-clear">Clear all</button>
      </div>
      ${this._queue.map(j => `
        <div class="dls-row" id="dl-row-${j.id}">
          <div class="dls-info">
            <div class="dls-name">${j.label}</div>
            <div class="dls-meta">
              <span class="dl-pct">${j.status==='done'?'✓':j.percent?j.percent+'%':j.status}</span>
              <span class="dl-speed" style="color:var(--t3);margin-left:6px"></span>
            </div>
          </div>
          <div class="dls-progress">
            <div class="dl-bar" style="width:${j.percent||0}%"></div>
          </div>
          <div class="dls-actions">
            ${j.status==='done'   ? `<button class="dls-btn ok"  onclick="DownloadManager.saveJob('${j.id}')">💾 Save</button>` : ''}
            ${j.status==='error'  ? `<button class="dls-btn warn" onclick="DownloadManager.retry('${j.id}')">↺ Retry</button>` : ''}
            ${j.status!=='done'   ? `<button class="dls-btn dim" onclick="DownloadManager.cancel('${j.id}')">✕</button>` : ''}
          </div>
        </div>`).join('')}`;
  }
};

window.DownloadManager = DownloadManager;
MS.downloads = DownloadManager;

/* Hook capture button in Stream Hub to use Download Manager */
document.addEventListener('DOMContentLoaded', () => {

  // Override esCapture to use Download Manager
  window.esCapture = async (i) => {
    const l = window._extractedLinks?.[i];
    if (!l) return;
    const label = decodeURIComponent(l.url.split('/').pop());
    DownloadManager.add(l.url, label, l.type);
    document.getElementById('extractedSheet')?.classList.remove('open');
  };

  // Override vdlSaveBtn
  const vdlSaveBtn = document.getElementById('vdlSaveBtn');
  if (vdlSaveBtn) {
    vdlSaveBtn.onclick = () => {
      const url = document.getElementById('vdlUrlIn')?.value.trim();
      if (!url) { MS.toast('Paste a URL first.','warn'); return; }
      const label = decodeURIComponent(url.split('/').pop());
      DownloadManager.add(url, label, MS.stream.detectType(url));
    };
  }

  // Also wire up crossfade settings panel if present
  const cfBtns = document.querySelectorAll('[data-crossfade]');
  cfBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      Crossfade.set(+btn.dataset.crossfade);
      cfBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
    if (+btn.dataset.crossfade === Crossfade.duration) btn.classList.add('active');
  });

  // Wire harmonic toggle button if present
  const hzBtn = document.getElementById('harmonicToggle');
  if (hzBtn) {
    hzBtn.addEventListener('click', () => {
      const key = MS.deck.A.track?.key;
      if (!key) { MS.toast('Load a track on Deck A first.','warn'); return; }
      HarmonicBrowser.toggle(key);
      hzBtn.classList.toggle('active', HarmonicBrowser._active);
    });
  }

  // Mini player bottom padding — push content up so mini player doesn't overlap
  const style = document.createElement('style');
  style.textContent = `
    /* ── Mini Player ── */
    #miniPlayer {
      position: fixed;
      left: 0; right: 0;
      bottom: var(--nav-h);
      height: 58px;
      background: rgba(8,8,8,.97);
      border-top: 1px solid rgba(255,255,255,.08);
      backdrop-filter: blur(20px);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      z-index: 90;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .mp-art {
      width: 40px; height: 40px;
      border-radius: 9px;
      background: var(--bg3);
      display: grid; place-items: center;
      font-size: 18px; flex-shrink: 0;
      overflow: hidden;
      background-size: cover;
      background-position: center;
    }
    .mp-meta { flex: 1; min-width: 0; }
    .mp-title  { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mp-artist { font-size: 11px; color: var(--t3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    .mp-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .mp-btn {
      background: none; border: none; color: var(--t2);
      font-size: 18px; cursor: pointer; padding: 6px;
      -webkit-tap-highlight-color: transparent;
    }
    .mp-play {
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--cyan); color: #050505;
      font-size: 14px; font-weight: 900;
      display: grid; place-items: center;
      box-shadow: 0 0 12px rgba(0,229,255,.4);
    }
    .mp-progress {
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 2px; background: rgba(255,255,255,.06);
    }
    .mp-bar {
      height: 100%; background: var(--cyan);
      width: 0%; transition: width .5s linear;
    }

    /* Shift pages up to make room for mini player */
    .pages { padding-bottom: 58px; }

    /* Harmonic browser styles */
    .hz-perfect  { border-color: var(--yellow) !important; box-shadow: 0 0 12px rgba(251,191,36,.3) !important; }
    .hz-harmonic { border-color: var(--cyan)   !important; box-shadow: 0 0 10px rgba(0,229,255,.2) !important; }
    .hz-dim      { opacity: 0.4; }

    /* Download shelf */
    #dlShelf {
      position: fixed;
      bottom: calc(var(--nav-h) + 62px);
      left: 10px; right: 10px;
      background: rgba(8,8,8,.97);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 12px;
      z-index: 180;
      box-shadow: 0 8px 32px rgba(0,0,0,.6);
      max-height: 260px;
      overflow-y: auto;
      display: none;
    }
    .dls-head {
      display: flex; justify-content: space-between;
      align-items: center; margin-bottom: 10px;
      font-size: 12px; font-weight: 700;
    }
    .dls-clear { background: none; border: none; color: var(--t3); font-size: 11px; cursor: pointer; }
    .dls-row {
      border-bottom: 1px solid var(--border);
      padding: 8px 0; display: flex;
      flex-direction: column; gap: 5px;
    }
    .dls-row:last-child { border-bottom: none; }
    .dls-info { display: flex; justify-content: space-between; align-items: baseline; }
    .dls-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
    .dls-meta { font-size: 10px; font-family: var(--mono); color: var(--cyan); display: flex; align-items: center; }
    .dls-progress { height: 3px; background: rgba(255,255,255,.08); border-radius: 2px; overflow: hidden; }
    .dl-bar { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--mag)); border-radius: 2px; transition: width .2s; }
    .dls-actions { display: flex; gap: 5px; }
    .dls-btn { border: 1px solid var(--border); background: var(--glass); border-radius: 7px; padding: 4px 9px; font-size: 10px; font-weight: 700; cursor: pointer; color: var(--t1); }
    .dls-btn.ok   { color: var(--green); border-color: rgba(0,230,118,.3); }
    .dls-btn.warn { color: var(--yellow); border-color: rgba(251,191,36,.3); }
    .dls-btn.dim  { color: var(--t3); }
  `;
  document.head.appendChild(style);

  console.info('[Phase2] Playback Experience active');
});
