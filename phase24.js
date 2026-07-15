/* ============================================================
   868 VIBEZ — Phase 24: Settings, Storage, Reset, Queue Peek, Updates
   1. Settings/About screen — version, storage usage, library stats
   2. Storage quota visibility (navigator.storage.estimate)
   3. Reset app / clear all data (with a real confirmation gate)
   4. "Up Next" peek strip on the Now Playing view — the full Queue
      engine already exists (phase9.js, Library ▸ Queue tab); this
      just surfaces it where people actually look, on Now Playing.
   5. Update-available banner — the service worker auto-updates
      silently (skipWaiting/clients.claim); this tells the person
      instead of leaving them on a stale screen unknowingly.
   ============================================================ */
'use strict';

(function () {
const $24 = id => document.getElementById(id);
const esc24 = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

const APP_VERSION = '1.0.0';
const BUILD_LABEL = 'Build 24';

/* ══════════════════════════════════════════════════════════════
   1 + 2 + 3 — SETTINGS / ABOUT OVERLAY
══════════════════════════════════════════════════════════════ */
function formatBytes(n) {
  if (!n) return '0 MB';
  const mb = n / (1024*1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb/1024).toFixed(2)} GB`;
}

async function getStorageInfo() {
  let usage = 0, quota = 0;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0; quota = est.quota || 0;
    }
  } catch {}
  let trackCount = 0, crateCount = 0, sessionCount = 0;
  try { trackCount = (MS.library || (await MS.db.all('tracks'))).length; } catch {}
  try { crateCount = (await MS.db.all('crates')).length; } catch {}
  try { sessionCount = (await MS.db.all('sessions')).length; } catch {}
  return { usage, quota, trackCount, crateCount, sessionCount };
}

async function renderSettings() {
  const body = $24('settingsBody');
  if (!body) return;
  const info = await getStorageInfo();
  const pct = info.quota ? Math.min(100, Math.round((info.usage/info.quota)*100)) : 0;

  body.innerHTML = `
    <div class="settings-brand">
      <img src="icons/icon-192.png" class="settings-icon" alt=""/>
      <div class="settings-brand-name">868 Vibez</div>
      <div class="settings-brand-sub">868 Apps Hub Ltd™ · v${APP_VERSION} · ${BUILD_LABEL}</div>
    </div>

    <div class="section-label">📊 Your Library</div>
    <div class="settings-stat-row">
      <div class="settings-stat"><div class="settings-stat-num">${info.trackCount}</div><div class="settings-stat-lbl">Tracks</div></div>
      <div class="settings-stat"><div class="settings-stat-num">${info.crateCount}</div><div class="settings-stat-lbl">Crates</div></div>
      <div class="settings-stat"><div class="settings-stat-num">${info.sessionCount}</div><div class="settings-stat-lbl">Sessions</div></div>
    </div>

    <div class="section-label">💾 Storage</div>
    <div class="settings-storage-bar"><div class="settings-storage-fill" style="width:${pct}%"></div></div>
    <div class="settings-storage-txt">${formatBytes(info.usage)} used${info.quota ? ` of ${formatBytes(info.quota)} available on this device` : ''}</div>

    <div class="section-label">ℹ️ About</div>
    <div class="settings-about-txt">
      Everything you import stays on this device — nothing is uploaded anywhere. Radio stations stream directly from each station's own server. Microphone audio (Toolkit ▸ Mic) is only ever used live in your mix and is never recorded or sent anywhere unless you tap Record yourself.
    </div>

    <div class="section-label">⚠️ Reset</div>
    <button class="settings-reset-btn" id="resetAppBtn">Erase All App Data</button>
    <div class="settings-reset-note">Deletes your entire library, crates, cues, mix history, requests, and settings from this device. This cannot be undone.</div>
  `;
  $24('resetAppBtn').addEventListener('click', confirmReset);
}

async function confirmReset() {
  const step1 = confirm('This erases your ENTIRE library, crates, cue points, mix history, and settings from this device. This cannot be undone.\n\nContinue?');
  if (!step1) return;
  const typed = prompt('Type DELETE to confirm — this is permanent.');
  if (typed !== 'DELETE') { MS.toast('Reset cancelled.', 'info'); return; }

  try {
    const dbs = await indexedDB.databases?.() || [{ name: '868VibezDB' }];
    for (const d of dbs) { if (d.name) indexedDB.deleteDatabase(d.name); }
  } catch {}
  try { localStorage.clear(); } catch {}
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch {}
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  } catch {}
  MS.toast('Everything cleared — reloading…', 'ok', 1500);
  setTimeout(() => location.reload(), 1200);
}

function buildSettingsOverlay() {
  if ($24('settingsOverlay')) return;
  const el = document.createElement('div');
  el.id = 'settingsOverlay';
  el.innerHTML = `
    <div class="settings-sheet">
      <div class="settings-head">
        <div class="settings-title">Settings</div>
        <button class="settings-close" id="settingsCloseBtn">✕</button>
      </div>
      <div class="settings-body" id="settingsBody"></div>
    </div>`;
  document.body.appendChild(el);
  $24('settingsCloseBtn').addEventListener('click', closeSettings);
  el.addEventListener('click', e => { if (e.target === el) closeSettings(); });
}
function openSettings() {
  buildSettingsOverlay();
  renderSettings();
  $24('settingsOverlay').classList.add('open');
}
function closeSettings() {
  $24('settingsOverlay')?.classList.remove('open');
}
window.openAppSettings = openSettings;

function addSettingsGear() {
  const header = document.querySelector('#page-player .subtab-bar');
  if (!header || $24('settingsGearBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'settingsGearBtn';
  btn.className = 'settings-gear-btn';
  btn.innerHTML = '⚙';
  btn.addEventListener('click', openSettings);
  header.style.position = 'relative';
  header.appendChild(btn);
}

/* ══════════════════════════════════════════════════════════════
   4 — "UP NEXT" PEEK STRIP ON NOW PLAYING
   Reuses the existing Queue engine (phase9.js) fully — this only
   adds a small preview + jump link where people are already looking.
══════════════════════════════════════════════════════════════ */
function buildQueuePeek() {
  const actions = document.querySelector('#page-player .np-actions');
  if (!actions || $24('npQueuePeek')) return;
  const peek = document.createElement('div');
  peek.id = 'npQueuePeek';
  peek.className = 'np-queue-peek';
  actions.parentNode.insertBefore(peek, actions);
  renderQueuePeek();
  MS.on && MS.on('player:play', renderQueuePeek);
}

function renderQueuePeek() {
  const peek = $24('npQueuePeek');
  if (!peek || !window.Queue) return;
  const items = window.Queue.items || [];
  if (!items.length) {
    peek.innerHTML = `<button class="np-queue-peek-empty" id="npQueueJump">🔜 Up Next — queue is empty, tap to add songs</button>`;
  } else {
    const next = items[0];
    peek.innerHTML = `
      <button class="np-queue-peek-row" id="npQueueJump">
        <span class="np-queue-peek-lbl">🔜 UP NEXT</span>
        <span class="np-queue-peek-title">${esc24(next.title)}</span>
        ${items.length > 1 ? `<span class="np-queue-peek-count">+${items.length-1} more</span>` : ''}
      </button>`;
  }
  $24('npQueueJump')?.addEventListener('click', () => {
    showPage('library');
    setTimeout(() => document.querySelector('#page-library [data-sub="queue"]')?.click(), 60);
  });
}

/* ══════════════════════════════════════════════════════════════
   5 — UPDATE-AVAILABLE BANNER
   sw.js already auto-activates new versions (skipWaiting +
   clients.claim); reloading mid-playback would be jarring, so this
   shows a dismissible banner instead of forcing a refresh.
══════════════════════════════════════════════════════════════ */
function watchForUpdate() {
  if (!('serviceWorker' in navigator)) return;
  let alreadyShown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (alreadyShown) return;
    alreadyShown = true;
    showUpdateBanner();
  });
}
function showUpdateBanner() {
  if ($24('updateBanner')) return;
  const el = document.createElement('div');
  el.id = 'updateBanner';
  el.innerHTML = `
    <span>✨ 868 Vibez was updated.</span>
    <button id="updateRefreshBtn">Refresh</button>
    <button id="updateDismissBtn">✕</button>`;
  document.body.appendChild(el);
  $24('updateRefreshBtn').addEventListener('click', () => location.reload());
  $24('updateDismissBtn').addEventListener('click', () => el.remove());
  setTimeout(() => el.classList.add('show'), 50);
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const css = document.createElement('style');
css.textContent = `
/* ── Settings gear ── */
.settings-gear-btn {
  position:absolute; right:10px; top:50%; transform:translateY(-50%);
  width:34px; height:34px; border-radius:50%;
  border:1px solid var(--border); background:var(--bg3); color:var(--t2);
  font-size:16px; display:flex; align-items:center; justify-content:center;
}

/* ── Settings overlay ── */
#settingsOverlay {
  position:fixed; inset:0; z-index:400;
  background:rgba(4,4,4,.7); backdrop-filter:blur(6px);
  display:flex; align-items:flex-end;
  opacity:0; pointer-events:none; transition:opacity .25s;
}
#settingsOverlay.open { opacity:1; pointer-events:auto; }
.settings-sheet {
  width:100%; max-height:88svh; overflow-y:auto;
  background:var(--bg2); border-radius:22px 22px 0 0;
  border-top:1px solid var(--border2);
  transform:translateY(100%); transition:transform .3s ease;
  padding-bottom:24px;
}
#settingsOverlay.open .settings-sheet { transform:translateY(0); }
.settings-head {
  display:flex; align-items:center; justify-content:space-between;
  padding:16px 18px; border-bottom:1px solid var(--border);
  position:sticky; top:0; background:var(--bg2); z-index:2;
}
.settings-title { font-family:var(--font-display,var(--font)); font-size:18px; font-weight:800; }
.settings-close { width:32px; height:32px; border-radius:50%; border:1px solid var(--border); background:var(--bg3); color:var(--t2); }
.settings-body { padding:8px 18px 0; }

.settings-brand { text-align:center; padding:20px 0 10px; }
.settings-icon { width:72px; height:72px; border-radius:18px; box-shadow:0 8px 24px rgba(0,0,0,.5); }
.settings-brand-name { font-family:var(--font-display,var(--font)); font-size:20px; font-weight:800; margin-top:10px; }
.settings-brand-sub { font-size:11px; color:var(--t3); margin-top:2px; }

.settings-stat-row { display:flex; gap:8px; margin-bottom:16px; }
.settings-stat { flex:1; text-align:center; background:var(--bg3); border:1px solid var(--border); border-radius:12px; padding:12px 6px; }
.settings-stat-num { font-family:var(--mono); font-size:20px; font-weight:800; color:var(--t1); }
.settings-stat-lbl { font-size:9px; color:var(--t3); text-transform:uppercase; letter-spacing:.08em; margin-top:2px; }

.settings-storage-bar { height:10px; border-radius:6px; background:var(--bg4); overflow:hidden; margin-bottom:6px; }
.settings-storage-fill { height:100%; background:linear-gradient(90deg,var(--cyan),var(--red)); }
.settings-storage-txt { font-size:11.5px; color:var(--t3); margin-bottom:16px; }

.settings-about-txt { font-size:12.5px; color:var(--t2); line-height:1.7; margin-bottom:18px; }

.settings-reset-btn {
  width:100%; padding:14px; border-radius:12px; font-size:13px; font-weight:800;
  border:1px solid var(--red); background:rgba(232,16,42,.08); color:var(--red);
}
.settings-reset-note { font-size:10.5px; color:var(--t3); line-height:1.6; margin-top:8px; margin-bottom:8px; }

/* ── Up Next peek ── */
.np-queue-peek { padding:0 4px 10px; }
.np-queue-peek-row, .np-queue-peek-empty {
  width:100%; display:flex; align-items:center; gap:8px;
  padding:11px 14px; border-radius:12px;
  background:var(--bg3); border:1px solid var(--border);
  color:var(--t2); font-size:12px;
}
.np-queue-peek-lbl { font-size:9px; font-weight:900; letter-spacing:.08em; color:var(--t3); flex-shrink:0; }
.np-queue-peek-title { flex:1; text-align:left; font-weight:600; color:var(--t1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.np-queue-peek-count { font-size:10px; color:var(--t3); flex-shrink:0; }
.np-queue-peek-empty { justify-content:center; color:var(--t3); font-size:11.5px; }

/* ── Update banner ── */
#updateBanner {
  position:fixed; left:12px; right:12px; bottom:calc(var(--nav-h,64px) + 14px);
  z-index:450; display:flex; align-items:center; gap:10px;
  background:var(--bg2); border:1px solid var(--border2); border-radius:14px;
  padding:12px 14px; box-shadow:0 10px 30px rgba(0,0,0,.5);
  transform:translateY(20px); opacity:0; transition:all .3s;
}
#updateBanner.show { transform:translateY(0); opacity:1; }
#updateBanner span { flex:1; font-size:12.5px; color:var(--t1); }
#updateBanner button { padding:7px 12px; border-radius:8px; font-size:11px; font-weight:700; border:1px solid var(--border); background:var(--bg3); color:var(--t2); }
#updateRefreshBtn { border-color:var(--red) !important; color:var(--red) !important; }
`;
document.head.appendChild(css);

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init24() {
  addSettingsGear();
  buildQueuePeek();
  watchForUpdate();
  console.info('[868 Vibez] Phase 24 ready — Settings, Storage, Reset, Queue Peek, Updates');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init24, 100));
} else {
  setTimeout(init24, 100);
}

})();
