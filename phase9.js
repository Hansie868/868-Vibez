/* ============================================================
   868 VIBEZ — Phase 9: Queue, Sleep Timer & Gapless Playback
   1. Play Queue       — add/reorder/remove, auto-advance
   2. Sleep Timer       — 15/30/45/60 min or end-of-track
   3. Gapless Preload    — next track buffers before current ends
   Uses our existing MS.db, MS.toast, #miniPlayer, Library tabs.
   No competing UI, no duplicate stores.
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. PLAY QUEUE ENGINE
   Stored in existing 'settings' store under id 'queue_main'
   (avoids a DB version bump — reuses what's already there).
══════════════════════════════════════════════════════════════ */
const Queue = {

  items: [], // [{ id, trackId, title, artist, addedAt }]

  async load() {
    try {
      const rec = await MS.db.get('settings', 'queue_main');
      this.items = rec?.items || [];
    } catch { this.items = []; }
    this._render();
    return this.items;
  },

  async _save() {
    try {
      await MS.db.put('settings', { id: 'queue_main', items: this.items, updatedAt: Date.now() });
    } catch {}
    this._render();
  },

  async add(track, mode = 'end') {
    if (!track?.id) return;
    const item = {
      id:      `${track.id}_${Date.now()}`,
      trackId: track.id,
      title:   track.title  || 'Unknown',
      artist:  track.artist || 'Unknown Artist',
      addedAt: Date.now()
    };
    if (mode === 'next') this.items.unshift(item);
    else this.items.push(item);
    await this._save();
    MS.toast(mode === 'next' ? '⏭ Play Next' : '➕ Added to Queue', 'ok', 1400);
  },

  async remove(itemId) {
    this.items = this.items.filter(i => i.id !== itemId);
    await this._save();
  },

  async move(itemId, dir) {
    const i = this.items.findIndex(x => x.id === itemId);
    if (i < 0) return;
    const j = Math.max(0, Math.min(this.items.length - 1, i + dir));
    if (i === j) return;
    const [item] = this.items.splice(i, 1);
    this.items.splice(j, 0, item);
    await this._save();
  },

  async clear() {
    this.items = [];
    await this._save();
    MS.toast('Queue cleared', 'info', 1200);
  },

  /* Called when current track ends — returns true if it advanced */
  async advance() {
    if (!this.items.length) return false;
    const next = this.items.shift();
    await this._save();
    const track = MS.library.find(t => t.id === next.trackId);
    if (track) { MS.playMain(track); return true; }
    return this.advance(); // skip missing tracks
  },

  async saveAsPlaylist(name) {
    if (!this.items.length) { MS.toast('Queue is empty.', 'warn'); return; }
    const playlistName = name || prompt('Playlist name:', 'My Queue');
    if (!playlistName) return;
    await MS.db.put('crates', {
      id:        `pl_${Date.now()}`,
      name:      playlistName,
      icon:      '🎶',
      isSmart:   false,
      auto:      false,
      trackIds:  this.items.map(i => i.trackId),
      createdAt: Date.now()
    });
    MS.toast(`Saved "${playlistName}" with ${this.items.length} tracks`, 'ok');
    MS.emit('crates:updated', null);
  },

  _render() {
    const list = document.getElementById('queueList');
    if (!list) return;
    if (!this.items.length) {
      list.innerHTML = `<div class="lib-empty" style="padding:32px 16px"><div class="lib-empty-icon">🎶</div><p>Queue is empty.<br>Add tracks from My Library.</p></div>`;
      return;
    }
    list.innerHTML = this.items.map((q, i) => `
      <div class="queue-row">
        <div class="queue-idx">${i + 1}</div>
        <div class="queue-meta">
          <div class="queue-title">${esc9(q.title)}</div>
          <div class="queue-sub">${esc9(q.artist)}</div>
        </div>
        <div class="queue-actions">
          <button class="q-btn" data-q-up="${q.id}">↑</button>
          <button class="q-btn" data-q-down="${q.id}">↓</button>
          <button class="q-btn q-remove" data-q-remove="${q.id}">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-q-up]').forEach(b => b.onclick = () => Queue.move(b.dataset.qUp, -1));
    list.querySelectorAll('[data-q-down]').forEach(b => b.onclick = () => Queue.move(b.dataset.qDown, 1));
    list.querySelectorAll('[data-q-remove]').forEach(b => b.onclick = () => Queue.remove(b.dataset.qRemove));

    const badge = document.getElementById('queueCountBadge');
    if (badge) { badge.textContent = this.items.length; badge.style.display = this.items.length ? '' : 'none'; }
  }
};

function esc9(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

MS.queue = Queue;

/* ══════════════════════════════════════════════════════════════
   2. SLEEP TIMER
   Pauses all three audio elements (main, deck A, deck B).
   Survives page navigation; cleared on manual cancel.
══════════════════════════════════════════════════════════════ */
const SleepTimer = {

  endsAt:   null,   // timestamp, or null
  mode:     null,   // 'duration' | 'endOfTrack' | null
  _interval: null,

  set(minutes) {
    this.clear();
    this.mode   = 'duration';
    this.endsAt = Date.now() + minutes * 60000;
    this._interval = setInterval(() => this._tick(), 1000);
    this._tick();
    MS.toast(`😴 Sleep in ${minutes} min`, 'ok', 1500);
  },

  setEndOfTrack() {
    this.clear();
    const audio = MS.audio?.main;
    if (!audio?.src) { MS.toast('No track playing.', 'warn'); return; }
    this.mode = 'endOfTrack';
    this._endHandler = () => {
      audio.pause();
      MS.audio?.A?.pause?.();
      MS.audio?.B?.pause?.();
      this.clear();
      MS.toast('😴 Sleep timer — playback stopped', 'info');
    };
    audio.addEventListener('ended', this._endHandler, { once: true });
    this._renderStatus('End of current track');
    MS.toast('😴 Sleep at end of track', 'ok', 1500);
  },

  clear() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this.endsAt = null;
    if (this.mode === 'endOfTrack' && this._endHandler && MS.audio?.main) {
      MS.audio.main.removeEventListener('ended', this._endHandler);
    }
    this.mode = null;
    this._renderStatus();
  },

  _tick() {
    if (this.mode !== 'duration' || !this.endsAt) return;
    const remaining = this.endsAt - Date.now();
    if (remaining <= 0) {
      MS.audio?.main?.pause?.();
      MS.audio?.A?.pause?.();
      MS.audio?.B?.pause?.();
      MS.toast('😴 Sleep timer — playback stopped', 'info');
      this.clear();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    this._renderStatus(`${mins}:${String(secs).padStart(2,'0')} remaining`);
  },

  _renderStatus(text) {
    const el  = document.getElementById('sleepStatus');
    const btn = document.getElementById('sleepIndicator');
    if (el) el.textContent = text || 'Sleep timer is off.';
    if (btn) btn.style.display = (this.mode ? '' : 'none');
  }
};

MS.sleepTimer = SleepTimer;

/* ══════════════════════════════════════════════════════════════
   3. GAPLESS PRELOAD ENGINE
   While the active track plays its last 8 seconds, silently
   pre-fetch and decode the next track's file into a blob URL
   so the transition has zero loading gap.
══════════════════════════════════════════════════════════════ */
const Gapless = {

  _preloadedUrl:   null,
  _preloadedTrack: null,
  _preloading:     false,
  PRELOAD_WINDOW:  8, // seconds before end to start preloading

  /* Determine what the "next" track would be without queue side-effects */
  async peekNext() {
    // Queue takes priority
    if (Queue.items.length) {
      const next = Queue.items[0];
      return MS.library.find(t => t.id === next.trackId) || null;
    }
    // Otherwise next in library order (mirrors playRelative(1) without shuffle)
    if (MS._shuffle) return null; // can't predict shuffle target
    const lib = MS.library;
    if (!lib.length || !MS.selectedTrack) return null;
    const i = lib.findIndex(t => t.id === MS.selectedTrack.id);
    if (i < 0) return null;
    return lib[(i + 1) % lib.length];
  },

  async tick() {
    const audio = MS.audio?.main;
    if (!audio?.duration || this._preloading) return;
    const remaining = audio.duration - audio.currentTime;
    if (remaining > this.PRELOAD_WINDOW || remaining <= 0) return;

    const next = await this.peekNext();
    if (!next || next.id === this._preloadedTrack?.id) return;
    if (next.source && next.source !== 'local' && next.source !== 'saved') return; // skip stream URLs

    this._preloading = true;
    try {
      const file = await MS.fileFromTrack(next);
      // Revoke any stale preload
      if (this._preloadedUrl) URL.revokeObjectURL(this._preloadedUrl);
      this._preloadedUrl   = URL.createObjectURL(file);
      this._preloadedTrack = next;
    } catch {
      this._preloadedUrl = null;
      this._preloadedTrack = null;
    } finally {
      this._preloading = false;
    }
  },

  /* Called by the patched playMain — returns a ready blob URL if available */
  consume(track) {
    if (this._preloadedTrack?.id === track.id && this._preloadedUrl) {
      const url = this._preloadedUrl;
      this._preloadedUrl   = null;
      this._preloadedTrack = null;
      return url;
    }
    return null;
  }
};

MS.gapless = Gapless;

// Tick gapless preload every second
setInterval(() => Gapless.tick(), 1000);

/* ══════════════════════════════════════════════════════════════
   PATCH playMain — use preloaded blob URL when available,
   advance queue on track end, advance gapless-aware.
══════════════════════════════════════════════════════════════ */
const _origPlayMain9 = MS.playMain;
MS.playMain = async function (track) {
  if (!track) return;
  MS.selectedTrack = track;
  const preloadedUrl = Gapless.consume(track);

  if (preloadedUrl) {
    try {
      const audio = MS.audio.main;
      if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.src = preloadedUrl;
      MS.ensureAudioCtx();
      if (!audio._msNode) MS.connectAudioEl(audio, MS.gainM);
      await audio.play();
      track.playCount  = (track.playCount || 0) + 1;
      track.lastPlayed = Date.now();
      await MS.db.put('tracks', track);
      MS.emit('player:play', track);
      return;
    } catch {
      // Fall through to normal path on any failure
    }
  }
  return _origPlayMain9(track);
};

/* Auto-advance through queue, fallback to normal playRelative */
document.addEventListener('DOMContentLoaded', () => {
  const audio = MS.audio?.main;
  if (!audio) return;
  audio.addEventListener('ended', async () => {
    const advanced = await Queue.advance();
    if (!advanced && MS._repeat !== true) {
      // Let existing playRelative(1)/shuffle logic in ui-upgrade.js handle it
      // (it's already bound to 'ended' elsewhere via repeat/shuffle patch)
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   UI — Queue tab in Library, Sleep Timer sheet, mini player hooks
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Add Queue tab to Library subtab bar ── */
  const libSubtabs = document.querySelector('#page-library .subtab-bar');
  if (libSubtabs && !libSubtabs.querySelector('[data-sub="queue"]')) {
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'queue';
    btn.innerHTML = `Queue <span id="queueCountBadge" style="display:none;background:var(--cyan);color:#050505;border-radius:8px;padding:1px 6px;font-size:9px;margin-left:4px;font-weight:800"></span>`;
    libSubtabs.appendChild(btn);
  }

  /* ── Queue subview ── */
  const libContent = document.querySelector('#page-library .lib-content');
  if (libContent && !document.getElementById('queueList')) {
    const queueView = document.createElement('div');
    queueView.dataset.subview = 'queue';
    queueView.style.cssText = 'display:none;flex-direction:column;height:100%';
    queueView.innerHTML = `
      <div style="display:flex;gap:8px;padding:14px 16px 8px;flex-shrink:0">
        <button id="queueAddCurrent" class="vz-btn sm primary" style="flex:1">➕ Add Current</button>
        <button id="queueSaveBtn" class="vz-btn sm" style="flex:1">💾 Save Playlist</button>
        <button id="queueClearBtn" class="vz-btn sm danger">Clear</button>
      </div>
      <div id="queueList" style="flex:1;overflow-y:auto;padding:0 16px 16px"></div>`;
    libContent.appendChild(queueView);
  }

  document.getElementById('queueAddCurrent')?.addEventListener('click', () => {
    if (!MS.selectedTrack) { MS.toast('Nothing playing.', 'warn'); return; }
    Queue.add(MS.selectedTrack);
  });
  document.getElementById('queueSaveBtn')?.addEventListener('click', () => Queue.saveAsPlaylist());
  document.getElementById('queueClearBtn')?.addEventListener('click', () => {
    if (confirm('Clear the entire queue?')) Queue.clear();
  });

  /* ── Add "Queue" buttons to track rows (Player + Library) ── */
  function addQueueButtonsToRows() {
    document.querySelectorAll('.track-row:not([data-queue-btn-added])').forEach(row => {
      row.dataset.queueBtnAdded = '1';
      const deckBtns = row.querySelector('.track-deck-btns');
      if (!deckBtns) return;
      const qBtn = document.createElement('button');
      qBtn.className = 'load-deck-a';
      qBtn.style.cssText = 'background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.35);color:#8b5cf6';
      qBtn.textContent = '+Q';
      qBtn.title = 'Add to Queue';
      qBtn.onclick = e => {
        e.stopPropagation();
        const id    = row.dataset.trackId;
        const track = MS.library.find(t => t.id === id);
        if (track) Queue.add(track);
      };
      deckBtns.appendChild(qBtn);
    });
  }
  MS.on('library:updated', () => setTimeout(addQueueButtonsToRows, 250));
  setInterval(addQueueButtonsToRows, 2000); // catch dynamically re-rendered rows

  /* ── Sleep Timer sheet (reuses our save-sheet pattern) ── */
  const sleepSheet = document.createElement('div');
  sleepSheet.className = 'save-sheet';
  sleepSheet.id = 'sleepSheet';
  sleepSheet.innerHTML = `
    <div class="save-card">
      <h3>😴 Sleep Timer</h3>
      <div id="sleepStatus" style="font-size:12px;color:var(--t3);margin-bottom:14px">Sleep timer is off.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <button class="vz-btn primary sleep-opt" data-min="15">15 min</button>
        <button class="vz-btn primary sleep-opt" data-min="30">30 min</button>
        <button class="vz-btn primary sleep-opt" data-min="45">45 min</button>
        <button class="vz-btn primary sleep-opt" data-min="60">60 min</button>
      </div>
      <button class="vz-btn" id="sleepEndOfTrack" style="width:100%;margin-bottom:8px">⏹ End of Current Track</button>
      <div style="display:flex;gap:8px">
        <button class="vz-btn danger" id="sleepClearBtn" style="flex:1">Clear Timer</button>
        <button class="vz-btn" id="sleepCloseBtn" style="flex:1">Close</button>
      </div>
    </div>`;
  document.body.appendChild(sleepSheet);

  sleepSheet.querySelectorAll('.sleep-opt').forEach(btn => {
    btn.onclick = () => { SleepTimer.set(+btn.dataset.min); sleepSheet.classList.remove('open'); };
  });
  document.getElementById('sleepEndOfTrack')?.addEventListener('click', () => { SleepTimer.setEndOfTrack(); sleepSheet.classList.remove('open'); });
  document.getElementById('sleepClearBtn')?.addEventListener('click', () => { SleepTimer.clear(); MS.toast('Sleep timer cleared.', 'info'); });
  document.getElementById('sleepCloseBtn')?.addEventListener('click', () => sleepSheet.classList.remove('open'));

  /* ── Sleep timer trigger button in Now Playing action row ── */
  const npActions = document.querySelector('.np-actions');
  if (npActions && !document.getElementById('sleepIndicator')) {
    const btn = document.createElement('button');
    btn.className = 'np-action-btn';
    btn.id = 'sleepTriggerBtn';
    btn.innerHTML = `<span style="font-size:22px;position:relative">😴<span id="sleepIndicator" style="display:none;position:absolute;top:-2px;right:-4px;width:8px;height:8px;background:var(--cyan);border-radius:50%;box-shadow:0 0 6px var(--cyan)"></span></span><span>Sleep</span>`;
    btn.onclick = () => sleepSheet.classList.add('open');
    npActions.appendChild(btn);
  }

  /* ── Mini player: add Queue + Sleep quick buttons ── */
  function patchMiniPlayer() {
    const mp = document.getElementById('miniPlayer');
    if (!mp || mp.querySelector('.mp-q-btn')) return;
    const controls = mp.querySelector('.mp-controls');
    if (!controls) return;

    const qBtn = document.createElement('button');
    qBtn.className = 'mp-btn mp-q-btn';
    qBtn.innerHTML = `🎶<span id="mpQueueBadge" style="display:none;position:absolute;top:0;right:0;width:6px;height:6px;background:var(--cyan);border-radius:50%"></span>`;
    qBtn.style.position = 'relative';
    qBtn.title = 'Queue';
    qBtn.onclick = e => { e.stopPropagation(); if (typeof showPage === 'function') showPage('library'); setTimeout(() => document.querySelector('[data-sub="queue"]')?.click(), 100); };
    controls.insertBefore(qBtn, controls.firstChild);
  }
  setInterval(patchMiniPlayer, 1000);

  /* ── Phase 9 CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Queue rows */
    .queue-row {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 0; border-bottom: 1px solid var(--border);
    }
    .queue-idx {
      width: 26px; height: 26px; border-radius: 8px;
      background: var(--bg3); color: var(--cyan);
      font-size: 11px; font-weight: 800; font-family: var(--mono);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .queue-meta { flex: 1; min-width: 0; }
    .queue-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .queue-sub   { font-size: 11px; color: var(--t3); margin-top: 2px; }
    .queue-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .q-btn {
      width: 28px; height: 28px; border-radius: 8px;
      border: 1px solid var(--border); background: var(--bg3);
      color: var(--t2); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .q-remove { color: var(--red); border-color: rgba(255,77,109,.3); }

    /* Sleep indicator pulse */
    #sleepIndicator { animation: pip-pulse 1.5s ease-in-out infinite; }
  `;
  document.head.appendChild(style);

  // Load queue on boot
  MS.on('boot:complete', () => Queue.load());

  console.info('[Phase9] Queue, Sleep Timer & Gapless Playback active');
});
