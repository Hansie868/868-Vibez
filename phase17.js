/* ============================================================
   868 VIBEZ — Phase 17: Battery Saver — Actually Wire It Up
   (Audit Fix)

   FOUND: Battery Saver mode (Phase 4) toggled a `body.battery-
   saver` CSS class that disables CSS animations/transitions —
   but the actual expensive, continuous work in this app is pure
   JavaScript requestAnimationFrame loops that have nothing to
   do with CSS:
     - app-ui.js: two platter-spin canvases redraw every frame,
       forever, on every page (not just when DJ page is visible)
     - engine.js: tickWaveheads() redraws both deck waveforms
       every frame, forever, same issue
   Neither loop checked battery saver state or page visibility
   at all. The setting existed and looked like it worked (the
   pulse-dot animations did stop), but the two genuinely
   expensive canvas redraws kept running at full 60fps
   regardless — exactly contradicting what the feature claimed
   to do, and what the original roadmap specifically asked for
   ("reduce waveform refresh rate, simplify visual active
   meters").

   FIX: Wrap both loops so they:
     1. Skip entirely when the DJ page isn't the active page
        (the platters and waveforms are invisible then anyway —
        this alone removes most of the waste on every other page)
     2. Throttle to ~12fps instead of 60fps when Battery Saver
        is active, rather than running unthrottled
   This is done by intercepting at the canvas draw level rather
   than touching engine.js/app-ui.js's existing loop structure,
   so neither file needs modification.
   ============================================================ */
'use strict';

const FrameThrottle = {
  batterySaverActive: false,
  THROTTLE_INTERVAL_MS: 1000 / 12, // ~12fps when saving battery, vs unthrottled 60fps
  _lastDrawTime: {},

  isDjPageVisible() {
    return document.querySelector('.page.active')?.dataset?.page === 'dj';
  },

  /* Returns true if the caller should SKIP this frame's expensive work */
  shouldSkip(key) {
    if (!this.isDjPageVisible()) return true; // nothing to see, don't bother drawing

    if (!this.batterySaverActive) return false; // full rate, no skip

    const now = performance.now();
    const last = this._lastDrawTime[key] || 0;
    if (now - last < this.THROTTLE_INTERVAL_MS) return true;
    this._lastDrawTime[key] = now;
    return false;
  }
};

MS.frameThrottle = FrameThrottle;

// Reflect the real Battery Saver state (Phase 4) into this throttle gate
MS.on('battery:saver', active => { FrameThrottle.batterySaverActive = active; });

/* ══════════════════════════════════════════════════════════════
   PATCH: gate the canvas drawing loops at their entry point —
   clearRect is always the FIRST call in every iteration of both
   the platter-spin and waveform draw loops (confirmed by reading
   app-ui.js and engine.js directly), so intercepting only that
   one call is sufficient to skip an entire frame's paint work
   cleanly, with no risk of a half-drawn frame from gating
   multiple operations independently.
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  ['platterA', 'platterB', 'waveA', 'waveB'].forEach(canvasId => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const originalGetContext = canvas.getContext.bind(canvas);
    let cachedCtx = null;
    let wrappedCtx = null;

    canvas.getContext = function (type, ...args) {
      const real = originalGetContext(type, ...args);
      if (type !== '2d' || !real) return real;
      if (real === cachedCtx && wrappedCtx) return wrappedCtx;
      cachedCtx = real;

      const skipKey = canvasId;
      let skipThisFrame = false;

      wrappedCtx = new Proxy(real, {
        get(target, prop) {
          if (prop === 'clearRect') {
            return function (...callArgs) {
              skipThisFrame = FrameThrottle.shouldSkip(skipKey);
              if (skipThisFrame) return; // skip the clear — and everything drawn after it
                                          // will paint on top of the existing frame, which
                                          // is visually identical to "frame held" since
                                          // nothing else changes when skipped
              return target.clearRect(...callArgs);
            };
          }
          // For every other drawing call, only skip if THIS frame was already
          // flagged to skip at the clearRect gate above — keeps all ops in a
          // single frame consistent with each other.
          const value = target[prop];
          if (typeof value !== 'function') return value;
          const expensiveOps = new Set(['fillRect','stroke','fill','drawImage']);
          if (!expensiveOps.has(prop)) return value.bind(target);
          return function (...callArgs) {
            if (skipThisFrame) return;
            return value.apply(target, callArgs);
          };
        }
      });

      return wrappedCtx;
    };
  });

  console.info('[Phase17] Battery Saver now actually throttles canvas redraw loops (was previously CSS-only)');
});

/* ══════════════════════════════════════════════════════════════
   AUDIT FIX: drag-to-reorder was fully built in phase10.js
   (MS.dragReorder.enable) but never actually wired to any UI —
   no track row anywhere ever got the .reorder-row class or a
   .reorder-handle child, so the feature was unreachable by any
   user despite being functionally complete. Wire it into the
   crate detail view (window._openCrate, from phase4.js) for
   MANUAL crates only — reordering a Smart Crate's contents
   wouldn't persist anyway since those are recomputed from rules
   on every library update.
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const _origOpenCrate17 = window._openCrate;
  if (typeof _origOpenCrate17 !== 'function') return;

  window._openCrate = async function (id) {
    await _origOpenCrate17(id);

    const crate = await MS.db.get('crates', id);
    if (!crate || crate.isSmart) return; // only manual crates are reorderable

    const list = document.getElementById('extractedList');
    if (!list) return;

    // Re-render rows with reorder handles, since the original render
    // (phase4.js) doesn't include them. Keep the same data/behaviour,
    // just add the handle + class that MS.dragReorder.enable() expects.
    const tracks = MS.library.filter(t => (crate.trackIds || []).includes(t.id));
    // Preserve the crate's stored order rather than library iteration order
    const ordered = (crate.trackIds || [])
      .map(tid => tracks.find(t => t.id === tid))
      .filter(Boolean);

    list.innerHTML = ordered.map(t => `
      <div class="es-item reorder-row" data-track-id="${t.id}" style="cursor:default">
        <span class="reorder-handle">⠿</span>
        <span class="si-pip pip-mp3"></span>
        <div class="es-name" style="flex:1" onclick="MS.playMain(MS.library.find(x=>x.id==='${t.id}'))" style="cursor:pointer">${(t.title||'Unknown').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}</div>
        <span style="font-size:10px;color:var(--t3);font-family:monospace">${t.bpm||'—'}</span>
        <button class="si-btn a" onclick="event.stopPropagation();MS.loadDeck('A',MS.library.find(x=>x.id==='${t.id}'))">A</button>
        <button class="si-btn b" onclick="event.stopPropagation();MS.loadDeck('B',MS.library.find(x=>x.id==='${t.id}'))">B</button>
      </div>`).join('');

    MS.dragReorder?.enable(list, id);
  };

  console.info('[Phase17] Drag-to-reorder wired into manual crate detail view (was built but unreachable)');
});
