/* MediaSuite Phase 22 AudioWorklet Processor Scaffold */
class Phase22MeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._tick = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      let peak = 0;
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        const abs = Math.abs(ch[i]);
        if (abs > peak) peak = abs;
      }
      this._tick++;
      if (this._tick % 12 === 0) this.port.postMessage({ type: 'meter', peak });
    }
    return true;
  }
}

registerProcessor('phase22-meter-processor', Phase22MeterProcessor);
