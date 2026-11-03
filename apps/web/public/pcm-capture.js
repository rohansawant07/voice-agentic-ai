/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Mic capture for live voice: downsamples to 16 kHz mono and posts 80 ms
// frames of 16-bit PCM, the format and frame size Deepgram Flux expects.
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1280; // 80 ms at 16 kHz

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.position = 0;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    // Average the input samples that fall into each output sample.
    while (this.position < channel.length) {
      const start = Math.floor(this.position);
      const end = Math.min(channel.length, Math.floor(this.position + this.step));
      let sum = 0;
      for (let i = start; i < end; i++) sum += channel[i];
      const value = end > start ? sum / (end - start) : channel[start];
      const clamped = Math.max(-1, Math.min(1, value));
      this.frame[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
      this.position += this.step;
    }
    this.position -= channel.length;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
