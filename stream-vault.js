/* ============================================================
   MediaSuite — Stream Vault Engine
   Zone 1: URL fetch, stream routing, link extraction,
   iframe sandbox, file system writer, MP4 video layer.
   All client-side. Zero cloud dependencies.
   ============================================================ */

(function () {
  'use strict';

  /* ── State ── */
  const vault = window.MSVault = {
    capturedBlob:    null,
    capturedUrl:     null,
    capturedType:    null,
    currentPortalUrl: null,
    customSites:     [],
  };

  /* ── Regex extractors (from Gemini screenshot) ── */
  const MP3_RE = /href="([^"]+\.mp3[^"]*)"/gi;
  const MP4_RE = /href="([^"]+\.mp4[^"]*)"/gi;
  const SRC_RE = /(?:src|href)="(https?:\/\/[^"]+\.(?:mp3|mp4|ogg|wav|m4a|webm)[^"]*)"/gi;

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);

  function status(msg, type = 'info') {
    const el = $('vaultStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = `vault-status vault-status--${type}`;
    if (window.MS?.toast) window.MS.toast(msg, type === 'error' ? 'error' : type === 'ok' ? 'ok' : 'info', 2500);
  }

  /* ── Detect URL type ── */
  function detectType(url) {
    const u = url.toLowerCase().split('?')[0];
    if (/\.mp4$|\.webm$/.test(u))  return 'mp4';
    if (/\.mp3$|\.ogg$|\.wav$|\.m4a$|\.aac$|\.flac$/.test(u)) return 'mp3';
    if (/\/stream|icecast|shoutcast|\.pls$|\.m3u$/.test(u))   return 'live';
    return 'portal';
  }

  /* ── Master entry point: load any URL ── */
  async function loadVaultUrl(rawUrl) {
    const url = rawUrl.trim();
    if (!url) { status('Paste a URL first.', 'warn'); return; }

    vault.capturedBlob = null;
    vault.capturedUrl  = url;
    $('vaultCapture').style.display = 'none';
    $('savePanel').style.display    = 'none';
    $('extractedPanel').style.display = 'none';
    $('vaultVideoWrap').style.display  = 'none';

    const type = detectType(url);
    vault.capturedType = type;

    status(`Detected: ${type.toUpperCase()} — loading…`, 'info');

    if (type === 'mp4') {
      await loadMP4(url);
    } else if (type === 'mp3') {
      await loadMP3Stream(url);
    } else if (type === 'live') {
      loadLiveStream(url);
    } else {
      await loadPortal(url);
    }
  }

  /* ── MP3: fetch + dual route (play + buffer) ── */
  async function loadMP3Stream(url) {
    status('Fetching MP3…', 'info');
    showPlaceholder(false);

    try {
      // Route A: immediate playback via audio element
      const mainAudio = $('mainAudio');
      if (mainAudio) {
        if (mainAudio.src && mainAudio.src.startsWith('blob:')) URL.revokeObjectURL(mainAudio.src);
        mainAudio.src = url;
        mainAudio.play().catch(() => {});
        $('npTitle').textContent = decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/, ''));
        $('npSub').textContent   = 'Streaming from Stream Vault';
        if (window.MS) window.MS.emit('player:play', { title: $('npTitle').textContent, url });
      }

      // Route B: buffer the entire file for offline save
      status('Buffering for offline capture…', 'info');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf  = await res.arrayBuffer();
      vault.capturedBlob = new Blob([buf], { type: 'audio/mpeg' });
      vault.capturedUrl  = url;

      $('vaultCapture').style.display = 'inline-flex';
      status(`✓ Ready — ${(buf.byteLength / 1048576).toFixed(2)} MB buffered. Hit Capture to save.`, 'ok');
    } catch (e) {
      status(`Stream error: ${e.message}. Try opening the portal instead.`, 'error');
    }
  }

  /* ── Live stream: direct audio element (no buffer — infinite) ── */
  function loadLiveStream(url) {
    status('Connecting to live stream…', 'info');
    showPlaceholder(false);
    const mainAudio = $('mainAudio');
    if (!mainAudio) return;
    if (mainAudio.src && mainAudio.src.startsWith('blob:')) URL.revokeObjectURL(mainAudio.src);
    mainAudio.src = url;
    mainAudio.play().then(() => {
      $('npTitle').textContent = 'Live Stream';
      $('npSub').textContent   = url;
      status('🔴 Live stream connected.', 'ok');
      if (window.MS) window.MS.emit('player:play', { title: 'Live Stream', url, live: true });
    }).catch(e => status(`Could not connect: ${e.message}`, 'error'));
  }

  /* ── MP4: video + audio split-render ── */
  async function loadMP4(url) {
    status('Loading MP4…', 'info');
    showPlaceholder(false);

    const wrap  = $('vaultVideoWrap');
    const video = $('vaultVideoEl');
    const acts  = $('vaultVideoActions');

    wrap.style.display  = 'block';
    video.src           = url;
    video.load();

    video.oncanplay = () => {
      status('✓ MP4 loaded — video + audio split active.', 'ok');
      // Connect audio layer to Web Audio graph via MediaElementAudioSourceNode
      connectVideoToAudioGraph(video, 'main');
    };
    video.onerror = () => status('Could not load MP4. Try fetching directly.', 'error');

    acts.innerHTML = `
      <button class="btn btn--xs" id="vaultMp4LoadA">→ Deck A</button>
      <button class="btn btn--xs" id="vaultMp4LoadB">→ Deck B</button>
      <button class="btn btn--xs" id="vaultMp4Capture">⬇ Capture Audio</button>`;

    $('vaultMp4LoadA').onclick = () => loadStreamToDeck('A', url, 'mp4');
    $('vaultMp4LoadB').onclick = () => loadStreamToDeck('B', url, 'mp4');
    $('vaultMp4Capture').onclick = () => captureMP4Audio(url);
  }

  /* ── Connect any video element into the Web Audio master chain ── */
  function connectVideoToAudioGraph(videoEl, label) {
    try {
      const ctx = window.mediaSuiteAudioCtx
        || window.audioCtx
        || new (window.AudioContext || window.webkitAudioContext)();

      if (!window.mediaSuiteAudioCtx) window.mediaSuiteAudioCtx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      // Avoid double-connecting
      if (videoEl._msSourceNode) { try { videoEl._msSourceNode.disconnect(); } catch {} }
      const src = ctx.createMediaElementSource(videoEl);
      videoEl._msSourceNode = src;

      const dest = window.mediaSuiteGetMasterOutput
        ? window.mediaSuiteGetMasterOutput()
        : ctx.destination;

      src.connect(dest);
      console.info(`[StreamVault] Video (${label}) connected → ${dest === ctx.destination ? 'destination' : 'limiter'}`);
    } catch (e) {
      console.warn('[StreamVault] Audio graph connect failed:', e.message);
    }
  }

  /* ── Load stream URL directly into a deck ── */
  function loadStreamToDeck(deck, url, type) {
    const audio = deck === 'A' ? $('audioA') : $('audioB');
    const video = deck === 'A' ? $('deckAVideoEl') : $('deckBVideoEl');
    const wrap  = deck === 'A' ? $('deckAVideo')   : $('deckBVideo');
    const title = deck === 'A' ? $('deckATitle')   : $('deckBTitle');

    if (!audio) { window.MS?.toast('Deck audio element not found.', 'error'); return; }

    const label = decodeURIComponent(url.split('/').pop().replace(/\.[^.]+$/, ''));

    if (type === 'mp4' && video && wrap) {
      // MP4: use video element for visual, connect audio to graph
      wrap.style.display = 'block';
      video.src = url;
      video.load();
      video.oncanplay = () => connectVideoToAudioGraph(video, `Deck ${deck}`);
      if (title) title.textContent = `${label} · MP4`;
    } else {
      // MP3/live: straight to audio element
      if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.src = url;
      if (title) title.textContent = label;
    }

    if (window.MS) {
      const track = { id: `stream_${Date.now()}`, title: label, url, type };
      window.MS.deck[deck].track = track;
      window.MS.emit('deck:loaded', { deck, track });
    }
    window.MS?.toast(`Loaded into Deck ${deck}`, 'ok', 1800);
  }

  /* ── Fetch page HTML and extract all media links ── */
  async function extractLinksFromUrl(url) {
    status('Scanning page for media links…', 'info');
    try {
      const res = await fetch(url, { headers: { 'Accept': 'text/html,*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html  = await res.text();
      const links = [];
      const base  = new URL(url).origin;

      let m;
      const mp3r = new RegExp(MP3_RE.source, 'gi');
      const mp4r = new RegExp(MP4_RE.source, 'gi');
      const srcr = new RegExp(SRC_RE.source, 'gi');

      while ((m = mp3r.exec(html))) links.push({ url: resolveUrl(m[1], base), type: 'mp3' });
      while ((m = mp4r.exec(html))) links.push({ url: resolveUrl(m[1], base), type: 'mp4' });
      while ((m = srcr.exec(html))) {
        const u = m[1];
        if (!links.find(l => l.url === u))
          links.push({ url: u, type: detectType(u) });
      }

      // Deduplicate
      const seen = new Set();
      const unique = links.filter(l => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });

      if (!unique.length) {
        status('No direct media links found on this page. Try pasting a direct URL.', 'warn');
        return;
      }

      showExtracted(unique, url);
      status(`Found ${unique.length} media link${unique.length > 1 ? 's' : ''}.`, 'ok');
    } catch (e) {
      // CORS block — try iframe
      status('Direct scan blocked (CORS). Loading page in sandbox…', 'warn');
      loadPortal(url);
    }
  }

  function resolveUrl(href, base) {
    if (href.startsWith('http')) return href;
    if (href.startsWith('//'))   return 'https:' + href;
    if (href.startsWith('/'))    return base + href;
    return base + '/' + href;
  }

  /* ── Show extracted links panel ── */
  function showExtracted(links, sourceUrl) {
    const panel = $('extractedPanel');
    const list  = $('extractedList');
    const title = $('extractedTitle');
    if (!panel || !list) return;

    title.textContent = `${links.length} media links found`;
    list.innerHTML = links.map((l, i) => `
      <div class="extracted-item">
        <span class="portal-dot ${l.type}"></span>
        <div class="portal-meta" style="flex:1;min-width:0;">
          <strong style="font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${decodeURIComponent(l.url.split('/').pop())}
          </strong>
          <small style="color:var(--text3);">${l.type.toUpperCase()}</small>
        </div>
        <button class="btn btn--xs" data-idx="${i}" data-action="play">▶</button>
        <button class="btn btn--xs" data-idx="${i}" data-action="loadA">→A</button>
        <button class="btn btn--xs" data-idx="${i}" data-action="loadB">→B</button>
      </div>`).join('');

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = () => {
        const l = links[+btn.dataset.idx];
        if (btn.dataset.action === 'play')  { $('vaultUrl').value = l.url; loadVaultUrl(l.url); }
        if (btn.dataset.action === 'loadA') loadStreamToDeck('A', l.url, l.type);
        if (btn.dataset.action === 'loadB') loadStreamToDeck('B', l.url, l.type);
      };
    });

    panel.style.display = 'block';
  }

  /* ── Load portal in iframe (with X-Frame-Options fallback) ── */
  function loadPortal(url) {
    vault.currentPortalUrl = url;
    const frame       = $('vaultFrame');
    const placeholder = $('vaultPlaceholder');
    if (!frame) return;

    showPlaceholder(false);
    frame.style.display = 'block';
    frame.src = url;

    // Detect iframe block via error / empty load
    const timer = setTimeout(() => {
      // If contentDocument is null or about:blank, it's blocked
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.location.href === 'about:blank') showFrameBlockModal(url);
      } catch {
        showFrameBlockModal(url);
      }
    }, 4000);

    frame.onload = () => clearTimeout(timer);
    frame.onerror = () => { clearTimeout(timer); showFrameBlockModal(url); };
  }

  function showPlaceholder(show) {
    const ph = $('vaultPlaceholder');
    const fr = $('vaultFrame');
    if (ph) ph.style.display = show ? 'flex' : 'none';
    if (fr) fr.style.display = show ? 'none' : 'block';
  }

  function showFrameBlockModal(url) {
    $('frameBlockUrl').textContent = url;
    $('frameBlockModal').style.display = 'flex';
    $('frameBlockOpen').onclick  = () => { window.open(url, '_blank'); closeFrameModal(); };
    $('frameBlockClose').onclick = closeFrameModal;
    status('Site blocks embedding — opening options.', 'warn');
    // Hide the empty iframe, show placeholder
    if ($('vaultFrame')) $('vaultFrame').style.display = 'none';
    showPlaceholder(true);
  }

  function closeFrameModal() {
    $('frameBlockModal').style.display = 'none';
  }

  /* ── Capture MP4 audio as WAV (fetch + decode + re-encode) ── */
  async function captureMP4Audio(url) {
    status('Fetching MP4 for audio capture…', 'info');
    try {
      const res  = await fetch(url);
      const buf  = await res.arrayBuffer();
      vault.capturedBlob = new Blob([buf], { type: 'video/mp4' });
      vault.capturedUrl  = url;
      vault.capturedType = 'mp4';
      $('vaultCapture').style.display = 'inline-flex';
      status(`✓ MP4 buffered (${(buf.byteLength/1048576).toFixed(1)} MB). Hit Capture to save.`, 'ok');
    } catch (e) {
      status(`Capture failed: ${e.message}`, 'error');
    }
  }

  /* ── Save captured blob to device filesystem ── */
  async function saveToDevice() {
    const blob   = vault.capturedBlob;
    if (!blob) { window.MS?.toast('Nothing captured yet.', 'warn'); return; }

    const artist = ($('saveArtist').value || 'Unknown Artist').trim();
    const album  = ($('saveAlbum').value  || 'Unknown Album').trim();
    const title  = ($('saveTitle').value  || 'Unknown Track').trim();
    const type   = vault.capturedType === 'mp4' ? 'mp4' : 'mp3';
    const fname  = `${title}.${type}`;

    if (!('showDirectoryPicker' in window)) {
      // Fallback: trigger browser download
      const a  = document.createElement('a');
      a.href   = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      window.MS?.toast(`Downloading ${fname}`, 'ok');
      $('savePanel').style.display = 'none';
      return;
    }

    try {
      window.MS?.toast('Select your music folder…', 'info', 2000);
      const rootHandle = window.MS?.folderHandle || await window.showDirectoryPicker({ mode: 'readwrite' });
      if (window.MS && !window.MS.folderHandle) window.MS.folderHandle = rootHandle;

      // Create Artist → Album → file.mp3
      const artistDir = await rootHandle.getDirectoryHandle(sanitize(artist), { create: true });
      const albumDir  = await artistDir.getDirectoryHandle(sanitize(album),   { create: true });
      const fileHandle = await albumDir.getFileHandle(sanitize(fname), { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      // Add to library DB
      if (window.MS) {
        const genre = $('saveGenre')?.value || '';
        const track = {
          id:           `stream_${Date.now()}`,
          title, artist, album, genre,
          path:         `${artist}/${album}/${fname}`,
          size:         blob.size,
          type:         blob.type,
          lastModified: Date.now(),
          dateImported: Date.now(),
          bpm: null, key: '', energy: null,
          favorite: false, playCount: 0,
          lastPlayed: null, crates: [],
          _fileHandle: fileHandle
        };
        await window.MS.db.put('tracks', track);
        await window.MS.db.put('handles', { id: track.id, handle: fileHandle, path: track.path });
        window.MS.library.push(track);
        window.MS.emit('library:updated', window.MS.library);
        window.MS.toast(`Saved to ${artist} / ${album} / ${fname}`, 'ok');
      }

      $('savePanel').style.display    = 'none';
      vault.capturedBlob = null;
      $('vaultCapture').style.display = 'none';
    } catch (e) {
      if (e.name !== 'AbortError') window.MS?.toast(`Save failed: ${e.message}`, 'error');
    }
  }

  function sanitize(str) {
    return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
  }

  /* ── Custom site registry (IndexedDB) ── */
  async function loadCustomSites() {
    if (!window.MS) return;
    try {
      const sites = await window.MS.db.all('settings');
      vault.customSites = sites.filter(s => s.id?.startsWith('customSite_'));
      renderCustomSites();
    } catch {}
  }

  function renderCustomSites() {
    const el = $('customSiteList');
    if (!el) return;
    el.innerHTML = vault.customSites.map(s => `
      <div class="portal-item" style="margin-top:4px;">
        <span class="portal-dot portal"></span>
        <div class="portal-meta"><strong style="font-size:11px;">${s.name||s.id}</strong></div>
        <button class="btn btn--xs" data-custom-url="${s.url}">↗</button>
      </div>`).join('');
    el.querySelectorAll('[data-custom-url]').forEach(b =>
      b.onclick = () => { $('vaultUrl').value = b.dataset.customUrl; loadPortal(b.dataset.customUrl); }
    );
  }

  async function addCustomSite() {
    const url  = prompt('Enter site URL:');
    if (!url) return;
    const name = prompt('Label for this site:') || url;
    const rec  = { id: `customSite_${Date.now()}`, url: url.trim(), name };
    await window.MS?.db.put('settings', rec);
    vault.customSites.push(rec);
    renderCustomSites();
    window.MS?.toast(`${name} saved to vault.`, 'ok');
  }

  /* ── Genre chip management ── */
  async function addGenreChip() {
    const g = prompt('New genre name:');
    if (!g) return;
    const strip = $('genreStrip');
    if (!strip) return;
    const btn = document.createElement('button');
    btn.className    = 'genre-chip';
    btn.dataset.genre = g;
    btn.textContent  = g;
    strip.insertBefore(btn, $('addGenreBtn'));
    btn.onclick = () => activateGenreChip(btn);
    window.MS?.toast(`Genre "${g}" added.`, 'ok', 1500);
  }

  function activateGenreChip(btn) {
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    if (window.MS) {
      window.MS._activeGenre = btn.dataset.genre || '';
      window.MS.emit('genre:filter', window.MS._activeGenre);
      // Trigger re-render
      if (typeof window.renderTrackListPublic === 'function') window.renderTrackListPublic();
    }
  }

  /* ── Bind all UI events ── */
  function bindVaultUI() {
    // Address bar
    $('vaultLoad')?.addEventListener('click', () => loadVaultUrl($('vaultUrl').value));
    $('vaultUrl')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadVaultUrl($('vaultUrl').value); });
    $('vaultExtract')?.addEventListener('click', () => extractLinksFromUrl($('vaultUrl').value.trim() || vault.currentPortalUrl));
    $('vaultCapture')?.addEventListener('click', () => { $('savePanel').style.display = 'block'; });
    $('saveToFolder')?.addEventListener('click', saveToDevice);
    $('cancelSave')?.addEventListener('click',   () => { $('savePanel').style.display = 'none'; });
    $('closeExtracted')?.addEventListener('click', () => { $('extractedPanel').style.display = 'none'; });
    $('addCustomSite')?.addEventListener('click', addCustomSite);
    $('addGenreBtn')?.addEventListener('click', addGenreChip);

    // Pre-seeded portal items
    document.querySelectorAll('.portal-play').forEach(btn => {
      btn.onclick = () => {
        const item = btn.closest('.portal-item');
        const url  = item?.dataset.url;
        if (url) { $('vaultUrl').value = url; loadVaultUrl(url); }
      };
    });

    document.querySelectorAll('.portal-open').forEach(btn => {
      btn.onclick = () => {
        const item = btn.closest('.portal-item');
        const url  = item?.dataset.url;
        if (url) { $('vaultUrl').value = url; loadPortal(url); }
      };
    });

    // Genre chips
    document.querySelectorAll('.genre-chip:not(.add-genre)').forEach(btn =>
      btn.addEventListener('click', () => activateGenreChip(btn))
    );

    // Vault tab activation
    document.querySelectorAll('.tabs button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.tab === 'vault') loadCustomSites();
      });
    });

    // Pitch controls
    ['A','B'].forEach(d => {
      const slider = $(`pitch${d}`);
      const label  = $(`pitch${d}Val`);
      slider?.addEventListener('input', () => {
        const st = +slider.value;
        if (label) label.textContent = `${st > 0 ? '+' : ''}${st.toFixed(1)} st`;
        const audio = d === 'A' ? $('audioA') : $('audioB');
        if (audio) audio.playbackRate = Math.pow(2, st / 12);
      });
    });

    // Performance tab: wire second session buttons
    $('startSession2')?.addEventListener('click', () => $('startSession')?.click());
    $('stopSession2')?.addEventListener('click',  () => $('stopSession')?.click());

    // Quick-load filter
    $('qlFilter')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#quickLoad .track').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    // Video close buttons
    $('closeVideo')?.addEventListener('click', () => {
      $('videoViewport').style.display = 'none';
      const v = $('videoEl');
      if (v) { v.pause(); v.src = ''; }
    });

    // Frame block modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeFrameModal();
    });
  }

  /* ── Boot ── */
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    bindVaultUI();
    loadCustomSites();

    // Listen for library updates to re-render quick load
    window.MS?.on('library:updated', () => {
      if (typeof window.renderQuickLoadPublic === 'function') window.renderQuickLoadPublic();
    });

    // Expose for app.js genre filter integration
    window.MSVault.activateGenreChip = activateGenreChip;
    window.MSVault.loadStreamToDeck  = loadStreamToDeck;
    window.MSVault.loadVaultUrl      = loadVaultUrl;

    console.info('[StreamVault] Engine ready.');
  }

  boot();
})();
