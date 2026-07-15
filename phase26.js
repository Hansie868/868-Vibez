/* ============================================================
   868 VIBEZ — Phase 26: Reference Files In Place, Don't Copy
   Fixes the "songs get duplicated into app storage" issue.

   THE HONEST PICTURE:
   Historically Android Chrome had NO way for a web app to get a
   persistent reference to a file on disk — only a one-time Blob
   via <input type="file">. That's why phase19 copied the actual
   audio data into IndexedDB (trackBlobs): it was the only way to
   make playback work at all on Android.

   Google has since been rolling real File System Access API
   support (showOpenFilePicker / showDirectoryPicker) out to
   Android Chrome, version by version, through 2026 — it isn't
   universal yet. So rather than assume either way, this module
   detects it live on the actual device and:
     - If available: stores a HANDLE (a live reference back to the
       real file on disk) instead of copying the song's bytes.
       Nothing is duplicated — the file is read fresh from its
       real location each time it's played. A permission prompt
       may reappear occasionally; that re-prompt is a platform
       requirement, not a bug.
     - If not available on that specific phone/Chrome version:
       falls back to the old copy-based import, same as before,
       because there is no other way to get a byte to play on a
       device without this API — that's a real platform limit,
       not something fixable in this app's code.

   Existing songs already imported via copy keep working exactly
   as they are — this only changes how NEW imports behave.
   ============================================================ */
'use strict';

(function () {
const $26 = id => document.getElementById(id);

const supportsRealFilePicker = 'showOpenFilePicker' in window;
const supportsRealDirPicker  = 'showDirectoryPicker' in window;

/* ══════════════════════════════════════════════════════════════
   REFERENCE-BASED IMPORT (no copy) — used when the platform
   genuinely supports it on this device.
══════════════════════════════════════════════════════════════ */
const AUDIO_EXT = new Set(['mp3','wav','ogg','m4a','aac','flac','mp4','webm','opus']);
const getExt26 = n => (n.split('.').pop() || '').toLowerCase();

async function importSongsByReference() {
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: 'Audio', accept: { 'audio/*': ['.mp3','.wav','.ogg','.m4a','.aac','.flac','.opus'] } }],
    });
    let count = 0;
    for (const handle of handles) {
      const file = await handle.getFile();
      if (!AUDIO_EXT.has(getExt26(file.name))) continue;
      await saveHandleAsTrack(handle, file, file.name);
      count++;
    }
    finishImport(count);
  } catch (e) {
    if (e.name !== 'AbortError') MS.toast('Could not import: ' + e.message, 'error');
  }
}

async function importFolderByReference() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    let count = 0;
    count = await walkDirectory(dirHandle, dirHandle.name);
    finishImport(count);
  } catch (e) {
    if (e.name !== 'AbortError') MS.toast('Could not import folder: ' + e.message, 'error');
  }
}

async function walkDirectory(dirHandle, pathPrefix) {
  let count = 0;
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === 'directory') {
      count += await walkDirectory(entry, `${pathPrefix}/${name}`);
    } else if (AUDIO_EXT.has(getExt26(name))) {
      const file = await entry.getFile();
      await saveHandleAsTrack(entry, file, `${pathPrefix}/${name}`);
      count++;
    }
  }
  return count;
}

async function saveHandleAsTrack(handle, file, relPath) {
  const id = `ref_${relPath}_${file.size}_${file.lastModified}`.replace(/[^a-z0-9_.-]/gi, '_');
  let track = await MS.db.get('tracks', id);
  if (!track) track = {
    id, title: file.name.replace(/\.[^.]+$/, ''), artist: 'Unknown', album: '', genre: '',
    mood: '', bpm: null, key: '', energy: null, favorite: false, playCount: 0,
    lastPlayed: null, dateImported: Date.now(), path: relPath, size: file.size,
    lastModified: file.lastModified, type: file.type, artwork: null,
    source: 'reference', // distinguishes from 'blob' — nothing copied for this one
  };
  track.path = relPath; track.size = file.size;
  await MS.db.put('tracks', track);
  await MS.db.put('handles', { id, handle });   // the live reference — no audio bytes stored
}

function finishImport(count) {
  MS.library = null;
  (async () => {
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    MS.toast(
      count
        ? `Imported ${count} song${count===1?'':'s'} — referenced in place, nothing duplicated.`
        : 'No audio files found in that selection.',
      count ? 'ok' : 'warn'
    );
  })();
}

/* ══════════════════════════════════════════════════════════════
   WIRE INTO EXISTING BUTTONS — prefer reference-based import when
   the device supports it; otherwise defer to phase19's existing
   copy-based fallback (already wired to the same buttons).
══════════════════════════════════════════════════════════════ */
function upgradeImportButtons() {
  const targets = ['npAddSongsBtn', 'npAddFolderBtn', 'libAddSongs', 'libOpenFolder'];
  targets.forEach(id => {
    const btn = $26(id);
    if (!btn || btn._vzRefWired) return;
    btn._vzRefWired = true;
    const isFolder = id.toLowerCase().includes('folder');
    // Capture-phase listener runs before phase19's own click handler and
    // can stop it from also firing, so only one import path executes.
    btn.addEventListener('click', e => {
      if (isFolder && supportsRealDirPicker) {
        e.stopImmediatePropagation();
        importFolderByReference();
      } else if (!isFolder && supportsRealFilePicker) {
        e.stopImmediatePropagation();
        importSongsByReference();
      }
      // else: let phase19's existing handler run (copy-based fallback)
    }, true);
  });
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS — tell the person plainly which mode their device is
   actually using, since it genuinely varies by phone/Chrome version.
══════════════════════════════════════════════════════════════ */
function addStorageModeNote() {
  const body = $26('settingsBody');
  if (!body || $26('storageModeNote')) return;
  const note = document.createElement('div');
  note.id = 'storageModeNote';
  const supported = supportsRealFilePicker && supportsRealDirPicker;
  note.innerHTML = `
    <div class="section-label">📂 How Songs Are Stored</div>
    <div class="settings-about-txt">
      ${supported
        ? "Your Chrome/Android version supports referencing songs directly from where they already live in your phone's storage — new imports are <b>not</b> duplicated into the app."
        : "Your Chrome/Android version doesn't yet support referencing files in place, so new imports are copied into the app's own storage so playback stays reliable — this is a current platform limit on this device, not something the app is choosing to do."}
    </div>`;
  body.appendChild(note);
}
function watchSettingsForModeNote() {
  const orig = window.openAppSettings;
  if (!orig || orig._vzModeWrapped) return;
  const wrapped = function (...args) {
    orig.apply(this, args);
    setTimeout(addStorageModeNote, 90);
  };
  wrapped._vzModeWrapped = true;
  wrapped._vzWrapped = orig._vzWrapped;
  window.openAppSettings = wrapped;
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
function init26() {
  upgradeImportButtons();
  watchSettingsForModeNote();
  console.info(`[868 Vibez] Phase 26 ready — reference-based import (${supportsRealFilePicker && supportsRealDirPicker ? 'SUPPORTED on this device' : 'not supported here, using copy fallback'})`);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init26, 160));
} else {
  setTimeout(init26, 160);
}

})();
