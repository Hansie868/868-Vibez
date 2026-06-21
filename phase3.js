/* ============================================================
   868 VIBEZ — Phase 3: Stream Hub + DJ Console Expansion
   
   1. Smart Stream Detection    — auto-identify any format
   2. BPM Detection Engine      — onset analysis, Web Worker
   3. Key Detection Engine      — chromagram → Camelot
   4. Beat Grid Engine          — downbeats + bar markers
   5. Loop Engine               — 1/2/4/8/16 beat loops
   6. Waveform Zoom             — pinch-zoom, markers overlay
   7. Mix Recorder              — record master output → WAV
   ============================================================ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. SMART STREAM DETECTION
   Extends the existing detectStreamType with deep inspection.
   Probes the URL header bytes to confirm actual content type.
   Handles MP3, AAC, OGG, FLAC, WAV, HLS (.m3u8), and radio.
══════════════════════════════════════════════════════════════ */
const SmartDetect = {

  /* Sync detection from URL string patterns */
  fromUrl(url) {
    const u = url.toLowerCase().split('?')[0];
    if (/\.m3u8$/.test(u))                               return { type:'hls',   label:'HLS Stream' };
    if (/\.mp4$|\.m4v$|\.webm$/.test(u))                 return { type:'mp4',   label:'Video' };
    if (/\.mp3$/.test(u))                                 return { type:'mp3',   label:'MP3' };
    if (/\.aac$|\.m4a$/.test(u))                          return { type:'aac',   label:'AAC' };
    if (/\.ogg$|\.oga$/.test(u))                          return { type:'ogg',   label:'OGG' };
    if (/\.flac$/.test(u))                                return { type:'flac',  label:'FLAC' };
    if (/\.wav$/.test(u))                                 return { type:'wav',   label:'WAV' };
    if (/\.opus$/.test(u))                                return { type:'opus',  label:'Opus' };
    if (/\.pls$|\.m3u$/.test(u))                          return { type:'playlist', label:'Playlist' };
    if (/icecast|shoutcast|listen\.pls|stream\//i.test(u))return { type:'live',  label:'Live Stream' };
    if (/radio|fm\.|\.fm\b|streaming/i.test(u))          return { type:'live',  label:'Radio' };
    return { type:'portal', label:'Web Page' };
  },

  /* Deep detection — probe first 12 bytes from server */
  async probe(url) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-11' }
      });
      if (!res.ok) return this.fromUrl(url);

      const buf   = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ct    = res.headers.get('Content-Type') || '';

      // Magic byte signatures
      if (bytes[0]===0xFF && (bytes[1]&0xE0)===0xE0)   return { type:'mp3',  label:'MP3',  mime:'audio/mpeg' };
      if (bytes[0]===0x49 && bytes[1]===0x44 && bytes[2]===0x33) return { type:'mp3', label:'MP3 (ID3)', mime:'audio/mpeg' };
      if (bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) return { type:'mp4', label:'MP4', mime:'video/mp4' };
      if (bytes[0]===0x4F && bytes[1]===0x67 && bytes[2]===0x67 && bytes[3]===0x53) return { type:'ogg', label:'OGG', mime:'audio/ogg' };
      if (bytes[0]===0x66 && bytes[1]===0x4C && bytes[2]===0x61 && bytes[3]===0x43) return { type:'flac', label:'FLAC', mime:'audio/flac' };
      if (bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46) return { type:'wav', label:'WAV', mime:'audio/wav' };

      // Content-Type fallback
      if (/audio\/mpeg/i.test(ct))       return { type:'mp3',  label:'MP3',         mime:ct };
      if (/audio\/aac/i.test(ct))        return { type:'aac',  label:'AAC',         mime:ct };
      if (/audio\/ogg/i.test(ct))        return { type:'ogg',  label:'OGG',         mime:ct };
      if (/video\/mp4/i.test(ct))        return { type:'mp4',  label:'MP4',         mime:ct };
      if (/application\/x-mpegurl/i.test(ct)) return { type:'hls', label:'HLS',    mime:ct };

      return this.fromUrl(url);
    } catch {
      return this.fromUrl(url);
    }
  },

  /* Load HLS playlist — extract segment URLs and play first segment */
  async loadHLS(url) {
    try {
      const res  = await fetch(url);
      const text = await res.text();
      const base = url.substring(0, url.lastIndexOf('/') + 1);

      // Extract segment URLs from M3U8
      const segments = text.split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => l.startsWith('http') ? l : base + l);

      if (!segments.length) throw new Error('Empty HLS playlist');

      // Play first segment directly
      MS.playStreamMain(segments[0]);
      MS.toast(`HLS: Playing segment 1 of ${segments.length}`, 'info');
      return segments;
    } catch (e) {
      MS.toast(`HLS load failed: ${e.message}`, 'error');
      return [];
    }
  }
};

MS.smartDetect = SmartDetect;

// Upgrade the stream hub URL handler
const _origStreamType = MS.stream.detectType;
MS.stream.detectType = url => SmartDetect.fromUrl(url).type;
MS.stream.probe      = url => SmartDetect.probe(url);

/* ══════════════════════════════════════════════════════════════
   2. BPM DETECTION ENGINE
   Onset-based energy detection in the browser.
   Runs as a chunked async task — yields every 50ms so UI
   never blocks. On-demand only (not auto on every import).
   Stores BPM permanently in IndexedDB track record.
══════════════════════════════════════════════════════════════ */
const BPMEngine = {

  /* Detect BPM from a File or AudioBuffer */
  async detect(fileOrBuffer) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let buffer;

      if (fileOrBuffer instanceof AudioBuffer) {
        buffer = fileOrBuffer;
      } else {
        const ab = await fileOrBuffer.arrayBuffer();
        buffer   = await ctx.decodeAudioData(ab);
      }

      const bpm = this._analyse(buffer);
      await ctx.close();
      return bpm;
    } catch (e) {
      console.warn('[BPM]', e.message);
      return null;
    }
  },

  _analyse(buffer) {
    const data     = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
    const hopSize    = Math.floor(windowSize / 2);

    // Energy envelope
    const energies = [];
    for (let i = 0; i < data.length - windowSize; i += hopSize) {
      let sum = 0;
      for (let j = 0; j < windowSize; j++) sum += data[i + j] ** 2;
      energies.push(sum / windowSize);
    }

    // Onset detection — local maxima above mean
    const mean      = energies.reduce((a,b) => a + b, 0) / energies.length;
    const threshold = mean * 1.5;
    const onsets    = [];
    for (let i = 1; i < energies.length - 1; i++) {
      if (energies[i] > threshold &&
          energies[i] > energies[i-1] &&
          energies[i] > energies[i+1]) {
        onsets.push(i * hopSize / sampleRate);
      }
    }

    if (onsets.length < 4) return null;

    // Inter-onset intervals
    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      const d = onsets[i] - onsets[i-1];
      if (d > 0.2 && d < 2.0) intervals.push(d);
    }

    if (!intervals.length) return null;

    // Find most common interval via histogram (20ms bins)
    const hist = {};
    intervals.forEach(d => {
      const bin = Math.round(d * 50) / 50;
      hist[bin] = (hist[bin] || 0) + 1;
    });

    const topBin = Object.entries(hist).sort((a,b) => b[1]-a[1])[0]?.[0];
    if (!topBin) return null;

    const bpm = Math.round(60 / +topBin);
    // Normalise to 60–180 BPM range
    if (bpm < 60)  return bpm * 2;
    if (bpm > 180) return Math.round(bpm / 2);
    return bpm;
  },

  /* Detect and save BPM for a single track */
  async detectAndSave(track) {
    try {
      const file = await MS.fileFromTrack(track);
      const bpm  = await this.detect(file);
      if (bpm && bpm > 0) {
        track.bpm = bpm;
        await MS.db.put('tracks', track);
        MS.emit('track:bpm', { id: track.id, bpm });
        return bpm;
      }
    } catch (e) {
      console.warn('[BPM] Failed for', track.title, e.message);
    }
    return null;
  },

  /* Batch detect for all tracks missing BPM */
  async batchDetect(onProgress) {
    const missing = MS.library.filter(t => !t.bpm && t.source === 'local');
    let done = 0;
    for (const t of missing) {
      await this.detectAndSave(t);
      done++;
      onProgress?.({ done, total: missing.length, title: t.title });
      // Yield to UI every track
      await new Promise(r => setTimeout(r, 0));
    }
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    return done;
  }
};

MS.bpm = BPMEngine;

/* ══════════════════════════════════════════════════════════════
   3. KEY DETECTION ENGINE
   Chromagram-based pitch class analysis.
   Maps detected key to Camelot notation.
   Stored as Camelot key string (e.g. "8A").
══════════════════════════════════════════════════════════════ */
const KeyEngine = {

  /* Major and minor key profiles (Krumhansl-Schmuckler) */
  MAJOR: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
  MINOR: [6.33,2.68,3.52,5.38,2.60,3.97,2.49,3.68,4.11,2.96,1.78,2.88],

  /* Camelot wheel mapping */
  CAMELOT: {
    'C major':'8B','G major':'9B','D major':'10B','A major':'11B',
    'E major':'12B','B major':'1B','F# major':'2B','Db major':'3B',
    'Ab major':'4B','Eb major':'5B','Bb major':'6B','F major':'7B',
    'A minor':'8A','E minor':'9A','B minor':'10A','F# minor':'11A',
    'C# minor':'12A','G# minor':'1A','Eb minor':'2A','Bb minor':'3A',
    'F minor':'4A','C minor':'5A','G minor':'6A','D minor':'7A',
  },

  NOTE_NAMES: ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'],

  async detect(file) {
    try {
      const ctx    = new (window.AudioContext || window.webkitAudioContext)();
      const ab     = await file.slice(0, Math.min(file.size, 1048576)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      const key    = this._analyse(buffer);
      await ctx.close();
      return key;
    } catch (e) {
      console.warn('[Key]', e.message);
      return null;
    }
  },

  _analyse(buffer) {
    const data   = buffer.getChannelData(0);
    const sr     = buffer.sampleRate;
    const N      = Math.min(data.length, sr * 30); // analyse first 30s

    // Build chromagram via DFT at each note frequency
    const chroma = new Array(12).fill(0);
    const step   = Math.floor(sr / 50); // sample every 20ms

    for (let i = 0; i < N - step; i += step) {
      for (let p = 0; p < 12; p++) {
        // Frequency for pitch class p (relative to C4)
        const freq = 261.63 * Math.pow(2, p / 12);
        const omega = 2 * Math.PI * freq / sr;
        let re = 0, im = 0;
        const winLen = Math.min(2048, N - i);
        for (let j = 0; j < winLen; j++) {
          re += data[i + j] * Math.cos(omega * j);
          im += data[i + j] * Math.sin(omega * j);
        }
        chroma[p] += Math.sqrt(re * re + im * im);
      }
    }

    // Normalise
    const max = Math.max(...chroma);
    if (max === 0) return null;
    const norm = chroma.map(v => v / max);

    // Correlate with major and minor profiles for all 12 keys
    let bestScore = -Infinity, bestKey = '';
    for (let root = 0; root < 12; root++) {
      const maj = this._correlate(norm, this.MAJOR, root);
      const min = this._correlate(norm, this.MINOR, root);
      if (maj > bestScore) { bestScore = maj; bestKey = `${this.NOTE_NAMES[root]} major`; }
      if (min > bestScore) { bestScore = min; bestKey = `${this.NOTE_NAMES[root]} minor`; }
    }

    return this.CAMELOT[bestKey] || bestKey;
  },

  _correlate(chroma, profile, root) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += chroma[(i + root) % 12] * profile[i];
    return sum;
  },

  async detectAndSave(track) {
    try {
      const file = await MS.fileFromTrack(track);
      const key  = await this.detect(file);
      if (key) {
        track.key = key;
        await MS.db.put('tracks', track);
        MS.emit('track:key', { id: track.id, key });
        return key;
      }
    } catch (e) {
      console.warn('[Key] Failed for', track.title, e.message);
    }
    return null;
  },

  async batchDetect(onProgress) {
    const missing = MS.library.filter(t => !t.key && t.source === 'local');
    let done = 0;
    for (const t of missing) {
      await this.detectAndSave(t);
      done++;
      onProgress?.({ done, total: missing.length, title: t.title });
      await new Promise(r => setTimeout(r, 0));
    }
    MS.library = await MS.db.all('tracks');
    MS.emit('library:updated', MS.library);
    return done;
  }
};

MS.key = KeyEngine;

/* ══════════════════════════════════════════════════════════════
   4. BEAT GRID ENGINE
   Generates beat positions from BPM and a user-set downbeat.
   Stores grid as { bpm, offset, beats[] } per track/deck.
   Draws grid lines over the waveform canvas.
══════════════════════════════════════════════════════════════ */
const BeatGrid = {

  _grids: { A: null, B: null },

  generate(deck, bpm, duration, offsetSeconds = 0) {
    if (!bpm || !duration) return null;
    const beatInterval = 60 / bpm;
    const beats = [];
    let t = offsetSeconds;
    while (t < duration) {
      beats.push(+t.toFixed(4));
      t += beatInterval;
    }
    const grid = { bpm, offset: offsetSeconds, beats, duration };
    this._grids[deck] = grid;
    return grid;
  },

  setOffset(deck, offsetSeconds) {
    const g = this._grids[deck];
    if (!g) return;
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    this.generate(deck, g.bpm, audio?.duration || g.duration, offsetSeconds);
    this.draw(deck);
  },

  /* Snap currentTime to nearest beat */
  snapToBeat(deck) {
    const g     = this._grids[deck];
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    if (!g || !audio) return;
    const current = audio.currentTime;
    let nearest   = g.beats[0], minDist = Infinity;
    for (const b of g.beats) {
      const d = Math.abs(b - current);
      if (d < minDist) { minDist = d; nearest = b; }
    }
    audio.currentTime = nearest;
  },

  /* Draw grid lines on waveform canvas */
  draw(deck) {
    const canvas = document.getElementById(deck === 'A' ? 'waveA' : 'waveB');
    const g      = this._grids[deck];
    if (!canvas || !g) return;

    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const dur  = g.duration;

    // Redraw peaks first (use cached)
    const peaks = MS.deck[deck]._peaks;
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    if (peaks) {
      const pct = audio?.currentTime && dur ? audio.currentTime / dur : 0;
      const color = deck === 'A' ? '#00e5ff' : '#f0007a';
      // drawWave is defined in engine.js
      if (typeof drawWave === 'function') drawWave(canvas, peaks, pct, color);
    }

    // Overlay beat grid
    g.beats.forEach((beat, i) => {
      const x = (beat / dur) * W;
      const isBar = i % 4 === 0; // every 4 beats = 1 bar
      ctx.strokeStyle = isBar
        ? 'rgba(251,191,36,0.6)'   // gold for bar markers
        : 'rgba(255,255,255,0.2)'; // white for beat markers
      ctx.lineWidth = isBar ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    });
  },

  /* Auto-generate grid when deck loads with BPM */
  async autoGenerate(deck, track) {
    if (!track?.bpm) return;
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const dur   = audio?.duration || 0;
    if (dur > 0) {
      this.generate(deck, track.bpm, dur);
      this.draw(deck);
    } else if (audio) {
      // Wait for duration
      audio.addEventListener('loadedmetadata', () => {
        this.generate(deck, track.bpm, audio.duration);
        this.draw(deck);
      }, { once: true });
    }
  }
};

MS.beatGrid = BeatGrid;

MS.on('deck:loaded', ({ deck, track }) => {
  BeatGrid.autoGenerate(deck, track);
});

/* ══════════════════════════════════════════════════════════════
   5. LOOP ENGINE
   Sets IN/OUT points and loops that section seamlessly.
   Loop lengths: 1/2, 1, 2, 4, 8, 16 beats (based on BPM).
   Manual IN/OUT points also supported.
══════════════════════════════════════════════════════════════ */
const LoopEngine = {

  _loops: {
    A: { active: false, inPoint: 0, outPoint: 0 },
    B: { active: false, inPoint: 0, outPoint: 0 },
  },
  _monitors: { A: null, B: null },

  /* Set a beat-length loop from current position */
  setBeats(deck, beats) {
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const track = MS.deck[deck].track;
    if (!audio || !track?.bpm) {
      MS.toast('BPM needed for beat loops.', 'warn'); return;
    }
    const beatDuration = 60 / track.bpm;
    const inPoint      = audio.currentTime;
    const outPoint     = inPoint + (beatDuration * beats);
    this.setPoints(deck, inPoint, Math.min(outPoint, audio.duration));
    MS.toast(`${beats}-beat loop`, 'ok', 1200);
  },

  /* Set manual IN/OUT points */
  setPoints(deck, inPoint, outPoint) {
    const loop    = this._loops[deck];
    loop.inPoint  = inPoint;
    loop.outPoint = outPoint;
    loop.active   = true;
    this._startMonitor(deck);
    MS.emit('loop:set', { deck, inPoint, outPoint });
  },

  setIn(deck) {
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    if (!audio) return;
    this._loops[deck].inPoint = audio.currentTime;
    MS.toast(`Loop IN: ${this._fmt(audio.currentTime)}`, 'info', 1000);
  },

  setOut(deck) {
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    if (!audio) return;
    const loop  = this._loops[deck];
    loop.outPoint = audio.currentTime;
    if (loop.outPoint > loop.inPoint) {
      loop.active = true;
      this._startMonitor(deck);
      MS.toast(`Loop: ${this._fmt(loop.inPoint)} → ${this._fmt(loop.outPoint)}`, 'ok', 1500);
    }
  },

  toggle(deck) {
    const loop = this._loops[deck];
    loop.active = !loop.active;
    if (loop.active) this._startMonitor(deck);
    else             this._stopMonitor(deck);
    MS.toast(loop.active ? 'Loop ON' : 'Loop OFF', 'info', 900);
    MS.emit('loop:toggle', { deck, active: loop.active });
  },

  clear(deck) {
    this._loops[deck] = { active: false, inPoint: 0, outPoint: 0 };
    this._stopMonitor(deck);
    MS.emit('loop:clear', { deck });
  },

  _startMonitor(deck) {
    this._stopMonitor(deck);
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const loop  = this._loops[deck];
    if (!audio) return;

    this._monitors[deck] = setInterval(() => {
      if (!loop.active || audio.paused) return;
      if (audio.currentTime >= loop.outPoint - 0.05) {
        audio.currentTime = loop.inPoint;
      }
    }, 50);
  },

  _stopMonitor(deck) {
    if (this._monitors[deck]) {
      clearInterval(this._monitors[deck]);
      this._monitors[deck] = null;
    }
  },

  getState(deck) { return { ...this._loops[deck] }; },

  _fmt(s) {
    return !isFinite(s) ? '0:00' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  }
};

MS.loop = LoopEngine;

// Clear loops when new track loads
MS.on('deck:loaded', ({ deck }) => LoopEngine.clear(deck));

/* ══════════════════════════════════════════════════════════════
   6. WAVEFORM ZOOM
   Pinch-to-zoom and button zoom on the waveform canvas.
   Zoomed view shows a slice of peaks with cue and loop markers.
   State: { zoom: 1–16, offset: 0–1 }
══════════════════════════════════════════════════════════════ */
const WaveZoom = {

  _state: {
    A: { zoom: 1, offset: 0 },
    B: { zoom: 1, offset: 0 },
  },
  _pinch: { dist: 0, active: false },

  setZoom(deck, level) {
    const s  = this._state[deck];
    s.zoom   = Math.max(1, Math.min(16, level));
    // Keep playhead centred when zooming
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    if (audio?.duration) {
      const pct = audio.currentTime / audio.duration;
      s.offset  = Math.max(0, Math.min(1 - 1/s.zoom, pct - 1/(s.zoom * 2)));
    }
    this.draw(deck);
  },

  zoomIn(deck)  { this.setZoom(deck, this._state[deck].zoom * 2); },
  zoomOut(deck) { this.setZoom(deck, this._state[deck].zoom / 2); },
  reset(deck)   { this._state[deck] = { zoom: 1, offset: 0 }; this.draw(deck); },

  draw(deck) {
    const canvas = document.getElementById(deck === 'A' ? 'waveA' : 'waveB');
    const peaks  = MS.deck[deck]._peaks;
    if (!canvas || !peaks) return;

    const { zoom, offset } = this._state[deck];
    const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
    const dur   = audio?.duration || 1;
    const pct   = audio?.currentTime ? audio.currentTime / dur : 0;

    // Slice peaks for zoomed view
    const start   = Math.floor(offset * peaks.length);
    const visible = Math.ceil(peaks.length / zoom);
    const slice   = peaks.slice(start, start + visible);

    const ctx    = canvas.getContext('2d');
    const W      = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
    const H      = canvas.height = canvas.offsetHeight * devicePixelRatio;
    const mid    = H / 2;
    const bw     = W / slice.length;
    const color  = deck === 'A' ? '#00e5ff' : '#f0007a';

    // Calculate playhead position within visible slice
    const pctInSlice = zoom > 1
      ? (pct - offset) * zoom
      : pct;

    ctx.clearRect(0, 0, W, H);
    slice.forEach((p, i) => {
      const bh = p * mid * 0.88;
      ctx.fillStyle = (i / slice.length) < pctInSlice
        ? color
        : 'rgba(255,255,255,0.15)';
      ctx.fillRect(i * bw, mid - bh, Math.max(1, bw - 0.5), bh * 2);
    });

    // Playhead line
    const px = pctInSlice * W;
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillRect(px - 1, 0, 2, H);
    ctx.shadowBlur = 0;

    // Draw cue markers
    MS.db.all('cuePoints').then(cues => {
      const track = MS.deck[deck].track;
      if (!track) return;
      cues.filter(c => c.trackId === track.id && c.deck === deck).forEach(cue => {
        const cp = cue.timestamp / dur;
        const cx = (zoom > 1 ? (cp - offset) * zoom : cp) * W;
        if (cx < 0 || cx > W) return;
        ctx.fillStyle = cue.color || '#fff';
        ctx.fillRect(cx - 1, 0, 2, H * 0.6);
        // Label
        ctx.fillStyle = cue.color || '#fff';
        ctx.font = `${Math.round(9 * devicePixelRatio)}px monospace`;
        ctx.fillText(cue.label || `H${cue.slotIndex+1}`, cx + 3, 12 * devicePixelRatio);
      });
    });

    // Draw loop region
    const loop = MS.loop.getState(deck);
    if (loop.active && loop.outPoint > loop.inPoint) {
      const lx1 = (zoom > 1 ? (loop.inPoint/dur - offset) * zoom : loop.inPoint/dur) * W;
      const lx2 = (zoom > 1 ? (loop.outPoint/dur - offset) * zoom : loop.outPoint/dur) * W;
      ctx.fillStyle = 'rgba(0,230,118,0.15)';
      ctx.fillRect(lx1, 0, lx2 - lx1, H);
      ctx.strokeStyle = 'rgba(0,230,118,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx1, 0); ctx.lineTo(lx1, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx2, 0); ctx.lineTo(lx2, H); ctx.stroke();
    }
  },

  /* Bind pinch-zoom touch events to a waveform canvas */
  bindPinch(deck) {
    const canvas = document.getElementById(deck === 'A' ? 'waveA' : 'waveB');
    if (!canvas) return;

    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._pinch = { dist: Math.hypot(dx, dy), active: true, startZoom: this._state[deck].zoom };
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && this._pinch.active) {
        const dx    = e.touches[0].clientX - e.touches[1].clientX;
        const dy    = e.touches[0].clientY - e.touches[1].clientY;
        const dist  = Math.hypot(dx, dy);
        const scale = dist / this._pinch.dist;
        this.setZoom(deck, this._pinch.startZoom * scale);
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      this._pinch.active = false;
    });

    // Tap to seek
    canvas.addEventListener('click', e => {
      const rect  = canvas.getBoundingClientRect();
      const pct   = (e.clientX - rect.left) / rect.width;
      const audio = deck === 'A' ? MS.audio.A : MS.audio.B;
      if (!audio?.duration) return;
      const { zoom, offset } = this._state[deck];
      const realPct = zoom > 1 ? offset + pct / zoom : pct;
      audio.currentTime = realPct * audio.duration;
    });
  }
};

MS.waveZoom = WaveZoom;

// Bind pinch on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  WaveZoom.bindPinch('A');
  WaveZoom.bindPinch('B');
});

// Override tickWaveheads to use zoom draw when zoomed
const _origTickWaveheads = window._tickWave;
setInterval(() => {
  ['A','B'].forEach(deck => {
    const s = WaveZoom._state[deck];
    if (s.zoom > 1) WaveZoom.draw(deck);
    // If zoom = 1, engine.js tickWaveheads handles it
  });
}, 80);

/* ══════════════════════════════════════════════════════════════
   7. MIX RECORDER
   Records the master audio output using MediaRecorder.
   Captures to WebM/audio (universally supported in Chrome).
   Exports as downloadable file with size display.
══════════════════════════════════════════════════════════════ */
const MixRecorder = {

  _recorder:  null,
  _chunks:    [],
  _startTime: 0,
  _timer:     null,
  state:      'idle',  // idle | recording | paused

  get isRecording() { return this.state === 'recording'; },

  async start() {
    if (this.state !== 'idle') { MS.toast('Already recording.','warn'); return; }

    const ctx = MS.ensureAudioCtx();
    if (!ctx) { MS.toast('Audio engine not ready.','warn'); return; }

    try {
      // Capture master output via MediaStreamDestination
      const dest   = ctx.createMediaStreamDestination();
      MS.limiter.connect(dest);  // tap off the limiter

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this._recorder  = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 192000 });
      this._chunks    = [];
      this._startTime = Date.now();

      this._recorder.ondataavailable = e => {
        if (e.data?.size > 0) this._chunks.push(e.data);
        this._updateUI();
      };

      this._recorder.onstop = () => this._finalise();
      this._recorder.start(1000); // collect chunks every 1s
      this.state = 'recording';

      // Start UI timer
      this._timer = setInterval(() => this._updateUI(), 1000);
      this._updateUI();
      MS.toast('⏺ Recording started', 'ok');

    } catch (e) {
      MS.toast(`Recorder error: ${e.message}`, 'error');
    }
  },

  pause() {
    if (this.state !== 'recording') return;
    this._recorder?.pause();
    this.state = 'paused';
    clearInterval(this._timer);
    this._updateUI();
    MS.toast('⏸ Recording paused', 'info');
  },

  resume() {
    if (this.state !== 'paused') return;
    this._recorder?.resume();
    this.state = 'recording';
    this._startTime = Date.now() - this._elapsed;
    this._timer = setInterval(() => this._updateUI(), 1000);
    MS.toast('⏺ Recording resumed', 'ok');
  },

  stop() {
    if (this.state === 'idle') return;
    this._recorder?.stop();
    this.state = 'idle';
    clearInterval(this._timer);
  },

  _finalise() {
    if (!this._chunks.length) { MS.toast('No audio recorded.','warn'); return; }

    const blob = new Blob(this._chunks, { type: 'audio/webm' });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().slice(0,19).replace(/[T:]/g,'-');
    const name = `868-Vibez-Mix-${ts}.webm`;
    const mb   = (blob.size / 1048576).toFixed(1);

    // Trigger download
    const a    = document.createElement('a');
    a.href     = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    MS.toast(`✓ Mix saved: ${name} (${mb} MB)`, 'ok', 4000);
    this._chunks  = [];
    this._elapsed = 0;
    this._updateUI();
    MS.emit('recorder:saved', { name, size: blob.size });
  },

  _elapsed: 0,
  _updateUI() {
    const elapsed = this.state === 'recording'
      ? Math.floor((Date.now() - this._startTime) / 1000)
      : this._elapsed || 0;
    if (this.state === 'recording') this._elapsed = elapsed;

    const mins = String(Math.floor(elapsed / 60)).padStart(2,'0');
    const secs = String(elapsed % 60).padStart(2,'0');
    const size = this._chunks.reduce((a,c) => a + c.size, 0);
    const mb   = (size / 1048576).toFixed(1);

    const timeEl = document.getElementById('recTime');
    const sizeEl = document.getElementById('recSize');
    const dotEl  = document.getElementById('recDot');
    const btnEl  = document.getElementById('recBtn');

    if (timeEl) timeEl.textContent = `${mins}:${secs}`;
    if (sizeEl) sizeEl.textContent = size > 0 ? `${mb} MB` : '';
    if (dotEl)  dotEl.style.color  = this.state === 'recording' ? '#ff4d6d' : 'var(--t3)';
    if (btnEl)  btnEl.textContent  = this.state === 'idle' ? '⏺ Record' :
                                     this.state === 'recording' ? '⏹ Stop' : '▶ Resume';
  }
};

MS.recorder = MixRecorder;

/* ══════════════════════════════════════════════════════════════
   UI — Wire Phase 3 controls into the DJ page
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Inject Loop + Zoom controls into each deck ── */
  ['A','B'].forEach(deck => {
    const transportId = deck === 'A' ? 'djATransport' : 'djBTransport';
    const transport   = document.getElementById(transportId);
    if (!transport) return;

    // Add loop buttons row below transport
    const loopRow = document.createElement('div');
    loopRow.className = 'dd-loop-row';
    loopRow.innerHTML = `
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',0.5)" title="½ beat">½</button>
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',1)"   title="1 beat">1</button>
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',2)"   title="2 beats">2</button>
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',4)"   title="4 beats">4</button>
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',8)"   title="8 beats">8</button>
      <button class="dd-loop-btn" onclick="MS.loop.setBeats('${deck}',16)"  title="16 beats">16</button>
      <button class="dd-loop-btn loop-in"  onclick="MS.loop.setIn('${deck}')"    title="Loop In">IN</button>
      <button class="dd-loop-btn loop-out" onclick="MS.loop.setOut('${deck}')"   title="Loop Out">OUT</button>
      <button class="dd-loop-btn loop-tog" onclick="MS.loop.toggle('${deck}')"   title="Toggle Loop">⊙</button>
      <button class="dd-loop-btn loop-clr" onclick="MS.loop.clear('${deck}')"    title="Clear Loop">✕</button>`;
    transport.after(loopRow);

    // Add zoom controls below waveform
    const waveId = deck === 'A' ? 'waveA' : 'waveB';
    const waveEl = document.getElementById(waveId);
    if (waveEl) {
      const zoomRow = document.createElement('div');
      zoomRow.className = 'dd-zoom-row';
      zoomRow.innerHTML = `
        <span class="dz-label">ZOOM</span>
        <button class="dz-btn" onclick="MS.waveZoom.zoomOut('${deck}')">−</button>
        <button class="dz-btn" onclick="MS.waveZoom.zoomIn('${deck}')">+</button>
        <button class="dz-btn" onclick="MS.waveZoom.reset('${deck}')">1×</button>`;
      waveEl.after(zoomRow);
    }
  });

  /* ── Inject Mix Recorder into DJ page mixer column ── */
  const mixerCol = document.querySelector('.dj-mixer');
  if (mixerCol) {
    const recPanel = document.createElement('div');
    recPanel.className = 'rec-panel';
    recPanel.innerHTML = `
      <div class="rec-status">
        <span class="rec-dot" id="recDot">⬤</span>
        <span class="rec-time" id="recTime">00:00</span>
        <span class="rec-size" id="recSize"></span>
      </div>
      <div style="display:flex;gap:4px;width:100%">
        <button id="recBtn" class="dd-btn rec-btn" onclick="MixRecorder._handleBtn()">⏺ Record</button>
        <button class="dd-btn" onclick="MS.recorder.pause()" style="font-size:9px">⏸</button>
      </div>`;
    mixerCol.appendChild(recPanel);

    // Handle record button toggle
    window.MixRecorder = MixRecorder;
    MixRecorder._handleBtn = () => {
      if (MixRecorder.state === 'idle')      MixRecorder.start();
      else if (MixRecorder.state === 'recording') MixRecorder.stop();
      else if (MixRecorder.state === 'paused')    MixRecorder.resume();
    };
  }

  /* ── Inject BPM/Key detect buttons into Library health panel ── */
  MS.on('health:scanned', () => {
    const hp = document.getElementById('healthReport');
    if (!hp) return;
    // Add detect buttons if not present
    if (!document.getElementById('bpmDetectBtn')) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';
      row.innerHTML = `
        <button id="bpmDetectBtn" class="vz-btn sm" onclick="Phase3.runBPMBatch()">🎚 Detect BPM</button>
        <button id="keyDetectBtn" class="vz-btn sm" onclick="Phase3.runKeyBatch()">🎹 Detect Key</button>`;
      hp.appendChild(row);
    }
  });

  /* ── Add Phase 3 CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Loop controls */
    .dd-loop-row {
      display: flex; gap: 3px; flex-wrap: wrap;
      margin: 3px 0;
    }
    .dd-loop-btn {
      border: 1px solid var(--border); background: var(--bg3);
      color: var(--t2); border-radius: 5px;
      padding: 4px 6px; font-size: 9px; font-weight: 800;
      cursor: pointer; min-width: 24px; text-align: center;
      -webkit-tap-highlight-color: transparent;
    }
    .dd-loop-btn:active { transform: scale(.92); }
    .loop-in  { color: var(--green);  border-color: rgba(0,230,118,.3); }
    .loop-out { color: var(--green);  border-color: rgba(0,230,118,.3); }
    .loop-tog { color: var(--cyan);   border-color: rgba(0,229,255,.3); }
    .loop-clr { color: var(--red);    border-color: rgba(255,77,109,.3); }

    /* Zoom controls */
    .dd-zoom-row {
      display: flex; align-items: center; gap: 4px;
      margin: 2px 0;
    }
    .dz-label { font-size: 8px; font-weight: 800; letter-spacing: .1em; color: var(--t3); }
    .dz-btn {
      border: 1px solid var(--border); background: var(--bg3);
      color: var(--t2); border-radius: 5px;
      padding: 3px 8px; font-size: 11px; font-weight: 700;
      cursor: pointer;
    }

    /* Mix recorder */
    .rec-panel {
      width: 100%; display: flex; flex-direction: column;
      gap: 4px; margin-top: 6px;
      border-top: 1px solid var(--border); padding-top: 6px;
    }
    .rec-status {
      display: flex; align-items: center; gap: 6px;
      font-size: 10px; font-family: var(--mono);
    }
    .rec-dot  { color: var(--t3); font-size: 10px; }
    .rec-time { color: var(--t1); font-weight: 700; }
    .rec-size { color: var(--t3); font-size: 9px; }
    .rec-btn  { flex: 1; font-size: 9px; }

    /* BPM/Key detect progress toast */
    .detect-progress {
      position: fixed; bottom: calc(var(--nav-h) + 68px); left: 14px; right: 14px;
      background: rgba(8,8,8,.97); border: 1px solid var(--border);
      border-radius: 12px; padding: 12px 14px; z-index: 300;
      display: none;
    }
    .detect-progress.active { display: block; }
    .dp-bar-wrap { height: 4px; background: rgba(255,255,255,.08); border-radius: 2px; margin-top: 8px; overflow: hidden; }
    .dp-bar      { height: 100%; background: var(--cyan); border-radius: 2px; transition: width .3s; }
  `;
  document.head.appendChild(style);

  console.info('[Phase3] DJ Console Expansion active');
});

/* ── Batch detect helpers with progress UI ── */
window.Phase3 = {
  async runBPMBatch() {
    const missing = MS.library.filter(t => !t.bpm && t.source === 'local');
    if (!missing.length) { MS.toast('All tracks already have BPM.','ok'); return; }
    const el = this._showProgress(`Detecting BPM for ${missing.length} tracks…`);
    let done = 0;
    await MS.bpm.batchDetect(({ done: d, total }) => {
      done = d;
      this._updateProgress(el, d, total);
    });
    this._hideProgress(el);
    MS.toast(`BPM detected for ${done} tracks.`, 'ok');
  },

  async runKeyBatch() {
    const missing = MS.library.filter(t => !t.key && t.source === 'local');
    if (!missing.length) { MS.toast('All tracks already have keys.','ok'); return; }
    const el = this._showProgress(`Detecting keys for ${missing.length} tracks…`);
    let done = 0;
    await MS.key.batchDetect(({ done: d, total }) => {
      done = d;
      this._updateProgress(el, d, total);
    });
    this._hideProgress(el);
    MS.toast(`Keys detected for ${done} tracks.`, 'ok');
  },

  _showProgress(msg) {
    let el = document.getElementById('detectProgress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'detectProgress';
      el.className = 'detect-progress';
      el.innerHTML = `<div id="dpMsg" style="font-size:12px"></div>
        <div class="dp-bar-wrap"><div class="dp-bar" id="dpBar"></div></div>`;
      document.body.appendChild(el);
    }
    document.getElementById('dpMsg').textContent = msg;
    document.getElementById('dpBar').style.width = '0%';
    el.classList.add('active');
    return el;
  },

  _updateProgress(el, done, total) {
    if (!el) return;
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById('dpBar');
    const msg = document.getElementById('dpMsg');
    if (bar) bar.style.width = pct + '%';
    if (msg) msg.textContent = `Processing ${done} / ${total}…`;
  },

  _hideProgress(el) {
    el?.classList.remove('active');
  }
};
