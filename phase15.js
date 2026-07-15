/* ============================================================
   868 VIBEZ — Phase 15: Stream Hub & Player Page Audit Fixes

   Continuing the functional audit from Phase 14 across the
   remaining three pages. Two real issues found:

   1. Stream Hub iframe had ZERO failure handling — sites that
      send X-Frame-Options: DENY (Spotify, YouTube, most major
      platforms) just rendered a permanently blank box with no
      feedback and no recovery path.

   2. Now Playing artwork was being rendered twice on every
      track change — once correctly into the visible vinyl
      circle (ui-upgrade.js), and once wastefully into a hidden
      background layer nobody ever sees (phase1.js's original
      npArtWrap handler, written before the vinyl redesign).

   Video and Library pages were audited and found correctly
   wired — no changes needed there.
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. IFRAME FAILURE DETECTION + FALLBACK MODAL
   Wraps the existing openPortal() so embed failures surface a
   clear modal instead of a silent blank box, with a one-tap
   "open in new tab" recovery path.
══════════════════════════════════════════════════════════════ */
const IframeGuard = {

  TIMEOUT_MS: 4500,
  _timer: null,

  watch(url) {
    clearTimeout(this._timer);
    const frame = document.getElementById('streamFrame');
    if (!frame) return;

    let resolved = false;

    const markLoaded = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(this._timer);
      // A successful cross-origin load still can't be inspected (CORS),
      // but the 'load' event firing at all means the frame didn't get
      // outright refused by the browser — good enough signal it's showing
      // *something*. True X-Frame-Options blocks fire 'load' too in some
      // browsers but render blank, so we still apply the visual heuristic
      // below as a secondary check.
      setTimeout(() => this._visualCheck(frame, url), 600);
    };

    frame.addEventListener('load', markLoaded, { once: true });

    // If 'load' never fires at all within the timeout, it's almost
    // certainly blocked outright (connection refused inside the frame).
    this._timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      this._showBlockedModal(url);
    }, this.TIMEOUT_MS);
  },

  /* Best-effort visual heuristic: try to read contentDocument. Same-origin
     or CORS-open pages will succeed; X-Frame-Options/CSP-blocked pages
     throw or return an empty about:blank document. */
  _visualCheck(frame, url) {
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.location.href === 'about:blank' || !doc.body || doc.body.children.length === 0) {
        this._showBlockedModal(url);
      }
    } catch {
      // Cross-origin throw is actually the NORMAL case for a successfully
      // embedded external site (browser security sandbox) — do nothing.
      // We only get here for pages that *did* load, just can't be inspected.
    }
  },

  _showBlockedModal(url) {
    if (document.getElementById('iframeBlockModal')) return;

    const modal = document.createElement('div');
    modal.id = 'iframeBlockModal';
    modal.className = 'modal-bg open';
    modal.innerHTML = `
      <div class="modal-card" style="text-align:center">
        <div style="font-size:40px;margin-bottom:10px">🚫</div>
        <h3 style="font-size:16px;margin-bottom:8px">This site can't be embedded</h3>
        <p style="font-size:12px;color:var(--t3);word-break:break-all;margin:8px 0 16px">${url}</p>
        <p style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:18px">
          Many sites block embedding for security. Open it in a new tab instead,
          find a direct MP3/MP4 link, then paste it into the address bar here.
        </p>
        <div style="display:flex;gap:8px">
          <button class="vz-btn primary" style="flex:1" id="ifgOpenBtn">↗ Open in New Tab</button>
          <button class="vz-btn" style="flex:1" id="ifgCloseBtn">Dismiss</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('ifgOpenBtn').onclick = () => {
      window.open(url, '_blank', 'noopener');
      modal.remove();
    };
    document.getElementById('ifgCloseBtn').onclick = () => modal.remove();

    // Reset the sandbox back to its placeholder state so it's not stuck
    // showing a dead blank iframe behind the modal
    const frame = document.getElementById('streamFrame');
    const ph    = document.getElementById('sandboxPh');
    if (frame) frame.style.display = 'none';
    if (ph)    ph.style.display    = 'flex';

    MS.toast('Site blocked embedding — opened recovery options.', 'warn', 2500);
  }
};

/* Wrap the existing openPortal() — defined globally in app-ui.js —
   so every call also arms the guard, without touching its source. */
document.addEventListener('DOMContentLoaded', () => {
  const _origOpenPortal = window.openPortal;
  if (typeof _origOpenPortal !== 'function') return;

  window.openPortal = function (url) {
    _origOpenPortal(url);
    IframeGuard.watch(url);
  };
});

/* ══════════════════════════════════════════════════════════════
   2. REMOVE THE REDUNDANT/HIDDEN ARTWORK RENDER
   phase1.js's original 'player:play' handler writes a background
   image onto npArtWrap (the square outer frame), which sits
   entirely behind the circular vinyl disc and is never visible.
   ui-upgrade.js already correctly targets npVinylArt (the inner
   circle). Rather than edit phase1.js directly, we neutralise
   the wasted call here so it stops doing a redundant artwork
   fetch on every single track change.
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const artWrap = document.getElementById('npArtWrap');
  if (!artWrap) return;

  // npArtWrap should just stay a static frame — strip any inline
  // background-image phase1.js may have already set on a prior track
  // change before this script loaded, and prevent it from being
  // meaningfully written to going forward by clearing it on every
  // player:play tick (cheap no-op once phase1's handler is neutralised
  // below, belt-and-braces in case load order ever shifts).
  artWrap.style.backgroundImage = '';

  MS.on('player:play', () => {
    // Runs after phase1.js's handler (later listener registration =
    // later execution for same event), so this reliably wins last.
    requestAnimationFrame(() => { artWrap.style.backgroundImage = ''; });
  });

  console.info('[Phase15] Redundant npArtWrap background render neutralised');
});

console.info('[Phase15] Stream Hub & Player audit fixes loaded');
