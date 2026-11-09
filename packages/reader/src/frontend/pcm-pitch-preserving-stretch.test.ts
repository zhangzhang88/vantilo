import { describe, expect, it } from "vitest";
import { PcmPitchPreservingStretch } from "./pcm-pitch-preserving-stretch";

const sampleRate = 24000;
const frequency = 220;

function generateVoiceLikeSamples(seconds: number) {
  const signal = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < signal.length; i++) {
    const at = i / sampleRate;
    const envelope = Math.min(1, i / (0.02 * sampleRate), (signal.length - i) / (0.02 * sampleRate));
    signal[i] = envelope * (0.6 * Math.sin(2 * Math.PI * frequency * at)
      + 0.22 * Math.sin(2 * Math.PI * frequency * 2 * at)
      + 0.1 * Math.sin(2 * Math.PI * frequency * 3 * at));
  }
  return signal;
}
function join(parts: Float32Array[]) {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let index = 0;
  for (const part of parts) { result.set(part, index); index += part.length; }
  return result;
}
function fundamentalFrequency(samples: Float32Array) {
  // Count upward zero crossings in a stable middle section: amplitude and
  // harmonics can change, but pitch must remain near the 220 Hz original.
  const begin = Math.floor(samples.length * 0.3);
  const end = Math.floor(samples.length * 0.7);
  let count = 0;
  for (let i = begin + 1; i < end; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) count++;
  }
  return count * sampleRate / (end - begin);
}

describe("Qwen PCM streaming pitch-preserving speed", () => {
  for (const rate of [0.75, 1.25, 1.5]) {
    it(`changes duration by ${rate}x while retaining original vocal pitch`, () => {
      const original = generateVoiceLikeSamples(3);
      const stretch = new PcmPitchPreservingStretch(rate, sampleRate);
      const parts: Float32Array[] = [];
      // The real HTTP gateway produces arbitrary PCM network frame boundaries.
      for (let at = 0; at < original.length; at += 4096) parts.push(stretch.push(original.subarray(at, at + 4096)));
      parts.push(stretch.finish());
      const output = join(parts);
      expect(output.length / sampleRate).toBeCloseTo(3 / rate, 1);
      expect(Math.abs(fundamentalFrequency(output) - frequency)).toBeLessThan(12);
      expect(output.some(value => !Number.isFinite(value))).toBe(false);
      expect(Math.max(...output.subarray(0, 5000))).toBeLessThanOrEqual(1);
      expect(stretch.finish()).toHaveLength(0);
    });
  }

  it("finishes short PCM streams without losing audio and remains bounded over long input", () => {
    const few = new PcmPitchPreservingStretch(1.25);
    const small = new Float32Array(280).fill(0.125);
    expect(few.push(small)).toHaveLength(0);
    expect(few.finish()).toEqual(small);
    const long = new PcmPitchPreservingStretch(1.5);
    const frame = generateVoiceLikeSamples(1);
    let total = 0;
    for (let i = 0; i < 120; i++) total += long.push(frame).length;
    total += long.finish().length;
    expect(total / sampleRate).toBeGreaterThan(75);
    expect(total / sampleRate).toBeLessThan(85);
  });
});
