/* ============================================================
   868 VIBEZ — Phase 25: Legal, Crash Logging, Lyrics Link-out
   1. Privacy Policy / Terms — real text, reachable from Settings
   2. Local crash/error logging — since there's no backend, errors
      are captured on-device and viewable/exportable from Settings
      so a report can actually reach the developer
   3. Lyrics link-out — searches Genius for the current track
      rather than embedding lyrics (copyright — never reproduce
      lyrics text directly)
   ============================================================ */
'use strict';

(function () {
const $25 = id => document.getElementById(id);
const esc25 = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* ══════════════════════════════════════════════════════════════
   2 — LOCAL CRASH / ERROR LOGGING
   No backend exists to auto-report to, so this keeps the last N
   errors on-device with enough context to be useful, and gives a
   one-tap "Copy for support" so a person can actually send it to
   the developer instead of it vanishing the moment the tab closes.
══════════════════════════════════════════════════════════════ */
const ErrorLog = {
  MAX: 40,
  buffer: [],

  async load() {
    try { this.buffer = (await MS.db.all('errorLog')) || []; }
    catch { this.buffer = []; }
  },
  async record(entry) {
    const rec = { id: 'err_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), at: Date.now(), ...entry };
    this.buffer.push(rec);
    if (this.buffer.length > this.MAX) {
      const drop = this.buffer.shift();
      try { await MS.db.del('errorLog', drop.id); } catch {}
    }
    try { await MS.db.put('errorLog', rec); } catch {}
  },
  async clear() {
    for (const e of this.buffer) { try { await MS.db.del('errorLog', e.id); } catch {} }
    this.buffer = [];
  },
  formatForExport() {
    const lines = [
      `868 Vibez — Error Log Export`,
      `Generated: ${new Date().toLocaleString()}`,
      `User agent: ${navigator.userAgent}`,
      '',
      ...this.buffer.map(e => `[${new Date(e.at).toISOString()}] ${e.kind}: ${e.message}\n  ${e.detail || ''}`),
    ];
    return lines.join('\n');
  },
};
MS.errorLog = ErrorLog;

window.addEventListener('error', e => {
  ErrorLog.record({
    kind: 'error',
    message: e.message || 'Unknown error',
    detail: `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`,
  });
});
window.addEventListener('unhandledrejection', e => {
  ErrorLog.record({
    kind: 'promise',
    message: (e.reason && (e.reason.message || String(e.reason))) || 'Unhandled rejection',
    detail: e.reason?.stack || '',
  });
});

function copyErrorLog() {
  const text = ErrorLog.formatForExport();
  navigator.clipboard?.writeText(text).then(
    () => MS.toast('Error log copied — paste it wherever you\'re reporting the issue.', 'ok', 3000),
    () => MS.toast('Could not copy — try the export instead.', 'warn')
  );
}
function exportErrorLog() {
  const text = ErrorLog.formatForExport();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `868vibez-errorlog-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
window.djCopyErrorLog = copyErrorLog;
window.djExportErrorLog = exportErrorLog;
window.djClearErrorLog = async () => { await ErrorLog.clear(); renderErrorLogPanel(); };

function renderErrorLogPanel() {
  const wrap = $25('errorLogPanel');
  if (!wrap) return;
  const count = ErrorLog.buffer.length;
  wrap.innerHTML = `
    <div class="settings-about-txt">${count ? `${count} issue${count===1?'':'s'} logged on this device since install.` : 'No errors logged — everything\'s been running clean.'}</div>
    ${count ? `
      <div class="settings-btn-row">
        <button class="vz-btn sm" onclick="djCopyErrorLog()">📋 Copy</button>
        <button class="vz-btn sm" onclick="djExportErrorLog()">⬇ Export</button>
        <button class="vz-btn sm" onclick="djClearErrorLog()">Clear</button>
      </div>` : ''}`;
}

/* ══════════════════════════════════════════════════════════════
   1 — PRIVACY POLICY / TERMS
   Plain-language, matches what the app actually does — no vague
   boilerplate about data it doesn't collect.
══════════════════════════════════════════════════════════════ */
const LEGAL_TEXT = {
  privacy: `Privacy — 868 Vibez

868 Vibez is built by 868 Apps Hub Ltd™.

WHAT STAYS ON YOUR DEVICE
Your music library, playlists, crates, cue points, mix history, and song requests are all stored locally in your browser's storage on this device. None of it is uploaded to us or anyone else. If you clear your browser data or use "Erase All App Data" in Settings, it's gone for good — we don't have a copy.

MICROPHONE
The Toolkit's mic feature accesses your microphone only while you have it switched on, to mix your voice live into your set. Mic audio is never recorded or transmitted anywhere unless you personally tap Record — and even then, the recording saves straight to your device, not to us.

RADIO STREAMS
When you play a station in the Stream tab, your device connects directly to that station's own streaming server (via the public radio-browser.info directory). We don't proxy, record, or see what you listen to.

WHAT WE DON'T HAVE
No account, no login, no analytics pipeline, no server-side database of your activity. We genuinely have no way to see your library, your mixes, or your listening habits.

CONTACT
Questions about this policy — reach out to 868 Apps Hub Ltd™ through the channel you got this app from.`,

  terms: `Terms of Use — 868 Vibez

By using 868 Vibez, you agree to the following:

YOUR CONTENT
Any music you import is your own responsibility — make sure you have the right to possess and play it. 868 Vibez doesn't supply, host, or distribute music; it's a player and mixing tool for content you already own.

RADIO STATIONS
Live radio stations available in the Stream tab are operated independently by their respective broadcasters. 868 Vibez links to their public streams; we don't control their content, availability, or schedules.

NO WARRANTY
868 Vibez is provided as-is. We work hard to keep it reliable, but as with any software, things can occasionally break — back up anything important using the export tools in the app.

CHANGES
These terms may be updated as the app evolves; continued use after an update means you accept the current version.

868 Apps Hub Ltd™ — Innovate. Build. Elevate.`,
};

function openLegal(kind) {
  const el = document.createElement('div');
  el.className = 'legal-overlay';
  el.innerHTML = `
    <div class="legal-sheet">
      <div class="settings-head">
        <div class="settings-title">${kind === 'privacy' ? 'Privacy Policy' : 'Terms of Use'}</div>
        <button class="settings-close" id="legalCloseBtn">✕</button>
      </div>
      <div class="legal-body">${esc25(LEGAL_TEXT[kind]).replace(/\n/g,'<br>')}</div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); };
  $25('legalCloseBtn').addEventListener('click', close);
  el.addEventListener('click', e => { if (e.target === el) close(); });
}
window.djOpenLegal = openLegal;

/* ══════════════════════════════════════════════════════════════
   3 — LYRICS LINK-OUT (never embeds lyrics text directly)
══════════════════════════════════════════════════════════════ */
function openLyricsSearch() {
  const track = MS.selectedTrack;
  if (!track) { MS.toast('Play a track first.', 'warn'); return; }
  const q = encodeURIComponent(`${track.title} ${track.artist||''} lyrics`);
  window.open(`https://genius.com/search?q=${q}`, '_blank');
}
window.djOpenLyricsSearch = openLyricsSearch;

function addLyricsButton() {
  const actions = document.querySelector('#page-player .np-actions');
  if (!actions || $25('npLyricsBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'npLyricsBtn';
  btn.className = 'np-action-btn';
  btn.innerHTML = `<span style="font-size:22px">📝</span><span>Lyrics</span>`;
  btn.addEventListener('click', openLyricsSearch);
  actions.appendChild(btn);
}

/* ══════════════════════════════════════════════════════════════
   Wire Legal + Error Log into the Settings sheet (phase24.js)
══════════════════════════════════════════════════════════════ */
function extendSettings() {
  const body = $25('settingsBody');
  if (!body || $25('legalSection')) return;
  const wrap = document.createElement('div');
  wrap.id = 'legalSection';
  wrap.innerHTML = `
    <div class="section-label">📄 Legal</div>
    <div class="settings-btn-row">
      <button class="vz-btn sm" onclick="djOpenLegal('privacy')">Privacy Policy</button>
      <button class="vz-btn sm" onclick="djOpenLegal('terms')">Terms of Use</button>
    </div>
    <div class="section-label">🐞 Error Log</div>
    <div id="errorLogPanel"></div>`;
  body.appendChild(wrap);
  renderErrorLogPanel();
}

/* Settings sheet is rebuilt fresh each time it opens (phase24's
   renderSettings), so re-run our extension every time it's opened. */
function watchSettingsOpen() {
  const origOpen = window.openAppSettings;
  if (!origOpen || origOpen._vzWrapped) return;
  window.openAppSettings = function (...args) {
    origOpen.apply(this, args);
    setTimeout(extendSettings, 60);
  };
  window.openAppSettings._vzWrapped = true;
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
.settings-btn-row { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.settings-btn-row button { flex:1; min-width:100px; }

.legal-overlay {
  position:fixed; inset:0; z-index:410;
  background:rgba(4,4,4,.75); backdrop-filter:blur(6px);
  display:flex; align-items:flex-end;
  opacity:0; pointer-events:none; transition:opacity .25s;
}
.legal-overlay.open { opacity:1; pointer-events:auto; }
.legal-sheet {
  width:100%; max-height:88svh; overflow-y:auto;
  background:var(--bg2); border-radius:22px 22px 0 0;
  border-top:1px solid var(--border2);
  transform:translateY(100%); transition:transform .3s ease;
  padding-bottom:24px;
}
.legal-overlay.open .legal-sheet { transform:translateY(0); }
.legal-body { padding:16px 18px; font-size:12.5px; line-height:1.8; color:var(--t2); white-space:normal; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
async function init25() {
  await ErrorLog.load();
  addLyricsButton();
  watchSettingsOpen();
  console.info('[868 Vibez] Phase 25 ready — Legal, Crash Log, Lyrics link-out');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init25, 140));
} else {
  setTimeout(init25, 140);
}

})();
