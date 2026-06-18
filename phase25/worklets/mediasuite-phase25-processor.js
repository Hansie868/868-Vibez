class MediaSuitePhase25Processor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.modGain = 1;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'modGain') this.modGain = Math.max(0, Math.min(2, Number(msg.value) || 1));
    };
  }
  process(inputs, outputs){
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;
    for (let ch = 0; ch < output.length; ch++){
      const source = input[ch] || input[0];
      const dest = output[ch];
      if (!source || !dest) continue;
      for (let i = 0; i < dest.length; i++) dest[i] = source[i] * this.modGain;
    }
    return true;
  }
}
registerProcessor('mediasuite-phase25-processor', MediaSuitePhase25Processor);
