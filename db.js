/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — db.js
   ONE database. Every store the app will ever use, created once.
   New DB name so broken installs of the old app can't interfere.
═══════════════════════════════════════════════════════════════ */
'use strict';
window.VZ = window.VZ || {};

(function () {
const DB_NAME = '868VibezV2';
const DB_VERSION = 1;
const STORES = [
  'tracks',      // track metadata (title, path, folderId, favorite, bpm, key…)
  'folders',     // folder handles (in-place access) or folder records (copy mode)
  'blobs',       // audio bytes — ONLY for copy-fallback devices
  'playlists',   // listening playlists { id, name, trackIds[] }
  'crates',      // DJ prep crates   { id, name, trackIds[] }
  'cues',        // hot cues per track { id: trackId, cues:[t0..t3] }
  'sessions',    // DJ mix history
  'requests',    // song request queue
  'midi',        // MIDI mappings
  'settings',    // key/value app settings
  'errors',      // local error log
];

let _db = null;
function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

const tx = (d, s, mode) => d.transaction(s, mode).objectStore(s);
VZ.db = {
  put:  async (s, v) => { const d = await open(); return new Promise((res, rej) => { const r = tx(d, s, 'readwrite').put(v); r.onsuccess = () => res(v); r.onerror = () => rej(r.error); }); },
  get:  async (s, k) => { const d = await open(); return new Promise((res, rej) => { const r = tx(d, s, 'readonly').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  del:  async (s, k) => { const d = await open(); return new Promise((res, rej) => { const r = tx(d, s, 'readwrite').delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
  all:  async s      => { const d = await open(); return new Promise((res, rej) => { const r = tx(d, s, 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); },
  clearStore: async s => { const d = await open(); return new Promise((res, rej) => { const r = tx(d, s, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
  wipe: () => new Promise((res) => { _db?.close(); _db = null; const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); }),
};
})();
