# MediaSuite V3 — Phase 24 GPU Visuals & Reverb Matrix

Adds:
- SharedWorker state hub for multi-window sync and diagnostics
- WebGL visualizer scaffold with WebGPU detection and Canvas fallback
- ConvolverNode reverb matrix
- IndexedDB `impulseResponses` cache
- Studio / Hall / Arena generated impulse presets
- Dry/wet and per-deck send controls

Notes:
- Critical audio timing stays in the active page AudioContext.
- The SharedWorker is used for state broadcast and diagnostics only.
- Reverb routing exposes `window.MediaSuitePhase24` and `window.MediaSuiteReverbSends` for integration with existing deck buses.
