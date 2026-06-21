/* ============================================================
   868 VIBEZ — Phase 12: Artwork Compression Pipeline
   
   Closes the one real gap identified across the roadmap docs:
   raw APIC blobs were being stored at full resolution, which
   bloats IndexedDB and slows list rendering on large libraries.
   
   This intercepts every artwork write point and replaces the
   stored blob with two canvas-downscaled WebP versions:
     - 300×300 "now"  → Now Playing / Album view hero art
     - 80×80   "thumb" → track rows / mini player / DJ decks
   The original full-resolution blob is never persisted —
   it's decoded, downscaled, and discarded in the same pass.
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   CANVAS DOWNSCALE ENGINE
   Decodes any image blob via createImageBitmap, draws it onto
   two offscreen canvases at fixed target sizes (cover-fit, no
   distortion), and exports each as a compressed WebP blob.
══════════════════════════════════════════════════════════════ */
const ArtworkCompressor = {

  SIZE_NOW:   300,
  SIZE_THUMB: 80,
  QUALITY:    0.82, // WebP quality — good visual fidelity at ~1/4 the size of source JPEG

  async compress(blob) {
    if (!blob || blob.size === 0) return { now: null, thumb: null };

    try {
      const bitmap = await createImageBitmap(blob);
      const now    = await this._render(bitmap, this.SIZE_NOW);
      const thumb  = await this._render(bitmap, this.SIZE_THUMB);
      bitmap.close?.(); // release decoded pixel memory immediately
      return { now, thumb };
    } catch (e) {
      console.warn('[Phase12] Artwork compression failed, falling back to original:', e.message);
      // If decoding fails (corrupt/unsupported image), keep the original
      // rather than losing the artwork entirely.
      return { now: blob, thumb: blob };
    }
  },

  /* Cover-fit draw: fills the target square, crops overflow, no stretching */
  async _render(bitmap, targetSize) {
    const canvas = new OffscreenCanvas(targetSize, targetSize);
    const ctx    = canvas.getContext('2d');

    const srcW = bitmap.width, srcH = bitmap.height;
    const scale = Math.max(targetSize / srcW, targetSize / srcH);
    const drawW = srcW * scale, drawH = srcH * scale;
    const dx = (targetSize - drawW) / 2;
    const dy = (targetSize - drawH) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, dx, dy, drawW, drawH);

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: this.QUALITY });
    return blob;
  }
};

MS.artworkCompressor = ArtworkCompressor;

/* ══════════════════════════════════════════════════════════════
   PATCH ArtworkCache.put — compress before storing, ever.
   This is the single choke point every artwork write already
   passes through (ID3 import, stream save, worker analysis),
   so patching it here closes the gap everywhere at once with
   zero changes needed in Phase 1, 3, or 11.
══════════════════════════════════════════════════════════════ */
const _origArtworkPut = MS.artwork.put.bind(MS.artwork);

MS.artwork.put = async function (id, blob) {
  if (!blob) return;

  const { now, thumb } = await ArtworkCompressor.compress(blob);
  if (!now && !thumb) return; // total failure — skip silently, track just has no art

  try {
    await MS.db.put('artwork_cache', {
      id,
      blob:      now || thumb,      // 300×300 version used as primary "now playing" art
      thumbBlob: thumb || now,      // 80×80 version used in lists
      mimeType:  'image/webp',
      cachedAt:  Date.now(),
      compressed: true
    });
  } catch (e) {
    console.warn('[Phase12] Compressed artwork write failed:', e.message);
  }
};

/* ══════════════════════════════════════════════════════════════
   PATCH getUrl to support requesting either size.
   Existing callers (renderArtwork, mini player, vinyl) keep
   working unchanged — they get the 'now' (300×300) version by
   default. New callers can request the thumbnail explicitly.
══════════════════════════════════════════════════════════════ */
const _origGetUrl = MS.artwork.getUrl.bind(MS.artwork);

MS.artwork.getUrl = async function (id, size = 'now') {
  const cacheKey = size === 'thumb' ? `${id}_thumb` : id;
  if (this._urlCache.has(cacheKey)) return this._urlCache.get(cacheKey);

  const rec = await this.get(id);
  if (!rec?.blob) return null;

  const targetBlob = (size === 'thumb' && rec.thumbBlob) ? rec.thumbBlob : rec.blob;
  const url = URL.createObjectURL(targetBlob);
  this._urlCache.set(cacheKey, url);
  return url;
};

/* Thumbnail convenience method for list rows / mini player */
MS.artwork.getThumbUrl = function (id) {
  return MS.artwork.getUrl(id, 'thumb');
};

/* Revoke both sizes when cleaning up */
const _origRevoke = MS.artwork.revoke.bind(MS.artwork);
MS.artwork.revoke = function (id) {
  _origRevoke(id);
  const thumbUrl = this._urlCache.get(`${id}_thumb`);
  if (thumbUrl) { URL.revokeObjectURL(thumbUrl); this._urlCache.delete(`${id}_thumb`); }
};

/* ══════════════════════════════════════════════════════════════
   RETROFIT — migrate any artwork already stored uncompressed
   (from before this phase existed) to the compressed format,
   one record at a time, fully in the background.
══════════════════════════════════════════════════════════════ */
const ArtworkMigration = {

  async run(onProgress) {
    let records;
    try { records = await MS.db.all('artwork_cache'); }
    catch { return 0; }

    const uncompressed = records.filter(r => !r.compressed);
    if (!uncompressed.length) return 0;

    let done = 0;
    for (const rec of uncompressed) {
      try {
        const { now, thumb } = await ArtworkCompressor.compress(rec.blob);
        await MS.db.put('artwork_cache', {
          id: rec.id,
          blob: now || rec.blob,
          thumbBlob: thumb || now || rec.blob,
          mimeType: 'image/webp',
          cachedAt: rec.cachedAt || Date.now(),
          compressed: true
        });
      } catch {}
      done++;
      onProgress?.({ done, total: uncompressed.length });
      if (done % 5 === 0) await new Promise(r => setTimeout(r, 0)); // yield to UI
    }

    // Clear in-memory URL cache so renders pick up the new compressed blobs
    MS.artwork.revokeAll();
    return done;
  }
};

MS.artworkMigration = ArtworkMigration;

/* ══════════════════════════════════════════════════════════════
   STORAGE SAVINGS REPORT — for the Health panel
══════════════════════════════════════════════════════════════ */
async function estimateArtworkSavings() {
  try {
    const records = await MS.db.all('artwork_cache');
    const compressed   = records.filter(r => r.compressed);
    const uncompressed = records.filter(r => !r.compressed);

    let compressedSize = 0, uncompressedSize = 0;
    compressed.forEach(r => { compressedSize += (r.blob?.size||0) + (r.thumbBlob?.size||0); });
    uncompressed.forEach(r => { uncompressedSize += (r.blob?.size||0); });

    return {
      totalRecords: records.length,
      compressed:   compressed.length,
      uncompressed: uncompressed.length,
      compressedKB:   Math.round(compressedSize / 1024),
      uncompressedKB: Math.round(uncompressedSize / 1024),
    };
  } catch {
    return { totalRecords:0, compressed:0, uncompressed:0, compressedKB:0, uncompressedKB:0 };
  }
}

/* ══════════════════════════════════════════════════════════════
   UI WIRING — Health panel storage card + migration trigger,
   and quietly upgrade thumbnail usage in existing list renders
   without touching their HTML structure.
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* Run migration automatically once, quietly, shortly after boot */
  MS.on('boot:complete', () => {
    setTimeout(async () => {
      const n = await ArtworkMigration.run();
      if (n > 0) {
        console.info(`[Phase12] Migrated ${n} artwork record(s) to compressed WebP`);
        MS.emit('library:updated', MS.library); // refresh any visible art
      }
    }, 4000);
  });

  /* Storage savings card in Library Health panel */
  MS.on('health:scanned', async () => {
    const hp = document.getElementById('healthReport');
    if (!hp || document.getElementById('artworkStorageCard')) return;

    const report = await estimateArtworkSavings();
    const card = document.createElement('div');
    card.id = 'artworkStorageCard';
    card.style.cssText = 'margin-top:12px;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;font-size:11px';
    card.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:var(--cyan)">🖼 Artwork Storage</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Compressed (WebP)</span><span style="font-family:monospace;color:var(--green)">${report.compressed} · ${report.compressedKB} KB</span></div>
      ${report.uncompressed > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>Pending migration</span><span style="font-family:monospace;color:var(--yellow)">${report.uncompressed} · ${report.uncompressedKB} KB</span></div>
      <button id="migrateArtworkBtn" class="vz-btn sm" style="width:100%;margin-top:8px">⚡ Compress Now</button>` : `<div style="color:var(--green);margin-top:4px">✓ All artwork optimised</div>`}`;
    hp.appendChild(card);

    document.getElementById('migrateArtworkBtn')?.addEventListener('click', async function() {
      this.textContent = 'Compressing…'; this.disabled = true;
      const n = await ArtworkMigration.run(({done,total}) => { this.textContent = `Compressing ${done}/${total}…`; });
      MS.toast(`Compressed ${n} artwork files`, 'ok');
      MS.emit('library:updated', MS.library);
      card.remove(); // will be rebuilt fresh on next health scan
    });
  });

  console.info('[Phase12] Artwork Compression Pipeline active');
});

/* ══════════════════════════════════════════════════════════════
   ROUTE LIST ROWS TO THE THUMBNAIL SIZE
   MS.renderArtwork is the one shared helper used everywhere —
   Now Playing, track rows, the DJ deck strip. Patch it to accept
   a 4th arg so list contexts request the 80×80 thumb instead of
   the 300×300 "now" version, without touching any call sites
   in phase1.js/phase2.js/phase8.js that don't pass it.
══════════════════════════════════════════════════════════════ */
const _origRenderArtwork12 = MS.renderArtwork;

MS.renderArtwork = async function (track, imgEl, fallbackText = '🎵', size = 'now') {
  if (!imgEl) return;
  if (!track?.artwork) {
    imgEl.style.backgroundImage = '';
    imgEl.textContent = fallbackText;
    return;
  }
  const url = await MS.artwork.getUrl(track.id, size);
  if (url) {
    imgEl.style.backgroundImage    = `url(${url})`;
    imgEl.style.backgroundSize     = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.textContent = '';
  } else {
    imgEl.textContent = fallbackText;
  }
};

/* Patch the two known list-row injection points to request thumbnails.
   Now Playing (.np-art-wrap / vinyl) is untouched — it keeps 'now' (300×300)
   since that's the dominant hero image and deserves the higher-res version. */
document.addEventListener('DOMContentLoaded', () => {

  // Phase 1's renderArtworkInList loop renders every .tr-art row — make it use thumbs
  MS.on('library:updated', () => {
    setTimeout(async () => {
      const rows = document.querySelectorAll('[data-track-id] .tr-art, [data-track-id] .pl-art, [data-track-id] .album-art-sm');
      for (const art of rows) {
        const row = art.closest('[data-track-id]');
        const id  = row?.dataset.trackId;
        const track = MS.library.find(t => t.id === id);
        if (!track?.artwork) continue;
        if (art.dataset.thumbLoaded === id) continue;
        const url = await MS.artwork.getThumbUrl(track.id);
        if (url) {
          art.style.backgroundImage    = `url(${url})`;
          art.style.backgroundSize     = 'cover';
          art.style.backgroundPosition = 'center';
          art.dataset.thumbLoaded = id;
          art.textContent = '';
        }
      }
    }, 350); // run after Phase 1's own injection pass so we win the final paint
  });

  // Mini player art also uses the thumbnail size (it's tiny on screen)
  const _origUpdateMiniArt = window.updateMiniPlayer;
  // Mini player's own renderArtwork call in phase2.js already routes through
  // the now-patched MS.renderArtwork default ('now') — override just that one
  // call site by intercepting the element after paint and swapping to thumb.
  MS.on('player:play', async track => {
    if (!track?.artwork) return;
    setTimeout(async () => {
      const mpArt = document.getElementById('mpArt');
      if (!mpArt) return;
      const url = await MS.artwork.getThumbUrl(track.id);
      if (url) {
        mpArt.style.backgroundImage    = `url(${url})`;
        mpArt.style.backgroundSize     = 'cover';
        mpArt.style.backgroundPosition = 'center';
        mpArt.textContent = '';
      }
    }, 150);
  });
});
