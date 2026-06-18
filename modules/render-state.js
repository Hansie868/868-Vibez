/* ============================================================
   MediaSuite Phase 22 — RenderState Batching Engine
   Purpose:
   - Stop high-frequency systems from writing directly to DOM
   - Store fast-changing state in memory
   - Flush UI updates only on requestAnimationFrame
   ============================================================ */
(function () {
  const root = window.MediaSuitePhase22 = window.MediaSuitePhase22 || {};

  const renderState = root.renderState = {
    midi: {
      connected: false,
      deviceCount: 0,
      lastMessage: 'No MIDI input',
      lastCC: null,
      lastNote: null,
      dirty: true
    },
    limiter: {
      enabled: true,
      reduction: 0,
      threshold: -1,
      ratio: 20,
      dirty: true
    },
    scheduler: {
      lookaheadMs: 25,
      queuedEvents: 0,
      driftMs: 0,
      dirty: true
    },
    routing: {
      maxChannels: 2,
      hardwareCueSupported: false,
      cueMode: 'software',
      deckACue: false,
      deckBCue: false,
      dirty: true
    },
    worklet: {
      supported: false,
      loaded: false,
      fallback: true,
      status: 'Native node fallback active',
      dirty: true
    },
    ui: {
      fps: 0,
      lastFrame: performance.now(),
      dirty: true
    }
  };

  const bindings = new Map();
  let rafId = null;
  let frameCounter = 0;
  let fpsClock = performance.now();

  function bindText(selector, getter) {
    const el = document.querySelector(selector);
    if (el) bindings.set(selector, { el, getter, last: undefined, type: 'text' });
  }

  function bindClass(selector, getter) {
    const el = document.querySelector(selector);
    if (el) bindings.set(selector + ':class', { el, getter, last: undefined, type: 'class' });
  }

  function set(path, value) {
    const parts = path.split('.');
    let ref = renderState;
    for (let i = 0; i < parts.length - 1; i++) {
      ref = ref[parts[i]] = ref[parts[i]] || {};
    }
    ref[parts[parts.length - 1]] = value;
    const group = parts[0];
    if (renderState[group]) renderState[group].dirty = true;
  }

  function patch(path, data) {
    const group = renderState[path];
    if (!group || typeof group !== 'object') return;
    Object.assign(group, data, { dirty: true });
  }

  function flush() {
    frameCounter++;
    const now = performance.now();
    if (now - fpsClock >= 1000) {
      renderState.ui.fps = frameCounter;
      renderState.ui.dirty = true;
      frameCounter = 0;
      fpsClock = now;
    }

    for (const binding of bindings.values()) {
      const value = binding.getter(renderState);
      if (value === binding.last) continue;
      binding.last = value;
      if (binding.type === 'text') binding.el.textContent = value;
      if (binding.type === 'class') binding.el.className = value;
    }

    renderState.midi.dirty = false;
    renderState.limiter.dirty = false;
    renderState.scheduler.dirty = false;
    renderState.routing.dirty = false;
    renderState.worklet.dirty = false;
    renderState.ui.dirty = false;

    rafId = requestAnimationFrame(flush);
  }

  function start() {
    if (rafId) return;
    rafId = requestAnimationFrame(flush);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  root.render = { bindText, bindClass, set, patch, start, stop };
  document.addEventListener('DOMContentLoaded', start);
})();
