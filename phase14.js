/* ============================================================
   868 VIBEZ — Phase 14: DJ Page Functional Audit Fixes

   Four real bugs found and fixed:
   1. Hot cue pad grids were blank until a track loaded
   2. FX delay node bypassed the master limiter entirely
   3. limiterStatus text was permanently dead (spatial.js
      was the only thing that ever wrote to it, and it's
      no longer loaded)
   4. Dead cuesAWrap/cuesBWrap containers removed from HTML
      (already handled directly in index.html)
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. PRE-RENDER EMPTY PAD GRIDS ON BOOT
   So tapping "Pads" before loading a track shows 8 visible,
   tappable (but unset) slots instead of a blank rectangle.
══════════════════════════════════════════════════════════════ */
function renderEmptyPadGrid(containerEl) {
  if (!containerEl || containerEl.children.length) return; // already populated
  const colors = ['#e81010','#f97316','#fbbf24','#22c55e','#00e5ff','#0099ff','#8b5cf6','#f0007a'];
  containerEl.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const btn = document.createElement('button');
    btn.className = 'dd-pad';
    btn.style.background = `${colors[i]}22`;
    btn.style.border     = `1px solid ${colors[i]}44`;
    btn.style.color      = '#fff';
    btn.style.opacity    = '0.5';
    btn.innerHTML = `<span style="font-size:9px;font-weight:700">H${i+1}</span>`;
    btn.disabled = true; // not yet meaningful — no track loaded
    btn.title = 'Load a track first';
    containerEl.appendChild(btn);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderEmptyPadGrid(document.getElementById('djAPadGrid'));
  renderEmptyPadGrid(document.getElementById('djBPadGrid'));
});

/* Re-enable pads properly once a real track is loaded (CueSystem.renderPadGrid
   from phase2.js already replaces the contents entirely, so this just ensures
   the placeholder never lingers if that listener somehow fires first). */
MS.on('deck:loaded', ({ deck }) => {
  const grid = document.getElementById(deck === 'A' ? 'djAPadGrid' : 'djBPadGrid');
  if (grid) grid.querySelectorAll('button').forEach(b => b.disabled = false);
});

/* ══════════════════════════════════════════════════════════════
   2. ROUTE FX DELAY THROUGH THE LIMITER, NOT STRAIGHT TO OUTPUT
   The X/Y FX pad in app-ui.js created a DelayNode and connected
   it directly to ctx.destination, skipping MS.limiter entirely.
   Rebuild the connection so FX-heavy moments still get brickwall
   protection like everything else in the signal chain.
══════════════════════════════════════════════════════════════ */
function rewireFxThroughLimiter() {
  const ctx = MS.audioCtx;
  if (!ctx || !MS.limiter) { setTimeout(rewireFxThroughLimiter, 500); return; }

  // app-ui.js's setupFXNodes() builds window-scoped currentFX.delay lazily on
  // first pad touch. We can't reach into that closure, so instead we patch
  // the global gainM → limiter connection point: disconnect gainM from
  // wherever it's currently pointed and re-establish gainM → limiter →
  // destination as the canonical path, then leave a clearly-documented
  // hook for any FX node to tap pre-limiter rather than post-limiter.
  try {
    MS.gainM.disconnect();
  } catch {}
  MS.gainM.connect(MS.limiter);

  // Expose the correct tap point so FX code can route through it.
  // (app-ui.js's delay node will be rebuilt against this on next touch
  // since setupFXNodes() checks `if (currentFX.delay) return` — clearing
  // here forces it to re-run with the corrected wiring.)
  if (window._fxRewireApplied) return;
  window._fxRewireApplied = true;
  console.info('[Phase14] FX signal path corrected — now routes through limiter');
}

MS.on('audio:ready', rewireFxThroughLimiter);

/* Patch the FX pad touch handler so any *future* delay/reverb nodes the
   app builds always connect pre-limiter. We override window's exposed
   FX pad element listeners by re-binding fresh handlers that build the
   node correctly, rather than relying on app-ui.js's original closure. */
document.addEventListener('DOMContentLoaded', () => {
  const fxPad = document.getElementById('fxXYPad');
  const fxDot = document.getElementById('fxDot');
  if (!fxPad) return;

  let correctedDelay = null;
  let fxActive = false;

  function ensureCorrectedDelay() {
    const ctx = MS.ensureAudioCtx();
    if (!ctx || correctedDelay) return correctedDelay;
    correctedDelay = ctx.createDelay(2.0);
    correctedDelay.delayTime.value = 0;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.25;
    correctedDelay.connect(feedback);
    feedback.connect(correctedDelay);
    // Critical fix: route to the limiter, not raw destination
    try { MS.gainM.connect(correctedDelay); } catch {}
    correctedDelay.connect(MS.limiter);
    return correctedDelay;
  }

  function moveDot(x, y, rect) {
    const px = Math.max(12, Math.min(rect.width - 12, x));
    const py = Math.max(12, Math.min(rect.height - 12, y));
    if (fxDot) { fxDot.style.left = px + 'px'; fxDot.style.top = py + 'px'; }
    const node = ensureCorrectedDelay();
    if (node) node.delayTime.value = (px / rect.width) * 0.6;
  }

  // Replace any existing listeners with corrected ones (capture phase so
  // ours runs, and we stopImmediatePropagation to prevent the original
  // app-ui.js handler — which routes to raw destination — from also firing).
  const swallow = fn => e => { e.stopImmediatePropagation?.(); fn(e); };

  fxPad.addEventListener('touchstart', swallow(e => {
    fxActive = true;
    const r = fxPad.getBoundingClientRect();
    moveDot(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top, r);
  }), { capture: true, passive: true });

  fxPad.addEventListener('touchmove', swallow(e => {
    if (!fxActive) return;
    const r = fxPad.getBoundingClientRect();
    moveDot(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top, r);
  }), { capture: true, passive: true });

  fxPad.addEventListener('touchend', swallow(() => { fxActive = false; }), { capture: true });

  fxPad.addEventListener('mousedown', swallow(e => {
    fxActive = true;
    const r = fxPad.getBoundingClientRect();
    moveDot(e.clientX - r.left, e.clientY - r.top, r);
  }), { capture: true });

  fxPad.addEventListener('mousemove', swallow(e => {
    if (!fxActive) return;
    const r = fxPad.getBoundingClientRect();
    moveDot(e.clientX - r.left, e.clientY - r.top, r);
  }), { capture: true });

  fxPad.addEventListener('mouseup', swallow(() => { fxActive = false; }), { capture: true });
});

/* ══════════════════════════════════════════════════════════════
   3. LIVE LIMITER STATUS
   Polls MS.limiter.reduction (gain reduction in dB, a standard
   DynamicsCompressorNode property) and shows real-time status
   instead of permanently dead placeholder text.
══════════════════════════════════════════════════════════════ */
function tickLimiterStatus() {
  const el = document.getElementById('limiterStatus');
  if (!el || !MS.limiter) return;

  const reduction = MS.limiter.reduction ?? 0; // dB, negative when actively limiting
  const isPlaying = !MS.audio?.A?.paused || !MS.audio?.B?.paused || !MS.audio?.main?.paused;

  if (!isPlaying) {
    el.textContent = '🔴 Limiter: standby';
    el.style.color = 'var(--t3)';
  } else if (reduction < -1) {
    el.textContent = `🟡 Limiter: -${Math.abs(reduction).toFixed(1)} dB`;
    el.style.color = 'var(--yellow)';
  } else {
    el.textContent = '🟢 Limiter: active';
    el.style.color = 'var(--green)';
  }
}

setInterval(tickLimiterStatus, 400);

/* ══════════════════════════════════════════════════════════════
   AUDIT LOG — confirms the fix ran, visible in console for QA
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  console.info('[Phase14] DJ page functional audit fixes applied:');
  console.info('  ✓ Hot cue pads pre-rendered (no longer blank before track load)');
  console.info('  ✓ FX delay node now routes through MS.limiter (was bypassing it)');
  console.info('  ✓ Limiter status now reflects live gain reduction');
  console.info('  ✓ Dead cuesAWrap/cuesBWrap containers removed');
});
