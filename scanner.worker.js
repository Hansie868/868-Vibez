/* ============================================================
   MediaSuite V3 Phase 5 — scanner.worker.js
   Background scanner for non-blocking indexing/fingerprinting.
   Runs fully client-side. No network calls.
   ============================================================ */

const AUDIO_EXT = ['mp3','wav','ogg','flac','m4a','aac','mp4','webm'];
let cancelled = false;

self.onmessage = async (event) => {
  const msg = event.data || {};

  if (msg.type === 'cancel') {
    cancelled = true;
    self.postMessage({ type: 'cancelled' });
    return;
  }

  if (msg.type === 'scanHandles') {
    cancelled = false;
    const handles = msg.handles || [];
    const batchSize = Number(msg.batchSize || 35);
    const total = handles.length;
    let batch = [];
    let indexed = 0;

    self.postMessage({ type: 'progress', phase: 'start', indexed, total });

    for (let i = 0; i < handles.length; i++) {
      if (cancelled) {
        self.postMessage({ type: 'cancelled', indexed, total });
        return;
      }

      const item = handles[i];
      try {
        const file = item.file;
        if (!file) continue;
        const ext = extension(file.name);
        if (!AUDIO_EXT.includes(ext)) continue;

        const fingerprint = await fingerprintFile(file);
        const parsed = parseName(file.name);
        const track = {
          id: fingerprint,
          title: parsed.title,
          artist: parsed.artist,
          album: '',
          genre: '',
          mood: '',
          bpm: null,
          key: '',
          energy: null,
          favorite: false,
          duration: 0,
          playCount: 0,
          lastPlayed: null,
          importedAt: Date.now(),
          fileName: file.name,
          size: file.size,
          lastModified: file.lastModified,
          path: item.path || file.name,
          ext,
          artwork: null,
          phase5Indexed: true
        };

        batch.push({ track, handleIndex: item.index });
        indexed++;

        if (batch.length >= batchSize) {
          self.postMessage({ type: 'batch', batch, indexed, total });
          batch = [];
        }

        if (indexed % 10 === 0) {
          self.postMessage({ type: 'progress', phase: 'scanning', indexed, total });
        }
      } catch (error) {
        self.postMessage({ type: 'itemError', message: String(error?.message || error), index: item.index });
      }
    }

    if (batch.length) {
      self.postMessage({ type: 'batch', batch, indexed, total });
    }

    self.postMessage({ type: 'complete', indexed, total });
  }
};

function extension(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

function parseName(name) {
  const clean = String(name || '').replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ').trim();
  const parts = clean.split(' - ');
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: 'Unknown Artist', title: clean || 'Untitled Track' };
}

async function fingerprintFile(file) {
  // Fast local fingerprint: name + size + modified + small SHA-256 slice.
  // This avoids reading full large media files during scan.
  const sliceA = file.slice(0, Math.min(file.size, 128 * 1024));
  const sliceB = file.size > 256 * 1024 ? file.slice(Math.max(0, file.size - 128 * 1024), file.size) : new Blob([]);
  const bufA = await sliceA.arrayBuffer();
  const bufB = await sliceB.arrayBuffer();
  const meta = new TextEncoder().encode(`${file.name}|${file.size}|${file.lastModified}`);
  const merged = new Uint8Array(meta.byteLength + bufA.byteLength + bufB.byteLength);
  merged.set(meta, 0);
  merged.set(new Uint8Array(bufA), meta.byteLength);
  merged.set(new Uint8Array(bufB), meta.byteLength + bufA.byteLength);
  const hash = await crypto.subtle.digest('SHA-256', merged);
  return 'trk_' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
