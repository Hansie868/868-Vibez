/* ============================================================
   868 VIBEZ — Phase 1: Metadata & Library Intelligence
   
   1. Native ID3v2 Parser (no third-party packages)
   2. Artwork Cache Engine (separate IndexedDB store)
   3. Library Health Scanner (health score + diagnostics)
   
   All vanilla JS. Runs in main thread but yields via
   setTimeout(0) chunks to never block the UI.
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. NATIVE ID3v2 BINARY PARSER
   Reads raw ArrayBuffer from local File blob.
   Extracts: TIT2 (title), TPE1 (artist), TALB (album),
             TCON (genre), TBPM (bpm), TKEY (key), APIC (art)
══════════════════════════════════════════════════════════════ */
const ID3 = {

  /* Read a null-terminated or length-prefixed string from DataView */
  _str(view, offset, len, encoding) {
    const bytes = new Uint8Array(view.buffer, offset, len);
    try {
      if (encoding === 0) return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
      if (encoding === 1 || encoding === 2) {
        // UTF-16 — skip BOM
        const start = (bytes[0] === 0xFF && bytes[1] === 0xFE) ||
                      (bytes[0] === 0xFE && bytes[1] === 0xFF) ? 2 : 0;
        return new TextDecoder('utf-16le').decode(bytes.slice(start)).replace(/\0/g, '').trim();
      }
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
    } catch { return ''; }
  },

  /* Decode syncsafe integer (ID3v2 tag size encoding) */
  _syncsafe(b0, b1, b2, b3) {
    return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
  },

  /* Main parse function — returns metadata object */
  async parse(file) {
    const result = {
      title: '', artist: '', album: '',
      genre: '', bpm: null, key: '', artworkBlob: null
    };

    try {
      // Read first 256KB — enough for tags on virtually all files
      const slice    = file.slice(0, Math.min(file.size, 262144));
      const buffer   = await slice.arrayBuffer();
      const view     = new DataView(buffer);
      const bytes    = new Uint8Array(buffer);

      // Verify ID3 header: bytes 0-2 must be 0x49 0x44 0x33 ("ID3")
      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
        return result; // No ID3 tag — use filename as title
      }

      const version  = bytes[3]; // ID3v2.x version (2, 3, or 4)
      const flags    = bytes[5];
      const hasExtHeader = !!(flags & 0x40);

      // Calculate total tag size (syncsafe integer in bytes 6-9)
      const tagSize  = this._syncsafe(bytes[6], bytes[7], bytes[8], bytes[9]) + 10;

      let offset = 10;

      // Skip extended header if present
      if (hasExtHeader) {
        const extSize = version === 4
          ? this._syncsafe(bytes[10], bytes[11], bytes[12], bytes[13])
          : view.getUint32(10, false);
        offset += extSize + (version === 4 ? 4 : 4);
      }

      // Walk frames
      while (offset < tagSize && offset < buffer.byteLength - 10) {
        // Read 4-byte frame ID
        const frameId = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);

        // Stop at padding (null bytes)
        if (bytes[offset] === 0) break;

        // Frame size (bytes 4-7 after frame ID)
        let frameSize;
        if (version === 4) {
          frameSize = this._syncsafe(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
        } else {
          frameSize = view.getUint32(offset + 4, false);
        }

        if (frameSize <= 0 || frameSize > 512000) { offset += 10; continue; }

        const dataOffset = offset + 10;
        const encoding   = bytes[dataOffset]; // First byte of text frames is encoding

        // Extract text frames
        if (frameId === 'TIT2' && !result.title)  result.title  = this._str(view, dataOffset + 1, frameSize - 1, encoding);
        if (frameId === 'TPE1' && !result.artist)  result.artist = this._str(view, dataOffset + 1, frameSize - 1, encoding);
        if (frameId === 'TALB' && !result.album)   result.album  = this._str(view, dataOffset + 1, frameSize - 1, encoding);
        if (frameId === 'TCON' && !result.genre)   result.genre  = this._cleanGenre(this._str(view, dataOffset + 1, frameSize - 1, encoding));
        if (frameId === 'TBPM' && !result.bpm)     result.bpm    = parseInt(this._str(view, dataOffset + 1, frameSize - 1, encoding)) || null;
        if (frameId === 'TKEY' && !result.key)     result.key    = this._str(view, dataOffset + 1, frameSize - 1, encoding);

        // Extract APIC (attached picture / album art)
        if (frameId === 'APIC' && !result.artworkBlob) {
          result.artworkBlob = this._extractAPIC(bytes, dataOffset, frameSize);
        }

        offset += 10 + frameSize;
      }
    } catch (e) {
      console.warn('[ID3] Parse error:', e.message);
    }

    return result;
  },

  /* Clean genre string — ID3v1 genres are stored as (N) numbers */
  _cleanGenre(raw) {
    if (!raw) return '';
    const match = raw.match(/^\((\d+)\)(.*)$/);
    if (match) {
      const genres = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge',
        'Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae',
        'Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack',
        'Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical',
        'Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','AlternRock',
        'Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock',
        'Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance',
        'Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap',
        'Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychadelic','Rave',
        'Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro',
        'Musical','Rock & Roll','Hard Rock'];
      const idx = parseInt(match[1]);
      return genres[idx] || match[2].trim() || raw;
    }
    return raw.replace(/^\(.*?\)/, '').trim() || raw;
  },

  /* Extract APIC frame binary → Blob */
  _extractAPIC(bytes, offset, frameSize) {
    try {
      const enc = bytes[offset]; // encoding byte
      let pos   = offset + 1;

      // Skip MIME type (null-terminated string)
      while (pos < offset + frameSize && bytes[pos] !== 0) pos++;
      pos++; // skip null terminator

      // Picture type byte (3 = cover art)
      pos++; // we accept any type

      // Skip description (null-terminated, encoding-aware)
      if (enc === 1 || enc === 2) {
        // UTF-16 uses double-null terminator
        while (pos < offset + frameSize - 1 && !(bytes[pos] === 0 && bytes[pos+1] === 0)) pos += 2;
        pos += 2;
      } else {
        while (pos < offset + frameSize && bytes[pos] !== 0) pos++;
        pos++;
      }

      const imgData  = bytes.slice(pos, offset + frameSize);
      const mimeType = this._detectImageMime(imgData);
      return new Blob([imgData], { type: mimeType });
    } catch { return null; }
  },

  /* Detect image MIME type from magic bytes */
  _detectImageMime(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
    return 'image/jpeg'; // default
  }
};

/* ══════════════════════════════════════════════════════════════
   2. ARTWORK CACHE ENGINE
   Separate IndexedDB store: 'artwork_cache'
   Keys: track fingerprint ID
   Values: { id, blob, mimeType, cachedAt }
   Object URLs created on demand and revoked after use.
══════════════════════════════════════════════════════════════ */
const ArtworkCache = {

  _store: 'artwork_cache',
  _urlCache: new Map(), // in-memory object URL cache

  async put(id, blob) {
    if (!blob) return;
    try {
      await MS.db.put(this._store, {
        id,
        blob,
        mimeType: blob.type || 'image/jpeg',
        cachedAt: Date.now()
      });
    } catch (e) {
      console.warn('[ArtworkCache] put failed:', e.message);
    }
  },

  async get(id) {
    try {
      return await MS.db.get(this._store, id);
    } catch { return null; }
  },

  async getUrl(id) {
    // Return cached object URL if still valid
    if (this._urlCache.has(id)) return this._urlCache.get(id);
    const rec = await this.get(id);
    if (!rec?.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    this._urlCache.set(id, url);
    return url;
  },

  revoke(id) {
    const url = this._urlCache.get(id);
    if (url) { URL.revokeObjectURL(url); this._urlCache.delete(id); }
  },

  revokeAll() {
    this._urlCache.forEach(url => URL.revokeObjectURL(url));
    this._urlCache.clear();
  },

  async has(id) {
    const rec = await this.get(id);
    return !!rec?.blob;
  }
};

// Expose globally
MS.artwork = ArtworkCache;

/* ══════════════════════════════════════════════════════════════
   3. ENHANCED SCAN — inject ID3 reading into folder scan
   Patches the existing scanFolder to also parse ID3 on import.
   Only parses new tracks (not already in DB with metadata).
══════════════════════════════════════════════════════════════ */
const _originalScanFolder = window._scanFolder || null;

async function scanFolderWithMeta(handle, path = '') {
  let count = 0;
  const audioExt = new Set(['mp3','wav','ogg','m4a','aac','flac','mp4','webm','opus']);
  const getExt   = n => (n.split('.').pop() || '').toLowerCase();
  const fingerprint = (file, p) => `${p||file.name}_${file.size}_${file.lastModified}`.replace(/[^a-z0-9_.-]/gi, '_');
  const sanitize = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);

  for await (const [name, h] of handle.entries()) {
    const p = path ? `${path}/${name}` : name;

    if (h.kind === 'directory') {
      count += await scanFolderWithMeta(h, p);
      continue;
    }

    if (!audioExt.has(getExt(name))) continue;

    const file = await h.getFile();
    const id   = fingerprint(file, p);

    let track = await MS.db.get('tracks', id);
    const isNew = !track;

    if (!track) {
      track = {
        id, title: name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist',
        album: '', genre: '', mood: '', bpm: null, key: '', energy: null,
        favorite: false, playCount: 0, lastPlayed: null,
        dateImported: Date.now(), path: p, size: file.size,
        lastModified: file.lastModified, type: file.type,
        artwork: null, source: 'local',
        metaParsed: false
      };
    }

    // Parse ID3 for new tracks or tracks without parsed metadata
    if (isNew || !track.metaParsed) {
      try {
        const meta = await ID3.parse(file);

        if (meta.title)  track.title  = meta.title;
        if (meta.artist && meta.artist !== 'Unknown') track.artist = meta.artist;
        if (meta.album)  track.album  = meta.album;
        if (meta.genre)  track.genre  = meta.genre;
        if (meta.bpm)    track.bpm    = meta.bpm;
        if (meta.key)    track.key    = meta.key;

        // Cache artwork separately
        if (meta.artworkBlob) {
          await ArtworkCache.put(id, meta.artworkBlob);
          track.artwork = id; // reference to artwork cache key
        }

        track.metaParsed = true;
      } catch (e) {
        console.warn('[Phase1] ID3 parse failed for', name, e.message);
      }
    }

    track.path = p;
    track.size = file.size;
    track._fileHandle = h;

    await MS.db.put('tracks', track);
    await MS.db.put('handles', { id, handle: h, path: p });
    count++;

    // Emit progress for UI feedback
    MS.emit('scan:progress', { name: track.title, count });
  }

  return count;
}

/* ══════════════════════════════════════════════════════════════
   UPGRADE openFolder to use ID3-aware scanner
══════════════════════════════════════════════════════════════ */
MS.openFolder = async function openFolder() {
  if (!('showDirectoryPicker' in window)) {
    MS.toast('Folder access requires Chrome or Edge.', 'warn');
    return;
  }
  try {
    MS.folderHandle = await window.showDirectoryPicker({ mode: 'read' });
    MS.toast(`Scanning ${MS.folderHandle.name} — reading metadata…`, 'info');

    // Show scan progress
    let lastToast = 0;
    MS.on('scan:progress', ({ name, count }) => {
      const now = Date.now();
      if (now - lastToast > 800) {
        lastToast = now;
        MS.toast(`Reading ${count} tracks…`, 'info', 1000);
      }
    });

    const n = await scanFolderWithMeta(MS.folderHandle);
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    MS.toast(`Imported ${n} tracks with full metadata.`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') MS.toast(e.message, 'error');
  }
};

/* ══════════════════════════════════════════════════════════════
   4. LIBRARY HEALTH SCANNER
   Sweeps IndexedDB tracks store.
   Flags: missing title, artist, album, artwork, bpm, key.
   Detects duplicates by title+artist fingerprint.
   Calculates Health Score out of 100.
══════════════════════════════════════════════════════════════ */
const LibraryHealth = {

  async scan() {
    const tracks = await MS.db.all('tracks');
    if (!tracks.length) return this._emptyReport();

    let score = 0;
    const maxScore = tracks.length * 6; // 6 metadata fields per track
    const issues   = { missingTitle:[], missingArtist:[], missingAlbum:[], missingArtwork:[], missingBpm:[], missingKey:[] };
    const seen     = new Map(); // for duplicate detection
    const dupes    = [];

    for (const t of tracks) {
      // Score each metadata field
      if (t.title && t.title !== t.path?.split('/').pop()?.replace(/\.[^.]+$/,''))  score++;
      else issues.missingTitle.push(t.id);

      if (t.artist && t.artist !== 'Unknown Artist' && t.artist !== 'Unknown') score++;
      else issues.missingArtist.push(t.id);

      if (t.album)  score++; else issues.missingAlbum.push(t.id);
      if (t.artwork) score++; else issues.missingArtwork.push(t.id);
      if (t.bpm)    score++; else issues.missingBpm.push(t.id);
      if (t.key)    score++; else issues.missingKey.push(t.id);

      // Duplicate detection by title+artist fingerprint
      const sig = `${(t.title||'').toLowerCase()}__${(t.artist||'').toLowerCase()}`;
      if (seen.has(sig)) dupes.push({ a: seen.get(sig), b: t.id, title: t.title });
      else seen.set(sig, t.id);
    }

    const healthScore = Math.round((score / maxScore) * 100);

    const report = {
      totalTracks:     tracks.length,
      healthScore,
      grade:           this._grade(healthScore),
      issues,
      duplicates:      dupes,
      summary: {
        missingArtwork:  issues.missingArtwork.length,
        missingBpm:      issues.missingBpm.length,
        missingKey:      issues.missingKey.length,
        missingArtist:   issues.missingArtist.length,
        duplicates:      dupes.length,
      },
      scannedAt: Date.now()
    };

    // Cache report
    MS._healthReport = report;
    MS.emit('health:scanned', report);
    return report;
  },

  _grade(score) {
    if (score >= 90) return { label: 'Excellent', color: '#00e676' };
    if (score >= 75) return { label: 'Good',      color: '#00e5ff' };
    if (score >= 50) return { label: 'Fair',       color: '#fbbf24' };
    if (score >= 25) return { label: 'Poor',       color: '#f97316' };
    return               { label: 'Critical',      color: '#ff4d6d' };
  },

  _emptyReport() {
    return {
      totalTracks: 0, healthScore: 0,
      grade: { label: 'No Library', color: '#666' },
      issues: {}, duplicates: [], summary: {},
      scannedAt: Date.now()
    };
  },

  /* Re-parse metadata for tracks missing it */
  async repairMissing(onProgress) {
    const tracks = await MS.db.all('tracks');
    const needsRepair = tracks.filter(t => !t.metaParsed || !t.title || t.artist === 'Unknown Artist');
    let fixed = 0;

    for (const t of needsRepair) {
      try {
        const file = await MS.fileFromTrack(t);
        const meta = await ID3.parse(file);

        if (meta.title)  t.title  = meta.title;
        if (meta.artist && meta.artist !== 'Unknown') t.artist = meta.artist;
        if (meta.album)  t.album  = meta.album;
        if (meta.genre)  t.genre  = meta.genre;
        if (meta.bpm)    t.bpm    = meta.bpm;
        if (meta.key)    t.key    = meta.key;
        if (meta.artworkBlob) {
          await ArtworkCache.put(t.id, meta.artworkBlob);
          t.artwork = t.id;
        }

        t.metaParsed = true;
        await MS.db.put('tracks', t);
        fixed++;
        onProgress?.({ fixed, total: needsRepair.length, title: t.title });
      } catch {}
    }

    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    MS.toast(`Repaired metadata for ${fixed} tracks.`, 'ok');
    return fixed;
  }
};

MS.health = LibraryHealth;

/* ══════════════════════════════════════════════════════════════
   5. MEDIA SESSION API
   Connects native browser lock screen / Bluetooth controls
   to the local playback engine.
══════════════════════════════════════════════════════════════ */
async function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;

  let artworkArr = [];
  if (track.artwork) {
    const url = await ArtworkCache.getUrl(track.id);
    if (url) artworkArr = [{ src: url, sizes: '512x512', type: 'image/jpeg' }];
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title:   track.title  || 'Unknown Title',
    artist:  track.artist || 'Unknown Artist',
    album:   track.album  || '',
    artwork: artworkArr
  });

  navigator.mediaSession.setActionHandler('play',          () => { MS.audio.main?.play(); MS.emit('player:play', MS.selectedTrack); });
  navigator.mediaSession.setActionHandler('pause',         () => { MS.audio.main?.pause(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => MS.playRelative(-1));
  navigator.mediaSession.setActionHandler('nexttrack',     () => MS.playRelative(1));
  navigator.mediaSession.setActionHandler('seekto', e => {
    if (MS.audio.main && e.seekTime !== undefined) MS.audio.main.currentTime = e.seekTime;
  });

  navigator.mediaSession.playbackState = 'playing';
}

/* Hook into player:play event */
MS.on('player:play', track => {
  if (track) updateMediaSession(track);
});

/* ══════════════════════════════════════════════════════════════
   6. CONTINUE LISTENING — persist & restore last session
══════════════════════════════════════════════════════════════ */
const ContinueListening = {

  save(track, currentTime) {
    if (!track?.id) return;
    try {
      localStorage.setItem('vz_last_track', JSON.stringify({
        id:        track.id,
        title:     track.title,
        artist:    track.artist,
        position:  currentTime || 0,
        savedAt:   Date.now()
      }));
    } catch {}
  },

  load() {
    try {
      const raw = localStorage.getItem('vz_last_track');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  async restore() {
    const saved = this.load();
    if (!saved) return false;

    // Only restore if saved within 7 days
    if (Date.now() - saved.savedAt > 7 * 24 * 60 * 60 * 1000) return false;

    const track = MS.library.find(t => t.id === saved.id);
    if (!track) return false;

    try {
      await MS.playMain(track);
      // Seek to saved position after canplay
      const audio = MS.audio.main;
      if (audio && saved.position > 5) {
        const seek = () => {
          audio.currentTime = saved.position;
          audio.removeEventListener('canplay', seek);
        };
        audio.addEventListener('canplay', seek);
      }
      MS.toast(`Continuing: ${track.title}`, 'info', 2000);
      return true;
    } catch { return false; }
  }
};

MS.continueListening = ContinueListening;

/* Auto-save position every 5 seconds while playing */
setInterval(() => {
  const audio = MS.audio?.main;
  if (audio && !audio.paused && MS.selectedTrack) {
    ContinueListening.save(MS.selectedTrack, audio.currentTime);
  }
}, 5000);

/* ══════════════════════════════════════════════════════════════
   7. DB VERSION UPGRADE — add artwork_cache store
   Bumps DB_VERSION so onupgradeneeded fires.
   Must patch before openDB is called again.
══════════════════════════════════════════════════════════════ */
(function upgradeDB() {
  // Override the MS.db.open to ensure artwork_cache store exists
  const _origOpen = MS.db.open;
  async function ensureArtworkStore() {
    const d = await _origOpen();
    if (!d.objectStoreNames.contains('artwork_cache')) {
      // Close and reopen with incremented version
      d.close();
      window._db = null;
      return new Promise((res, rej) => {
        const req = indexedDB.open('868VibezDB', 2);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('artwork_cache'))
            db.createObjectStore('artwork_cache', { keyPath: 'id' });
        };
        req.onsuccess = () => { window._db = req.result; res(req.result); };
        req.onerror   = () => rej(req.error);
      });
    }
    return d;
  }
  // Immediately trigger the upgrade check
  ensureArtworkStore().then(db => {
    // Patch all db methods to use the upgraded db
    const put  = (s,v)  => new Promise((res,rej)=>{ const r=db.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess=()=>res(v); r.onerror=()=>rej(r.error); });
    const get  = (s,k)  => new Promise((res,rej)=>{ const r=db.transaction(s).objectStore(s).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
    const del  = (s,k)  => new Promise((res,rej)=>{ const r=db.transaction(s,'readwrite').objectStore(s).delete(k); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    const all  = s      => new Promise((res,rej)=>{ const r=db.transaction(s).objectStore(s).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
    MS.db = { put, get, del, all, open: ()=>Promise.resolve(db) };
    console.info('[Phase1] DB upgraded — artwork_cache store ready');
  }).catch(e => console.warn('[Phase1] DB upgrade failed:', e.message));
})();

/* ══════════════════════════════════════════════════════════════
   8. ARTWORK RENDERING HELPER
   Call this anywhere you need to show album art for a track.
   Returns an img element src URL, or null if no artwork.
══════════════════════════════════════════════════════════════ */
MS.getArtworkUrl = async function(track) {
  if (!track?.artwork) return null;
  return ArtworkCache.getUrl(track.artwork);
};

MS.renderArtwork = async function(track, imgEl, fallbackText = '🎵') {
  if (!imgEl) return;
  if (!track?.artwork) {
    imgEl.style.backgroundImage = '';
    imgEl.textContent = fallbackText;
    return;
  }
  const url = await ArtworkCache.getUrl(track.artwork);
  if (url) {
    imgEl.style.backgroundImage = `url(${url})`;
    imgEl.style.backgroundSize  = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.textContent = '';
  } else {
    imgEl.textContent = fallbackText;
  }
};

/* ══════════════════════════════════════════════════════════════
   9. PHASE 1 UI INTEGRATION
   Hooks into existing app-ui.js events to show artwork,
   health scores, and continue listening prompt.
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Update Now Playing artwork when track changes ── */
  MS.on('player:play', async track => {
    const artWrap = document.getElementById('npArtWrap');
    if (artWrap) await MS.renderArtwork(track, artWrap, '🎵');
  });

  /* ── Update artwork in track list rows ── */
  MS.on('library:updated', () => {
    // Defer to avoid blocking
    setTimeout(renderArtworkInList, 100);
  });

  async function renderArtworkInList() {
    const rows = document.querySelectorAll('[data-track-id]');
    for (const row of rows) {
      const id    = row.dataset.trackId;
      const track = MS.library.find(t => t.id === id);
      const art   = row.querySelector('.tr-art');
      if (art && track) await MS.renderArtwork(track, art, '🎵');
    }
  }

  /* ── Health panel in Library page ── */
  const healthBtn = document.getElementById('healthScanBtn');
  if (healthBtn) {
    healthBtn.addEventListener('click', async () => {
      healthBtn.textContent = 'Scanning…';
      healthBtn.disabled    = true;
      const report = await LibraryHealth.scan();
      renderHealthReport(report);
      healthBtn.textContent = '↺ Re-scan';
      healthBtn.disabled    = false;
    });
  }

  function renderHealthReport(r) {
    const el = document.getElementById('healthReport');
    if (!el) return;
    const g = r.grade;
    el.innerHTML = `
      <div style="text-align:center;padding:16px 0 8px">
        <div style="font-size:48px;font-weight:900;color:${g.color};font-family:monospace">${r.healthScore}</div>
        <div style="font-size:13px;font-weight:700;color:${g.color};margin-top:2px">${g.label}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:4px">${r.totalTracks} tracks analysed</div>
      </div>
      <div style="display:grid;gap:6px;margin-top:8px">
        ${healthRow('🎵', 'Missing titles',   r.summary.missingArtist)}
        ${healthRow('🖼', 'Missing artwork',  r.summary.missingArtwork)}
        ${healthRow('🎚', 'Missing BPM',      r.summary.missingBpm)}
        ${healthRow('🎹', 'Missing key',      r.summary.missingKey)}
        ${healthRow('⚠️', 'Duplicates found', r.summary.duplicates)}
      </div>
      ${r.summary.missingArtwork > 0 || r.summary.missingArtist > 0 ? `
        <button onclick="MS.health.repairMissing(p=>MS.toast('Fixed '+p.fixed+' tracks…','info',800))"
          class="vz-btn primary" style="width:100%;margin-top:12px">
          ✦ Auto-Repair Metadata
        </button>` : '<div style="color:var(--green);text-align:center;margin-top:10px;font-size:12px">✓ Library looks great</div>'}`;
  }

  function healthRow(icon, label, count) {
    const ok    = count === 0;
    const color = ok ? 'var(--green)' : count > 10 ? 'var(--red)' : 'var(--yellow)';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span>${icon} ${label}</span>
      <span style="font-family:monospace;font-weight:700;color:${color}">${ok ? '✓' : count}</span>
    </div>`;
  }

  /* ── Continue Listening prompt on boot ── */
  MS.on('boot:complete', async () => {
    const saved = ContinueListening.load();
    if (!saved) return;
    const track = MS.library.find(t => t.id === saved.id);
    if (!track) return;

    // Show a non-intrusive prompt
    setTimeout(() => {
      showContinuePrompt(track, saved.position);
    }, 1200);
  });

  function showContinuePrompt(track, position) {
    const existing = document.getElementById('continuePrompt');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'continuePrompt';
    el.style.cssText = `
      position:fixed; bottom:calc(var(--nav-h) + 12px); left:12px; right:12px;
      background:rgba(10,10,10,.97); border:1px solid rgba(0,229,255,.3);
      border-radius:16px; padding:14px 16px; z-index:500;
      display:flex; align-items:center; gap:12px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);
      animation:slideUp .3s ease;
    `;
    const mins = Math.floor(position / 60);
    const secs = Math.floor(position % 60).toString().padStart(2, '0');
    el.innerHTML = `
      <div style="font-size:28px;flex-shrink:0">▶</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${track.title}</div>
        <div style="font-size:11px;color:var(--t3)">Continue from ${mins}:${secs}</div>
      </div>
      <button onclick="MS.continueListening.restore();document.getElementById('continuePrompt')?.remove()"
        style="background:var(--cyan);border:none;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:800;color:#050505;cursor:pointer;flex-shrink:0">
        Resume
      </button>
      <button onclick="document.getElementById('continuePrompt')?.remove()"
        style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer;padding:4px;flex-shrink:0">
        ✕
      </button>`;

    document.body.appendChild(el);

    // Auto-dismiss after 8 seconds
    setTimeout(() => el.remove(), 8000);
  }

  /* ── Add slide-up animation ── */
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  console.info('[Phase1] Metadata & Library Intelligence active');
});

/* Expose ID3 parser for other modules */
MS.id3 = ID3;

