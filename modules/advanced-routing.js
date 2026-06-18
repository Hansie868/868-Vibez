/* ============================================================
   MediaSuite Phase 22 — Advanced Multi-Output Cue Routing
   Purpose:
   - Detect 4-channel hardware output availability
   - Route master to channels 0/1 and cue to channels 2/3 when supported
   - Fallback safely to software/visual cue mode on normal stereo devices
   ============================================================ */
(function () {
  const root = window.MediaSuitePhase22 = window.MediaSuitePhase22 || {};

  function getAudioContext() {
    return window.audioCtx || window.audioContext || window.msAudioCtx || null;
  }

  function ensureGain(ctx, name) {
    const key = '__phase22_' + name;
    if (!window[key]) window[key] = ctx.createGain();
    return window[key];
  }

  function createRoutingGraph(ctx) {
    const destination = ctx.destination;
    const maxChannels = destination.maxChannelCount || destination.channelCount || 2;
    const hardwareCueSupported = maxChannels >= 4;

    const graph = root.routingGraph = root.routingGraph || {};
    graph.maxChannels = maxChannels;
    graph.hardwareCueSupported = hardwareCueSupported;
    graph.masterInput = graph.masterInput || ensureGain(ctx, 'masterInput');
    graph.cueAInput = graph.cueAInput || ensureGain(ctx, 'cueAInput');
    graph.cueBInput = graph.cueBInput || ensureGain(ctx, 'cueBInput');
    graph.deckACueGain = graph.deckACueGain || ensureGain(ctx, 'deckACueGain');
    graph.deckBCueGain = graph.deckBCueGain || ensureGain(ctx, 'deckBCueGain');
    graph.deckACueGain.gain.value = 0;
    graph.deckBCueGain.gain.value = 0;

    try {
      if (hardwareCueSupported) {
        destination.channelCount = Math.min(4, maxChannels);
        destination.channelCountMode = 'explicit';
        destination.channelInterpretation = 'discrete';

        graph.masterSplitter = graph.masterSplitter || ctx.createChannelSplitter(2);
        graph.cueMerger = graph.cueMerger || ctx.createChannelMerger(4);
        graph.cueSum = graph.cueSum || ctx.createGain();

        safeDisconnect(graph.masterInput);
        safeDisconnect(graph.cueAInput);
        safeDisconnect(graph.cueBInput);
        safeDisconnect(graph.deckACueGain);
        safeDisconnect(graph.deckBCueGain);
        safeDisconnect(graph.cueSum);
        safeDisconnect(graph.cueMerger);

        graph.masterInput.connect(graph.masterSplitter);
        graph.masterSplitter.connect(graph.cueMerger, 0, 0);
        graph.masterSplitter.connect(graph.cueMerger, 1, 1);

        graph.cueAInput.connect(graph.deckACueGain);
        graph.cueBInput.connect(graph.deckBCueGain);
        graph.deckACueGain.connect(graph.cueSum);
        graph.deckBCueGain.connect(graph.cueSum);
        graph.cueSum.connect(graph.cueMerger, 0, 2);
        graph.cueSum.connect(graph.cueMerger, 0, 3);
        graph.cueMerger.connect(destination);
      } else {
        safeDisconnect(graph.masterInput);
        graph.masterInput.connect(destination);
      }
    } catch (err) {
      console.warn('[Phase22] Hardware cue routing failed; using fallback.', err);
      try { safeDisconnect(graph.masterInput); graph.masterInput.connect(destination); } catch (_) {}
      graph.hardwareCueSupported = false;
    }

    root.render?.patch('routing', {
      maxChannels,
      hardwareCueSupported: graph.hardwareCueSupported,
      cueMode: graph.hardwareCueSupported ? 'hardware-4ch' : 'software-stereo'
    });

    return graph;
  }

  function safeDisconnect(node) {
    try { node.disconnect(); } catch (_) {}
  }

  function setCue(deck, enabled) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const graph = root.routingGraph || createRoutingGraph(ctx);
    const value = enabled ? 1 : 0;
    const t = ctx.currentTime;
    const target = deck === 'A' ? graph.deckACueGain : graph.deckBCueGain;
    if (target?.gain) {
      target.gain.cancelScheduledValues(t);
      target.gain.setTargetAtTime(value, t, 0.01);
    }
    if (deck === 'A') root.render?.set('routing.deckACue', !!enabled);
    if (deck === 'B') root.render?.set('routing.deckBCue', !!enabled);
  }

  function toggleCue(deck) {
    const state = root.renderState?.routing;
    const current = deck === 'A' ? state?.deckACue : state?.deckBCue;
    setCue(deck, !current);
  }

  function mountCueControls() {
    const mixer = document.querySelector('#mixerCenter, .mixer-pod, .mixer, [data-panel="mixer"]');
    if (!mixer || document.querySelector('#phase22CuePanel')) return;

    const panel = document.createElement('div');
    panel.id = 'phase22CuePanel';
    panel.className = 'phase22-panel phase22-cue-panel';
    panel.innerHTML = `
      <div class="phase22-title">Cue Routing</div>
      <div class="phase22-row">
        <button id="phase22CueA" class="phase22-btn">Deck A CUE</button>
        <button id="phase22CueB" class="phase22-btn">Deck B CUE</button>
      </div>
      <div class="phase22-status">
        <span id="phase22RoutingStatus">Routing: detecting…</span>
      </div>
    `;
    mixer.appendChild(panel);

    panel.querySelector('#phase22CueA').addEventListener('click', () => toggleCue('A'));
    panel.querySelector('#phase22CueB').addEventListener('click', () => toggleCue('B'));
    root.render?.bindText('#phase22RoutingStatus', s => `Routing: ${s.routing.cueMode} · channels ${s.routing.maxChannels}`);
  }

  async function initRouting() {
    mountCueControls();
    const ctx = getAudioContext();
    if (!ctx) {
      root.render?.patch('routing', { cueMode: 'waiting-for-audio-context', maxChannels: 2, hardwareCueSupported: false });
      return null;
    }
    return createRoutingGraph(ctx);
  }

  root.advancedRouting = { initRouting, createRoutingGraph, setCue, toggleCue };
  document.addEventListener('DOMContentLoaded', () => setTimeout(initRouting, 600));
  document.addEventListener('click', () => setTimeout(initRouting, 100), { once: true });
})();
