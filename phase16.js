/* ============================================================
   868 VIBEZ — Phase 16: IndexedDB Race Condition — Audit Fix
   & Migration Safety Net

   ROOT CAUSE (full writeup):
   engine.js, phase1.js, and phase4.js each independently called
   indexedDB.open('868VibezDB', N) with their own version number
   (1, then 2, then 3) inside separate script-load IIFEs. Because
   indexedDB.open() is asynchronous by spec, every one of those
   IIFEs yields control back to the browser before its own upgrade
   completes — which means script load ORDER alone never
   guaranteed completion order. Depending on device speed and
   browser task scheduling, phase4's v3 request could complete
   before phase1's v2 request. When that happened:
     - The DB jumped straight from v1 to v3 in one transaction,
       running only phase4's onupgradeneeded logic (which only
       knows about 'stats') — 'artwork_cache' was never created.
     - phase1's now-stale v2 request then opened against an
       already-v3 database, which throws VersionError per spec
       (you cannot request a version lower than what's on disk).
       That promise rejected, the .catch() silently logged a
       warning, and MS.db was left pointing at the connection
       that has no artwork_cache store.
     - Every MS.artwork.put() call after that failed silently
       inside its own try/catch. Album art simply never saved,
       with zero visible error to the user — the worst kind of
       bug because it can pass on a fast device in testing and
       fail intermittently on a slower phone.

   THE ACTUAL FIX (lives in engine.js, not here):
   engine.js's openDB() now declares the FULL final schema for
   every store any phase needs, at ONE version number (4), opened
   exactly once. There is now only one indexedDB.open() call in
   the entire app — nothing exists for a second call to race
   against. phase1.js's and phase4.js's old upgrade IIFEs are
   still present in those files but are now permanently inert:
   their guard checks ("does this store already exist?") always
   pass on the first try against engine.js's single connection,
   so their own indexedDB.open() calls are never reached.

   THIS FILE'S JOB:
   Pure verification and recovery — for any user who already has
   the app installed from before this fix shipped, their on-disk
   database may genuinely be missing a store due to the race
   having already happened in a prior session. This checks for
   that specific damage and repairs it without requiring the user
   to clear their data and lose their library.
   ============================================================ */
'use strict';

const EXPECTED_STORES = [
  'tracks','waveforms','playlists','crates','settings','handles','cuePoints',
  'artwork_cache','stats',
  'sessions','requestQueue','midiMappings', // phase22: mix history, song requests, MIDI
  'errorLog' // phase25: local crash/error logging
];

async function verifyAndRepairSchema() {
  try {
    const db = await MS.db.open();
    const missing = EXPECTED_STORES.filter(s => !db.objectStoreNames.contains(s));

    if (!missing.length) {
      console.info(`[Phase16] ✓ Schema verified — all ${EXPECTED_STORES.length} stores present.`);
      return;
    }

    // A real installed user has a DB genuinely missing stores from the
    // historical race. The only spec-correct way to add stores to an
    // existing database is another version-bump upgrade — but we don't
    // know what version they're currently at, so request one version
    // higher than whatever they currently have.
    console.warn('[Phase16] Repairing damaged schema — missing stores:', missing);
    const currentVersion = db.version;
    db.close();

    await new Promise((resolve, reject) => {
      const req = indexedDB.open('868VibezDB', currentVersion + 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        missing.forEach(s => {
          if (!d.objectStoreNames.contains(s)) {
            d.createObjectStore(s, { keyPath: 'id' });
            console.info(`[Phase16] Repaired: created missing store '${s}'`);
          }
        });
      };
      req.onsuccess = () => {
        // Rebind MS.db to the repaired connection so the rest of the
        // app (which already captured the old, broken one) uses the
        // fixed schema going forward.
        const d = req.result;
        const put = (s,v) => new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess=()=>res(v); r.onerror=()=>rej(r.error); });
        const get = (s,k) => new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
        const del = (s,k) => new Promise((res,rej)=>{ const r=d.transaction(s,'readwrite').objectStore(s).delete(k); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
        const all = (s)   => new Promise((res,rej)=>{ const r=d.transaction(s).objectStore(s).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
        MS.db = { put, get, del, all, open: () => Promise.resolve(d) };
        console.info(`[Phase16] ✓ Schema repaired — now at v${d.version} with all stores present.`);
        MS.toast?.('Storage repaired — your library is safe.', 'ok', 2500);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

  } catch (e) {
    console.error('[Phase16] Schema verification/repair failed:', e.message);
  }
}

// Run once, early, before the rest of the app starts reading/writing
// in earnest. MS.db is already engine.js's single connection by this
// point in script load order, so this only ever needs to act for
// genuinely pre-existing damaged installs.
verifyAndRepairSchema();
