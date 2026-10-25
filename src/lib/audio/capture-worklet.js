// Downsamples microphone input to 16 kHz mono Int16 and posts it in ~250 ms batches.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions?.targetRate ?? 16000;
    this.ratio = sampleRate / this.target;
    this.pos = 0;
    this.acc = 0;
    this.accN = 0;
    this.batch = new Int16Array(Math.round(this.target / 4));
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      // Average the input samples that fall into each output sample (box filter).
      let s = ch[i];
      if (input.length > 1) s = (s + input[1][i]) / 2;
      this.acc += s;
      this.accN++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accN));
        this.acc = 0;
        this.accN = 0;
        this.peak = Math.max(this.peak, Math.abs(v));
        this.batch[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.batch.length) {
          this.port.postMessage({ samples: this.batch, peak: this.peak }, [this.batch.buffer]);
          this.batch = new Int16Array(this.batch.length);
          this.n = 0;
          this.peak = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
