/* ============================================================
   MediaSuite — Spatial Layout Controller
   Manages zone switching, deck drawer open/close,
   drag-to-resize, header metric updates, and all
   wiring between zones and the app engine.
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ══ Zone switcher ══ */
  const ZONES = ['vault', 'collection', 'archive'];

  function activateZone(name) {
    // Hub triggers
    document.querySelectorAll('.zone-trigger').forEach(b => {
      b.classList.toggle('active', b.dataset.zone === name);
    });
    // Zone panels
    ZONES.forEach(z => {
      const el = $(`zone-${z}`);
      if (el) el.classList.toggle('active', z === name);
    });
    // Render data for the activated zone
    if (name === 'collection' && window.MS) {
      window.renderTrackListPublic?.();
      window.MS.emit?.('zone:collection', null);
    }
    if (name === 'archive' && window.MS) {
      window.renderCratesPublic?.();
      window.renderAnalyticsPublic?.();
      window.renderSearchPublic?.();
    }
    if (name === 'vault') {
      window.MSVault?.loadCustomSites?.();
    }
    localStorage.setItem('ms_active_zone', name);
  }

  document.querySelectorAll('.zone-trigger').forEach(b =>
    b.addEventListener('click', () => activateZone(b.dataset.zone))
  );

  /* ══ Deck drawer ══ */
  const drawer = $('deckDrawer');
  const handle = $('drawerHandle');
  const arrow  = $('deckArrow');
  const toggle = $('deckToggle');
  let   drawerOpen = false;

  function setDrawer(open, silent) {
    drawerOpen = open;
    drawer?.classList.toggle('open', open);
    if (arrow) {
      arrow.textContent = open ? '▼' : '▲';
      arrow.classList.toggle('open', open);
    }
    if (toggle) toggle.classList.toggle('active', open);
    // Push workspace bottom up so content isn't hidden under drawer
    const ws = $('workspace');
    if (ws) ws.style.bottom = open ? (drawerOpen ? getDrawerHeight() + 'px' : '48px') : '48px';
    if (!silent) localStorage.setItem('ms_deck_open', open ? '1' : '0');
  }

  function getDrawerHeight() {
    return drawer ? drawer.offsetHeight : 48;
  }

  toggle?.addEventListener('click', () => setDrawer(!drawerOpen));
  handle?.addEventListener('click', () => setDrawer(!drawerOpen));

  // Touch swipe on handle to open/close
  let touchY0 = 0;
  handle?.addEventListener('touchstart', e => { touchY0 = e.touches[0].clientY; }, { passive: true });
  handle?.addEventListener('touchend', e => {
    const dy = touchY0 - e.changedTouches[0].clientY;
    if (dy > 30 && !drawerOpen) setDrawer(true);
    if (dy < -30 && drawerOpen) setDrawer(false);
  });

  /* ══ Workspace bottom padding when drawer opens ══ */
  const resizeObs = new ResizeObserver(() => {
    if ($('workspace') && drawerOpen) {
      $('workspace').style.bottom = getDrawerHeight() + 'px';
    }
  });
  if (drawer) resizeObs.observe(drawer);

  /* ══ Header metrics updater ══ */
  function updateMetrics() {
    const ms = window.MS;
    if (!ms) return;

    // System dot
    const dot = document.querySelector('.metric-dot');
    if (dot) {
      dot.style.background  = '#00e676';
      dot.style.boxShadow   = '0 0 6px #00e676';
    }

    // Track count
    const tc = $('trackCount');
    if (tc) tc.textContent = ms.library?.length ?? 0;

    // Folder short name
    const fs = $('folderShort');
    if (fs) fs.textContent = ms.folderHandle?.name
      ? ms.folderHandle.name.slice(0, 14)
      : '—';

    // collTrackCount
    const ctc = $('collTrackCount');
    if (ctc) ctc.textContent = `${ms.library?.length ?? 0} tracks`;

    // folderInfo
    const fi = $('folderInfo');
    if (fi) fi.textContent = ms.folderHandle?.name
      ? `Linked: ${ms.folderHandle.name}`
      : 'No folder linked.';

    // cacheCount
    ms.db?.all('waveforms').then(ws => {
      const cc = $('cacheCount');
      if (cc) cc.textContent = `${ws.length} waveforms`;
      const ds = $('dbStatus');
      if (ds) ds.textContent = `DB · ${ms.library?.length ?? 0} tracks · ${ws.length} waves`;
    }).catch(() => {});
  }
  setInterval(updateMetrics, 1500);

  /* ══ URL type badge ══ */
  $('vaultUrl')?.addEventListener('input', e => {
    const u = e.target.value.toLowerCase();
    const badge = $('urlTypeBadge');
    if (!badge) return;
    if (/\.mp4|\.webm/.test(u))              { badge.textContent = 'MP4'; badge.style.color = 'var(--magenta)'; }
    else if (/\.mp3|\.ogg|\.wav|\.m4a/.test(u)) { badge.textContent = 'MP3'; badge.style.color = 'var(--cyan)'; }
    else if (/icecast|shoutcast|stream/.test(u)) { badge.textContent = 'LIVE'; badge.style.color = 'var(--red)'; }
    else if (u.startsWith('http'))            { badge.textContent = 'PORTAL'; badge.style.color = 'var(--purple)'; }
    else                                      { badge.textContent = 'URL'; badge.style.color = 'var(--text3)'; }
  });

  /* ══ Vault sidebar item binding ══ */
  document.querySelectorAll('.vsb-item').forEach(item => {
    const url  = item.dataset.url;
    const type = item.dataset.type;
    if (!url) return;

    item.querySelector('.vsb-play')?.addEventListener('click', () => {
      $('vaultUrl').value = url;
      window.MSVault?.loadVaultUrl?.(url);
    });
    item.querySelector('.vsb-a')?.addEventListener('click', () => {
      window.MSVault?.loadStreamToDeck?.('A', url, type);
    });
    item.querySelector('.vsb-b')?.addEventListener('click', () => {
      window.MSVault?.loadStreamToDeck?.('B', url, type);
    });
    item.querySelector('.vsb-portal')?.addEventListener('click', () => {
      $('vaultUrl').value = url;
      window.MSVault?.loadVaultUrl?.(url);
    });
  });

  /* ══ Genre chip wiring ══ */
  document.querySelectorAll('.g-chip:not(.g-chip-add)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.g-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      if (window.MS) {
        window.MS._activeGenre = btn.dataset.genre || '';
        window.MS.emit?.('genre:filter', window.MS._activeGenre);
        window.renderTrackListPublic?.();
      }
    });
  });

  $('addGenreBtn')?.addEventListener('click', () => {
    const g = prompt('New genre name:');
    if (!g) return;
    const rail = $('genreStrip');
    if (!rail) return;
    const btn = document.createElement('button');
    btn.className    = 'g-chip';
    btn.dataset.genre = g;
    btn.textContent  = g;
    rail.insertBefore(btn, $('addGenreBtn'));
    btn.addEventListener('click', () => {
      document.querySelectorAll('.g-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      if (window.MS) { window.MS._activeGenre = g; window.MS.emit?.('genre:filter', g); window.renderTrackListPublic?.(); }
    });
    window.MS?.toast?.(`Genre "${g}" added.`, 'ok', 1500);
  });

  /* ══ View toggle ══ */
  $('viewList')?.addEventListener('click', () => {
    $('viewList').classList.add('active');
    $('viewGroup')?.classList.remove('active');
    window.renderTrackListPublic?.();
  });
  $('viewGroup')?.addEventListener('click', () => {
    $('viewGroup').classList.add('active');
    $('viewList')?.classList.remove('active');
    window.renderTrackListPublic?.();
  });

  /* ══ Quick-load filter ══ */
  $('qlFilter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#quickLoad .track').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  /* ══ Pitch sliders ══ */
  ['A','B'].forEach(d => {
    const sl  = $(`pitch${d}`);
    const lbl = $(`pitch${d}Val`);
    sl?.addEventListener('input', () => {
      const st = +sl.value;
      if (lbl) lbl.textContent = (st >= 0 ? '+' : '') + st.toFixed(1);
      const audio = d === 'A' ? $('audioA') : $('audioB');
      if (audio) audio.playbackRate = Math.pow(2, st / 12);
    });
  });

  /* ══ Channel faders ══ */
  $('faderA')?.addEventListener('input', e => {
    const a = $('audioA'); if (a) a.volume = +e.target.value;
  });
  $('faderB')?.addEventListener('input', e => {
    const b = $('audioB'); if (b) b.volume = +e.target.value;
  });

  /* ══ Deck harmonic badge updater ══ */
  function updateHarmonicBadges() {
    if (!window.MS) return;
    const tA = window.MS.deck?.A?.track;
    const tB = window.MS.deck?.B?.track;
    if (!tA || !tB) return;
    const tier = window.MS.camelot?.harmonicTier?.(tA.key, tB.key);
    const badgeA = $('deckAHarmonic');
    const badgeB = $('deckBHarmonic');
    if (!badgeA || !badgeB) return;
    if (tier === 'perfect') {
      const s = '⚡ PERFECT MIX';
      badgeA.textContent = badgeB.textContent = s;
      badgeA.style.cssText = badgeB.style.cssText = 'color:var(--cyan);background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.3);border-radius:8px;padding:2px 7px;';
    } else if (tier === 'harmonic') {
      const s = '♪ HARMONIC';
      badgeA.textContent = badgeB.textContent = s;
      badgeA.style.cssText = badgeB.style.cssText = 'color:var(--purple);background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:2px 7px;';
    } else {
      badgeA.textContent = badgeB.textContent = '';
    }
  }
  window.MS?.on?.('deck:loaded', updateHarmonicBadges);
  setInterval(updateHarmonicBadges, 2000);

  /* ══ Session buttons (deck drawer mirrors archive) ══ */
  $('startSession2')?.addEventListener('click', () => $('startSession')?.click());
  $('stopSession2')?.addEventListener('click',  () => $('stopSession')?.click());

  /* ══ Expose public render hooks ══ */
  window.renderCratesPublic    = () => window.MS && typeof renderCrates    === 'function' && renderCrates();
  window.renderAnalyticsPublic = () => window.MS && typeof renderAnalytics === 'function' && renderAnalytics();
  window.renderSearchPublic    = () => window.MS && typeof renderSearch    === 'function' && renderSearch();

  /* ══ MS event hooks ══ */
  function hookMS() {
    if (!window.MS) { setTimeout(hookMS, 100); return; }
    window.MS.on('library:updated', () => {
      window.renderTrackListPublic?.();
      window.renderQuickLoadPublic?.();
      updateMetrics();
    });
    window.MS.on('deck:loaded', () => {
      updateHarmonicBadges();
      // Update limiter status
      const lim = $('limiterStatus');
      if (lim) lim.textContent = window.mediaSuiteMasterLimiter ? '🟢 Limiter: ON' : '🔴 Limiter: Off';
    });
    window.MS.on('player:play', () => updateMetrics());
  }
  hookMS();

  /* ══ Restore last state ══ */
  document.addEventListener('DOMContentLoaded', () => {
    // Restore zone
    const lastZone = localStorage.getItem('ms_active_zone') || 'vault';
    activateZone(lastZone);
    // Restore deck drawer
    if (localStorage.getItem('ms_deck_open') === '1') {
      setTimeout(() => setDrawer(true, true), 300);
    }
    updateMetrics();
  });

  /* ══ Initial workspace bottom ══ */
  const ws = $('workspace');
  if (ws) ws.style.bottom = '48px';

  console.info('[Spatial] Layout controller ready.');
})();
