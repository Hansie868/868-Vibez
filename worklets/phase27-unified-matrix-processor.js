/* MediaSuite Phase 27 — Unified Multi-Input AudioWorklet Scaffold
   Safe scaffold: sums multi-input audio with soft limiting and preserves fallback routing externally. */
class Phase27UnifiedMatrixProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.meter = 0;
    this.tick = 0;
    this.scratchVelocity = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'scratchVelocity') {
        this.scratchVelocity = Number(event.data.value || 0);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const chCount = output.length;
    const frames = output[0].length;
    let peak = 0;

    for (let ch = 0; ch < chCount; ch++) {
      const out = output[ch];
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
          const input = inputs[inputIndex];
          if (!input || !input.length) continue;
          const src = input[Math.min(ch, input.length - 1)];
          if (src) sum += src[i] || 0;
        }
        // Conservative soft guard; final limiter remains downstream.
        const guarded = Math.tanh(sum * 0.9);
        out[i] = guarded;
        const abs = Math.abs(guarded);
        if (abs > peak) peak = abs;
      }
    }

    if (++this.tick % 60 === 0) {
      this.port.postMessage({ type: 'meter', value: peak });
    }
    return true;
  }
}

registerProcessor('phase27-unified-matrix', Phase27UnifiedMatrixProcessor);
