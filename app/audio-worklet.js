// Audio playout for the stream, on the audio rendering thread.
//
// Decoded Opus (5 ms packets) arrives in bursts: over the internet audio shares one TCP connection with video,
// so a keyframe can hold it back for tens of milliseconds. Scheduling every packet as its own buffer turned
// each late packet into a gap and a click. Here a jitter buffer absorbs the bursts:
//   - playback starts once `target` ms are buffered; an underrun raises the target (up to 250 ms), 15 s
//     without one lowers it again (down to 40 ms);
//   - running dry fades out instead of cutting off, and playback fades back in;
//   - the read speed is nudged (+-0.5..1.5 %, linear interpolation) to hold the buffer near the target, which
//     also absorbs the host/browser clock drift and a context sample rate other than the stream's.
class StreamAudioPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.channels = opts.channels || 2;
    this.sourceRate = opts.sampleRate || 48000;
    this.baseStep = this.sourceRate / sampleRate; // source samples per output sample
    this.capacity = this.sourceRate * 2;
    this.buffers = Array.from({ length: this.channels }, () => new Float32Array(this.capacity));
    this.writeIndex = 0;
    this.readPos = 0; // fractional, in source samples
    this.level = 0; // buffered source samples
    this.targetMs = 60;
    this.playing = false;
    this.fade = 0; // 0..1 fade-in gain
    this.underruns = 0;
    this.lastUnderrunFrame = 0;
    this.frame = 0;
    this.reportAt = 0;
    this.port.onmessage = (event) => this.push(event.data);
  }

  push(data) {
    if (data?.type === 'reset') {
      this.level = 0;
      this.playing = false;
      return;
    }
    const planes = data?.channels;
    if (!planes?.length) return;
    const frames = planes[0].length;
    // Never let the buffer hold more than ~1 s: drop the oldest audio rather than drifting behind.
    const overflow = this.level + frames - this.sourceRate;
    if (overflow > 0) {
      this.readPos = (this.readPos + overflow) % this.capacity;
      this.level -= overflow;
    }
    for (let c = 0; c < this.channels; c += 1) {
      const source = planes[Math.min(c, planes.length - 1)];
      const target = this.buffers[c];
      for (let i = 0; i < frames; i += 1) target[(this.writeIndex + i) % this.capacity] = source[i];
    }
    this.writeIndex = (this.writeIndex + frames) % this.capacity;
    this.level += frames;
  }

  levelMs() {
    return (this.level / this.sourceRate) * 1000;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const length = output[0].length;
    this.frame += length;
    if (!this.playing) {
      if (this.levelMs() >= this.targetMs) {
        this.playing = true;
        this.fade = 0;
      } else {
        for (const channel of output) channel.fill(0);
        this.maybeReport();
        return true;
      }
    }
    // Hold the buffer near the target: read slightly faster when it grows, slower when it shrinks.
    const error = this.levelMs() - this.targetMs;
    const speed = error > 60 ? 1.015 : error > 20 ? 1.005 : error < -20 ? 0.995 : 1;
    const step = this.baseStep * speed;
    const needed = Math.ceil(length * step) + 2;
    const available = Math.min(length, Math.floor((this.level - 2) / step));
    const fadeOutFrom = needed > this.level ? Math.max(0, available - 96) : Infinity;
    for (let i = 0; i < length; i += 1) {
      if (i >= available) {
        for (let c = 0; c < output.length; c += 1) output[c][i] = 0;
        continue;
      }
      const index = Math.floor(this.readPos);
      const frac = this.readPos - index;
      const next = (index + 1) % this.capacity;
      if (this.fade < 1) this.fade = Math.min(1, this.fade + 1 / 240); // ~5 ms fade-in
      const gain = this.fade * (i >= fadeOutFrom ? (available - i) / (available - fadeOutFrom) : 1);
      for (let c = 0; c < output.length; c += 1) {
        const plane = this.buffers[Math.min(c, this.channels - 1)];
        const sample = (plane[index] + (plane[next] - plane[index]) * frac) * gain;
        output[c][i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
      }
      this.readPos += step;
      if (this.readPos >= this.capacity) this.readPos -= this.capacity;
      this.level -= step;
    }
    if (available < length) {
      // Ran dry: faded out above; wait for a bigger cushion before playing again.
      this.playing = false;
      this.level = Math.max(0, this.level);
      this.underruns += 1;
      this.lastUnderrunFrame = this.frame;
      this.targetMs = Math.min(250, this.targetMs + 15);
    } else if (this.frame - this.lastUnderrunFrame > sampleRate * 15 && this.targetMs > 40) {
      this.lastUnderrunFrame = this.frame;
      this.targetMs = Math.max(40, this.targetMs - 5);
    }
    this.maybeReport();
    return true;
  }

  maybeReport() {
    if (this.frame - this.reportAt < sampleRate) return;
    this.reportAt = this.frame;
    this.port.postMessage({ type: 'stats', bufferedMs: Math.round(this.levelMs()), targetMs: this.targetMs, underruns: this.underruns });
  }
}

registerProcessor('sunbridge-audio-player', StreamAudioPlayer);
