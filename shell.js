/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — shell.js
   Splash (tap-to-enter only), tab bar, toasts, settings sheet,
   error log, storage info, reset, privacy/terms, update notice.
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const $ = id => document.getElementById(id);
const VERSION = '2.0.0';

/* ── Toasts ── */
let toastT = null;
VZ.toast = function (msg, kind = 'info', ms = 2200) {
  let el = $('vzToast');
  if (!el) { el = document.createElement('div'); el.id = 'vzToast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
};

/* ── Error log (built in from day one) ── */
VZ.logError = async function (where, err) {
  try {
    const rec = { id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      at: Date.now(), where, message: err?.message || String(err), stack: (err?.stack || '').slice(0, 600) };
    const all = await VZ.db.all('errors');
    if (all.length > 40) await VZ.db.del('errors', all.sort((a, b) => a.at - b.at)[0].id);
    await VZ.db.put('errors', rec);
  } catch {}
};
window.addEventListener('error', e => VZ.logError('window', e.error || e.message));
window.addEventListener('unhandledrejection', e => VZ.logError('promise', e.reason));

/* ── Tabs ── */
VZ.shell = {
  showTab(name) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    document.dispatchEvent(new CustomEvent('vz:tab', { detail: name }));
  },
};

/* ── Splash: tap to enter only ── */
function initSplash() {
  const splash = $('splash'); if (!splash) return;
  splash.addEventListener('click', () => {
    splash.classList.add('out');
    VZ.engine.ensureCtx();          // unlock audio inside the user gesture
    setTimeout(() => splash.remove(), 500);
    VZ.shell.showTab('player');
  });
}

/* ── Settings ── */
const PRIVACY = `Privacy — 868 Vibez\n\n868 Vibez is built by 868 Apps Hub Ltd™.\n\nEVERYTHING STAYS ON YOUR DEVICE. Your music library, playlists, crates, cues, mix history and requests are stored locally in your browser on this phone. Nothing is uploaded to us or anyone else. If you erase the app's data, it's gone — we hold no copy.\n\nMICROPHONE. The DJ Toolkit's mic is live-only while you switch it on; nothing is recorded or transmitted unless you personally tap REC — and recordings save to your device, not to us.\n\nRADIO. Playing a station connects your phone directly to that broadcaster's own public stream (found via the open radio-browser.info directory). We don't proxy, record or see what you listen to.\n\nNO ACCOUNTS, NO ANALYTICS, NO TRACKING.`;
const TERMS = `Terms of Use — 868 Vibez\n\nYOUR CONTENT: any music you connect is your responsibility — make sure you have the right to possess and play it. 868 Vibez supplies no music; it plays and mixes what you already own.\n\nRADIO: stations are independent broadcasters; we link to their public streams and don't control their content or availability.\n\nNO WARRANTY: provided as-is. Back up anything important using the export tools.\n\n868 Apps Hub Ltd™ — Innovate. Build. Elevate.`;

async function openSettings() {
  let storageLine = 'Storage info unavailable on this browser.';
  try {
    const est = await navigator.storage.estimate();
    const mb = n => (n / 1048576).toFixed(1) + ' MB';
    storageLine = `Using ${mb(est.usage || 0)} of ${mb(est.quota || 0)} available.`;
  } catch {}
  const errors = await VZ.db.all('errors');
  const trackCount = VZ.libraryCore.tracks.length;
  const copied = VZ.libraryCore.tracks.filter(t => t.source === 'copy').length;

  const sheet = document.createElement('div');
  sheet.className = 'sheet-overlay open';
  sheet.innerHTML = `
    <div class="sheet settings">
      <div class="sheet-title"><img src="icons/icon-192.png" class="set-logo"/> 868 Vibez <span class="ver">v${VERSION}</span></div>
      <div class="set-line">${trackCount} songs · ${VZ.libraryCore.folders.length} folders${copied ? ` · ${copied} copied (platform fallback)` : ' · all referenced in place'}</div>
      <div class="set-line">${storageLine}</div>
      <div class="sec-label">Legal</div>
      <div class="btn-row">
        <button class="btn" data-legal="p">Privacy</button>
        <button class="btn" data-legal="t">Terms</button>
      </div>
      <div class="sec-label">Error Log</div>
      <div class="set-line">${errors.length ? errors.length + ' issue(s) logged on this device.' : 'No errors logged — running clean.'}</div>
      ${errors.length ? `<div class="btn-row">
        <button class="btn" data-err="copy">📋 Copy</button>
        <button class="btn" data-err="clear">Clear</button>
      </div>` : ''}
      <div class="sec-label danger">Danger Zone</div>
      <button class="btn wide danger" data-reset>Erase All App Data</button>
      <button class="sheet-btn ghost" data-x>Close</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.dataset.x !== undefined) sheet.remove(); });
  sheet.querySelectorAll('[data-legal]').forEach(b => b.addEventListener('click', () => {
    alert(b.dataset.legal === 'p' ? PRIVACY : TERMS);
  }));
  sheet.querySelector('[data-err="copy"]')?.addEventListener('click', async () => {
    const txt = `868 Vibez v${VERSION} error log\n${navigator.userAgent}\n\n` +
      errors.map(e => `[${new Date(e.at).toISOString()}] ${e.where}: ${e.message}\n${e.stack}`).join('\n\n');
    try { await navigator.clipboard.writeText(txt); VZ.toast('Copied — paste it when reporting the issue.', 'ok'); }
    catch { VZ.toast('Copy blocked by browser.', 'warn'); }
  });
  sheet.querySelector('[data-err="clear"]')?.addEventListener('click', async () => {
    await VZ.db.clearStore('errors'); sheet.remove(); VZ.toast('Error log cleared.', 'ok');
  });
  sheet.querySelector('[data-reset]').addEventListener('click', async () => {
    if (!confirm('This erases your library links, playlists, crates, cues, history — everything. Your actual music files on the phone are NOT touched. Continue?')) return;
    if (prompt('Type DELETE to confirm:') !== 'DELETE') return;
    await VZ.db.wipe();
    localStorage.clear();
    const regs = await navigator.serviceWorker?.getRegistrations() || [];
    for (const r of regs) await r.unregister();
    location.reload();
  });
}

/* ── Update notice (no silent version swaps) ── */
function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (shown) return; shown = true;
    const bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.innerHTML = `✨ 868 Vibez was updated <button id="updGo">Refresh</button><button id="updX">✕</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#updGo').addEventListener('click', () => location.reload());
    bar.querySelector('#updX').addEventListener('click', () => bar.remove());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSplash();
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => VZ.shell.showTab(b.dataset.tab)));
  $('settingsBtn')?.addEventListener('click', openSettings);
  watchUpdates();
  navigator.serviceWorker?.register('./sw.js').catch(() => {});
});
})();
