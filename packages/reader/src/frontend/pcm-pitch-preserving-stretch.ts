/**
 * Small streaming WSOLA time-stretcher for 24 kHz mono TTS.
 *
 * Changing an AudioBufferSourceNode's playbackRate also changes vocal pitch.
 * WSOLA instead overlaps similar waveform sections while changing duration.
 * This is intentionally bounded: ~40 ms frames, <10 ms lookahead search, and
 * only a few thousand samples retained between incoming PCM chunks.
 */
export class PcmPitchPreservingStretch {
  private readonly windowSamples: number;
  private readonly hop: number;
  private readonly radius: number;
  private input = new Float32Array(0);
  private base = 0;
  private expected = 0;
  private lastEnd = 0;
  private tail: Float32Array | null = null;
  private finished = false;

  constructor(
    readonly rate: number,
    readonly sampleRate = 24000,
  ) {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error("不支持的播放语速");
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("不支持的采样率");
    this.hop = Math.round(sampleRate * 0.02);
    this.windowSamples = this.hop * 2;
    this.radius = Math.round(sampleRate * 0.0075);
  }

  push(samples: Float32Array): Float32Array {
    if (this.finished) throw new Error("音频处理已经结束");
    if (samples.length === 0) return new Float32Array(0);
    const joined = new Float32Array(this.input.length + samples.length);
    joined.set(this.input);
    joined.set(samples, this.input.length);
    this.input = joined;
    return this.process(false);
  }

  finish(): Float32Array {
    if (this.finished) return new Float32Array(0);
    this.finished = true;
    const sections = [this.process(true)];
    if (!this.tail) {
      sections.push(this.input);
    } else {
      sections.push(this.tail);
      const remaining = this.base + this.input.length - this.lastEnd;
      if (remaining > 0) sections.push(this.input.subarray(Math.max(0, this.lastEnd - this.base)));
    }
    this.input = new Float32Array(0);
    return concatFloat32(sections);
  }

  private process(final: boolean): Float32Array {
    const parts: Float32Array[] = [];
    const availableEnd = this.base + this.input.length;
    const { hop, windowSamples: window, radius } = this;

    if (!this.tail) {
      if (availableEnd < window) return new Float32Array(0);
      parts.push(this.input.slice(0, hop));
      this.tail = this.input.slice(hop, window);
      this.lastEnd = window;
      this.expected = hop * this.rate;
    }

    while (this.tail) {
      const target = Math.round(this.expected);
      const earliest = Math.max(0, target - radius);
      const latest = Math.min(target + radius, availableEnd - window);
      if (latest < earliest || (!final && availableEnd < target + radius + window)) break;

      let best = Math.min(Math.max(target, earliest), latest);
      let bestScore = -Infinity;
      let tailEnergy = 0;
      for (let j = 0; j < hop; j += 3) tailEnergy += this.tail[j] * this.tail[j];
      if (tailEnergy > 1e-8) {
        // Cross-correlation aligns pitch periods rather than splicing arbitrary
        // waveform phases, avoiding the metallic/doubled voices of naive OLA.
        for (let candidate = earliest; candidate <= latest; candidate += 3) {
          let dot = 0, energy = 0;
          const local = candidate - this.base;
          for (let j = 0; j < hop; j += 3) {
            const value = this.input[local + j];
            dot += this.tail[j] * value;
            energy += value * value;
          }
          const score = dot / Math.sqrt(tailEnergy * energy + 1e-12);
          if (score > bestScore) { bestScore = score; best = candidate; }
        }
      }
      const local = best - this.base;
      const segment = new Float32Array(hop);
      for (let j = 0; j < hop; j++) {
        const fraction = j / hop;
        segment[j] = this.tail[j] * (1 - fraction) + this.input[local + j] * fraction;
      }
      parts.push(segment);
      this.tail = this.input.slice(local + hop, local + window);
      this.lastEnd = best + window;
      this.expected += hop * this.rate;
    }

    // Leave enough input for the next correlation search; older source samples
    // are never read again. Memory therefore remains bounded during long books.
    if (!final) {
      const retainFrom = Math.min(this.lastEnd, Math.max(this.base, Math.floor(this.expected) - radius - 4));
      if (retainFrom > this.base) {
        this.input = this.input.slice(retainFrom - this.base);
        this.base = retainFrom;
      }
    }
    return concatFloat32(parts);
  }
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Float32Array(length);
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}
