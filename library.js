/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — library.js  (Tab 3 + the file-access core)
   Music is ACCESSED IN PLACE from phone storage — never copied —
   on devices whose browser supports it (File System Access API).
   Folders are added ONCE and persist across app restarts.
   Copy fallback (with a plain notice) only where the platform
   genuinely forces it.
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const AUDIO_EXT = new Set(['mp3','wav','ogg','m4a','aac','flac','opus','webm']);
const ext = n => (n.split('.').pop() || '').toLowerCase();
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const REF_MODE = 'showDirectoryPicker' in window;

/* ─────────── CORE: folders, tracks, file resolution ─────────── */
const Core = VZ.libraryCore = {
  folders: [],   // { id, name, mode:'ref'|'copy', handle? }
  tracks: [],    // { id, folderId, path, title, artist, favorite, bpm, key, size, source }

  async load() {
    this.folders = await VZ.db.all('folders');
    this.tracks  = await VZ.db.all('tracks');
    VZ.engine.emit('library:changed');
  },

  /* Re-grant read permission on a stored folder handle (needs a user
     gesture — callers invoke this from taps). */
  async ensurePermission(folder) {
    if (folder.mode !== 'ref' || !folder.handle) return true;
    try {
      if ((await folder.handle.queryPermission({ mode: 'read' })) === 'granted') return true;
      return (await folder.handle.requestPermission({ mode: 'read' })) === 'granted';
    } catch { return true; }  // older impls lack query/request — just try reads
  },

  /* Resolve a track to a playable File. Ref mode walks the stored
     folder handle live — nothing was ever copied. */
  async fileForTrack(t) {
    if (t.source === 'copy') {
      const rec = await VZ.db.get('blobs', t.id);
      if (rec?.blob) return rec.blob;
      throw new Error('Song data missing — re-add its folder.');
    }
    const folder = this.folders.find(f => f.id === t.folderId);
    if (!folder?.handle) throw new Error('Folder no longer connected — re-add it in Library.');
    if (!(await this.ensurePermission(folder))) throw new Error('Permission to read the folder was declined.');
    const parts = t.path.split('/');
    let dir = folder.handle;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return fh.getFile();
  },

  /* ── Add a folder (ref mode) ── */
  async addFolderRef() {
    const handle = await window.showDirectoryPicker();
    const id = 'f_' + Date.now();
    const folder = { id, name: handle.name, mode: 'ref', handle, addedAt: Date.now() };
    await VZ.db.put('folders', folder);
    this.folders.push(folder);
    const n = await this.scanFolder(folder);
    VZ.toast(`Added "${handle.name}" — ${n} songs, referenced in place (nothing copied).`, 'ok', 3200);
    VZ.engine.emit('library:changed');
  },

  async scanFolder(folder) {           // (re)index a ref folder's audio files
    const found = [];
    async function walk(dir, prefix) {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'directory') await walk(entry, prefix ? `${prefix}/${name}` : name);
        else if (AUDIO_EXT.has(ext(name))) found.push(prefix ? `${prefix}/${name}` : name);
      }
    }
    await walk(folder.handle, '');
    found.sort();
    for (const path of found) {
      const id = `t_${folder.id}_${path}`.replace(/[^\w.-]/g, '_');
      if (!this.tracks.find(t => t.id === id)) {
        const track = { id, folderId: folder.id, path, source: 'ref',
          title: path.split('/').pop().replace(/\.[^.]+$/, ''), artist: '',
          favorite: false, bpm: null, key: null, addedAt: Date.now() };
        await VZ.db.put('tracks', track);
        this.tracks.push(track);
      }
    }
    return found.length;
  },

  /* ── Add a folder (copy fallback) — used ONLY when ref mode is
     unavailable on this device; a plain notice explains why. ── */
  async addFolderCopy(fileList) {
    const files = [...fileList].filter(f => AUDIO_EXT.has(ext(f.name)));
    if (!files.length) { VZ.toast('No audio files in that selection.', 'warn'); return; }
    const rootName = files[0].webkitRelativePath?.split('/')[0] || 'Music';
    const id = 'f_' + Date.now();
    const folder = { id, name: rootName, mode: 'copy', addedAt: Date.now() };
    await VZ.db.put('folders', folder);
    this.folders.push(folder);
    for (const file of files) {
      const rel = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
      const tid = `t_${id}_${rel}`.replace(/[^\w.-]/g, '_');
      const track = { id: tid, folderId: id, path: rel, source: 'copy',
        title: file.name.replace(/\.[^.]+$/, ''), artist: '',
        favorite: false, bpm: null, key: null, addedAt: Date.now() };
      await VZ.db.put('tracks', track);
      await VZ.db.put('blobs', { id: tid, blob: file });
      this.tracks.push(track);
    }
    VZ.toast(`Added "${rootName}" — ${files.length} songs. Your Chrome version doesn't support in-place access yet, so this folder was copied into the app (a platform limit on this device, not a choice).`, 'warn', 5200);
    VZ.engine.emit('library:changed');
  },

  async removeFolder(id) {
    const doomed = this.tracks.filter(t => t.folderId === id);
    for (const t of doomed) {
      await VZ.db.del('tracks', t.id);
      if (t.source === 'copy') await VZ.db.del('blobs', t.id);
    }
    await VZ.db.del('folders', id);
    this.tracks = this.tracks.filter(t => t.folderId !== id);
    this.folders = this.folders.filter(f => f.id !== id);
    VZ.engine.emit('library:changed');
  },

  addFolder() {
    if (REF_MODE) return this.addFolderRef().catch(e => { if (e.name !== 'AbortError') VZ.toast(e.message, 'error'); });
    document.getElementById('copyFolderInput').click();
  },

  tracksIn(folderId) {
    return this.tracks.filter(t => t.folderId === folderId)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  },

  async toggleFavorite(trackId) {
    const t = this.tracks.find(x => x.id === trackId); if (!t) return;
    t.favorite = !t.favorite;
    await VZ.db.put('tracks', t);
    VZ.engine.emit('library:changed');
    return t.favorite;
  },

  /* On-demand BPM/key analysis (only when asked, per spec) */
  async analyze(track) {
    const file = await this.fileForTrack(track);
    const buf = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    // Simple onset-energy BPM estimate on a mono downmix
    const data = audio.getChannelData(0);
    const sr = audio.sampleRate, hop = 1024;
    const energies = [];
    for (let i = 0; i + hop < data.length; i += hop) {
      let e = 0; for (let j = 0; j < hop; j += 4) e += data[i + j] * data[i + j];
      energies.push(e);
    }
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const peaks = [];
    for (let i = 2; i < energies.length - 2; i++)
      if (energies[i] > mean * 1.4 && energies[i] > energies[i-1] && energies[i] > energies[i+1]) peaks.push(i * hop / sr);
    const gaps = {};
    for (let i = 1; i < peaks.length; i++) {
      let g = peaks[i] - peaks[i-1];
      while (g < 0.24) g *= 2; while (g > 1) g /= 2;   // fold into 60–250bpm range
      const bpm = Math.round(60 / g);
      gaps[bpm] = (gaps[bpm] || 0) + 1;
    }
    const best = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
    track.bpm = best ? +best[0] : null;
    await VZ.db.put('tracks', track);
    VZ.engine.emit('library:changed');
    return track.bpm;
  },
};

/* ─────────── PLAYLISTS & CRATES ─────────── */
const Lists = VZ.lists = {
  playlists: [], crates: [],
  async load() {
    this.playlists = await VZ.db.all('playlists');
    this.crates = await VZ.db.all('crates');
  },
  async create(kind, name) {
    const rec = { id: kind[0] + '_' + Date.now(), name, trackIds: [] };
    await VZ.db.put(kind, rec);
    this[kind].push(rec);
    return rec;
  },
  async addTrack(kind, listId, trackId) {
    const rec = this[kind].find(l => l.id === listId); if (!rec) return;
    if (!rec.trackIds.includes(trackId)) { rec.trackIds.push(trackId); await VZ.db.put(kind, rec); }
  },
  async removeTrack(kind, listId, trackId) {
    const rec = this[kind].find(l => l.id === listId); if (!rec) return;
    rec.trackIds = rec.trackIds.filter(i => i !== trackId);
    await VZ.db.put(kind, rec);
  },
  async remove(kind, listId) {
    await VZ.db.del(kind, listId);
    this[kind] = this[kind].filter(l => l.id !== listId);
  },
};

/* ─────────── TAB 3 UI ─────────── */
let view = { type: 'root', id: null };   // root | folder | favorites | playlist | crate
const $ = id => document.getElementById(id);

function render() {
  const box = $('libBody'); if (!box) return;
  if (view.type === 'root') return renderRoot(box);
  if (view.type === 'folder') return renderTrackList(box, Core.tracksIn(view.id), Core.folders.find(f => f.id === view.id)?.name || 'Folder');
  if (view.type === 'favorites') return renderTrackList(box, Core.tracks.filter(t => t.favorite), '❤️ Favorites');
  const kind = view.type === 'playlist' ? 'playlists' : 'crates';
  const list = Lists[kind].find(l => l.id === view.id);
  const tracks = (list?.trackIds || []).map(id => Core.tracks.find(t => t.id === id)).filter(Boolean);
  renderTrackList(box, tracks, (view.type === 'playlist' ? '🎵 ' : '📦 ') + (list?.name || ''), { kind, listId: view.id });
}

function renderRoot(box) {
  const favCount = Core.tracks.filter(t => t.favorite).length;
  box.innerHTML = `
    <div class="lib-actions">
      <button class="btn primary" id="libAddFolderBtn">📁 Add Music Folder</button>
    </div>
    ${!REF_MODE ? `<div class="lib-note">This phone's Chrome doesn't yet support reading music in place, so added folders are copied into the app — a platform limit here, not the app's choice.</div>` : ''}
    <div class="sec-label">Folders</div>
    ${Core.folders.length ? Core.folders.map(f => `
      <div class="lib-row" data-open-folder="${f.id}">
        <span class="lib-ico">📁</span>
        <div class="lib-main"><div class="lib-title">${esc(f.name)}</div>
        <div class="lib-sub">${Core.tracksIn(f.id).length} songs · ${f.mode === 'ref' ? 'in place' : 'copied'}</div></div>
        <button class="lib-x" data-del-folder="${f.id}">✕</button>
      </div>`).join('') : `<div class="lib-empty">No folders yet — tap Add Music Folder to connect your music. You only do this once.</div>`}
    <div class="sec-label">Collections</div>
    <div class="lib-row" data-open-favs><span class="lib-ico">❤️</span><div class="lib-main"><div class="lib-title">Favorites</div><div class="lib-sub">${favCount} songs</div></div></div>
    <div class="sec-label">Playlists <button class="mini-add" data-new="playlists">+ New</button></div>
    ${Lists.playlists.map(p => `<div class="lib-row" data-open-pl="${p.id}"><span class="lib-ico">🎵</span><div class="lib-main"><div class="lib-title">${esc(p.name)}</div><div class="lib-sub">${p.trackIds.length} songs</div></div><button class="lib-x" data-del-list="playlists:${p.id}">✕</button></div>`).join('') || `<div class="lib-empty sm">For listening — build one with the ⋯ menu on any song.</div>`}
    <div class="sec-label">Crates <button class="mini-add" data-new="crates">+ New</button></div>
    ${Lists.crates.map(p => `<div class="lib-row" data-open-cr="${p.id}"><span class="lib-ico">📦</span><div class="lib-main"><div class="lib-title">${esc(p.name)}</div><div class="lib-sub">${p.trackIds.length} tracks</div></div><button class="lib-x" data-del-list="crates:${p.id}">✕</button></div>`).join('') || `<div class="lib-empty sm">For DJ prep — stock one before a session.</div>`}`;
  $('libAddFolderBtn').onclick = () => Core.addFolder();
  box.querySelectorAll('[data-open-folder]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('.lib-x')) return; view = { type: 'folder', id: el.dataset.openFolder }; render(); }));
  box.querySelector('[data-open-favs]')?.addEventListener('click', () => { view = { type: 'favorites' }; render(); });
  box.querySelectorAll('[data-open-pl]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('.lib-x')) return; view = { type: 'playlist', id: el.dataset.openPl }; render(); }));
  box.querySelectorAll('[data-open-cr]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('.lib-x')) return; view = { type: 'crate', id: el.dataset.openCr }; render(); }));
  box.querySelectorAll('[data-del-folder]').forEach(el => el.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm('Remove this folder from the library? (The music itself stays on your phone.)')) { await Core.removeFolder(el.dataset.delFolder); render(); }
  }));
  box.querySelectorAll('[data-del-list]').forEach(el => el.addEventListener('click', async e => {
    e.stopPropagation();
    const [kind, id] = el.dataset.delList.split(':');
    if (confirm('Delete this list? (Songs are not affected.)')) { await Lists.remove(kind, id); render(); }
  }));
  box.querySelectorAll('[data-new]').forEach(el => el.addEventListener('click', async () => {
    const name = prompt(el.dataset.new === 'playlists' ? 'Playlist name:' : 'Crate name:');
    if (name?.trim()) { await Lists.create(el.dataset.new, name.trim()); render(); }
  }));
}

function renderTrackList(box, tracks, title, listCtx) {
  box.innerHTML = `
    <div class="lib-head-row">
      <button class="btn ghost" id="libBackBtn">← Back</button>
      <div class="lib-head-title">${title}</div>
    </div>
    ${tracks.length ? tracks.map((t, i) => `
      <div class="lib-row track" data-play="${i}">
        <span class="lib-ico">${t.favorite ? '❤️' : '🎵'}</span>
        <div class="lib-main">
          <div class="lib-title">${esc(t.title)}</div>
          <div class="lib-sub">${esc(t.path.includes('/') ? t.path.split('/').slice(0, -1).join('/') : '')}${t.bpm ? ` · ${t.bpm} BPM` : ''}</div>
        </div>
        <button class="lib-x" data-menu="${t.id}">⋯</button>
      </div>`).join('') : `<div class="lib-empty">Nothing here yet.</div>`}`;
  $('libBackBtn').onclick = () => { view = { type: 'root' }; render(); };
  box.querySelectorAll('[data-play]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('[data-menu]')) return;
    VZ.player.playQueue(tracks, +el.dataset.play);   // plays in folder order, per spec
    VZ.shell.showTab('player');
  }));
  box.querySelectorAll('[data-menu]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    trackMenu(el.dataset.menu, listCtx);
  }));
}

function trackMenu(trackId, listCtx) {
  const t = Core.tracks.find(x => x.id === trackId); if (!t) return;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-overlay open';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(t.title)}</div>
      <button class="sheet-btn" data-act="fav">${t.favorite ? '💔 Remove Favorite' : '❤️ Favorite'}</button>
      <button class="sheet-btn" data-act="pl">🎵 Add to Playlist…</button>
      <button class="sheet-btn" data-act="cr">📦 Add to Crate…</button>
      <button class="sheet-btn" data-act="an">${t.bpm ? `🔬 Re-analyze (now ${t.bpm} BPM)` : '🔬 Analyze BPM'}</button>
      ${listCtx ? `<button class="sheet-btn" data-act="rm">➖ Remove from this list</button>` : ''}
      <button class="sheet-btn ghost" data-act="x">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('.sheet-btn').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'fav') await Core.toggleFavorite(trackId);
    if (act === 'pl' || act === 'cr') {
      const kind = act === 'pl' ? 'playlists' : 'crates';
      const options = Lists[kind];
      let target = null;
      if (!options.length) {
        const name = prompt(`No ${kind} yet — name a new one:`);
        if (name?.trim()) target = await Lists.create(kind, name.trim());
      } else {
        const pick = prompt(`Add to which? Type the number:\n${options.map((o, i) => `${i + 1}. ${o.name}`).join('\n')}\n(or type a new name)`);
        if (pick?.trim()) {
          const n = parseInt(pick, 10);
          target = (n >= 1 && n <= options.length) ? options[n - 1] : await Lists.create(kind, pick.trim());
        }
      }
      if (target) { await Lists.addTrack(kind, target.id, trackId); VZ.toast(`Added to "${target.name}".`, 'ok'); }
    }
    if (act === 'an') {
      VZ.toast('Analyzing…', 'info', 1500);
      try { const bpm = await Core.analyze(t); VZ.toast(bpm ? `≈ ${bpm} BPM` : 'Couldn\'t detect a steady beat.', bpm ? 'ok' : 'warn'); }
      catch (err) { VZ.toast('Analysis failed: ' + err.message, 'error'); }
    }
    if (act === 'rm' && listCtx) { await Lists.removeTrack(listCtx.kind, listCtx.listId, trackId); }
    close(); render();
  }));
}

VZ.libraryTab = { render, reset() { view = { type: 'root' }; render(); } };

document.addEventListener('DOMContentLoaded', async () => {
  await Core.load(); await Lists.load();
  document.getElementById('copyFolderInput')?.addEventListener('change', e => Core.addFolderCopy(e.target.files));
  VZ.engine.on('library:changed', render);
  render();
});
})();
