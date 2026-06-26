/**
 * 868 VIBEZ V2.0 — CORE ENGINE
 * Phase 1: Music Player + Queue + Favorites + Folder Navigation
 * Architecture: Local-First, Zero-Cloud, Vanilla JS, Single DB Open
 */
"use strict";

/* ============================================================
   DATABASE — Single authoritative open call. Never duplicated.
   ============================================================ */
const DB_NAME    = "868VibezV2";
const DB_VERSION = 5;

const STORES = [
  { name: "tracks",    cfg: { keyPath: "id" } },
  { name: "folders",   cfg: { keyPath: "id" } },
  { name: "metadata",  cfg: { keyPath: "trackId" } },
  { name: "queue",     cfg: { keyPath: "id", autoIncrement: true } },
  { name: "playlists", cfg: { keyPath: "id", autoIncrement: true } },
  { name: "crates",    cfg: { keyPath: "id", autoIncrement: true } },
  { name: "recent",    cfg: { keyPath: "id", autoIncrement: true } },
  { name: "settings",  cfg: { keyPath: "key" } },
  { name: "waveforms", cfg: { keyPath: "trackId" } },
  { name: "analysis",  cfg: { keyPath: "trackId" } },
  { name: "stats",     cfg: { keyPath: "trackId" } }
];

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(({ name, cfg }) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, cfg);
        }
      });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/* ============================================================
   DB OPERATIONS — Atomic, promise-based
   ============================================================ */
function getStore(name, mode = "readonly") {
  return V.db.transaction(name, mode).objectStore(name);
}

const db = {
  put: (store, val) => new Promise((res, rej) => {
    const r = getStore(store, "readwrite").put(val);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }),
  get: (store, key) => new Promise((res, rej) => {
    const r = getStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }),
  all: (store) => new Promise((res, rej) => {
    const r = getStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  }),
  del: (store, key) => new Promise((res, rej) => {
    const r = getStore(store, "readwrite").delete(key);
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  }),
  clear: (store) => new Promise((res, rej) => {
    const r = getStore(store, "readwrite").clear();
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  })
};

/* ============================================================
   GLOBAL STATE
   ============================================================ */
const V = window.Vibez = {
  db:            null,
  library:       [],       // all tracks
  folders:       {},       // folderId → [trackId, ...]
  queue:         [],       // persisted queue items
  favorites:     new Set(),
  currentTrack:  null,
  currentFolder: null,     // folderId of current track
  currentFolderTracks: [], // ordered list of trackIds in current folder
  currentFolderIndex:  -1, // position within currentFolderTracks
  currentUrl:    null,
  radioPlayer:   new Audio(),
  activeRadioId: null
};

/* ============================================================
   HELPERS
   ============================================================ */
const $     = id => document.getElementById(id);
const esc   = s  => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));

const fmt = s => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const makeFolderId = path =>
  path.replace(/[^a-z0-9_/.-]/gi, "_");

const makeTrackId = f =>
  `tr_${f.name}_${f.size}_${f.lastModified}`.replace(/[^a-z0-9_.-]/gi, "_");

/* ============================================================
   SPLASH SCREEN
   ============================================================ */
function dismissSplash() {
  const splash = $("splash");
  const app    = $("app");
  splash.classList.add("fade-out");
  app.classList.remove("hidden");
  setTimeout(() => { splash.style.display = "none"; }, 650);
}

/* ============================================================
   FILE IMPORT — Folder-aware ingestion pipeline
   ============================================================ */
async function importFiles(fileList) {
  const files  = [...fileList].filter(f =>
    f.type.startsWith("audio/") ||
    /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name)
  );

  if (!files.length) return;

  // Group by webkitRelativePath folder or fallback to "Imported"
  const folderMap = {};

  for (const f of files) {
    const rawPath  = f.webkitRelativePath || "";
    const folderPath = rawPath.includes("/")
      ? rawPath.substring(0, rawPath.lastIndexOf("/"))
      : "Imported";

    const folderId = makeFolderId(folderPath);

    if (!folderMap[folderId]) {
      folderMap[folderId] = {
        id:    folderId,
        name:  folderPath.split("/").pop() || "Imported",
        path:  folderPath,
        tracks: []
      };
    }

    const trackId = makeTrackId(f);
    const title   = f.name.replace(/\.[^.]+$/, "");

    // Store track blob
    await db.put("tracks", {
      id:       trackId,
      name:     f.name,
      type:     f.type || "audio/mpeg",
      size:     f.size,
      folderId: folderId,
      addedAt:  Date.now(),
      blob:     f
    });

    // Store metadata (will be enriched in Phase 5)
    const existing = await db.get("metadata", trackId).catch(() => null);
    if (!existing) {
      await db.put("metadata", {
        trackId,
        title,
        artist: "Unknown Artist",
        album:  "",
        genre:  "",
        year:   ""
      });
    }

    // Recent log
    await db.put("recent", {
      trackId,
      type:      "added",
      timestamp: Date.now()
    });

    folderMap[folderId].tracks.push(trackId);
  }

  // Persist folders — merge with existing
  for (const [folderId, folder] of Object.entries(folderMap)) {
    const existing = await db.get("folders", folderId).catch(() => null);
    if (existing) {
      // Merge track lists, deduplicate
      const merged = [...new Set([...existing.tracks, ...folder.tracks])];
      await db.put("folders", { ...existing, tracks: merged });
    } else {
      await db.put("folders", folder);
    }
  }

  await syncState();
}

/* ============================================================
   STATE SYNC — Reload library, folders, queue, favorites
   ============================================================ */
async function syncState() {
  V.library = await db.all("tracks");

  const folderList = await db.all("folders");
  V.folders = {};
  folderList.forEach(f => { V.folders[f.id] = f; });

  const queueItems = await db.all("queue");
  V.queue = queueItems.sort((a, b) => (a.position || 0) - (b.position || 0));

  const favSetting = await db.get("settings", "favorites").catch(() => null);
  V.favorites = new Set(favSetting?.value || []);

  renderLibrary();
  renderQueue();

  // Restore last session
  const last = await db.get("settings", "last_session").catch(() => null);
  if (last?.value?.trackId && !V.currentTrack) {
    const track = V.library.find(x => x.id === last.value.trackId);
    if (track) loadTrack(track, false, last.value.time || 0);
  }
}

/* ============================================================
   TRACK LOADING — Core playback with folder context
   ============================================================ */
async function loadTrack(trackRecord, shouldPlay = true, resumeAt = 0) {
  const audio = $("audio");

  // Stop radio if playing
  if (V.activeRadioId) stopRadio();

  // Revoke previous object URL
  if (V.currentUrl) {
    URL.revokeObjectURL(V.currentUrl);
    V.currentUrl = null;
  }

  // Load fresh blob from DB
  const stored = await db.get("tracks", trackRecord.id);
  if (!stored?.blob) return;

  const meta = await db.get("metadata", trackRecord.id).catch(() => ({}));

  V.currentTrack = { ...stored, ...meta };

  // Set folder context for folder navigation
  V.currentFolder = stored.folderId || null;
  if (V.currentFolder && V.folders[V.currentFolder]) {
    V.currentFolderTracks = V.folders[V.currentFolder].tracks || [];
    V.currentFolderIndex  = V.currentFolderTracks.indexOf(stored.id);
  } else {
    V.currentFolderTracks = [stored.id];
    V.currentFolderIndex  = 0;
  }

  // Build object URL and assign
  V.currentUrl    = URL.createObjectURL(stored.blob);
  audio.src       = V.currentUrl;
  audio.currentTime = resumeAt;

  updatePlayerUI();

  if (shouldPlay) {
    audio.play().catch(() => {
      // Autoplay blocked — UI already reflects paused state via event
    });
  }

  // Persist session
  await db.put("settings", {
    key:   "last_session",
    value: { trackId: stored.id, time: resumeAt }
  });

  setupMediaSession();
}

/* ============================================================
   PLAYER UI UPDATE
   ============================================================ */
function updatePlayerUI() {
  const audio = $("audio");
  const t     = V.currentTrack;
  const playing = t && !audio.paused;

  $("songTitle").textContent  = t ? (t.title || t.name)  : "No track loaded";
  $("artistName").textContent = t ? (t.artist || "Unknown Artist") : "Import music to begin";

  // Vinyl animation
  $("vinyl").classList.toggle("playing", playing);

  // Play / pause icon swap
  $("iconPlay").classList.toggle("hidden",  playing);
  $("iconPause").classList.toggle("hidden", !playing);

  // Favorite button state
  const isFav = t && V.favorites.has(t.id);
  $("favBtn").classList.toggle("active", isFav);
  $("heartIcon").style.color = isFav ? "var(--red)" : "";
}

/* ============================================================
   MEDIA SESSION (lock screen / notification)
   ============================================================ */
function setupMediaSession() {
  if (!("mediaSession" in navigator) || !V.currentTrack) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  V.currentTrack.title  || V.currentTrack.name,
    artist: V.currentTrack.artist || "Unknown Artist",
    album:  "868 Vibez"
  });
  try { navigator.mediaSession.setActionHandler("play",          () => $("audio").play()); }   catch {}
  try { navigator.mediaSession.setActionHandler("pause",         () => $("audio").pause()); }  catch {}
  try { navigator.mediaSession.setActionHandler("previoustrack", () => prevTrack()); }         catch {}
  try { navigator.mediaSession.setActionHandler("nexttrack",     () => nextTrack()); }         catch {}
}

/* ============================================================
   FOLDER NAVIGATION — stays strictly within current folder
   ============================================================ */
function nextTrack() {
  if (!V.currentFolderTracks.length) return;

  // Check queue first
  if (V.queue.length > 0) {
    playNextFromQueue();
    return;
  }

  const len  = V.currentFolderTracks.length;
  const next = (V.currentFolderIndex + 1) % len; // loops at end
  const nextId = V.currentFolderTracks[next];
  const track  = V.library.find(x => x.id === nextId);
  if (track) loadTrack(track, true);
}

function prevTrack() {
  if (!V.currentFolderTracks.length) return;
  const len  = V.currentFolderTracks.length;
  const prev = (V.currentFolderIndex - 1 + len) % len; // loops at start
  const prevId = V.currentFolderTracks[prev];
  const track  = V.library.find(x => x.id === prevId);
  if (track) loadTrack(track, true);
}

/* ============================================================
   QUEUE
   ============================================================ */
async function addToQueue(trackId) {
  await db.put("queue", { trackId, position: Date.now() });
  await syncState();
}

async function removeFromQueue(itemId) {
  await db.del("queue", itemId);
  await syncState();
}

async function playNextFromQueue() {
  if (!V.queue.length) { nextTrack(); return; }
  const item  = V.queue.shift();
  await db.del("queue", item.id);
  const track = V.library.find(x => x.id === item.trackId);
  renderQueue();
  if (track) loadTrack(track, true);
}

function renderQueue() {
  const el = $("queueList");
  if (!el) return;

  if (!V.queue.length) {
    el.innerHTML = `
      <div class="list-empty">
        <div class="list-empty-icon">🎵</div>
        <p class="list-empty-title">Queue is empty</p>
        <p class="list-empty-sub">Add songs from the Library to queue them up</p>
      </div>`;
    return;
  }

  el.innerHTML = V.queue.map((item, idx) => {
    const t = V.library.find(x => x.id === item.trackId);
    const name = t ? esc(t.name.replace(/\.[^.]+$/, "")) : "Unknown Track";
    return `
      <div class="list-item">
        <div class="list-item-art">
          <span class="list-item-note">${idx + 1}</span>
        </div>
        <div class="list-item-info">
          <div class="list-item-title">${name}</div>
        </div>
        <div class="list-item-actions">
          <button class="list-action-btn" onclick="window.Vibez.removeFromQueue(${item.id})">✕</button>
        </div>
      </div>`;
  }).join("");
}

/* ============================================================
   LIBRARY RENDERER
   ============================================================ */
async function renderLibrary() {
  const el    = $("libraryList");
  const query = ($("searchInput")?.value || "").toLowerCase().trim();
  if (!el) return;

  const metaAll = await db.all("metadata");

  const filtered = V.library.filter(t => {
    const m = metaAll.find(x => x.trackId === t.id) || {};
    const title  = (m.title  || t.name || "").toLowerCase();
    const artist = (m.artist || "").toLowerCase();
    return !query || title.includes(query) || artist.includes(query);
  });

  if (!filtered.length) {
    el.innerHTML = V.library.length === 0
      ? `<div class="list-empty">
           <div class="list-empty-icon">📁</div>
           <p class="list-empty-title">No music yet</p>
           <p class="list-empty-sub">Tap Import on the Player page to add your music</p>
         </div>`
      : `<div class="list-empty">
           <div class="list-empty-icon">🔍</div>
           <p class="list-empty-title">No results</p>
           <p class="list-empty-sub">Try a different search term</p>
         </div>`;
    return;
  }

  el.innerHTML = filtered.map(t => {
    const m       = metaAll.find(x => x.trackId === t.id) || {};
    const title   = esc(m.title  || t.name.replace(/\.[^.]+$/, ""));
    const artist  = esc(m.artist || "Unknown Artist");
    const current = V.currentTrack?.id === t.id;

    return `
      <div class="list-item${current ? " playing" : ""}" data-track-id="${t.id}">
        <div class="list-item-art">
          ${current
            ? `<div class="playing-bar"><span></span><span></span><span></span></div>`
            : `<span class="list-item-note">🎵</span>`
          }
        </div>
        <div class="list-item-info">
          <div class="list-item-title">${title}</div>
          <div class="list-item-sub">${artist}</div>
        </div>
        <div class="list-item-actions">
          <button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button>
          <button class="list-action-btn" onclick="window.Vibez.addToQueue('${t.id}')">+Q</button>
        </div>
      </div>`;
  }).join("");
}

/* ============================================================
   RADIO — Placeholder renderer (full data in Phase 3)
   ============================================================ */
const STATIONS = [
  // Music stations
  { id: "103fm",       name: "103 FM",                freq: "103.0 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "1077mfl",     name: "107.7 FM Music For Life",freq: "107.7 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "951ultimate", name: "95.1 The Ultimate One",  freq: "95.1 FM",  cat: "music", phone: "+18686252095",     whatsapp: "18683949595" },
  { id: "961wefm",     name: "96.1 WEFM",              freq: "96.1 FM",  cat: "music", phone: "+18686289336",     whatsapp: null },
  { id: "bacchanal",   name: "Bacchanal Radio",        freq: "Online",   cat: "music", phone: null,              whatsapp: null },
  { id: "boom941",     name: "Boom Champions 94.1",    freq: "94.1 FM",  cat: "music", phone: "+18686276937",     whatsapp: "18683229494" },
  { id: "freedom1065", name: "Freedom 106.5 FM",       freq: "106.5 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "heartbeat",   name: "Heartbeat 103.5",        freq: "103.5 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "hott93",      name: "Hott 93",                freq: "93.5 FM",  cat: "music", phone: "+18686258426",     whatsapp: null },
  { id: "isaac981",    name: "ISAAC 98.1 FM",          freq: "98.1 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "iconic1047",  name: "Iconic 104.7 FM",        freq: "104.7 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "mix901",      name: "MIX 90.1 FM",            freq: "90.1 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "music97",     name: "Music Radio 97",         freq: "97.1 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "power102",    name: "Power 102 FM",           freq: "102.0 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "radio905",    name: "Radio 90.5",             freq: "90.5 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "sangeet1061", name: "Sangeet 106.1 FM",       freq: "106.1 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "sky995",      name: "SKY 99.5 FM",            freq: "99.5 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "slam1005",    name: "Slam 100.5",             freq: "100.5 FM", cat: "music", phone: "+18686241005",     whatsapp: "18687077526" },
  { id: "star947",     name: "Star 947",               freq: "94.7 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "sweet100",    name: "Sweet FM",               freq: "100.1 FM", cat: "music", phone: "+18686229292",     whatsapp: null },
  { id: "street919",   name: "The Street 91.9 FM",     freq: "91.9 FM",  cat: "music", phone: null,              whatsapp: null },
  { id: "vibect105",   name: "Vibe CT 105",            freq: "105.1 FM", cat: "music", phone: "+18686235105",     whatsapp: "18683881051" },
  { id: "w1071",       name: "W107.1",                 freq: "107.1 FM", cat: "music", phone: null,              whatsapp: null },
  { id: "wack901",     name: "Wack Radio",             freq: "90.1 FM",  cat: "music", phone: "+18686529774",     whatsapp: null },
  { id: "next991",     name: "Next 99.1 FM",           freq: "99.1 FM",  cat: "music", phone: "+18686283006",     whatsapp: "18683104991" },
  { id: "tambrin927",  name: "Radio Tambrin 92.7",     freq: "92.7 FM",  cat: "music", phone: "+18686393437",     whatsapp: null },
  // Talk / News
  { id: "talkcity911", name: "Talk City 91.1 FM",      freq: "91.1 FM",  cat: "talk",  phone: "+18686224911",     whatsapp: "18683944911" },
  { id: "i955",        name: "i95.5 FM",               freq: "95.5 FM",  cat: "talk",  phone: "+18686283937",     whatsapp: null }
];

function renderRadio() {
  const el = $("radioList");
  if (!el) return;

  const musicStations = STATIONS.filter(s => s.cat === "music");
  const talkStations  = STATIONS.filter(s => s.cat === "talk");

  const renderItem = s => {
    const active  = V.activeRadioId === s.id;
    const initials = s.name.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase();

    const phoneBtn = s.phone
      ? `<a href="tel:${s.phone}" class="radio-link-btn">📞 Call</a>`
      : "";

    const waBtn = s.whatsapp
      ? `<a href="https://wa.me/${s.whatsapp}" target="_blank" rel="noopener" class="radio-link-btn">💬 WhatsApp</a>`
      : "";

    return `
      <div class="radio-item">
        <div class="radio-logo">${initials}</div>
        <div class="radio-info">
          ${active ? `<div class="radio-live-badge">● Live</div>` : ""}
          <div class="radio-name">${esc(s.name)}</div>
          <div class="radio-freq">${esc(s.freq)}</div>
          ${(phoneBtn || waBtn) ? `<div class="radio-links">${phoneBtn}${waBtn}</div>` : ""}
        </div>
        <button class="radio-play-btn${active ? " active" : ""}"
                onclick="window.Vibez.toggleRadio('${s.id}')">
          ${active ? "■" : "▶"}
        </button>
      </div>`;
  };

  el.innerHTML = `
    <div class="radio-category">Music Stations</div>
    ${musicStations.map(renderItem).join("")}
    <div class="radio-category">Talk &amp; News</div>
    ${talkStations.map(renderItem).join("")}
  `;
}

function toggleRadio(stationId) {
  const s = STATIONS.find(x => x.id === stationId);
  if (!s) return;

  if (V.activeRadioId === stationId) {
    stopRadio();
    return;
  }

  if (!s.stream) {
    // Stream URL pending — show placeholder
    alert(`${s.name}\nStream URL pending verification.\nPlease check back after S23 Ultra stream extraction.`);
    return;
  }

  // Pause music player
  $("audio").pause();

  V.activeRadioId   = stationId;
  V.radioPlayer.src = s.stream;
  V.radioPlayer.play().catch(() => stopRadio());
  renderRadio();
}

function stopRadio() {
  V.radioPlayer.pause();
  V.radioPlayer.src = "";
  V.activeRadioId   = null;
  renderRadio();
}

/* ============================================================
   PAGE NAVIGATION
   ============================================================ */
function showPage(name) {
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active", p.id === `page-${name}`)
  );
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.page === name)
  );
  localStorage.setItem("vz_page", name);
}

/* ============================================================
   EVENT BINDINGS
   ============================================================ */
function bindEvents() {
  const audio = $("audio");

  // Navigation
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.onclick = () => showPage(b.dataset.page);
  });

  // Import
  $("importBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => importFiles(e.target.files);

  // Transport
  $("playBtn").onclick = () => {
    if (!V.currentTrack) {
      if (V.library.length) loadTrack(V.library[0], true);
      return;
    }
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  };

  $("prevBtn").onclick = () => prevTrack();
  $("nextBtn").onclick = () => nextTrack();

  // Seek bar
  $("seek").oninput = () => {
    if (audio.duration) {
      audio.currentTime = (Number($("seek").value) / 1000) * audio.duration;
    }
  };

  // Audio events
  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    $("seek").value        = Math.floor((audio.currentTime / audio.duration) * 1000);
    $("curTime").textContent = fmt(audio.currentTime);
    $("durTime").textContent = fmt(audio.duration);

    // Persist session progress every 5 seconds
    if (V.currentTrack && Math.floor(audio.currentTime) % 5 === 0) {
      db.put("settings", {
        key:   "last_session",
        value: { trackId: V.currentTrack.id, time: audio.currentTime }
      }).catch(() => {});
    }
  };

  audio.onplay  = updatePlayerUI;
  audio.onpause = updatePlayerUI;
  audio.onended = () => nextTrack();

  // Favorites
  $("favBtn").onclick = async () => {
    if (!V.currentTrack) return;
    const id = V.currentTrack.id;
    V.favorites.has(id) ? V.favorites.delete(id) : V.favorites.add(id);
    await db.put("settings", { key: "favorites", value: [...V.favorites] });
    updatePlayerUI();
  };

  // Queue panel
  $("queueBtn").onclick = () => {
    $("queuePanel").classList.add("open");
  };

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.onclick = () => {
      const target = btn.dataset.close;
      if (target) $(target).classList.remove("open");
    };
  });

  // Close panel on backdrop tap
  $("queuePanel").onclick = e => {
    if (e.target === $("queuePanel")) $("queuePanel").classList.remove("open");
  };

  // Library search
  $("searchInput").oninput = () => renderLibrary();

  // Library tab switching
  document.querySelectorAll(".lib-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".lib-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      handleLibraryTab(tab.dataset.tab);
    };
  });

  // Splash dismiss
  $("splash").onclick = dismissSplash;
  setTimeout(dismissSplash, 2800);
}

/* ============================================================
   LIBRARY TAB HANDLER
   ============================================================ */
function handleLibraryTab(tab) {
  const el = $("libraryList");
  switch (tab) {
    case "songs":
      renderLibrary();
      break;
    case "playlists":
      el.innerHTML = `<div class="list-empty"><div class="list-empty-icon">🎶</div><p class="list-empty-title">No playlists yet</p><p class="list-empty-sub">Create playlists to organize your music</p></div>`;
      break;
    case "crates":
      el.innerHTML = `<div class="list-empty"><div class="list-empty-icon">📦</div><p class="list-empty-title">No crates yet</p><p class="list-empty-sub">Create crates to prep your DJ sets</p></div>`;
      break;
    case "favorites":
      renderFavorites();
      break;
    case "recent":
      renderRecent();
      break;
  }
}

async function renderFavorites() {
  const el = $("libraryList");
  const metaAll = await db.all("metadata");

  const favTracks = V.library.filter(t => V.favorites.has(t.id));

  if (!favTracks.length) {
    el.innerHTML = `<div class="list-empty"><div class="list-empty-icon">♥</div><p class="list-empty-title">No favorites yet</p><p class="list-empty-sub">Heart a song on the Player to save it here</p></div>`;
    return;
  }

  el.innerHTML = favTracks.map(t => {
    const m      = metaAll.find(x => x.trackId === t.id) || {};
    const title  = esc(m.title  || t.name.replace(/\.[^.]+$/, ""));
    const artist = esc(m.artist || "Unknown Artist");
    return `
      <div class="list-item" data-track-id="${t.id}">
        <div class="list-item-art"><span class="list-item-note">♥</span></div>
        <div class="list-item-info">
          <div class="list-item-title">${title}</div>
          <div class="list-item-sub">${artist}</div>
        </div>
        <div class="list-item-actions">
          <button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button>
        </div>
      </div>`;
  }).join("");
}

async function renderRecent() {
  const el = $("libraryList");
  const recentAll = await db.all("recent");
  const metaAll   = await db.all("metadata");

  // Sort by most recently added, deduplicate by trackId
  const seen = new Set();
  const sorted = recentAll
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter(r => {
      if (seen.has(r.trackId)) return false;
      seen.add(r.trackId);
      return true;
    })
    .slice(0, 50);

  if (!sorted.length) {
    el.innerHTML = `<div class="list-empty"><div class="list-empty-icon">🕐</div><p class="list-empty-title">Nothing added yet</p><p class="list-empty-sub">Import music to see recently added tracks here</p></div>`;
    return;
  }

  el.innerHTML = sorted.map(r => {
    const t = V.library.find(x => x.id === r.trackId);
    if (!t) return "";
    const m      = metaAll.find(x => x.trackId === t.id) || {};
    const title  = esc(m.title  || t.name.replace(/\.[^.]+$/, ""));
    const artist = esc(m.artist || "Unknown Artist");
    return `
      <div class="list-item" data-track-id="${t.id}">
        <div class="list-item-art"><span class="list-item-note">🕐</span></div>
        <div class="list-item-info">
          <div class="list-item-title">${title}</div>
          <div class="list-item-sub">${artist}</div>
        </div>
        <div class="list-item-actions">
          <button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button>
        </div>
      </div>`;
  }).join("");
}

/* ============================================================
   GLOBAL API — Exposed on window.Vibez for inline handlers
   ============================================================ */
Object.assign(window.Vibez, {
  playFromLibrary: id => {
    const t = V.library.find(x => x.id === id);
    if (t) loadTrack(t, true);
  },
  addToQueue,
  removeFromQueue,
  toggleRadio
});

/* ============================================================
   INIT ENTRY POINT
   ============================================================ */
(async () => {
  try {
    V.db = await initDB();
    bindEvents();
    renderRadio();
    await syncState();

    // Restore last page
    const savedPage = localStorage.getItem("vz_page") || "player";
    showPage(savedPage);

    console.info("868 Vibez V2 — Phase 1 Init: ✓ (DB v5)");
  } catch (err) {
    console.error("868 Vibez init failed:", err);
  }
})();
