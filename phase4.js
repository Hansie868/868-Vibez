/* ============================================================
   868 VIBEZ — Phase 4: Smart Library + Mobile Experience

   1. Play Statistics Engine   — count, skip, time, streaks
   2. Smart Crates v2          — 8 auto-updating collections
   3. Favorites Intelligence   — top artists, genres, BPM ranges
   4. Swipe Navigation         — horizontal swipe between pages
   5. Battery Saver Mode       — reduce CPU when battery low
   6. Offline Recovery Engine  — restore state after crash/reload
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. PLAY STATISTICS ENGINE
   Tracks per-track: play count, skip count, total listen time,
   last played, date first played, consecutive play streak.
   Persisted to IndexedDB 'stats' store (separate from tracks).
══════════════════════════════════════════════════════════════ */
const Stats = {

  _store: 'stats',

  async get(trackId) {
    try {
      const s = await MS.db.get(this._store, trackId);
      return s || this._empty(trackId);
    } catch { return this._empty(trackId); }
  },

  _empty(id) {
    return {
      id,
      playCount:     0,
      skipCount:     0,
      totalSeconds:  0,
      firstPlayed:   null,
      lastPlayed:    null,
      streak:        0,
      lastStreakDate: null
    };
  },

  async recordPlay(trackId) {
    const s   = await this.get(trackId);
    const now = Date.now();
    s.playCount++;
    if (!s.firstPlayed) s.firstPlayed = now;
    s.lastPlayed = now;

    // Consecutive day streak
    const today     = new Date().toDateString();
    const lastDate  = s.lastStreakDate;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (lastDate === yesterday) { s.streak++; }
    else if (lastDate !== today) { s.streak = 1; }
    s.lastStreakDate = today;

    await MS.db.put(this._store, s);

    // Also update track record play count
    const track = MS.library.find(t => t.id === trackId);
    if (track) {
      track.playCount  = s.playCount;
      track.lastPlayed = now;
      await MS.db.put('tracks', track);
    }

    MS.emit('stats:play', { trackId, stats: s });
    return s;
  },

  async recordSkip(trackId, listenedSeconds) {
    const s = await this.get(trackId);
    s.skipCount++;
    s.totalSeconds += listenedSeconds || 0;
    await MS.db.put(this._store, s);
    MS.emit('stats:skip', { trackId, stats: s });
  },

  async recordListenTime(trackId, seconds) {
    if (!seconds || seconds < 2) return;
    const s = await this.get(trackId);
    s.totalSeconds = (s.totalSeconds || 0) + seconds;
    await MS.db.put(this._store, s);
  },

  async getAll() {
    try { return await MS.db.all(this._store); }
    catch { return []; }
  },

  async getTopTracks(limit = 10) {
    const all = await this.getAll();
    return all
      .filter(s => s.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);
  },

  async getTotalListenTime() {
    const all = await this.getAll();
    return all.reduce((sum, s) => sum + (s.totalSeconds || 0), 0);
  },

  formatTime(seconds) {
    if (seconds < 60)   return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
    return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
  }
};

MS.stats = Stats;

// Track listen time while playing
let _listenStart   = null;
let _listenTrackId = null;

MS.on('player:play', track => {
  // Save listen time for previous track
  if (_listenTrackId && _listenStart) {
    const secs = (Date.now() - _listenStart) / 1000;
    Stats.recordListenTime(_listenTrackId, secs);
  }
  if (track?.id) {
    Stats.recordPlay(track.id);
    _listenTrackId = track.id;
    _listenStart   = Date.now();
  }
});

// Detect skips — if track changes before 30% listened
document.addEventListener('DOMContentLoaded', () => {
  const audio = MS.audio?.main;
  if (!audio) return;
  audio.addEventListener('ended', () => {
    if (_listenTrackId && _listenStart) {
      Stats.recordListenTime(_listenTrackId, (Date.now()-_listenStart)/1000);
      _listenTrackId = null; _listenStart = null;
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   2. SMART CRATES v2
   8 auto-updating crates based on real play data.
   Refreshes whenever library updates or stats change.
══════════════════════════════════════════════════════════════ */
const SmartCrates = {

  DEFINITIONS: [
    {
      id:   'sc-most-played',
      name: '🔥 Most Played',
      icon: '🔥',
      build: async (lib) => {
        const stats = await Stats.getAll();
        const map   = Object.fromEntries(stats.map(s => [s.id, s.playCount || 0]));
        return lib
          .filter(t => (map[t.id] || 0) > 0)
          .sort((a,b) => (map[b.id]||0) - (map[a.id]||0))
          .slice(0, 50)
          .map(t => t.id);
      }
    },
    {
      id:   'sc-recently-played',
      name: '🕐 Recently Played',
      icon: '🕐',
      build: async (lib) => {
        return lib
          .filter(t => t.lastPlayed)
          .sort((a,b) => (b.lastPlayed||0) - (a.lastPlayed||0))
          .slice(0, 50)
          .map(t => t.id);
      }
    },
    {
      id:   'sc-recently-added',
      name: '✨ Recently Added',
      icon: '✨',
      build: async (lib) => {
        return lib
          .sort((a,b) => (b.dateImported||0) - (a.dateImported||0))
          .slice(0, 50)
          .map(t => t.id);
      }
    },
    {
      id:   'sc-high-energy',
      name: '⚡ High Energy',
      icon: '⚡',
      build: async (lib) => {
        return lib
          .filter(t => (t.energy||0) >= 7)
          .sort((a,b) => (b.energy||0) - (a.energy||0))
          .map(t => t.id);
      }
    },
    {
      id:   'sc-low-energy',
      name: '🌙 Chill Zone',
      icon: '🌙',
      build: async (lib) => {
        return lib
          .filter(t => t.energy !== null && t.energy <= 4)
          .sort((a,b) => (a.energy||0) - (b.energy||0))
          .map(t => t.id);
      }
    },
    {
      id:   'sc-favourites',
      name: '★ Favourites',
      icon: '★',
      build: async (lib) => {
        return lib.filter(t => t.favorite).map(t => t.id);
      }
    },
    {
      id:   'sc-unplayed',
      name: '💎 Never Played',
      icon: '💎',
      build: async (lib) => {
        return lib
          .filter(t => !t.playCount || t.playCount === 0)
          .sort((a,b) => (b.dateImported||0) - (a.dateImported||0))
          .map(t => t.id);
      }
    },
    {
      id:   'sc-high-bpm',
      name: '💨 High BPM 130+',
      icon: '💨',
      build: async (lib) => {
        return lib
          .filter(t => t.bpm && t.bpm >= 130)
          .sort((a,b) => (b.bpm||0) - (a.bpm||0))
          .map(t => t.id);
      }
    },
  ],

  async refresh() {
    const lib = MS.library;
    if (!lib?.length) return;

    for (const def of this.DEFINITIONS) {
      const trackIds = await def.build(lib);
      const existing = await MS.db.get('crates', def.id) || {};
      await MS.db.put('crates', {
        ...existing,
        id:       def.id,
        name:     def.name,
        icon:     def.icon,
        isSmart:  true,
        auto:     true,
        trackIds,
        updatedAt: Date.now()
      });
    }

    MS.emit('crates:updated', null);
  },

  async getAll() {
    try {
      const all = await MS.db.all('crates');
      return all.sort((a,b) => {
        // Auto crates first, then user crates
        if (a.auto && !b.auto) return -1;
        if (!a.auto && b.auto) return 1;
        return (a.name||'').localeCompare(b.name||'');
      });
    } catch { return []; }
  }
};

MS.smartCrates = SmartCrates;

// Refresh crates whenever library updates
MS.on('library:updated', () => SmartCrates.refresh());
MS.on('stats:play',      () => SmartCrates.refresh());

/* ══════════════════════════════════════════════════════════════
   3. FAVORITES INTELLIGENCE
   Analyses play history to surface top artists, genres,
   BPM preferences, and listening patterns.
══════════════════════════════════════════════════════════════ */
const FavoritesIntel = {

  async analyse() {
    const lib   = MS.library;
    const stats = await Stats.getAll();
    if (!lib.length || !stats.length) return null;

    // Build play-weighted track map
    const playMap = Object.fromEntries(stats.map(s => [s.id, s]));

    // Artist rankings
    const artistPlays = {};
    lib.forEach(t => {
      if (!t.artist || t.artist === 'Unknown Artist') return;
      const plays = playMap[t.id]?.playCount || 0;
      artistPlays[t.artist] = (artistPlays[t.artist] || 0) + plays;
    });
    const topArtists = Object.entries(artistPlays)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([name,plays]) => ({ name, plays }));

    // Genre rankings
    const genrePlays = {};
    lib.forEach(t => {
      if (!t.genre) return;
      const plays = playMap[t.id]?.playCount || 0;
      genrePlays[t.genre] = (genrePlays[t.genre] || 0) + plays;
    });
    const topGenres = Object.entries(genrePlays)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([name,plays]) => ({ name, plays }));

    // BPM preference — weighted average of played tracks
    const bpmTracks = lib.filter(t => t.bpm && (playMap[t.id]?.playCount||0) > 0);
    let bpmSum = 0, bpmWeight = 0;
    bpmTracks.forEach(t => {
      const w = playMap[t.id]?.playCount || 1;
      bpmSum    += t.bpm * w;
      bpmWeight += w;
    });
    const avgBpm = bpmWeight > 0 ? Math.round(bpmSum / bpmWeight) : null;

    // Listening time by hour of day
    const hourMap = new Array(24).fill(0);
    stats.forEach(s => {
      if (s.lastPlayed) hourMap[new Date(s.lastPlayed).getHours()]++;
    });
    const peakHour = hourMap.indexOf(Math.max(...hourMap));

    // Total stats
    const totalListenTime = await Stats.getTotalListenTime();

    return {
      topArtists,
      topGenres,
      avgBpm,
      peakHour,
      totalListenTime,
      totalPlays:  stats.reduce((a,s) => a+(s.playCount||0), 0),
      totalSkips:  stats.reduce((a,s) => a+(s.skipCount||0), 0),
      uniqueTracks: stats.filter(s => s.playCount > 0).length
    };
  },

  renderCard(report, containerEl) {
    if (!containerEl || !report) return;
    const fmtHour = h => {
      if (h === 0)  return 'Midnight';
      if (h < 12)   return `${h}am`;
      if (h === 12) return 'Noon';
      return `${h-12}pm`;
    };

    containerEl.innerHTML = `
      <div class="fi-section">
        <div class="fi-label">Top Artists</div>
        ${report.topArtists.length
          ? report.topArtists.map((a,i) => `
            <div class="fi-row">
              <span class="fi-rank">#${i+1}</span>
              <span class="fi-name">${a.name}</span>
              <span class="fi-val">${a.plays} plays</span>
            </div>`).join('')
          : '<div class="fi-empty">No play history yet</div>'}
      </div>
      <div class="fi-section">
        <div class="fi-label">Top Genres</div>
        ${report.topGenres.map(g => `
          <div class="fi-row">
            <span class="fi-name">${g.name}</span>
            <span class="fi-val">${g.plays} plays</span>
          </div>`).join('') || '<div class="fi-empty">No genre data</div>'}
      </div>
      <div class="fi-section">
        <div class="fi-label">Listening Profile</div>
        <div class="fi-row"><span>Avg BPM preference</span><span class="fi-val fi-hl">${report.avgBpm || '—'}</span></div>
        <div class="fi-row"><span>Peak listening hour</span><span class="fi-val fi-hl">${fmtHour(report.peakHour)}</span></div>
        <div class="fi-row"><span>Total listen time</span><span class="fi-val fi-hl">${Stats.formatTime(report.totalListenTime)}</span></div>
        <div class="fi-row"><span>Total plays</span><span class="fi-val">${report.totalPlays}</span></div>
        <div class="fi-row"><span>Tracks played</span><span class="fi-val">${report.uniqueTracks}</span></div>
      </div>`;
  }
};

MS.favIntel = FavoritesIntel;

/* ══════════════════════════════════════════════════════════════
   4. SWIPE NAVIGATION
   Horizontal touch swipe to move between the 5 pages.
   Threshold: 60px horizontal, <80px vertical drift.
   Velocity-aware: fast swipe triggers at 30px.
   Ignores swipes that start on scrollable elements.
══════════════════════════════════════════════════════════════ */
const SwipeNav = {

  PAGES:     ['stream','player','video','library','dj'],
  _touch:    { x:0, y:0, t:0 },
  _enabled:  true,

  bind() {
    const workspace = document.querySelector('.pages');
    if (!workspace) return;

    workspace.addEventListener('touchstart', e => {
      if (!this._enabled) return;
      // Ignore if touch started inside a scrollable element
      if (this._isScrollable(e.target)) return;
      const t = e.touches[0];
      this._touch = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });

    workspace.addEventListener('touchend', e => {
      if (!this._enabled) return;
      if (this._isScrollable(e.target)) return;
      const t    = e.changedTouches[0];
      const dx   = t.clientX - this._touch.x;
      const dy   = Math.abs(t.clientY - this._touch.y);
      const dt   = Date.now() - this._touch.t;
      const vel  = Math.abs(dx) / dt; // px/ms

      // Require mostly horizontal swipe
      if (dy > 80 || Math.abs(dx) < 30) return;

      // Threshold: 60px OR velocity > 0.4 px/ms
      if (Math.abs(dx) < 60 && vel < 0.4) return;

      const curr = this.PAGES.indexOf(
        document.querySelector('.page.active')?.dataset?.page || 'stream'
      );

      if (dx < 0 && curr < this.PAGES.length - 1) {
        // Swipe left → next page
        if (typeof showPage === 'function') showPage(this.PAGES[curr + 1]);
      } else if (dx > 0 && curr > 0) {
        // Swipe right → previous page
        if (typeof showPage === 'function') showPage(this.PAGES[curr - 1]);
      }
    }, { passive: true });
  },

  _isScrollable(el) {
    // Walk up DOM to check if inside a scroll container or interactive element
    let node = el;
    while (node && node !== document.body) {
      if (['INPUT','TEXTAREA','SELECT','CANVAS','IFRAME'].includes(node.tagName)) return true;
      if (node.classList?.contains('lib-content'))   return true;
      if (node.classList?.contains('stream-content')) return true;
      if (node.classList?.contains('track-list-view')) return true;
      if (node.classList?.contains('es-list'))        return true;
      if (node.classList?.contains('dls-row'))        return true;
      const style = window.getComputedStyle(node);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
      node = node.parentElement;
    }
    return false;
  },

  disable() { this._enabled = false; },
  enable()  { this._enabled = true; }
};

MS.swipeNav = SwipeNav;

/* ══════════════════════════════════════════════════════════════
   5. BATTERY SAVER MODE
   Listens to navigator.getBattery() (Chrome Android).
   Activates at < 20% battery OR when user enables manually.
   Reduces: waveform redraw rate, animations, canvas FPS.
══════════════════════════════════════════════════════════════ */
const BatterySaver = {

  active:      false,
  _level:      1,
  _charging:   true,
  THRESHOLD:   0.20,

  async init() {
    if (!('getBattery' in navigator)) return;
    try {
      const bat = await navigator.getBattery();
      this._update(bat);
      bat.addEventListener('levelchange',  () => this._update(bat));
      bat.addEventListener('chargingchange',() => this._update(bat));
    } catch {}
  },

  _update(bat) {
    this._level    = bat.level;
    this._charging = bat.charging;
    const shouldSave = !bat.charging && bat.level <= this.THRESHOLD;
    if (shouldSave && !this.active) this._activate();
    if (!shouldSave && this.active && !this._manualOverride) this._deactivate();
    this._updateBadge();
  },

  _manualOverride: false,
  toggle() {
    this._manualOverride = !this.active;
    if (this.active) this._deactivate(); else this._activate();
  },

  _activate() {
    this.active = true;
    document.body.classList.add('battery-saver');
    MS.emit('battery:saver', true);
    MS.toast(`🔋 Battery Saver ON (${Math.round(this._level*100)}%)`, 'warn', 2500);
  },

  _deactivate() {
    this.active = false;
    this._manualOverride = false;
    document.body.classList.remove('battery-saver');
    MS.emit('battery:saver', false);
  },

  _updateBadge() {
    const el = document.getElementById('batteryBadge');
    if (!el) return;
    const pct = Math.round(this._level * 100);
    el.textContent = `🔋 ${pct}%`;
    el.style.color = pct <= 20 ? 'var(--red)' : pct <= 50 ? 'var(--yellow)' : 'var(--t3)';
    el.style.display = '';
  }
};

MS.battery = BatterySaver;

/* ══════════════════════════════════════════════════════════════
   6. OFFLINE RECOVERY ENGINE
   Persists critical state to localStorage every 10s.
   On boot, detects dirty shutdown and offers to restore.
   Covers: current track, position, page, active crates.
══════════════════════════════════════════════════════════════ */
const OfflineRecovery = {

  KEY: 'vz_recovery',

  save() {
    try {
      const audio = MS.audio?.main;
      const snap  = {
        trackId:    MS.selectedTrack?.id   || null,
        position:   audio?.currentTime     || 0,
        page:       document.querySelector('.page.active')?.dataset?.page || 'stream',
        libraryLen: MS.library.length,
        timestamp:  Date.now(),
        dirty:      true  // cleared on clean shutdown
      };
      localStorage.setItem(this.KEY, JSON.stringify(snap));
    } catch {}
  },

  markClean() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      snap.dirty = false;
      localStorage.setItem(this.KEY, JSON.stringify(snap));
    } catch {}
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  async checkAndRestore() {
    const snap = this.load();
    if (!snap?.dirty || !snap.trackId) return false;

    // Only restore if crash was within 24 hours
    if (Date.now() - snap.timestamp > 86400000) return false;

    const track = MS.library.find(t => t.id === snap.trackId);
    if (!track) return false;

    // Restore page
    if (snap.page && typeof showPage === 'function') {
      showPage(snap.page);
    }

    // Show restore prompt (don't auto-play — requires user gesture)
    this._showRestorePrompt(track, snap.position);
    return true;
  },

  _showRestorePrompt(track, position) {
    const el = document.createElement('div');
    el.id = 'recoveryPrompt';
    el.style.cssText = `
      position:fixed; top:12px; left:12px; right:12px;
      background:rgba(8,8,8,.97); border:1px solid rgba(251,191,36,.35);
      border-radius:14px; padding:14px 16px; z-index:600;
      display:flex; align-items:center; gap:12px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);
      animation:slideDown .3s ease;
    `;
    const mins = String(Math.floor(position/60)).padStart(2,'0');
    const secs = String(Math.floor(position%60)).padStart(2,'0');
    el.innerHTML = `
      <span style="font-size:22px;flex-shrink:0">⚡</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--yellow)">Session Recovered</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${track.title} · ${mins}:${secs}
        </div>
      </div>
      <button onclick="OfflineRecovery._doRestore('${track.id}',${position})"
        style="background:var(--yellow);border:none;border-radius:9px;padding:7px 12px;font-size:11px;font-weight:800;color:#050505;cursor:pointer;flex-shrink:0">
        Restore
      </button>
      <button onclick="document.getElementById('recoveryPrompt')?.remove();OfflineRecovery.markClean()"
        style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer;padding:4px;flex-shrink:0">✕</button>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  },

  async _doRestore(trackId, position) {
    document.getElementById('recoveryPrompt')?.remove();
    const track = MS.library.find(t => t.id === trackId);
    if (!track) return;
    try {
      await MS.playMain(track);
      const audio = MS.audio?.main;
      if (audio && position > 2) {
        const seek = () => { audio.currentTime = position; audio.removeEventListener('canplay',seek); };
        audio.addEventListener('canplay', seek);
      }
      this.markClean();
      MS.toast('Session restored', 'ok');
    } catch (e) { MS.toast(e.message, 'error'); }
  }
};

window.OfflineRecovery = OfflineRecovery;
MS.recovery = OfflineRecovery;

// Auto-save every 10 seconds
setInterval(() => OfflineRecovery.save(), 10000);

// Mark clean on page unload
window.addEventListener('beforeunload', () => OfflineRecovery.markClean());
window.addEventListener('pagehide',     () => OfflineRecovery.markClean());

/* ══════════════════════════════════════════════════════════════
   UI WIRING — DOM Ready
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  /* ── Bind swipe navigation ── */
  SwipeNav.bind();

  /* ── Battery saver init ── */
  await BatterySaver.init();

  /* ── Offline recovery check ── */
  MS.on('boot:complete', async () => {
    await SmartCrates.refresh();
    await OfflineRecovery.checkAndRestore();
  });

  /* ── Upgrade Library page: add Stats + Favorites Intel tab ── */
  const subtabBar = document.querySelector('#page-library .subtab-bar');
  if (subtabBar) {
    // Add Stats and Insights tabs
    const statsTab    = document.createElement('button');
    statsTab.className = 'subtab';
    statsTab.dataset.sub = 'stats';
    statsTab.textContent = 'Stats';
    subtabBar.appendChild(statsTab);

    const insightsTab    = document.createElement('button');
    insightsTab.className = 'subtab';
    insightsTab.dataset.sub = 'insights';
    insightsTab.textContent = 'Insights';
    subtabBar.appendChild(insightsTab);

    // Stats sub-view
    const libContent = document.querySelector('#page-library .lib-content');
    if (libContent) {
      const statsView = document.createElement('div');
      statsView.dataset.subview = 'stats';
      statsView.style.cssText   = 'display:none;padding:16px;overflow-y:auto';
      statsView.id = 'statsView';
      statsView.innerHTML = `
        <div class="fi-section">
          <div class="fi-label">Library Overview</div>
          <div id="statsOverview"></div>
        </div>
        <div class="fi-section" style="margin-top:16px">
          <div class="fi-label">Top Tracks</div>
          <div id="statsTopTracks"></div>
        </div>`;
      libContent.appendChild(statsView);

      const insightsView = document.createElement('div');
      insightsView.dataset.subview = 'insights';
      insightsView.style.cssText   = 'display:none;padding:16px;overflow-y:auto';
      insightsView.id = 'insightsView';
      libContent.appendChild(insightsView);
    }
  }

  /* ── Upgrade smart crates in Library playlists view ── */
  MS.on('crates:updated', renderSmartCratesList);

  async function renderSmartCratesList() {
    const el = document.getElementById('playlistView');
    if (!el) return;

    const crates     = await SmartCrates.getAll();
    const autoCrates = crates.filter(c => c.auto);

    // Rebuild playlist view with smart crates
    el.innerHTML = `
      <div class="new-pl-btn" onclick="window._createUserPlaylist?.()">
        <div class="new-pl-icon">＋</div>
        <div class="pl-info">
          <div class="pl-name">New Playlist</div>
          <div class="pl-count">Create a custom collection</div>
        </div>
      </div>
      <div class="section-label">Smart Collections</div>
      ${autoCrates.map(c => `
        <div class="playlist-item" onclick="window._openCrate?.('${c.id}')">
          <div class="pl-art" style="font-size:22px">${c.icon||'📁'}</div>
          <div class="pl-info">
            <div class="pl-name">${c.name}</div>
            <div class="pl-count">${(c.trackIds||[]).length} tracks</div>
          </div>
          <span style="color:var(--t3);font-size:18px">›</span>
        </div>`).join('')}`;

    // Wire crate open
    window._openCrate = async (id) => {
      const crate  = await MS.db.get('crates', id);
      if (!crate) return;
      const tracks = MS.library.filter(t => (crate.trackIds||[]).includes(t.id));
      // Reuse extracted sheet as a track list
      const sheet  = document.getElementById('extractedSheet');
      const list   = document.getElementById('extractedList');
      const count  = document.getElementById('extractedCount');
      if (!sheet||!list) return;
      if (count) count.textContent = `${crate.name} · ${tracks.length} tracks`;
      list.innerHTML = tracks.map(t => `
        <div class="es-item" style="cursor:pointer" onclick="MS.playMain(MS.library.find(x=>x.id==='${t.id}'))">
          <span class="si-pip pip-mp3"></span>
          <div class="es-name" style="flex:1">${t.title||'Unknown'}</div>
          <span style="font-size:10px;color:var(--t3);font-family:monospace">${t.bpm||'—'}</span>
          <button class="si-btn a" onclick="event.stopPropagation();MS.loadDeck('A',MS.library.find(x=>x.id==='${t.id}'))">A</button>
          <button class="si-btn b" onclick="event.stopPropagation();MS.loadDeck('B',MS.library.find(x=>x.id==='${t.id}'))">B</button>
        </div>`).join('');
      sheet.classList.add('open');
    };
  }

  /* ── Stats view render ── */
  async function renderStatsView() {
    const overviewEl   = document.getElementById('statsOverview');
    const topTracksEl  = document.getElementById('statsTopTracks');
    if (!overviewEl) return;

    const totalTime  = await Stats.getTotalListenTime();
    const topTracks  = await Stats.getTopTracks(10);

    overviewEl.innerHTML = `
      <div class="fi-row"><span>Total tracks</span><span class="fi-val">${MS.library.length}</span></div>
      <div class="fi-row"><span>Tracks played</span><span class="fi-val">${MS.library.filter(t=>t.playCount>0).length}</span></div>
      <div class="fi-row"><span>Total listen time</span><span class="fi-val fi-hl">${Stats.formatTime(totalTime)}</span></div>
      <div class="fi-row"><span>Favourites</span><span class="fi-val">${MS.library.filter(t=>t.favorite).length}</span></div>`;

    if (topTracksEl) {
      topTracksEl.innerHTML = topTracks.length
        ? topTracks.map((s,i) => {
            const track = MS.library.find(t => t.id === s.id);
            if (!track) return '';
            return `<div class="fi-row">
              <span class="fi-rank">#${i+1}</span>
              <span class="fi-name" style="flex:1">${track.title}</span>
              <span class="fi-val">${s.playCount}×</span>
            </div>`;
          }).join('')
        : '<div class="fi-empty">No plays recorded yet</div>';
    }
  }

  /* ── Insights view render ── */
  async function renderInsightsView() {
    const el = document.getElementById('insightsView');
    if (!el) return;
    const report = await FavoritesIntel.analyse();
    if (!report) {
      el.innerHTML = '<div class="fi-empty" style="padding:24px">Play some tracks to build your listening profile.</div>';
      return;
    }
    FavoritesIntel.renderCard(report, el);
  }

  /* ── Hook subtab clicks for new tabs ── */
  document.querySelectorAll('#page-library .subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.sub;
      // Show correct subview
      document.querySelectorAll('#page-library [data-subview]').forEach(v => {
        v.style.display = v.dataset.subview === t ? 'block' : 'none';
      });
      if (t === 'stats')    renderStatsView();
      if (t === 'insights') renderInsightsView();
    });
  });

  /* ── Battery badge in Library ── */
  const libTopbar = document.querySelector('.lib-topbar');
  if (libTopbar) {
    const badge = document.createElement('span');
    badge.id = 'batteryBadge';
    badge.style.cssText = 'font-size:10px;display:none;margin-left:auto';
    libTopbar.appendChild(badge);

    const saverBtn = document.createElement('button');
    saverBtn.className = 'vz-btn sm';
    saverBtn.title = 'Battery Saver Mode';
    saverBtn.textContent = '🔋';
    saverBtn.onclick = () => {
      BatterySaver.toggle();
      saverBtn.style.borderColor = BatterySaver.active ? 'var(--yellow)' : '';
    };
    libTopbar.appendChild(saverBtn);
  }

  /* ── Phase 4 CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Smart crates / stats */
    .fi-section  { margin-bottom: 16px; }
    .fi-label    { font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--t3); margin-bottom: 8px; }
    .fi-row      { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
    .fi-row:last-child { border-bottom: none; }
    .fi-rank     { font-size: 10px; font-family: monospace; color: var(--t3); width: 20px; flex-shrink: 0; }
    .fi-name     { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-val      { font-family: monospace; color: var(--t2); font-size: 11px; white-space: nowrap; }
    .fi-hl       { color: var(--cyan); font-weight: 700; }
    .fi-empty    { font-size: 12px; color: var(--t3); padding: 8px 0; }

    /* Battery saver — reduce animations */
    body.battery-saver * { animation-duration: 0s !important; transition-duration: 0.05s !important; }
    body.battery-saver .ambient { display: none; }
    body.battery-saver #miniPlayer .mp-bar { transition: none !important; }

    /* Recovery prompt slide-down */
    @keyframes slideDown {
      from { transform: translateY(-20px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }

    /* Swipe hint indicator */
    .swipe-indicator {
      position: fixed; bottom: calc(var(--nav-h) + 70px);
      left: 50%; transform: translateX(-50%);
      display: flex; gap: 6px; z-index: 50;
      pointer-events: none;
    }
    .swipe-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(255,255,255,.2);
      transition: background .2s, transform .2s;
    }
    .swipe-dot.active {
      background: var(--cyan);
      transform: scale(1.4);
      box-shadow: 0 0 6px var(--cyan);
    }
  `;
  document.head.appendChild(style);

  /* ── Page indicator dots (shows swipe-ability) ── */
  const dots = document.createElement('div');
  dots.className = 'swipe-indicator';
  dots.id = 'swipeDots';
  SwipeNav.PAGES.forEach((p, i) => {
    const dot = document.createElement('div');
    dot.className = 'swipe-dot';
    dot.dataset.page = p;
    dots.appendChild(dot);
  });
  document.body.appendChild(dots);

  function updateDots(page) {
    document.querySelectorAll('.swipe-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.page === page);
    });
  }

  // Hook into showPage
  const _origShowPage = window.showPage;
  window.showPage = function(name) {
    _origShowPage?.(name);
    updateDots(name);
    // Disable swipe on DJ page (landscape handles its own touch)
    if (name === 'dj') SwipeNav.disable();
    else SwipeNav.enable();
  };

  // Init dots
  updateDots(document.querySelector('.page.active')?.dataset?.page || 'stream');

  // Hide dots after 3 seconds of no interaction
  let dotTimer;
  document.addEventListener('touchstart', () => {
    dots.style.opacity = '1';
    clearTimeout(dotTimer);
    dotTimer = setTimeout(() => { dots.style.opacity = '0'; }, 3000);
  }, { passive: true });
  dots.style.opacity = '0';
  dots.style.transition = 'opacity .3s';

  console.info('[Phase4] Smart Library + Mobile Experience active');
});

/* ══════════════════════════════════════════════════════════════
   DB VERSION UPGRADE — add 'stats' store
══════════════════════════════════════════════════════════════ */
(function upgradeDBPhase4() {
  async function ensureStatsStore() {
    try {
      const db = await MS.db.open();
      if (db.objectStoreNames.contains('stats')) return;
      db.close();
      return new Promise((res, rej) => {
        const version = 3;
        const req = indexedDB.open('868VibezDB', version);
        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('stats'))
            d.createObjectStore('stats', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const d = req.result;
          // Rebind MS.db methods to new db instance
          const put = (s,v)  => new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess=()=>res(v); r.onerror=()=>rej(r.error); });
          const get = (s,k)  => new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
          const del = (s,k)  => new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).delete(k); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
          const all = s      => new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
          MS.db = { put, get, del, all, open: ()=>Promise.resolve(d) };
          console.info('[Phase4] DB v3 — stats store ready');
          res(d);
        };
        req.onerror = () => rej(req.error);
      });
    } catch (e) {
      console.warn('[Phase4] DB upgrade failed:', e.message);
    }
  }
  ensureStatsStore();
})();
