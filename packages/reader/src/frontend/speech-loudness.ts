const MEASUREMENT_SAMPLES = 960; // 40 ms at the audiobook sample rate.
const MIN_SPEECH_POWER = 10 ** (-43 / 10);
const TARGET_DB = -24;
const DEAD_BAND_DB = 0.5;
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = 4.5;
const GAIN_SMOOTHING = 1 - Math.exp(-1 / (24000 * 0.12));

/** Balances sustained voice levels using only PCM that has already arrived. */
export class SpeechLoudness {
  private samples = 0;
  private squareSum = 0;
  private speechWindows = 0;
  private silenceWindows = 0;
  private speechPower = 0;
  private targetGain = 1;
  private gain = 1;

  beginChunk() {
    this.samples = 0;
    this.squareSum = 0;
    this.speechWindows = 0;
    this.silenceWindows = 0;
    this.targetGain = 1;
  }

  apply(pcm: Float32Array) {
    for (let index = 0; index < pcm.length; index++) {
      const sample = pcm[index];
      this.squareSum += sample * sample;
      this.samples++;
      if (this.samples === MEASUREMENT_SAMPLES) this.measure();
      this.gain += (this.targetGain - this.gain) * GAIN_SMOOTHING;
      // Leave headroom when boosting. Attenuation can scale the full signal.
      const headroom = this.gain > 1 ? 1 - Math.abs(sample) : 1;
      pcm[index] = sample * (1 + (this.gain - 1) * headroom);
    }
  }

  private measure() {
    const power = this.squareSum / MEASUREMENT_SAMPLES;
    this.samples = 0;
    this.squareSum = 0;
    if (power < MIN_SPEECH_POWER) {
      if (++this.silenceWindows === 8) {
        this.targetGain = 1;
        this.speechWindows = 0;
      }
      return;
    }
    this.silenceWindows = 0;
    // Smooth energy first so a trail of low-level syllables does not dominate the estimate.
    this.speechPower = this.speechWindows
      ? this.speechPower + (power - this.speechPower) * 0.12
      : power;
    if (++this.speechWindows < 4) return;
    const difference = TARGET_DB - 10 * Math.log10(this.speechPower);
    const correction = Math.sign(difference) * Math.max(0, Math.abs(difference) - DEAD_BAND_DB);
    const gainDb = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, correction));
    this.targetGain = 10 ** (gainDb / 20);
  }
}
