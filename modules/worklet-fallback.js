/* ============================================================
   MediaSuite Phase 22 — AudioWorklet Baseline + Fallback
   ============================================================ */
(function () {
  const root = window.MediaSuitePhase22 = window.MediaSuitePhase22 || {};

  function getAudioContext() {
    return window.audioCtx || window.audioContext || window.msAudioCtx || null;
  }

  async function initWorklet() {
    const ctx = getAudioContext();
    if (!ctx) {
      root.render?.patch('worklet', { supported: false, loaded: false, fallback: true, status: 'Waiting for AudioContext' });
      return null;
    }

    const supported = !!(ctx.audioWorklet && window.AudioWorkletNode && window.isSecureContext);
    root.render?.patch('worklet', { supported });

    if (!supported) {
      root.workletGraph = createNativeFallback(ctx);
      root.render?.patch('worklet', {
        loaded: false,
        fallback: true,
        status: 'AudioWorklet unavailable; native Gain/Biquad fallback active'
      });
      return root.workletGraph;
    }

    try {
      await ctx.audioWorklet.addModule('worklets/phase22-meter-processor.js');
      const node = new AudioWorkletNode(ctx, 'phase22-meter-processor');
      node.port.onmessage = (event) => {
        if (event.data?.type === 'meter') {
          root.render?.set('limiter.reduction', Number(event.data.peak || 0).toFixed(3));
        }
      };
      root.workletGraph = { mode: 'worklet', node };
      root.render?.patch('worklet', { loaded: true, fallback: false, status: 'AudioWorklet processor active' });
      return root.workletGraph;
    } catch (err) {
      console.warn('[Phase22] AudioWorklet failed; fallback active.', err);
      root.workletGraph = createNativeFallback(ctx);
      root.render?.patch('worklet', {
        loaded: false,
        fallback: true,
        status: 'AudioWorklet load failed; native fallback active'
      });
      return root.workletGraph;
    }
  }

  function createNativeFallback(ctx) {
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const output = ctx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 20;
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    input.connect(hp);
    hp.connect(lp);
    lp.connect(output);
    return { mode: 'native-fallback', input, hp, lp, output };
  }

  function mountWorkletStatus() {
    const host = document.querySelector('#phase22CuePanel, #mixerCenter, .mixer-pod, body');
    if (!host || document.querySelector('#phase22WorkletStatus')) return;
    const div = document.createElement('div');
    div.id = 'phase22WorkletStatus';
    div.className = 'phase22-status phase22-worklet-status';
    div.textContent = 'Worklet: initializing…';
    host.appendChild(div);
    root.render?.bindText('#phase22WorkletStatus', s => `Worklet: ${s.worklet.status}`);
  }

  root.workletFallback = { initWorklet, createNativeFallback };
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(mountWorkletStatus, 900);
    setTimeout(initWorklet, 1100);
  });
  document.addEventListener('click', () => setTimeout(initWorklet, 150), { once: true });
})();
