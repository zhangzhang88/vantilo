import { streamChineseListeningTts } from "./chinese-listening-tts";
import type { SpeechPcmChunk } from "./chinese-tts-stream";
import type { ChineseAudiobookVoice } from "../shared/qwen-tts-voices";

type Entry = {
  frames: SpeechPcmChunk[];
  samples: number;
  generationRtf: number | null;
  firstFrameMs: number | null;
  generationStartedAt: number;
  done: boolean;
  failed: boolean;
  controller: AbortController;
  readers: number;
  waiters: Set<() => void>;
  finished: Promise<void>;
};
const MAX_PREFETCHED_CHUNKS = 4;
const MAX_SAMPLES_PER_CHUNK = 24_000 * 45;
const RECOVERY_DELAY_MS = 250;

/** Bounded rolling cache of fully or partially synthesized audiobook chunks.
 * Lookahead may cross paragraph boundaries. No AudioContext is created, so
 * nothing plays until the user explicitly presses Play.
 */
export class ChineseListeningPrebuffer {
  private controller = new AbortController();
  private entries = new Map<string, Entry>();
  private retained = new Set<string>();
  constructor(
    private readonly synthesize: typeof streamChineseListeningTts = streamChineseListeningTts,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Retain the current and next audio chunks. A currently consumed entry
   * is leased until playback finishes reading it, even if lookahead moves. */
  retainWindow(chunks: ReadonlyArray<{ text: string; voice: ChineseAudiobookVoice }>): void {
    const keep = new Set(chunks.slice(0, MAX_PREFETCHED_CHUNKS).map(({ text, voice }) => JSON.stringify([voice, text])));
    this.retained = keep;
    for (const [key, entry] of this.entries) {
      if (!keep.has(key) && entry.readers === 0) this.evict(key, entry);
    }
  }

  private evict(key: string, entry: Entry) {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.controller.abort();
    entry.failed = true;
    entry.done = true;
    this.notify(entry);
  }

  isComplete(text: string, voice: ChineseAudiobookVoice): boolean {
    const entry = this.entries.get(JSON.stringify([voice, text]));
    return Boolean(entry?.done && !entry.failed);
  }

  /** Actual synthesis throughput, including model startup. Cached PCM can
   * arrive instantly at the player even when its generation was slow. */
  generationRtf(text: string, voice: ChineseAudiobookVoice): number | null {
    const entry = this.entries.get(JSON.stringify([voice, text]));
    return entry?.done && !entry.failed ? entry.generationRtf : null;
  }

  firstFrameMs(text: string, voice: ChineseAudiobookVoice): number | null {
    return this.entries.get(JSON.stringify([voice, text]))?.firstFrameMs ?? null;
  }

  prefetch(text: string, voice: ChineseAudiobookVoice): Promise<void> {
    if (this.controller.signal.aborted || !text.trim()) return Promise.resolve();
    const key = JSON.stringify([voice, text]);
    const existing = this.entries.get(key);
    if (existing) return existing.finished;
    if (this.entries.size >= MAX_PREFETCHED_CHUNKS) return Promise.resolve();

    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const controller = new AbortController();
    const generationStartedAt = this.now();
    const entry: Entry = { frames: [], samples: 0, generationRtf: null, firstFrameMs: null, generationStartedAt, done: false, failed: false, controller, readers: 0, waiters: new Set(), finished };
    this.entries.set(key, entry);
    const signal = controller.signal;
    void (async () => {
      try {
        for await (const frame of this.synthesize(text, signal, voice)) {
          if (signal.aborted) return;
          if (frame.sampleRate !== 24_000 || entry.samples + frame.samples.length > MAX_SAMPLES_PER_CHUNK) {
            throw new Error("预缓冲音频超出允许范围");
          }
          if (!frame.samples.length) continue;
          if (entry.firstFrameMs === null) entry.firstFrameMs = Math.max(0, this.now() - generationStartedAt);
          entry.frames.push({ sampleRate: frame.sampleRate, samples: frame.samples.slice() });
          entry.samples += frame.samples.length;
          this.notify(entry);
        }
      } catch { entry.failed = true; }
      finally {
        if (signal.aborted) entry.failed = true;
        if (!entry.frames.length) entry.failed = true;
        if (!entry.failed && entry.samples > 0) {
          entry.generationRtf = Math.min(8, Math.max(0,
            (this.now() - generationStartedAt) / 1000 / (entry.samples / 24_000)));
        }
        entry.done = true; this.notify(entry); finish();
      }
    })();
    return finished;
  }

  async *stream(text: string, signal: AbortSignal, voice: ChineseAudiobookVoice): AsyncGenerator<SpeechPcmChunk> {
    if (signal.aborted) return;
    const key = JSON.stringify([voice, text]);
    let entry = this.entries.get(key);
    if (!entry && this.entries.size < MAX_PREFETCHED_CHUNKS) {
      // A new paragraph can be requested before lookahead has reached it.
      // Bring it into the same complete-chunk path whenever space permits.
      void this.prefetch(text, voice);
      entry = this.entries.get(key);
    }
    if (entry) {
      entry.readers++;
      try {
        // Forward PCM frames as soon as Qwen emits them. Waiting for entry.done
        // withheld incremental audio until the entire utterance had rendered.
        let nextFrame = 0;
        while (!signal.aborted) {
          while (nextFrame < entry.frames.length) {
            yield entry.frames[nextFrame++];
            if (signal.aborted) return;
          }
          if (!entry.done) {
            await new Promise<void>(resolve => {
              const wake = () => { entry.waiters.delete(wake); signal.removeEventListener("abort", wake); resolve(); };
              entry.waiters.add(wake);
              signal.addEventListener("abort", wake, { once: true });
              if (nextFrame < entry.frames.length || entry.done || signal.aborted) wake();
            });
            continue;
          }
          if (!entry.failed) return;
          if (nextFrame > 0) throw new Error("本地语音生成中断，请重新朗读");
          break; // No audio escaped, so a clean retry cannot duplicate speech.
        }
      } finally {
        entry.readers--;
        if (entry.readers === 0 && (entry.failed || !this.retained.has(key))) this.evict(key, entry);
      }
    }
    if (signal.aborted) return;
    // Background synthesis may fail temporarily while another TTS model is
    // busy. Recover once without yielding half a sentence or requiring a
    // second click; only report an actionable error if both attempts fail.
    for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
      let emitted = 0;
      try {
        let samples = 0;
        for await (const frame of this.synthesize(text, signal, voice)) {
          if (signal.aborted) return;
          if (frame.sampleRate !== 24_000 || samples + frame.samples.length > MAX_SAMPLES_PER_CHUNK) {
            throw new Error("音频片段过长，无法完成播放准备");
          }
          if (!frame.samples.length) continue;
          samples += frame.samples.length;
          emitted++;
          yield { sampleRate: 24_000, samples: frame.samples.slice() };
        }
        if (!emitted) throw new Error("本地语音服务未返回音频");
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (emitted > 0) throw new Error("本地语音生成中断，请重新朗读", { cause: error });
        if (attempt === 1) throw new Error("本地朗读暂时不可用，请检查 TTS 服务后重试", { cause: error });
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, RECOVERY_DELAY_MS);
          signal.addEventListener("abort", finish, { once: true });
          if (signal.aborted) finish();
        });
      }
    }
  }

  reset(): void {
    this.controller.abort();
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      entry.failed = true;
      entry.done = true;
      this.notify(entry);
    }
    this.entries.clear();
    this.retained.clear();
    this.controller = new AbortController();
  }
  dispose(): void { this.reset(); this.controller.abort(); }
  private notify(entry: Entry) { for (const wake of [...entry.waiters]) wake(); }
}
