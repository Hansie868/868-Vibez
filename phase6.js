/* ============================================================
   868 VIBEZ — Phase 6: Storage & Backup
   1. Library backup to .868 JSON format
   2. Restore wizard (one-tap recovery)
   3. Automatic daily snapshots
   ============================================================ */
'use strict';

const Backup = {

  VERSION: '868vibez-v1.1',

  /* ── Export full library to .868 file ── */
  async export() {
    MS.toast('Building backup…', 'info', 1500);
    try {
      const tracks    = await MS.db.all('tracks');
      const cuePoints = await MS.db.all('cuePoints');
      const crates    = await MS.db.all('crates');
      const settings  = await MS.db.all('settings');
      const stats     = await MS.db.all('stats').catch(() => []);

      // Strip file handles (not serialisable)
      const cleanTracks = tracks.map(t => {
        const { _fileHandle, ...clean } = t;
        return clean;
      });

      const payload = {
        version:    this.VERSION,
        exportedAt: Date.now(),
        deviceInfo: { userAgent: navigator.userAgent, language: navigator.language },
        library:    cleanTracks,
        cuePoints,
        crates,
        settings:   settings.filter(s => !s.id?.startsWith('customSite_') || true),
        stats,
        meta: {
          trackCount:    cleanTracks.length,
          favourites:    cleanTracks.filter(t => t.favorite).length,
          withArtwork:   cleanTracks.filter(t => t.artwork).length,
          withBpm:       cleanTracks.filter(t => t.bpm).length,
          withKey:       cleanTracks.filter(t => t.key).length,
        }
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const ts   = new Date().toISOString().slice(0, 10);
      const name = `868-vibez-library-${ts}.868`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);

      // Save snapshot record
      await this._saveSnapshot(payload.meta, name);

      MS.toast(`✓ Backup saved: ${name} (${(json.length/1024).toFixed(0)} KB)`, 'ok', 3000);
      return payload;
    } catch (e) {
      MS.toast(`Backup failed: ${e.message}`, 'error');
      return null;
    }
  },

  /* ── Import from .868 file ── */
  async import(file) {
    try {
      const text    = await file.text();
      const payload = JSON.parse(text);

      if (!payload.version?.startsWith('868vibez')) {
        MS.toast('Not a valid 868 Vibez backup file.', 'error');
        return false;
      }

      const { library, cuePoints, crates, settings, stats } = payload;
      MS.toast(`Restoring ${library?.length || 0} tracks…`, 'info', 2000);

      // Restore tracks (don't overwrite existing with same id if newer)
      let newTrackCount = 0;
      for (const t of library || []) {
        const existing = await MS.db.get('tracks', t.id);
        if (!existing || (t.dateImported || 0) > (existing.dateImported || 0)) {
          await MS.db.put('tracks', t);
          if (!existing) newTrackCount++;
        }
      }

      for (const c of cuePoints || []) await MS.db.put('cuePoints', c);
      for (const c of crates    || []) await MS.db.put('crates', c);
      for (const s of settings  || []) await MS.db.put('settings', s);
      for (const s of stats     || []) await MS.db.put('stats', s).catch(() => {});

      MS.library = await MS.db.all('tracks');
      MS.emit('library:updated', MS.library);
      MS.toast(`✓ Restored ${library?.length || 0} tracks from backup.`, 'ok');

      // AUDIT FIX: imported tracks have no FileSystemFileHandle — these
      // are live OS-level references that genuinely cannot be serialized
      // to JSON, so a .868 backup can only ever restore metadata (titles,
      // cues, crates, stats), never the actual playable audio link. If
      // any newly-added tracks lack a corresponding entry in the
      // 'handles' store, tell the user clearly what to do next instead
      // of letting them discover silent playback failures one track at
      // a time.
      if (newTrackCount > 0) {
        let unlinked = 0;
        for (const t of library || []) {
          const h = await MS.db.get('handles', t.id);
          if (!h) unlinked++;
        }
        if (unlinked > 0) this._showRelinkNotice(unlinked);
      }

      return true;
    } catch (e) {
      MS.toast(`Restore failed: ${e.message}`, 'error');
      return false;
    }
  },

  _showRelinkNotice(count) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; top:60px; left:12px; right:12px; z-index:600;
      background:rgba(8,8,8,.97); border:1px solid rgba(251,191,36,.4);
      border-radius:14px; padding:14px; display:flex; align-items:center; gap:12px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);
    `;
    el.innerHTML = `
      <span style="font-size:22px">🔗</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700;color:var(--yellow)">Re-link your music folder</div>
        <div style="font-size:11px;color:var(--t3);line-height:1.5;margin-top:2px">
          ${count} restored track${count===1?'':'s'} need${count===1?'s':''} their audio files re-linked —
          backups only restore titles, cues, and playlists, not the files themselves.
          Open My Library and tap "Open Folder" pointing to the same music folder.
        </div>
      </div>
      <button style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer;flex-shrink:0"
        onclick="this.closest('div').parentElement.remove()">✕</button>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  },

  /* ── Auto snapshot (daily) ── */
  async autoSnapshot() {
    const key  = 'vz_last_snapshot';
    const last = localStorage.getItem(key);
    const now  = Date.now();
    const day  = 86400000;

    if (last && now - parseInt(last) < day) return; // already snapped today

    try {
      const tracks   = await MS.db.all('tracks');
      const snapshot = {
        id:         `snap_${now}`,
        value:      JSON.stringify({
          tracks:    tracks.map(({ _fileHandle, ...t }) => t),
          timestamp: now,
          count:     tracks.length
        }),
        createdAt: now
      };
      await MS.db.put('settings', snapshot);
      localStorage.setItem(key, String(now));
      console.info(`[Phase6] Daily snapshot saved — ${tracks.length} tracks`);
    } catch (e) {
      console.warn('[Phase6] Snapshot failed:', e.message);
    }
  },

  /* ── List saved snapshots ── */
  async listSnapshots() {
    const all = await MS.db.all('settings');
    return all
      .filter(s => s.id?.startsWith('snap_'))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 10);
  },

  async _saveSnapshot(meta, filename) {
    await MS.db.put('settings', {
      id:        `snap_${Date.now()}`,
      filename,
      meta,
      createdAt: Date.now()
    });
  },

  /* ── Restore from a settings store snapshot ── */
  async restoreSnapshot(snapId) {
    const snap = await MS.db.get('settings', snapId);
    if (!snap?.value) { MS.toast('Snapshot not found.', 'warn'); return; }
    try {
      const data = JSON.parse(snap.value);
      for (const t of data.tracks || []) await MS.db.put('tracks', t);
      MS.library = await MS.db.all('tracks');
      MS.emit('library:updated', MS.library);
      MS.toast(`✓ Snapshot restored — ${data.count} tracks.`, 'ok');
    } catch (e) {
      MS.toast(`Snapshot restore failed: ${e.message}`, 'error');
    }
  }
};

MS.backup = Backup;

/* ══ UI ══ */
document.addEventListener('DOMContentLoaded', () => {

  // Auto snapshot on boot
  MS.on('boot:complete', () => setTimeout(() => Backup.autoSnapshot(), 3000));

  // Inject backup panel into Library page settings area
  const libContent = document.querySelector('#page-library .lib-content');
  if (libContent) {
    const backupView = document.createElement('div');
    backupView.dataset.subview = 'backup';
    backupView.style.cssText = 'display:none;padding:20px;overflow-y:auto';
    backupView.innerHTML = `
      <div class="section-label" style="padding:0 0 12px">Library Backup</div>

      <div style="background:rgba(0,229,255,.06);border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:12px;margin-bottom:16px;font-size:11px;color:var(--t2);line-height:1.6">
        ℹ️ Backups save your titles, BPM/key data, cue points, crates, and play stats —
        not the audio files themselves. After restoring, re-open your music folder so
        tracks can find their files again.
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
        <button id="backupExportBtn" class="vz-btn primary">
          ⬇ Export Library (.868)
        </button>
        <label class="vz-btn" style="text-align:center;cursor:pointer">
          ⬆ Import Backup (.868)
          <input type="file" id="backupFileIn" accept=".868,.json" style="display:none">
        </label>
      </div>

      <div class="section-label" style="padding:0 0 8px">Saved Snapshots</div>
      <div id="snapshotList" style="display:flex;flex-direction:column;gap:6px"></div>

      <div style="margin-top:20px">
        <button id="manualSnapBtn" class="vz-btn sm">📸 Save Snapshot Now</button>
      </div>`;
    libContent.appendChild(backupView);
  }

  // Add Backup tab to Library subtab bar
  const subtabBar = document.querySelector('#page-library .subtab-bar');
  if (subtabBar) {
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'backup';
    btn.textContent = 'Backup';
    subtabBar.appendChild(btn);
    btn.addEventListener('click', renderSnapshotList);
  }

  async function renderSnapshotList() {
    const list = document.getElementById('snapshotList');
    if (!list) return;
    const snaps = await Backup.listSnapshots();
    list.innerHTML = snaps.length
      ? snaps.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:12px">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600">${s.filename || 'Snapshot'}</div>
              <div style="font-size:10px;color:var(--t3)">${new Date(s.createdAt).toLocaleString()} · ${s.meta?.trackCount || '?'} tracks</div>
            </div>
            <button class="vz-btn sm" onclick="MS.backup.restoreSnapshot('${s.id}')">Restore</button>
          </div>`).join('')
      : '<div style="font-size:12px;color:var(--t3)">No snapshots yet.</div>';
  }

  // Wire buttons
  document.getElementById('backupExportBtn')?.addEventListener('click', () => Backup.export());

  document.getElementById('backupFileIn')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    await Backup.import(file);
    e.target.value = '';
  });

  document.getElementById('manualSnapBtn')?.addEventListener('click', async () => {
    localStorage.removeItem('vz_last_snapshot');
    await Backup.autoSnapshot();
    await renderSnapshotList();
    MS.toast('Snapshot saved.', 'ok', 1500);
  });

  console.info('[Phase6] Storage & Backup active');
});
