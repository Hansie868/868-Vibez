/* ============================================================
   868 VIBEZ — UI Visual Upgrade
   Wires artwork into every track row, upgrades Now Playing
   vinyl animation, favourite toggle, shuffle/repeat state.
   ============================================================ */
'use strict';

/* ══ Patch renderTrackList to include artwork ══ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Override renderTrackList with artwork-aware version ── */
  const _origRender = window.renderTrackList;
  window.renderTrackList = window.renderTrackListPublic = async function() {
    // Call original first to build DOM
    if (_origRender) _origRender();
    // Then inject artwork asynchronously
    await injectArtwork();
  };

  async function injectArtwork() {
    const rows = document.querySelectorAll('[data-track-id]');
    for (const row of rows) {
      const id    = row.dataset.trackId;
      const track = MS.library.find(t => t.id === id);
      if (!track?.artwork) continue;
      const art = row.querySelector('.tr-art');
      if (!art) continue;
      // Avoid re-fetching if already set
      if (art.dataset.artLoaded === id) continue;
      const url = await MS.artwork?.getUrl(id);
      if (url) {
        art.style.backgroundImage    = `url(${url})`;
        art.style.backgroundSize     = 'cover';
        art.style.backgroundPosition = 'center';
        art.dataset.artLoaded = id;
      }
    }
  }

  // Re-inject artwork when library updates
  MS.on('library:updated', () => setTimeout(injectArtwork, 200));

  /* ── Vinyl animation control ── */
  const disc = document.getElementById('npVinylDisc');
  const arm  = document.getElementById('npArm');

  function setVinylPlaying(playing) {
    if (disc) disc.classList.toggle('spinning', playing);
    if (arm)  arm.style.transform = playing ? 'rotate(20deg)' : 'rotate(28deg)';
  }

  // Tick vinyl state from audio
  setInterval(() => {
    const audio = MS.audio?.main;
    setVinylPlaying(audio ? !audio.paused : false);
  }, 500);

  /* ── Now Playing artwork update ── */
  async function updateNowPlayingArt(track) {
    const vinylArt = document.getElementById('npVinylArt');
    if (!vinylArt) return;

    if (!track?.artwork) {
      vinylArt.style.backgroundImage = '';
      vinylArt.textContent = '♪';
      return;
    }

    const url = await MS.artwork?.getUrl(track.id);
    if (url) {
      vinylArt.style.backgroundImage    = `url(${url})`;
      vinylArt.style.backgroundSize     = 'cover';
      vinylArt.style.backgroundPosition = 'center';
      vinylArt.textContent = '';
    } else {
      vinylArt.textContent = '♪';
    }

    // Also update mini player art
    const mpArt = document.getElementById('mpArt');
    if (mpArt && url) {
      mpArt.style.backgroundImage    = `url(${url})`;
      mpArt.style.backgroundSize     = 'cover';
      mpArt.style.backgroundPosition = 'center';
      mpArt.textContent = '';
    }
  }

  MS.on('player:play', track => {
    updateNowPlayingArt(track);
    updateFavBtn(track);
    setVinylPlaying(true);
  });

  /* ── Favourite toggle ── */
  window.toggleFavourite = async () => {
    const track = MS.selectedTrack;
    if (!track) { MS.toast('No track loaded.', 'warn'); return; }
    track.favorite = !track.favorite;
    await MS.db.put('tracks', track);
    const idx = MS.library.findIndex(t => t.id === track.id);
    if (idx >= 0) MS.library[idx] = track;
    updateFavBtn(track);
    MS.toast(track.favorite ? '★ Added to Favourites' : 'Removed from Favourites', 'ok', 1500);
  };

  function updateFavBtn(track) {
    const icon = document.getElementById('npFavIcon');
    const btn  = document.getElementById('npFavBtn');
    if (!icon || !btn) return;
    const isFav = track?.favorite;
    icon.textContent = isFav ? '♥' : '♡';
    icon.style.color = isFav ? 'var(--red)' : '';
    btn.classList.toggle('active', isFav);
  }

  /* ── Shuffle & Repeat ── */
  let _shuffle = false;
  let _repeat  = false;

  document.getElementById('npShuffleBtn')?.addEventListener('click', () => {
    _shuffle = !_shuffle;
    const btn = document.getElementById('npShuffleBtn');
    btn?.classList.toggle('active', _shuffle);
    MS.toast(_shuffle ? '⇄ Shuffle ON' : '⇄ Shuffle OFF', 'info', 1200);
    MS._shuffle = _shuffle;
  });

  document.getElementById('npRepeatBtn')?.addEventListener('click', () => {
    _repeat = !_repeat;
    const btn = document.getElementById('npRepeatBtn');
    btn?.classList.toggle('active', _repeat);
    MS.toast(_repeat ? '↺ Repeat ON' : '↺ Repeat OFF', 'info', 1200);
    MS._repeat = _repeat;
    const audio = MS.audio?.main;
    if (audio) audio.loop = _repeat;
  });

  // Override playRelative to handle shuffle
  const _origPlayRelative = MS.playRelative;
  MS.playRelative = function(dir) {
    if (_shuffle && MS.library.length > 1) {
      let idx;
      do { idx = Math.floor(Math.random() * MS.library.length); }
      while (MS.library.length > 1 && MS.library[idx]?.id === MS.selectedTrack?.id);
      MS.playMain(MS.library[idx]);
    } else {
      _origPlayRelative(dir);
    }
  };

  /* ── Upgrade DJ pad grid colours ── */
  // Re-render pads with proper solid colours after DOM is ready
  MS.on('deck:loaded', async ({ deck }) => {
    const gridId = deck === 'A' ? 'djAPadGrid' : 'djBPadGrid';
    const grid   = document.getElementById(gridId);
    if (!grid || !MS.cue) return;
    // Already handled by phase2 CueSystem.renderPadGrid
    // Just ensure the grid is visible with proper colours
    const pads = grid.querySelectorAll('.dd-pad');
    pads.forEach((pad, i) => {
      if (!pad.style.background || pad.style.background === 'rgba(255, 255, 255, 0.06)') {
        // Empty pad — use muted version of colour
        const colors = ['#e81010','#f97316','#fbbf24','#22c55e','#00e5ff','#0099ff','#8b5cf6','#f0007a'];
        pad.style.background = `${colors[i]}22`;
        pad.style.border     = `1px solid ${colors[i]}44`;
      }
    });
  });

  /* ── Upgrade track rows in lib view ── */
  MS.on('library:updated', () => {
    // Patch libTrackList rows too
    setTimeout(async () => {
      const rows = document.querySelectorAll('#libTrackList .track-row');
      for (const row of rows) {
        const id    = row.dataset.trackId;
        const track = MS.library.find(t => t.id === id);
        if (!track?.artwork) continue;
        const art = row.querySelector('.tr-art');
        if (!art || art.dataset.artLoaded === id) continue;
        const url = await MS.artwork?.getUrl(id);
        if (url) {
          art.style.backgroundImage    = `url(${url})`;
          art.style.backgroundSize     = 'cover';
          art.style.backgroundPosition = 'center';
          art.dataset.artLoaded = id;
        }
      }
    }, 300);
  });

  /* ── Stream source pip dots — animated live indicator ── */
  document.querySelectorAll('.pip-live').forEach(pip => {
    pip.style.animation = 'pip-pulse 1.2s ease-in-out infinite';
  });

  /* ── Better empty state for Now Playing ── */
  const npTitle  = document.getElementById('npTitle');
  const npArtist = document.getElementById('npArtist');
  if (npTitle && !MS.selectedTrack) {
    npTitle.textContent  = 'Nothing Playing';
    npArtist.textContent = 'Tap a track or stream to begin';
  }

  /* ── Video page — auto-play on load ── */
  const videoEl = document.getElementById('mainVideoEl');
  if (videoEl) {
    videoEl.addEventListener('canplay', () => {
      const ph = document.getElementById('videoPh');
      if (ph) ph.style.display = 'none';
    });
  }

  console.info('[UI Upgrade] Visual enhancements active');
});

/* ══ Also patch libTrackList render in app-ui.js ══ */
// Patch renderLibTrackList to include data-track-id and artwork
const _patchLibRender = () => {
  const orig = window.renderLibTrackList;
  if (!orig) { setTimeout(_patchLibRender, 500); return; }
  window.renderLibTrackList = async function() {
    orig();
    // Inject artwork into lib track rows
    setTimeout(async () => {
      const rows = document.querySelectorAll('#libTrackList [data-track-id]');
      for (const row of rows) {
        const id    = row.dataset.trackId;
        const track = MS.library.find(t => t.id === id);
        if (!track?.artwork) continue;
        const art = row.querySelector('.tr-art');
        if (!art || art.dataset.artLoaded === id) continue;
        const url = await MS.artwork?.getUrl(id);
        if (url) {
          art.style.backgroundImage    = `url(${url})`;
          art.style.backgroundSize     = 'cover';
          art.style.backgroundPosition = 'center';
          art.dataset.artLoaded = id;
        }
      }
    }, 200);
  };
};
_patchLibRender();
