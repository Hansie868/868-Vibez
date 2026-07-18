/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — player.js  (Tab 1)
   Exactly the approved layout: spinning 868 vinyl, title, seek,
   prev/play/next, Queue, Favorite, Import. Nothing else.
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const E = VZ.engine;

const P = VZ.player = {
  queue: [], index: -1,

  playQueue(tracks, startIndex = 0) {
    this.queue = tracks.slice();
    this.index = startIndex;
    this._playCurrent();
  },
  async _playCurrent() {
    const t = this.queue[this.index]; if (!t) return;
    try { await E.playMain(t); }
    catch (e) { VZ.toast(`Couldn't play "${t.title}": ${e.message}`, 'error', 3500); VZ.logError('player.play', e); }
    renderNow();
  },
  next() { if (this.index < this.queue.length - 1) { this.index++; this._playCurrent(); } },
  prev() {
    if (E.el.main && E.el.main.currentTime > 3) { E.el.main.currentTime = 0; return; }
    if (this.index > 0) { this.index--; this._playCurrent(); }
  },
};
E.on('main:ended', () => P.next());

/* ── Render ── */
const fmt = s => { s = Math.max(0, s|0); return `${(s/60)|0}:${String(s%60).padStart(2,'0')}`; };

function renderNow() {
  const t = E.mainTrack;
  $('npTitle').textContent = t ? t.title : 'No track playing';
  $('npArtist').textContent = t ? (t.artist || 'Unknown Artist') : 'Add a folder, then pick a song';
  $('npFavBtn').classList.toggle('on', !!t?.favorite);
  updatePlayState();
}
function updatePlayState() {
  const playing = E.el.main && !E.el.main.paused && E.el.main.src;
  $('npPlayBtn').textContent = playing ? '⏸' : '▶';
  $('npVinyl').classList.toggle('spinning', !!playing);
}

let seeking = false;
setInterval(() => {
  const a = E.el.main; if (!a || seeking) return;
  const dur = a.duration || 0, cur = a.currentTime || 0;
  $('npSeek').value = dur ? (cur / dur) * 1000 : 0;
  $('npTimeCur').textContent = fmt(cur);
  $('npTimeDur').textContent = fmt(dur);
  updatePlayState();
}, 400);

/* ── Queue sheet ── */
function openQueue() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-overlay open';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">Up Next</div>
      <div class="q-list">
        ${P.queue.length ? P.queue.map((t, i) => `
          <div class="q-row ${i === P.index ? 'now' : ''}" data-i="${i}">
            <span>${i === P.index ? '▶' : (i + 1)}</span>
            <div class="q-main">${esc(t.title)}</div>
          </div>`).join('') : `<div class="lib-empty">Queue is empty — pick a song from Library.</div>`}
      </div>
      <button class="sheet-btn ghost" data-x>Close</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.dataset.x !== undefined) sheet.remove(); });
  sheet.querySelectorAll('.q-row').forEach(r => r.addEventListener('click', () => { P.index = +r.dataset.i; P._playCurrent(); sheet.remove(); }));
}

document.addEventListener('DOMContentLoaded', () => {
  $('npPlayBtn').addEventListener('click', () => { E.ensureCtx(); E.toggleMain(); updatePlayState(); });
  $('npPrevBtn').addEventListener('click', () => P.prev());
  $('npNextBtn').addEventListener('click', () => P.next());
  $('npQueueBtn').addEventListener('click', openQueue);
  $('npFavBtn').addEventListener('click', async () => {
    if (!E.mainTrack) return;
    const on = await VZ.libraryCore.toggleFavorite(E.mainTrack.id);
    $('npFavBtn').classList.toggle('on', on);
  });
  $('npImportBtn').addEventListener('click', () => VZ.libraryCore.addFolder());
  $('npSeek').addEventListener('input', () => { seeking = true; });
  $('npSeek').addEventListener('change', () => {
    const a = E.el.main;
    if (a?.duration) a.currentTime = ($('npSeek').value / 1000) * a.duration;
    seeking = false;
  });
  E.on('main:state', renderNow);
  E.on('library:changed', renderNow);
  renderNow();
});
})();
