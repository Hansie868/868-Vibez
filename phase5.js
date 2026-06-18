/* ============================================================
   MediaSuite V3 Phase 5 — Pro Performance Engine
   - Worker scanner
   - Equal-power crossfader
   - Sharp Cut mode
   - Virtualized list rendering
   - Harmonic visual enhancement
   ============================================================ */
(function () {
  'use strict';

  const P5 = {
    worker: null,
    cancelScan: false,
    fileHandleMap: new Map(),
    virtual: new Map(),
    rowHeight: 76,
    overscan: 10,
    sharpCut: false,
    equalPower: true
  };

  window.MediaSuitePhase5 = P5;

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    injectPhase5UI();
    bindCrossfaderEngine();
    patchScannerIfAvailable();
    patchRenderersIfAvailable();
    console.log('MediaSuite Phase 5 Pro Performance Engine loaded.');
  });

  function injectPhase5UI() {
    const libraryHead = document.querySelector('#tab-library .panel-head');
    if (libraryHead && !$('phase5ScanBar')) {
      const bar = document.createElement('div');
      bar.id = 'phase5ScanBar';
      bar.className = 'phase5-bar';
      bar.innerHTML = `
        <div class="phase5-progress-line">
          <strong>Phase 5 Scanner</strong>
          <span id="phase5ScanText">Idle</span>
        </div>
        <div class="phase5-progress-track"><div id="phase5ScanFill" class="phase5-progress-fill"></div></div>
        <div class="phase5-controls">
          <button id="phase5CancelScan" class="btn danger" type="button">Cancel Scan</button>
          <span class="phase5-toggle">Worker scanning: ON</span>
          <span class="phase5-toggle">Virtual lists: ON</span>
        </div>`;
      libraryHead.insertAdjacentElement('afterend', bar);
      $('phase5CancelScan').onclick = () => cancelWorkerScan();
    }

    const mixer = document.querySelector('.mixer.pod');
    if (mixer && !$('sharpCutToggle')) {
      const box = document.createElement('label');
      box.className = 'phase5-toggle';
      box.innerHTML = `<input id="sharpCutToggle" type="checkbox"> Sharp Cut Crossfader`;
      mixer.appendChild(box);
      $('sharpCutToggle').addEventListener('change', (e) => {
        P5.sharpCut = !!e.target.checked;
        applyCrossfaderGains();
      });
    }

    document.querySelectorAll('.panel-head h1').forEach((h) => {
      if (!h.querySelector('.phase5-badge')) {
        const badge = document.createElement('span');
        badge.className = 'phase5-badge';
        badge.textContent = 'Phase 5';
        h.appendChild(badge);
      }
    });
  }

  function bindCrossfaderEngine() {
    const xf = $('xfader');
    if (!xf) return;
    xf.addEventListener('input', applyCrossfaderGains, { passive: true });
    const master = $('masterGain');
    if (master) master.addEventListener('input', applyCrossfaderGains, { passive: true });
    applyCrossfaderGains();
  }

  function applyCrossfaderGains() {
    const xf = $('xfader');
    const master = $('masterGain');
    const audioA = $('audioA');
    const audioB = $('audioB');
    if (!xf || !audioA || !audioB) return;

    const x = clamp(Number(xf.value || 0.5), 0, 1);
    const m = clamp(Number(master?.value || 1), 0, 1.5);
    let gainA, gainB;

    if (P5.sharpCut) {
      // Rapid switch mode: hard center cut, useful for quick drops/scratches.
      gainA = x < 0.52 ? 1 : 0;
      gainB = x > 0.48 ? 1 : 0;
    } else {
      // Equal-power constant-loudness curve.
      // Center does not dip like raw linear 0.5 / 0.5 gain.
      gainA = Math.cos(x * Math.PI / 2);
      gainB = Math.sin(x * Math.PI / 2);
    }

    audioA.volume = clamp(gainA * m, 0, 1);
    audioB.volume = clamp(gainB * m, 0, 1);
  }

  function patchScannerIfAvailable() {
    if (!window.Worker) {
      setProgress('Web Workers unavailable. Using default scanner.', 0);
      return;
    }

    // Wrap the existing openFolder button to prefer worker scanning.
    const openBtn = $('openFolder');
    if (!openBtn || openBtn.dataset.phase5Bound) return;
    openBtn.dataset.phase5Bound = '1';

    openBtn.addEventListener('click', async (e) => {
      // Run in capture-like behavior by preventing duplicated default only if showDirectoryPicker exists.
      if (!window.showDirectoryPicker) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        const dir = await window.showDirectoryPicker({ mode: 'read' });
        await phase5ScanDirectory(dir);
      } catch (err) {
        if (String(err?.name || '').includes('Abort')) return;
        console.warn('Phase 5 worker scan failed. Falling back if original scanner exists.', err);
        if (typeof window.openFolderOriginal === 'function') window.openFolderOriginal();
      }
    }, true);
  }

  async function phase5ScanDirectory(dirHandle) {
    setProgress('Preparing worker scan...', 1);
    P5.fileHandleMap.clear();
    const items = [];
    let index = 0;

    for await (const entry of walkDirectory(dirHandle, '')) {
      if (entry.kind === 'file') {
        const file = await entry.handle.getFile();
        items.push({ index, path: entry.path, file });
        P5.fileHandleMap.set(index, entry.handle);
        index++;
      }
    }

    if (!items.length) {
      setProgress('No supported files found.', 0);
      return;
    }

    const worker = new Worker('./scanner.worker.js');
    P5.worker = worker;
    P5.cancelScan = false;

    worker.onmessage = async (event) => {
      const msg = event.data || {};
      if (msg.type === 'progress') {
        setProgress(`Scanning ${msg.indexed || 0} / ${msg.total || items.length}`, percent(msg.indexed || 0, msg.total || items.length));
      }
      if (msg.type === 'batch') {
        await commitWorkerBatch(msg.batch || []);
        setProgress(`Indexed ${msg.indexed} / ${msg.total}`, percent(msg.indexed, msg.total));
      }
      if (msg.type === 'itemError') {
        console.warn('Worker item error:', msg);
      }
      if (msg.type === 'cancelled') {
        setProgress('Scan cancelled.', 0);
        worker.terminate();
        P5.worker = null;
      }
      if (msg.type === 'complete') {
        setProgress(`Scan complete: ${msg.indexed} tracks indexed`, 100);
        worker.terminate();
        P5.worker = null;
        await afterWorkerScan();
      }
    };

    worker.onerror = (err) => {
      console.error('scanner.worker.js error:', err);
      setProgress('Worker scanner error. Check console.', 0);
    };

    worker.postMessage({ type: 'scanHandles', handles: items, batchSize: 35 });
  }

  async function* walkDirectory(dirHandle, prefix) {
    for await (const [name, handle] of dirHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') yield { kind: 'file', handle, path };
      if (handle.kind === 'directory') yield* walkDirectory(handle, path);
    }
  }

  async function commitWorkerBatch(batch) {
    for (const item of batch) {
      const t = item.track;
      try {
        if (typeof put === 'function') await put('tracks', t);
        if (typeof put === 'function') await put('handles', { id: t.id, handle: P5.fileHandleMap.get(item.handleIndex), path: t.path });
      } catch (err) {
        console.warn('IndexedDB batch commit failed:', err, t);
      }
    }
  }

  async function afterWorkerScan() {
    try {
      if (typeof all === 'function') {
        // library is a top-level lexical in the original static app; assign if accessible.
        // eslint-disable-next-line no-undef
        library = await all('tracks');
      }
      if (typeof applySmartCrates === 'function') await applySmartCrates();
      if (typeof renderAll === 'function') renderAll();
      enhanceHarmonicClasses();
    } catch (err) {
      console.warn('Post worker refresh failed:', err);
    }
  }

  function cancelWorkerScan() {
    P5.cancelScan = true;
    if (P5.worker) P5.worker.postMessage({ type: 'cancel' });
    setProgress('Cancelling scan...', 0);
  }

  function setProgress(text, value) {
    const label = $('phase5ScanText');
    const fill = $('phase5ScanFill');
    if (label) label.textContent = text;
    if (fill) fill.style.width = `${clamp(Number(value || 0), 0, 100)}%`;
  }

  function patchRenderersIfAvailable() {
    const tryPatch = () => {
      virtualizeContainer('trackList');
      virtualizeContainer('crateTracks');
      virtualizeContainer('quickLoad');
      enhanceHarmonicClasses();
    };

    const mo = new MutationObserver(() => requestAnimationFrame(tryPatch));
    ['trackList', 'crateTracks', 'quickLoad'].forEach((id) => {
      const el = $(id);
      if (el) mo.observe(el, { childList: true, subtree: false });
    });
    setInterval(tryPatch, 1200);
  }

  function virtualizeContainer(id) {
    const el = $(id);
    if (!el || el.dataset.virtualized === '1') return;
    const children = Array.from(el.children).filter(x => x.classList && x.classList.contains('track'));
    if (children.length < 80) return;

    const htmlItems = children.map(x => x.outerHTML);
    el.dataset.virtualized = '1';
    el.classList.add('virtual-list');
    el.innerHTML = `<div class="virtual-spacer"><div class="virtual-window"></div></div>`;

    const spacer = el.querySelector('.virtual-spacer');
    const win = el.querySelector('.virtual-window');
    const state = { id, items: htmlItems, spacer, win };
    P5.virtual.set(id, state);

    const render = () => renderVirtual(el, state);
    el.addEventListener('scroll', render, { passive: true });
    render();
  }

  function renderVirtual(container, state) {
    const total = state.items.length;
    const row = P5.rowHeight;
    const viewH = Math.max(container.clientHeight, 320);
    const start = Math.max(0, Math.floor(container.scrollTop / row) - P5.overscan);
    const count = Math.ceil(viewH / row) + P5.overscan * 2;
    const end = Math.min(total, start + count);
    state.spacer.style.height = `${total * row}px`;
    state.win.style.transform = `translateY(${start * row}px)`;
    state.win.innerHTML = state.items.slice(start, end).join('');

    state.win.querySelectorAll('.track').forEach((el) => {
      if (typeof selectTrack === 'function') el.onclick = () => selectTrack(el.dataset.id);
    });
    enhanceHarmonicClasses(state.win);
  }

  function enhanceHarmonicClasses(root = document) {
    let activeKey = '';
    let activeBpm = null;
    try {
      // eslint-disable-next-line no-undef
      activeKey = state?.deckA?.key || state?.deckB?.key || selectedTrack?.key || '';
      // eslint-disable-next-line no-undef
      activeBpm = state?.deckA?.bpm || state?.deckB?.bpm || selectedTrack?.bpm || null;
    } catch (_) {}

    const compatible = activeKey ? camelotCompatible(activeKey) : [];
    root.querySelectorAll('.track').forEach((el) => {
      el.classList.remove('phase5-perfect', 'phase5-compatible', 'phase5-rhythm');
      const key = (el.querySelector('.pill')?.textContent || '').trim().toUpperCase();
      const text = el.textContent || '';
      const bpmMatch = text.match(/(\d{2,3})\s*BPM/i);
      const bpm = bpmMatch ? Number(bpmMatch[1]) : null;

      if (activeKey && key === activeKey.toUpperCase()) el.classList.add('phase5-perfect');
      else if (activeKey && compatible.includes(key)) el.classList.add('phase5-compatible');
      else if (activeBpm && bpm && Math.abs(Number(activeBpm) - bpm) <= 3) el.classList.add('phase5-rhythm');
    });
  }

  function camelotCompatible(key) {
    const m = String(key || '').toUpperCase().match(/^(\d{1,2})(A|B)$/);
    if (!m) return [];
    const n = Number(m[1]);
    const l = m[2];
    const prev = n === 1 ? 12 : n - 1;
    const next = n === 12 ? 1 : n + 1;
    const opp = l === 'A' ? 'B' : 'A';
    return [`${n}${l}`, `${prev}${l}`, `${next}${l}`, `${n}${opp}`];
  }

  function percent(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
})();
