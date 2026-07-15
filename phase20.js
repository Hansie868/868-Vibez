/* ============================================================
   868 VIBEZ — Phase 20: DJ Console Foundation
   Item A on the DJ roadmap — everything else (waveform coloring,
   pads, recording, MIDI, etc.) builds on top of this.

   1. Screen-fit layout — console sized to exactly one landscape
      screenful, platters demoted so the waveform (already sticky
      from phase18) becomes the primary touch surface.
   2. Touch-friendly faders — every <input type=range> on the DJ
      page gets a padded invisible "wide zone" wrapped around it,
      so dragging works from anywhere near the fader, not just the
      thin visual thumb. The native input stays the source of
      truth, so every existing listener (phase18, app-ui.js) keeps
      working completely untouched.
   3. Bigger transport + pro-row buttons, deck accent colors.
   ============================================================ */
'use strict';

(function () {
const $20 = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════
   1 — WIDE TOUCH-ZONE FADER WRAPPER
   Wraps a range input in a padded div and forwards drag gestures
   from anywhere in that padded zone to the real input, then fires
   a native 'input' event so nothing downstream needs to change.
══════════════════════════════════════════════════════════════ */
function wrapFader(input, opts = {}) {
  if (!input || input._vzWrapped) return;
  input._vzWrapped = true;
  const vertical = opts.vertical ?? (input.closest('.dm-fader-col') != null || input.classList.contains('dm-fader'));

  const zone = document.createElement('div');
  zone.className = 'vz-fader-zone' + (vertical ? ' vertical' : '');
  input.parentNode.insertBefore(zone, input);
  zone.appendChild(input);

  const setFromClientPos = (clientX, clientY) => {
    const r = zone.getBoundingClientRect();
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    let frac;
    if (vertical) {
      frac = 1 - (clientY - r.top) / r.height;      // top = max
    } else {
      frac = (clientX - r.left) / r.width;
    }
    frac = Math.max(0, Math.min(1, frac));
    const step = parseFloat(input.step) || 1;
    let val = min + frac * (max - min);
    val = Math.round(val / step) * step;
    val = Math.max(min, Math.min(max, val));
    if (+input.value !== val) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  let dragging = false;
  const start = e => {
    dragging = true;
    zone.classList.add('dragging');
    const t = e.touches ? e.touches[0] : e;
    setFromClientPos(t.clientX, t.clientY);
    e.preventDefault();
  };
  const move = e => {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    setFromClientPos(t.clientX, t.clientY);
    e.preventDefault();
  };
  const end = () => { dragging = false; zone.classList.remove('dragging'); };

  zone.addEventListener('touchstart', start, { passive: false });
  zone.addEventListener('touchmove',  move,  { passive: false });
  zone.addEventListener('touchend',   end);
  zone.addEventListener('mousedown',  start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup',   end);

  // Double-tap the zone (not the input) resets to a sensible default
  if (opts.resetValue != null) {
    let lastTap = 0;
    zone.addEventListener('touchend', () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        input.value = opts.resetValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      lastTap = now;
    });
  }
}

function wrapAllFaders() {
  const page = $20('page-dj');
  if (!page) return;
  // Mixer faders + crossfader (vertical column faders + horizontal xfader)
  ['djFaderA','djFaderB','djMaster'].forEach(id => wrapFader($20(id), { vertical: true, resetValue: id === 'djMaster' ? 1 : 1 }));
  wrapFader($20('djXfader'), { vertical: false, resetValue: 0.5 });
  // Pitch sliders (horizontal)
  wrapFader($20('pitchA'), { vertical: false, resetValue: 0 });
  wrapFader($20('pitchB'), { vertical: false, resetValue: 0 });
  // Pro EQ + filter sliders injected by phase18 (may load after this,
  // so also re-scan periodically for newly-added ones)
  page.querySelectorAll('.dj-eq-slider').forEach(el => wrapFader(el, { vertical: false, resetValue: 0 }));
  page.querySelectorAll('.dj-filter-row input[type=range]').forEach(el => wrapFader(el, { vertical: false, resetValue: 0 }));
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init20() {
  wrapAllFaders();
  // Pro-row controls (phase18) inject asynchronously after audio:ready —
  // rescan a few times early on to catch them without polling forever.
  let tries = 0;
  const rescan = setInterval(() => {
    wrapAllFaders();
    if (++tries > 20) clearInterval(rescan);
  }, 400);
  console.info('[868 Vibez] Phase 20 ready — DJ console foundation');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init20, 50));
} else {
  setTimeout(init20, 50);
}

/* ══════════════════════════════════════════════════════════════
   STYLES — screen-fit layout, platter demotion, big controls,
   poster-matched deck accents
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
/* ── Screen-fit: console occupies exactly one landscape screenful,
   music dock (phase18) picks up immediately after it ── */
@media (orientation:landscape) {
  .twin-decks.active {
    min-height:calc(100svh - 88px);
    max-height:calc(100svh - 88px);
    grid-template-columns:1fr 84px 1fr;
  }
  .dj-deck {
    overflow-y:auto;
    -webkit-overflow-scrolling:touch;
    padding:4px 7px;
    gap:4px;
  }
  .dj-mixer {
    overflow-y:auto !important;
    -webkit-overflow-scrolling:touch;
  }
  /* Platter demoted — status ring showing spin + BPM, not the main
     touch surface. The waveform strip (sticky, phase18) is now
     where real interaction happens. */
  .dd-platter {
    width:min(20vw, 20svh) !important;
    height:min(20vw, 20svh) !important;
    margin:1px auto !important;
  }
  .dd-bpm-num { font-size:13px; }
}

/* ── Poster-matched deck accents: Deck A blue / Deck B red,
   consistent everywhere on the DJ page (badges, play buttons,
   pitch value, cue rows) ── */
.dd-badge.a, .dd-play.a-play { box-shadow:0 0 10px rgba(47,155,255,.25); }
.dd-badge.b, .dd-play.b-play { box-shadow:0 0 10px rgba(255,45,77,.25); }

/* ── Bigger transport row — thumb-sized targets ── */
.dd-transport { min-height:40px; }
.dd-btn { min-height:38px; font-size:10.5px; }
.dd-play { min-height:46px; font-size:18px; }

/* ── Wide touch-zone fader wrapper ──
   Invisible padded hit area around every slider so a thumb doesn't
   need pixel-perfect accuracy to grab and drag it. */
.vz-fader-zone {
  position:relative;
  touch-action:none;
}
.vz-fader-zone:not(.vertical) {
  padding:14px 2px;
  display:flex; align-items:center;
}
.vz-fader-zone.vertical {
  padding:10px 14px;
  display:flex; justify-content:center;
}
.vz-fader-zone.dragging {
  background:rgba(255,255,255,.04);
  border-radius:8px;
}
.vz-fader-zone input[type=range] { position:relative; z-index:2; pointer-events:none; }

/* Bigger, glowier thumbs/tracks on every DJ-page range input */
#page-dj input[type=range]::-webkit-slider-thumb {
  width:24px; height:24px;
  box-shadow:0 2px 10px rgba(0,0,0,.6), 0 0 0 3px rgba(255,255,255,.08);
}
#page-dj .dm-fader::-webkit-slider-thumb { width:26px; height:18px; border-radius:5px; }
#page-dj input[type=range]::-webkit-slider-runnable-track { height:6px; border-radius:3px; }
#page-dj .dm-fader { width:22px !important; }
#page-dj .dm-xfader::-webkit-slider-thumb { background:linear-gradient(135deg,#2f9bff,#ff2d4d); }

/* Pro-row (phase18) buttons — slightly bigger for thumb reach */
.dd-btn.pro { min-height:34px; font-size:9px; }
`;
document.head.appendChild(css);

})();
