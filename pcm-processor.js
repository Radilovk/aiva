/**
 * AudioWorklet processor for capturing PCM audio at 16kHz.
 * Buffers samples and posts Int16 PCM chunks to the main thread.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.bufferSize = 4096;
    this.targetRate = 16000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    // Accumulate samples
    const newBuffer = new Float32Array(this.buffer.length + channelData.length);
    newBuffer.set(this.buffer);
    newBuffer.set(channelData, this.buffer.length);
    this.buffer = newBuffer;

    // Flush when buffer is large enough
    while (this.buffer.length >= this.bufferSize) {
      const chunk = this.buffer.slice(0, this.bufferSize);
      this.buffer = this.buffer.slice(this.bufferSize);

      // Resample to 16kHz if needed
      let samples = chunk;
      if (sampleRate !== this.targetRate) {
        const ratio = sampleRate / this.targetRate;
        const newLen = Math.floor(chunk.length / ratio);
        samples = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          samples[i] = chunk[Math.floor(i * ratio)];
        }
      }

      // Float32 → Int16
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      this.port.postMessage({ pcm: int16.buffer }, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
