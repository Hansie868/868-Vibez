/* MediaSuite Phase 26 — Vinyl Scratch AudioWorklet Processor
   Local-only DSP scaffold. Receives scratchVelocity and wet mix.
   Falls back safely when AudioWorklet is unavailable. */

class VinylScratchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'scratchVelocity', defaultValue: 1, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
      { name: 'scratchWet', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.lastSample = 0;
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const wet = parameters.scratchWet.length ? parameters.scratchWet[0] : 0;
    if (!input || !input.length || !output || !output.length) return true;

    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[ch] || input[0];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;

      for (let i = 0; i < outCh.length; i++) {
        const vel = parameters.scratchVelocity.length > 1 ? parameters.scratchVelocity[i] : parameters.scratchVelocity[0];
        const srcIndex = Math.max(0, Math.min(inCh.length - 1, Math.floor(i * Math.abs(vel || 1))));
        const a = inCh[srcIndex] || 0;
        const b = inCh[Math.min(inCh.length - 1, srcIndex + 1)] || a;
        const frac = (i * Math.abs(vel || 1)) % 1;
        let scratched = a + (b - a) * frac;
        if ((vel || 1) < 0) scratched = -scratched * 0.85;
        outCh[i] = inCh[i] * (1 - wet) + scratched * wet;
      }
    }
    return true;
  }
}

registerProcessor('vinyl-scratch-processor', VinylScratchProcessor);
