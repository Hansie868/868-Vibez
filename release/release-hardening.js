/* ============================================================
   MediaSuite Phase 20 — Release Polish, Optimization,
   Testing, Stability & Release Preparation Runtime
   ============================================================ */
(function () {
  'use strict';

  const VERSION = 'MediaSuite V3 Phase 20 Release Candidate';
  const DB_NAME = 'MediaSuiteReleaseDB';
  const DB_VERSION = 1;
  const state = {
    errors: [],
    warnings: [],
    metrics: [],
    startedAt: Date.now(),
    safeMode: localStorage.getItem('ms20.safeMode') === '1',
    highContrast: localStorage.getItem('ms20.highContrast') === '1',
    compact: localStorage.getItem('ms20.compact') === '1'
  };

  function openReleaseDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, value) {
    const db = await openReleaseDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function toast(title, message, type = '') {
    let stack = document.querySelector('.ms20-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'ms20-toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `ms20-toast ${type}`.trim();
    el.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 9000 : 5200);
  }

  function escapeHTML(v) {
    return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function captureError(kind, err) {
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      kind,
      message: err?.message || String(err),
      stack: err?.stack || '',
      at: new Date().toISOString(),
      url: location.href
    };
    state.errors.push(item);
    put('logs', item).catch(() => {});
    toast('Runtime Issue Captured', item.message.slice(0, 180), 'error');
  }

  window.addEventListener('error', e => captureError('error', e.error || e.message));
  window.addEventListener('unhandledrejection', e => captureError('promise', e.reason));

  function applyUserModes() {
    document.documentElement.classList.toggle('ms20-safe-mode', state.safeMode);
    document.documentElement.classList.toggle('ms20-high-contrast', state.highContrast);
    document.documentElement.classList.toggle('ms20-density-compact', state.compact);
  }

  function collectMetrics() {
    const memory = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    } : null;
    const metric = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      uptimeMs: Date.now() - state.startedAt,
      domNodes: document.getElementsByTagName('*').length,
      memory,
      errors: state.errors.length,
      url: location.href
    };
    state.metrics.push(metric);
    if (state.metrics.length > 100) state.metrics.shift();
    return metric;
  }

  function runReleaseAudit() {
    const checks = [];
    const hasSW = 'serviceWorker' in navigator;
    const hasIDB = 'indexedDB' in window;
    const hasAudio = 'AudioContext' in window || 'webkitAudioContext' in window;
    const hasSecure = window.isSecureContext || location.protocol === 'http:' || location.hostname === 'localhost';
    const hasManifest = !!document.querySelector('link[rel="manifest"]');
    const hasViewport = !!document.querySelector('meta[name="viewport"]');
    const hasTheme = !!document.querySelector('meta[name="theme-color"]');

    checks.push(['Service Worker Support', hasSW]);
    checks.push(['IndexedDB Support', hasIDB]);
    checks.push(['Web Audio Support', hasAudio]);
    checks.push(['Secure/Local Context', hasSecure]);
    checks.push(['Manifest Linked', hasManifest]);
    checks.push(['Mobile Viewport Meta', hasViewport]);
    checks.push(['Theme Color Meta', hasTheme]);

    const failed = checks.filter(([, ok]) => !ok);
    if (failed.length) toast('Release Audit', `${failed.length} checks need attention.`, 'warn');
    else toast('Release Audit', 'All core release checks passed.', 'ok');
    return checks;
  }

  function createSnapshot() {
    const snapshot = {
      id: `snapshot_${new Date().toISOString()}`,
      version: VERSION,
      location: location.href,
      localStorage: { ...localStorage },
      metrics: collectMetrics(),
      errors: state.errors.slice(-20),
      createdAt: new Date().toISOString()
    };
    return put('snapshots', snapshot).then(() => {
      toast('Backup Snapshot Created', snapshot.id, 'ok');
      return snapshot;
    });
  }

  function downloadDiagnostics() {
    const payload = {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      location: location.href,
      metrics: collectMetrics(),
      errors: state.errors,
      warnings: state.warnings,
      releaseAudit: runReleaseAudit()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mediasuite-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportLocalSettings() {
    const payload = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      localStorage: { ...localStorage }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mediasuite-settings-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function buildPanel() {
    const fab = document.createElement('button');
    fab.className = 'ms20-fab';
    fab.title = 'Release Tools';
    fab.textContent = 'RC';

    const panel = document.createElement('section');
    panel.className = 'ms20-panel';
    panel.innerHTML = `
      <h3>MediaSuite Release Candidate Tools</h3>
      <p><strong>${VERSION}</strong></p>
      <p>Final polish layer for stability, diagnostics, backups, accessibility, and release validation.</p>
      <ul>
        <li>Runtime error capture</li>
        <li>Release audit checks</li>
        <li>Backup snapshot generator</li>
        <li>Diagnostics export</li>
        <li>Safe mode, compact mode, and high contrast mode</li>
      </ul>
      <div class="ms20-actions">
        <button class="ms20-btn ok" data-ms20="audit">Run Audit</button>
        <button class="ms20-btn" data-ms20="snapshot">Create Snapshot</button>
        <button class="ms20-btn" data-ms20="diagnostics">Export Diagnostics</button>
        <button class="ms20-btn" data-ms20="settings">Backup Settings</button>
        <button class="ms20-btn" data-ms20="compact">Toggle Compact</button>
        <button class="ms20-btn" data-ms20="contrast">Toggle Contrast</button>
        <button class="ms20-btn danger" data-ms20="safe">Toggle Safe Mode</button>
        <button class="ms20-btn" data-ms20="close">Close</button>
      </div>
      <p id="ms20MetricLine" style="margin-top:10px;"></p>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener('click', () => panel.classList.toggle('open'));
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-ms20]');
      if (!btn) return;
      const action = btn.getAttribute('data-ms20');
      if (action === 'close') panel.classList.remove('open');
      if (action === 'audit') renderAudit(panel);
      if (action === 'snapshot') await createSnapshot();
      if (action === 'diagnostics') downloadDiagnostics();
      if (action === 'settings') exportLocalSettings();
      if (action === 'compact') { state.compact = !state.compact; localStorage.setItem('ms20.compact', state.compact ? '1' : '0'); applyUserModes(); }
      if (action === 'contrast') { state.highContrast = !state.highContrast; localStorage.setItem('ms20.highContrast', state.highContrast ? '1' : '0'); applyUserModes(); }
      if (action === 'safe') { state.safeMode = !state.safeMode; localStorage.setItem('ms20.safeMode', state.safeMode ? '1' : '0'); applyUserModes(); }
      updateMetricLine();
    });
  }

  function renderAudit(panel) {
    const checks = runReleaseAudit();
    const existing = panel.querySelector('.ms20-audit-results');
    if (existing) existing.remove();
    const block = document.createElement('div');
    block.className = 'ms20-audit-results';
    block.style.marginTop = '10px';
    block.innerHTML = checks.map(([name, ok]) => `<p>${ok ? '✓' : '!' } ${escapeHTML(name)}</p>`).join('');
    panel.appendChild(block);
  }

  function updateMetricLine() {
    const line = document.getElementById('ms20MetricLine');
    if (!line) return;
    const m = collectMetrics();
    const mem = m.memory ? ` · Heap ${(m.memory.usedJSHeapSize / 1048576).toFixed(1)}MB` : '';
    line.textContent = `DOM ${m.domNodes} nodes · Errors ${m.errors}${mem}`;
  }

  function installIdleCleanup() {
    const run = () => {
      collectMetrics();
      if (state.errors.length > 50) state.errors.splice(0, state.errors.length - 50);
    };
    if ('requestIdleCallback' in window) {
      const loop = () => requestIdleCallback(() => { run(); loop(); }, { timeout: 8000 });
      loop();
    } else {
      setInterval(run, 10000);
    }
  }

  async function init() {
    applyUserModes();
    await openReleaseDB().catch(err => captureError('indexeddb', err));
    buildPanel();
    installIdleCleanup();
    updateMetricLine();
    setInterval(updateMetricLine, 15000);
    setTimeout(() => toast('Release Layer Active', VERSION, 'ok'), 500);
    window.MediaSuiteRelease = {
      version: VERSION,
      runReleaseAudit,
      createSnapshot,
      downloadDiagnostics,
      collectMetrics,
      state
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
