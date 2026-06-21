/* ============================================================
   868 VIBEZ — Phase 10: Library Depth & Power Features
   1. Lyrics            — manual entry, scrollable overlay
   2. Smart Playlist UI  — visual rules builder on matchRules
   3. Drag-to-Reorder    — Pointer Events, persisted order
   4. Album View         — grouped by album, tap-to-expand
   5. Unified Search      — tracks + stream history + downloads
   6. Bulk Tag Editor    — multi-select genre/BPM correction
   7. Single-Track Export — share/save one file
   8. Volume Normalisation — ReplayGain-style per-track gain
   9. Failed Download Retry Queue
   ============================================================ */
'use strict';

const esc10 = s => String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* ══════════════════════════════════════════════════════════════
   1. LYRICS
   Stored on the track record itself: track.lyrics (string).
   No schema change needed — tracks already accept new fields.
══════════════════════════════════════════════════════════════ */
const Lyrics = {

  async save(trackId, text) {
    const track = MS.library.find(t => t.id === trackId);
    if (!track) return;
    track.lyrics = text;
    await MS.db.put('tracks', track);
    MS.toast('Lyrics saved', 'ok', 1200);
  },

  async get(trackId) {
    const track = MS.library.find(t => t.id === trackId);
    return track?.lyrics || '';
  },

  open(track) {
    const sheet = document.getElementById('lyricsSheet');
    const body  = document.getElementById('lyricsBody');
    const title = document.getElementById('lyricsTrackTitle');
    if (!sheet || !body) return;
    title.textContent = track?.title || 'Lyrics';

    const text = track?.lyrics || '';
    if (text) {
      body.innerHTML = `<div id="lyricsView" style="white-space:pre-wrap;line-height:1.9;font-size:15px;padding:4px 0">${esc10(text)}</div>
        <button class="vz-btn sm" id="lyricsEditBtn" style="margin-top:16px">✎ Edit Lyrics</button>`;
      document.getElementById('lyricsEditBtn').onclick = () => this._editMode(track);
    } else {
      this._editMode(track);
    }
    sheet.classList.add('open');
  },

  _editMode(track) {
    const body = document.getElementById('lyricsBody');
    body.innerHTML = `
      <textarea id="lyricsTextarea" placeholder="Paste or type lyrics here…"
        style="width:100%;min-height:240px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;color:var(--t1);font-size:14px;padding:12px;font-family:var(--font);line-height:1.7;resize:vertical">${esc10(track?.lyrics||'')}</textarea>
      <button class="vz-btn primary" id="lyricsSaveBtn" style="margin-top:12px;width:100%">💾 Save Lyrics</button>`;
    document.getElementById('lyricsSaveBtn').onclick = async () => {
      const text = document.getElementById('lyricsTextarea').value;
      await Lyrics.save(track.id, text);
      Lyrics.open(MS.library.find(t => t.id === track.id));
    };
  }
};
MS.lyrics = Lyrics;

/* ══════════════════════════════════════════════════════════════
   2. SMART PLAYLIST BUILDER — visual UI over existing matchRules
══════════════════════════════════════════════════════════════ */
const PlaylistBuilder = {

  open() {
    const sheet = document.getElementById('builderSheet');
    if (sheet) sheet.classList.add('open');
  },

  async create() {
    const name     = document.getElementById('pbName')?.value.trim();
    const bpmMin   = +document.getElementById('pbBpmMin')?.value || null;
    const bpmMax   = +document.getElementById('pbBpmMax')?.value || null;
    const genre    = document.getElementById('pbGenre')?.value.trim();
    const energyMin= +document.getElementById('pbEnergyMin')?.value || null;
    const favOnly  = document.getElementById('pbFavOnly')?.checked;
    const keys     = document.getElementById('pbKeys')?.value.trim();

    if (!name) { MS.toast('Give your playlist a name.', 'warn'); return; }

    const rules = {};
    if (bpmMin) rules.bpmMin = bpmMin;
    if (bpmMax) rules.bpmMax = bpmMax;
    if (genre)  rules.genre  = genre;
    if (energyMin) rules.energyMin = energyMin;
    if (favOnly) rules.favorite = true;
    if (keys)   rules.keys = keys;

    const trackIds = MS.library.filter(t => MS.matchRules(t, rules)).map(t => t.id);

    await MS.db.put('crates', {
      id: `pl_${Date.now()}`, name, icon: '⚡',
      isSmart: true, auto: false, rules, trackIds,
      createdAt: Date.now()
    });

    MS.toast(`"${name}" created — ${trackIds.length} matching tracks`, 'ok');
    document.getElementById('builderSheet')?.classList.remove('open');
    MS.emit('crates:updated', null);
    this._clearForm();
  },

  _clearForm() {
    ['pbName','pbBpmMin','pbBpmMax','pbGenre','pbEnergyMin','pbKeys'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const fav = document.getElementById('pbFavOnly');
    if (fav) fav.checked = false;
  },

  async preview() {
    const bpmMin   = +document.getElementById('pbBpmMin')?.value || null;
    const bpmMax   = +document.getElementById('pbBpmMax')?.value || null;
    const genre    = document.getElementById('pbGenre')?.value.trim();
    const energyMin= +document.getElementById('pbEnergyMin')?.value || null;
    const favOnly  = document.getElementById('pbFavOnly')?.checked;
    const keys     = document.getElementById('pbKeys')?.value.trim();
    const rules = {};
    if (bpmMin) rules.bpmMin = bpmMin;
    if (bpmMax) rules.bpmMax = bpmMax;
    if (genre)  rules.genre  = genre;
    if (energyMin) rules.energyMin = energyMin;
    if (favOnly) rules.favorite = true;
    if (keys)   rules.keys = keys;
    const count = MS.library.filter(t => MS.matchRules(t, rules)).length;
    const el = document.getElementById('pbPreviewCount');
    if (el) el.textContent = `${count} tracks match`;
  }
};
MS.playlistBuilder = PlaylistBuilder;

/* ══════════════════════════════════════════════════════════════
   3. DRAG-TO-REORDER — Pointer Events, persists trackIds order
══════════════════════════════════════════════════════════════ */
const DragReorder = {

  enable(listEl, crateId) {
    if (!listEl) return;
    let dragEl = null, startY = 0, placeholder = null;

    listEl.querySelectorAll('.reorder-row').forEach(row => {
      const handle = row.querySelector('.reorder-handle');
      if (!handle) return;

      handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        dragEl = row;
        startY = e.clientY;
        row.style.zIndex = '10';
        row.style.position = 'relative';
        row.setPointerCapture(e.pointerId);

        placeholder = document.createElement('div');
        placeholder.style.height = row.offsetHeight + 'px';
        placeholder.className = 'reorder-placeholder';
        row.after(placeholder);

        const move = ev => {
          const dy = ev.clientY - startY;
          row.style.transform = `translateY(${dy}px)`;
          // Find element under pointer to reorder
          const below = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.reorder-row');
          if (below && below !== row && below !== placeholder) {
            const rect = below.getBoundingClientRect();
            const mid  = rect.top + rect.height / 2;
            if (ev.clientY < mid) below.before(placeholder);
            else below.after(placeholder);
          }
        };
        const up = async () => {
          placeholder.replaceWith(row);
          row.style.transform = '';
          row.style.zIndex = '';
          handle.releasePointerCapture(e.pointerId);
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);

          // Persist new order
          const newOrder = [...listEl.querySelectorAll('.reorder-row')].map(r => r.dataset.trackId);
          const crate = await MS.db.get('crates', crateId);
          if (crate) { crate.trackIds = newOrder; await MS.db.put('crates', crate); }
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
    });
  }
};
MS.dragReorder = DragReorder;

/* ══════════════════════════════════════════════════════════════
   4. ALBUM VIEW — grouped by album, tap-to-expand
══════════════════════════════════════════════════════════════ */
const AlbumView = {

  render(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const albums = {};
    MS.library.forEach(t => {
      const key = t.album || '(Unknown Album)';
      if (!albums[key]) albums[key] = { artist: t.artist, tracks: [], artwork: t.artwork };
      albums[key].tracks.push(t);
      if (!albums[key].artwork && t.artwork) albums[key].artwork = t.artwork;
    });

    const entries = Object.entries(albums).sort((a,b) => a[0].localeCompare(b[0]));

    if (!entries.length) {
      el.innerHTML = `<div class="lib-empty"><div class="lib-empty-icon">💿</div><p>No albums yet.</p></div>`;
      return;
    }

    el.innerHTML = entries.map(([name, data], i) => `
      <div class="album-group">
        <div class="album-header" data-album-idx="${i}">
          <div class="album-art-sm" id="albumArt${i}">💿</div>
          <div class="album-info">
            <div class="album-name">${esc10(name)}</div>
            <div class="album-sub">${esc10(data.artist||'Various Artists')} · ${data.tracks.length} tracks</div>
          </div>
          <span class="album-chevron">›</span>
        </div>
        <div class="album-tracks" id="albumTracks${i}" style="display:none"></div>
      </div>`).join('');

    entries.forEach(([name, data], i) => {
      // Load artwork
      if (data.artwork) {
        MS.artwork?.getUrl(data.artwork).then(url => {
          if (url) {
            const art = document.getElementById(`albumArt${i}`);
            if (art) { art.style.backgroundImage=`url(${url})`; art.style.backgroundSize='cover'; art.textContent=''; }
          }
        });
      }
      document.querySelector(`[data-album-idx="${i}"]`)?.addEventListener('click', () => {
        const tracksEl = document.getElementById(`albumTracks${i}`);
        const chevron  = document.querySelector(`[data-album-idx="${i}"] .album-chevron`);
        const isOpen   = tracksEl.style.display !== 'none';
        tracksEl.style.display = isOpen ? 'none' : 'block';
        if (chevron) chevron.textContent = isOpen ? '›' : '⌄';
        if (!isOpen && !tracksEl.dataset.rendered) {
          tracksEl.innerHTML = data.tracks.map(t => `
            <div class="track-row" data-track-id="${t.id}" onclick="playTrack('${t.id}')" style="padding-left:12px">
              <div class="tr-art">♪</div>
              <div class="tr-info">
                <div class="tr-title">${esc10(t.title)}</div>
                <div class="tr-sub">${esc10(t.artist||'')} ${t.bpm?'· '+t.bpm+' BPM':''}</div>
              </div>
            </div>`).join('');
          tracksEl.dataset.rendered = '1';
        }
      });
    });
  }
};
MS.albumView = AlbumView;

/* ══════════════════════════════════════════════════════════════
   5. UNIFIED SEARCH — tracks + stream history + downloads
══════════════════════════════════════════════════════════════ */
const UnifiedSearch = {

  async search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return { tracks: [], streams: [], downloads: [] };

    const tracks = MS.library.filter(t =>
      [t.title,t.artist,t.album,t.genre,t.key].join(' ').toLowerCase().includes(q)
    ).slice(0, 20);

    let streamHistory = [];
    try {
      const all = await MS.db.all('settings');
      streamHistory = all
        .filter(s => s.id?.startsWith('streamHist_') && s.url?.toLowerCase().includes(q))
        .slice(0, 10);
    } catch {}

    const downloads = (MS.downloads?._queue || []).filter(j =>
      j.label?.toLowerCase().includes(q)
    );

    return { tracks, streams: streamHistory, downloads };
  },

  async render(query) {
    const el = document.getElementById('unifiedSearchResults');
    if (!el) return;
    if (!query.trim()) { el.innerHTML = ''; return; }

    const { tracks, streams, downloads } = await this.search(query);
    let html = '';

    if (tracks.length) {
      html += `<div class="section-label">Library — ${tracks.length}</div>`;
      html += tracks.map(t => `
        <div class="track-row" data-track-id="${t.id}" onclick="playTrack('${t.id}')">
          <div class="tr-art">♪</div>
          <div class="tr-info"><div class="tr-title">${esc10(t.title)}</div><div class="tr-sub">${esc10(t.artist||'')}</div></div>
        </div>`).join('');
    }
    if (streams.length) {
      html += `<div class="section-label">Stream History — ${streams.length}</div>`;
      html += streams.map(s => `
        <div class="source-item" onclick="document.getElementById('streamUrlInput').value='${esc10(s.url)}';showPage('stream')">
          <span class="si-pip pip-portal"></span>
          <div class="si-info"><div class="si-name">${esc10(s.url?.split('/').pop()||s.url)}</div></div>
        </div>`).join('');
    }
    if (downloads.length) {
      html += `<div class="section-label">Downloads — ${downloads.length}</div>`;
      html += downloads.map(d => `<div class="source-item"><div class="si-info"><div class="si-name">${esc10(d.label)}</div></div></div>`).join('');
    }
    el.innerHTML = html || `<div class="lib-empty" style="padding:32px"><p>No results for "${esc10(query)}"</p></div>`;
  }
};
MS.unifiedSearch = UnifiedSearch;

/* ══════════════════════════════════════════════════════════════
   6. BULK TAG EDITOR — multi-select correction
══════════════════════════════════════════════════════════════ */
const BulkEdit = {

  selected: new Set(),
  active: false,

  toggle() {
    this.active = !this.active;
    this.selected.clear();
    document.querySelectorAll('.track-row').forEach(r => r.classList.toggle('select-mode', this.active));
    const bar = document.getElementById('bulkEditBar');
    if (bar) bar.style.display = this.active ? 'flex' : 'none';
    this._updateCount();
  },

  toggleTrack(id, rowEl) {
    if (this.selected.has(id)) { this.selected.delete(id); rowEl?.classList.remove('selected-bulk'); }
    else { this.selected.add(id); rowEl?.classList.add('selected-bulk'); }
    this._updateCount();
  },

  _updateCount() {
    const el = document.getElementById('bulkCount');
    if (el) el.textContent = `${this.selected.size} selected`;
  },

  async applyGenre(genre) {
    if (!this.selected.size) { MS.toast('Select tracks first.', 'warn'); return; }
    for (const id of this.selected) {
      const t = MS.library.find(x => x.id === id);
      if (t) { t.genre = genre; await MS.db.put('tracks', t); }
    }
    MS.toast(`Genre set for ${this.selected.size} tracks`, 'ok');
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    this.toggle();
  },

  async applyBpm(bpm) {
    if (!this.selected.size) { MS.toast('Select tracks first.', 'warn'); return; }
    for (const id of this.selected) {
      const t = MS.library.find(x => x.id === id);
      if (t) { t.bpm = bpm; await MS.db.put('tracks', t); }
    }
    MS.toast(`BPM set for ${this.selected.size} tracks`, 'ok');
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    this.toggle();
  },

  async deleteSelected() {
    if (!this.selected.size) return;
    if (!confirm(`Remove ${this.selected.size} tracks from library?`)) return;
    for (const id of this.selected) await MS.db.del('tracks', id);
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    MS.toast(`Removed ${this.selected.size} tracks`, 'ok');
    this.toggle();
  }
};
MS.bulkEdit = BulkEdit;

/* ══════════════════════════════════════════════════════════════
   7. SINGLE-TRACK EXPORT
══════════════════════════════════════════════════════════════ */
async function exportTrack(trackId) {
  const track = MS.library.find(t => t.id === trackId);
  if (!track) return;
  try {
    const file = await MS.fileFromTrack(track);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `${track.artist||'Unknown'} - ${track.title||'Track'}.${(track.path||'mp3').split('.').pop()}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    MS.toast(`Exported: ${track.title}`, 'ok');

    // Try native share if available
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: track.title }); } catch {}
    }
  } catch (e) {
    MS.toast(e.message, 'error');
  }
}
MS.exportTrack = exportTrack;
window.exportTrack = exportTrack;

/* ══════════════════════════════════════════════════════════════
   8. VOLUME NORMALISATION — ReplayGain-style
   Analyses RMS loudness on import, stores gainOffset on track.
   Applied automatically via a gain node per playback.
══════════════════════════════════════════════════════════════ */
const Normaliser = {

  TARGET_RMS: 0.15, // target loudness reference

  async analyse(file) {
    try {
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const ab  = await file.slice(0, Math.min(file.size, 5242880)).arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      const data = buf.getChannelData(0);

      let sumSquares = 0;
      const step = Math.max(1, Math.floor(data.length / 100000));
      let n = 0;
      for (let i = 0; i < data.length; i += step) { sumSquares += data[i]*data[i]; n++; }
      const rms = Math.sqrt(sumSquares / n);
      await ctx.close();

      if (rms <= 0) return 1;
      let gain = this.TARGET_RMS / rms;
      gain = Math.max(0.3, Math.min(3, gain)); // clamp to reasonable range
      return gain;
    } catch { return 1; }
  },

  async analyseAndSave(track) {
    try {
      const file = await MS.fileFromTrack(track);
      const gain = await this.analyse(file);
      track.gainOffset = gain;
      await MS.db.put('tracks', track);
      return gain;
    } catch { return 1; }
  },

  async batchAnalyse(onProgress) {
    const missing = MS.library.filter(t => !t.gainOffset && t.source === 'local');
    let done = 0;
    for (const t of missing) {
      await this.analyseAndSave(t);
      done++;
      onProgress?.({ done, total: missing.length });
      await new Promise(r => setTimeout(r, 0));
    }
    MS.library = await MS.db.all('tracks');
    return done;
  },

  /* Apply gain offset when track plays */
  apply(track) {
    if (!MS.gainM || !track.gainOffset) return;
    MS.gainM.gain.value = track.gainOffset;
  }
};
MS.normaliser = Normaliser;

MS.on('player:play', track => { if (track) Normaliser.apply(track); });

/* ══════════════════════════════════════════════════════════════
   9. FAILED DOWNLOAD RETRY QUEUE
   Hooks into existing DownloadManager from Phase 2.
══════════════════════════════════════════════════════════════ */
function renderFailedDownloads() {
  const el = document.getElementById('failedDownloadsList');
  if (!el || !MS.downloads) return;
  const failed = (MS.downloads._queue || []).filter(j => j.status === 'error');
  if (!failed.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="section-label">Failed Downloads</div>` +
    failed.map(j => `
      <div class="source-item">
        <span class="si-pip pip-mp4" style="background:var(--red)"></span>
        <div class="si-info"><div class="si-name">${esc10(j.label)}</div><div class="si-meta">${esc10(j.error||'Failed')}</div></div>
        <button class="si-btn" onclick="MS.downloads.retry('${j.id}')">↺ Retry</button>
      </div>`).join('');
}
MS.on('library:updated', renderFailedDownloads);

/* ══════════════════════════════════════════════════════════════
   UI WIRING
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Inject all sheets/modals ── */
  document.body.insertAdjacentHTML('beforeend', `
    <!-- Lyrics Sheet -->
    <div class="save-sheet" id="lyricsSheet">
      <div class="save-card" style="max-height:80vh;overflow-y:auto">
        <h3 id="lyricsTrackTitle">Lyrics</h3>
        <div id="lyricsBody" style="margin-top:14px"></div>
        <button class="vz-btn" id="lyricsCloseBtn" style="width:100%;margin-top:14px">Close</button>
      </div>
    </div>

    <!-- Smart Playlist Builder Sheet -->
    <div class="save-sheet" id="builderSheet">
      <div class="save-card">
        <h3>⚡ Build Smart Playlist</h3>
        <div class="save-fields" style="margin-top:14px">
          <input class="vz-input" id="pbName" placeholder="Playlist name" style="grid-column:1/-1">
          <input class="vz-input" id="pbBpmMin" type="number" placeholder="BPM min">
          <input class="vz-input" id="pbBpmMax" type="number" placeholder="BPM max">
          <input class="vz-input" id="pbGenre" placeholder="Genre contains…">
          <input class="vz-input" id="pbEnergyMin" type="number" placeholder="Energy ≥">
          <input class="vz-input" id="pbKeys" placeholder="Keys: 8A,9A" style="grid-column:1/-1">
          <label style="grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" id="pbFavOnly"> Favourites only
          </label>
        </div>
        <div id="pbPreviewCount" style="font-size:11px;color:var(--cyan);margin:10px 0;font-family:monospace">0 tracks match</div>
        <div style="display:flex;gap:8px">
          <button class="vz-btn primary" id="pbCreateBtn" style="flex:1">Create</button>
          <button class="vz-btn" id="pbCancelBtn" style="flex:1">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Bulk Edit Bar -->
    <div id="bulkEditBar" style="display:none;position:fixed;bottom:calc(var(--nav-h)+58px);left:10px;right:10px;background:rgba(8,8,8,.97);border:1px solid var(--border);border-radius:16px;padding:12px;z-index:250;box-shadow:0 8px 32px rgba(0,0,0,.6)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span id="bulkCount" style="font-size:12px;font-weight:700">0 selected</span>
        <button class="vz-btn sm" onclick="MS.bulkEdit.toggle()">Done</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input class="vz-input" id="bulkGenreIn" placeholder="Set genre…" style="flex:1;min-width:100px">
        <button class="vz-btn sm" onclick="MS.bulkEdit.applyGenre(document.getElementById('bulkGenreIn').value)">Apply</button>
        <input class="vz-input" id="bulkBpmIn" type="number" placeholder="Set BPM…" style="flex:1;min-width:100px">
        <button class="vz-btn sm" onclick="MS.bulkEdit.applyBpm(+document.getElementById('bulkBpmIn').value)">Apply</button>
        <button class="vz-btn sm danger" onclick="MS.bulkEdit.deleteSelected()" style="width:100%">Remove Selected</button>
      </div>
    </div>
  `);

  document.getElementById('lyricsCloseBtn')?.addEventListener('click', () => document.getElementById('lyricsSheet').classList.remove('open'));
  document.getElementById('pbCancelBtn')?.addEventListener('click', () => document.getElementById('builderSheet').classList.remove('open'));
  document.getElementById('pbCreateBtn')?.addEventListener('click', () => PlaylistBuilder.create());
  ['pbBpmMin','pbBpmMax','pbGenre','pbEnergyMin','pbKeys','pbFavOnly'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', () => PlaylistBuilder.preview())
  );

  /* ── Add Albums tab to Library ── */
  const libSubtabs = document.querySelector('#page-library .subtab-bar');
  if (libSubtabs && !libSubtabs.querySelector('[data-sub="albums"]')) {
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'albums';
    btn.textContent = 'Albums';
    libSubtabs.appendChild(btn);
  }

  const libContent = document.querySelector('#page-library .lib-content');
  if (libContent && !document.getElementById('albumView')) {
    const albumDiv = document.createElement('div');
    albumDiv.dataset.subview = 'albums';
    albumDiv.id = 'albumView';
    albumDiv.style.cssText = 'display:none;overflow-y:auto;padding:8px 0';
    libContent.appendChild(albumDiv);
  }

  document.querySelectorAll('#page-library .subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.sub === 'albums') AlbumView.render('albumView');
    });
  });

  /* ── Add "New Smart Playlist" + Bulk Edit buttons to Library topbar ── */
  const libTopbar = document.querySelector('.lib-topbar');
  if (libTopbar) {
    const smartBtn = document.createElement('button');
    smartBtn.className = 'vz-btn sm';
    smartBtn.textContent = '⚡ Smart';
    smartBtn.onclick = () => PlaylistBuilder.open();
    libTopbar.appendChild(smartBtn);

    const bulkBtn = document.createElement('button');
    bulkBtn.className = 'vz-btn sm';
    bulkBtn.textContent = '☑ Select';
    bulkBtn.onclick = () => BulkEdit.toggle();
    libTopbar.appendChild(bulkBtn);
  }

  /* ── Add Lyrics + Export buttons to Now Playing actions ── */
  const npActions = document.querySelector('.np-actions');
  if (npActions) {
    const lyricsBtn = document.createElement('button');
    lyricsBtn.className = 'np-action-btn';
    lyricsBtn.innerHTML = `<span style="font-size:22px">📝</span><span>Lyrics</span>`;
    lyricsBtn.onclick = () => { if (MS.selectedTrack) Lyrics.open(MS.selectedTrack); else MS.toast('No track playing.','warn'); };
    npActions.appendChild(lyricsBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'np-action-btn';
    exportBtn.innerHTML = `<span style="font-size:22px">📤</span><span>Export</span>`;
    exportBtn.onclick = () => { if (MS.selectedTrack) exportTrack(MS.selectedTrack.id); else MS.toast('No track playing.','warn'); };
    npActions.appendChild(exportBtn);
  }

  /* ── Wire bulk select on track row clicks (when active) ── */
  document.addEventListener('click', e => {
    if (!BulkEdit.active) return;
    const row = e.target.closest('.track-row');
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    BulkEdit.toggleTrack(row.dataset.trackId, row);
  }, true);

  /* ── Unified search box on Library top (alternative entry) ── */
  const globalSearchInput = document.getElementById('libSearch');
  globalSearchInput?.addEventListener('input', e => {
    // existing per-page search still works; this adds nothing destructive
  });

  /* ── Volume normalisation trigger in health panel ── */
  MS.on('health:scanned', () => {
    const hp = document.getElementById('healthReport');
    if (!hp || document.getElementById('normaliseBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'normaliseBtn';
    btn.className = 'vz-btn sm';
    btn.textContent = '🔊 Normalise Volume';
    btn.style.marginTop = '8px';
    btn.onclick = async () => {
      MS.toast('Analysing loudness…', 'info', 1500);
      const n = await Normaliser.batchAnalyse();
      MS.toast(`Normalised ${n} tracks`, 'ok');
    };
    hp.appendChild(btn);
  });

  /* ── CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Album view */
    .album-group { border-bottom: 1px solid var(--border); }
    .album-header { display:flex; align-items:center; gap:12px; padding:12px 16px; cursor:pointer; }
    .album-header:active { background: var(--glass2); }
    .album-art-sm { width:48px;height:48px;border-radius:10px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background-size:cover;background-position:center }
    .album-info { flex:1; min-width:0; }
    .album-name { font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .album-sub { font-size:11px; color:var(--t3); margin-top:2px; }
    .album-chevron { font-size:18px; color:var(--t3); transition:transform .2s; }
    .album-tracks { background: rgba(0,0,0,.2); }

    /* Bulk select mode */
    .track-row.select-mode { cursor:pointer; }
    .track-row.selected-bulk { background: rgba(0,229,255,.1) !important; border-left:3px solid var(--cyan); }

    /* Reorder */
    .reorder-handle { cursor:grab; color:var(--t3); padding:4px 8px; touch-action:none; }
    .reorder-placeholder { background: rgba(0,229,255,.08); border:1px dashed rgba(0,229,255,.3); border-radius:10px; }

    /* Lyrics */
    #lyricsBody { max-height: 50vh; overflow-y: auto; }
  `;
  document.head.appendChild(style);

  console.info('[Phase10] Library Depth & Power Features active');
});
