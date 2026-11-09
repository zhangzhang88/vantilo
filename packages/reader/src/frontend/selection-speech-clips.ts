import { streamChineseTts, type SpeechPcmChunk } from "./chinese-tts-stream";
import type { EnglishQwenTtsVoice } from "../shared/qwen-tts-voices";
import { qwenTtsSeed } from "../shared/qwen-tts-seed";

const SAMPLE_RATE = 24_000;
const MAX_CLIP_SAMPLES = SAMPLE_RATE * 16;
const MAX_STREAM_CLIP_SAMPLES = SAMPLE_RATE * 45;
const MAX_CACHE_SAMPLES = SAMPLE_RATE * 90;
const MAX_CACHE_ENTRIES = 24;
const CACHE_FORMAT = "qwen3-tts-0.6b-customvoice:pcm24k:seed-v1";

/** A stable per-text/voice seed for speech.cpp's supported Qwen3-TTS seed option.
 * This reduces sampling variation; it cannot guarantee a hallucination-free clip.
 */
export function selectionSpeechSeed(text: string, voice: EnglishQwenTtsVoice): number {
  return qwenTtsSeed(text, voice);
}

/** Short English selections generate completely before playback, so late PCM
 * frames can never insert silence. Complete clips are kept only in bounded RAM.
 */
export class SelectionSpeechClipCache {
  private readonly clips = new Map<string, Int16Array>();
  private cachedSamples = 0;
  private retryNonce = 0;

  constructor(private readonly generate: typeof streamChineseTts = streamChineseTts) {}

  /** A changed TTS provider/config must not play clips from the old model. */
  clear(): void {
    this.clips.clear();
    this.cachedSamples = 0;
    this.retryNonce = 0;
  }

  async *synthesize(text: string, voice: EnglishQwenTtsVoice, signal: AbortSignal, regenerate = false): AsyncGenerator<SpeechPcmChunk> {
    yield* this.generateClip(text, voice, signal, regenerate, true, MAX_CLIP_SAMPLES);
  }

  /** Keep the first reading responsive, while saving completed PCM for instant replays. */
  async *stream(text: string, voice: EnglishQwenTtsVoice, signal: AbortSignal, regenerate = false): AsyncGenerator<SpeechPcmChunk> {
    yield* this.generateClip(text, voice, signal, regenerate, false, MAX_STREAM_CLIP_SAMPLES);
  }

  private async *generateClip(
    text: string, voice: EnglishQwenTtsVoice, signal: AbortSignal, regenerate: boolean,
    waitForComplete: boolean, maxSamples: number,
  ): AsyncGenerator<SpeechPcmChunk> {
    if (signal.aborted) return;
    const key = JSON.stringify([CACHE_FORMAT, "en-US", voice, text]);
    const hit = this.clips.get(key);
    if (hit && !regenerate) {
      this.clips.delete(key);
      this.clips.set(key, hit);
      if (!signal.aborted) yield { sampleRate: SAMPLE_RATE, samples: hit };
      return;
    }

    const chunks: Int16Array[] = [];
    let length = 0;
    let cacheable = true;
    // The transport validates the final "end: complete" marker; never cache
    // aborted streams, partial network responses or failed model generations.
    const seed = regenerate
      ? selectionSpeechSeed(`${text}\0retry:${++this.retryNonce}`, voice)
      : selectionSpeechSeed(text, voice);
    for await (const frame of this.generate(text, signal, "en-US", voice, seed)) {
      if (signal.aborted) return;
      if (frame.sampleRate !== SAMPLE_RATE) {
        throw new Error("Qwen 英文短语音频长度或采样率异常");
      }
      if (frame.samples.length) {
        if (length + frame.samples.length > maxSamples) {
          if (waitForComplete) throw new Error("Qwen 英文短语音频长度或采样率异常");
          // Long-sentence playback should keep streaming, even when the clip
          // is too big for the short-lived cache. Do not retain extra PCM.
          cacheable = false;
          chunks.length = 0;
        }
        if (cacheable) chunks.push(frame.samples.slice());
        length += frame.samples.length;
        if (!waitForComplete) yield frame;
      }
    }
    if (signal.aborted) return;
    if (!length) throw new Error("Qwen 未返回完整的短语音频");
    if (!cacheable) return;

    const joined = new Int16Array(length);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const replaced = this.clips.get(key);
    if (replaced) this.cachedSamples -= replaced.length;
    this.clips.delete(key);
    this.clips.set(key, joined);
    this.cachedSamples += length;
    while (this.clips.size > MAX_CACHE_ENTRIES || this.cachedSamples > MAX_CACHE_SAMPLES) {
      const oldest = this.clips.keys().next().value;
      if (oldest === undefined) break;
      this.cachedSamples -= this.clips.get(oldest)!.length;
      this.clips.delete(oldest);
    }
    if (waitForComplete && !signal.aborted) yield { sampleRate: SAMPLE_RATE, samples: joined };
  }
}

/** Shared by selected-text and sentence playback so a generated phrase has one cache identity. */
let sharedEnglishCache: SelectionSpeechClipCache | undefined;
export function getEnglishSpeechClipCache(): SelectionSpeechClipCache {
  if (!sharedEnglishCache) {
    sharedEnglishCache = new SelectionSpeechClipCache();
    if (typeof window !== "undefined") {
      window.addEventListener("magazine-reader:tts-profile-updated", () => sharedEnglishCache?.clear());
    }
  }
  return sharedEnglishCache;
}
