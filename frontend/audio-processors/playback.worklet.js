/**
 * Audio Playback Worklet Processor for playing PCM audio.
 * Uses an offset tracker instead of slice() to avoid allocations
 * on the real-time audio thread.
 */

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.audioQueue = [];
    this.currentOffset = 0;
    this.queuedSamples = 0;
    const configuredMin = options?.processorOptions?.minBufferSamples;
    this.minBufferSamples = Number.isFinite(configuredMin) ? configuredMin : 2400;
    this.buffering = true;
    this.wasPlaying = false;

    this.port.onmessage = (event) => {
      if (event.data === "interrupt") {
        this.audioQueue = [];
        this.currentOffset = 0;
        this.queuedSamples = 0;
        this.buffering = true;
        this.wasPlaying = false;
        this.port.postMessage({ type: "drained" });
      } else if (event.data instanceof Float32Array) {
        this.audioQueue.push(event.data);
        this.queuedSamples += event.data.length;
        if (this.buffering && this.queuedSamples >= this.minBufferSamples) {
          this.buffering = false;
        }
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (output.length === 0) return true;

    const channel = output[0];
    let outputIndex = 0;

    if (this.buffering) {
      while (outputIndex < channel.length) {
        channel[outputIndex++] = 0;
      }
      return true;
    }

    // Fill the output buffer from the queue
    let samplesCopied = 0;
    while (outputIndex < channel.length && this.audioQueue.length > 0) {
      const currentBuffer = this.audioQueue[0];

      if (!currentBuffer || currentBuffer.length === 0) {
        this.audioQueue.shift();
        this.currentOffset = 0;
        continue;
      }

      const remainingOutput = channel.length - outputIndex;
      const remainingBuffer = currentBuffer.length - this.currentOffset;
      const copyLength = Math.min(remainingOutput, remainingBuffer);

      for (let i = 0; i < copyLength; i++) {
        channel[outputIndex++] = currentBuffer[this.currentOffset++];
      }
      samplesCopied += copyLength;

      if (this.currentOffset >= currentBuffer.length) {
        this.audioQueue.shift();
        this.currentOffset = 0;
      }
    }

    while (outputIndex < channel.length) {
      channel[outputIndex++] = 0;
    }

    this.queuedSamples = Math.max(0, this.queuedSamples - samplesCopied);

    const isPlaying = this.queuedSamples > 0;
    if (this.wasPlaying && !isPlaying) {
      // Do not re-enter buffering between TTS chunks — that caused ~100ms gaps
      // and audible stutter. Buffering only on cold start and interrupt.
      this.port.postMessage({ type: "drained" });
    }
    this.wasPlaying = isPlaying;

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
