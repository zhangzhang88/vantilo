import { streamChineseTts } from "./chinese-tts-stream";
import { DEFAULT_QWEN_TTS_ENGLISH_VOICE } from "../shared/qwen-tts-voices";
import { isDictionaryWord } from "./word-lookup";

export type WordAccent = "us" | "uk";
export type WordAudioSource = "youdao" | "qwen";
export type WordAudioEvent = {
  text: string;
  accent: WordAccent;
  status: "loading" | "playing" | "failed";
  source?: WordAudioSource;
  latencyMs: number;
  message?: string;
};

export const WORD_AUDIO_EVENT = "magazine-reader:word-pronunciation";
export const STOP_WORD_AUDIO_EVENT = "magazine-reader:stop-word-audio";
export const WORD_FALLBACK_DELAY_MS = 400;
// The backup voice generates tiny PCM frames with variable arrival times.
// A short word must be assembled before playback: scheduling each arriving
// frame can insert silence whenever synthesis falls behind the audio clock.
const MAX_WORD_AUDIO_WAIT_MS = 6_500;
const MAX_UK_AUDIO_WAIT_MS = 4_000;
const QWEN_WORD_CLIP_TIMEOUT_MS = 5_500;
const QWEN_SAMPLE_RATE = 24_000;
const MAX_QWEN_WORD_SAMPLES = QWEN_SAMPLE_RATE * 12;
const MAX_QWEN_CACHED_SAMPLES = QWEN_SAMPLE_RATE * 120;
const MAX_QWEN_CACHED_WORDS = 64;

type AudioLike = Pick<HTMLAudioElement, "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener" | "preload" | "currentTime">;
type Active = {
  text: string;
  accent: WordAccent;
  startTime: number;
  audio: AudioLike;
  controller: AbortController;
  fallbackTimer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  qwenDeadline?: ReturnType<typeof setTimeout>;
  qwenStarted: boolean;
  qwenFailed: boolean;
  remoteFailed: boolean;
  source?: WordAudioSource;
  stopped: boolean;
  qwenSources: Set<AudioBufferSourceNode>;
  contextReady?: Promise<void>;
  onPlaying: EventListener;
  onError: EventListener;
};

export function wordAudioUrl(text: string, accent: WordAccent): string {
  if (!isDictionaryWord(text) || text.length > 80) throw new Error("不是可播放的英文单词");
  return `/api/word-audio?word=${encodeURIComponent(text.trim()).replaceAll("\u0027", "%27")}&accent=${accent}`;
}

/**
 * One active word at a time. Dictionary lookup is entirely independent.
 * Use Qwen only for US, because the installed Qwen voices do not establish
 * an equivalent British-English fallback. No macOS speechSynthesis calls.
 */
export class WordPronunciationPlayer {
  private active: Active | null = null;
  private context: AudioContext | null = null;
  // Repeated words can use the already synthesized, gap-free clip immediately.
  // Session-only and bounded: never write new user data or alter the Youdao cache.
  private readonly qwenClips = new Map<string, Int16Array>();
  private qwenCachedSamples = 0;

  constructor(private readonly deps: {
    audio?: (url: string) => AudioLike;
    audioContext?: () => AudioContext;
    tts?: typeof streamChineseTts;
    notify?: (event: WordAudioEvent) => void;
    clock?: () => number;
  } = {}) {}

  play(rawText: string, accent: WordAccent): void {
    this.stop();
    const text = rawText.trim();
    if (!isDictionaryWord(text) || text.length > 80) return;
    const audio = this.deps.audio?.(wordAudioUrl(text, accent)) ?? new Audio(wordAudioUrl(text, accent));
    const active: Active = {
      text, accent, audio, startTime: this.now(), controller: new AbortController(),
      qwenStarted: false, qwenFailed: accent === "uk", remoteFailed: false,
      stopped: false, qwenSources: new Set(),
      onPlaying: () => {}, onError: () => {},
    };
    this.active = active;
    audio.preload = "auto";
    active.onPlaying = () => this.won(active, "youdao");
    active.onError = () => {
      if (!this.isPending(active)) return;
      active.remoteFailed = true;
      this.beginQwen(active);
      this.maybeFail(active);
    };
    audio.addEventListener("playing", active.onPlaying);
    audio.addEventListener("error", active.onError);
    this.report(active, "loading");
    // A Qwen AudioContext must be unlocked by the original pointer gesture.
    // Reuse one context rather than recreating an expensive decoder on every word.
    if (accent === "us") {
      try {
        this.context ??= (this.deps.audioContext?.() ?? new AudioContext());
        active.contextReady = this.context.resume();
        void active.contextReady.catch(() => {});
      } catch { active.qwenFailed = true; }
    }
    this.stopOtherReadingAudio();
    if (!active.qwenFailed) {
      active.fallbackTimer = setTimeout(() => this.beginQwen(active), WORD_FALLBACK_DELAY_MS);
    }
    active.deadline = setTimeout(() => {
      if (!this.isPending(active)) return;
      active.remoteFailed = true;
      active.qwenFailed = true;
      this.maybeFail(active);
    }, accent === "uk" ? MAX_UK_AUDIO_WAIT_MS : MAX_WORD_AUDIO_WAIT_MS);
    try {
      // Do not await the dictionary, remote request or audio warmup here.
      void audio.play().then(() => this.won(active, "youdao")).catch(() => {
        if (!this.isPending(active)) return;
        active.remoteFailed = true;
        this.beginQwen(active);
        this.maybeFail(active);
      });
    } catch {
      active.remoteFailed = true;
      this.beginQwen(active);
      this.maybeFail(active);
    }
  }

  stop() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.stopped = true;
    this.clearTimers(active);
    active.controller.abort();
    this.stopRemote(active);
    this.stopQwen(active);
  }

  /** A playback source is selected once. Late bytes cannot trigger double audio. */
  private won(active: Active, source: WordAudioSource) {
    if (!this.isPending(active)) return;
    active.source = source;
    this.clearTimers(active);
    if (source === "youdao") {
      active.controller.abort();
      this.stopQwen(active);
    } else {
      this.stopRemote(active);
    }
    this.report(active, "playing", source);
  }

  private beginQwen(active: Active) {
    if (!this.isPending(active) || active.qwenStarted || active.qwenFailed) return;
    if (active.accent !== "us" || !this.context) {
      active.qwenFailed = true;
      this.maybeFail(active);
      return;
    }
    active.qwenStarted = true;
    const cached = this.getCachedQwenClip(active.text);
    if (cached) {
      void this.playQwenClip(active, cached).catch(() => {
        if (this.isPending(active)) { active.qwenFailed = true; this.maybeFail(active); }
      });
      return;
    }
    active.qwenDeadline = setTimeout(() => {
      if (this.isPending(active)) {
        active.qwenFailed = true;
        active.controller.abort();
        this.maybeFail(active);
      }
    }, QWEN_WORD_CLIP_TIMEOUT_MS);
    void this.streamQwen(active).catch(() => {
      if (this.isPending(active)) {
        active.qwenFailed = true;
        this.maybeFail(active);
      }
    });
  }

  private async streamQwen(active: Active) {
    const generator = (this.deps.tts ?? streamChineseTts)(
      active.text, active.controller.signal, "en-US", DEFAULT_QWEN_TTS_ENGLISH_VOICE,
    );
    const frames: Int16Array[] = [];
    let sampleCount = 0;
    for await (const frame of generator) {
      if (active.stopped || this.active !== active || active.controller.signal.aborted) break;
      if (active.source === "youdao") break;
      if (frame.samples.length < 1) continue;
      if (frame.sampleRate !== QWEN_SAMPLE_RATE || sampleCount + frame.samples.length > MAX_QWEN_WORD_SAMPLES) {
        throw new Error("本地 Qwen 单词音频长度或采样率不正确");
      }
      frames.push(frame.samples);
      sampleCount += frame.samples.length;
    }
    if (!this.isPending(active) || active.controller.signal.aborted) return;
    if (!sampleCount) throw new Error("本地 Qwen 没有返回单词音频");
    const clip = new Int16Array(sampleCount);
    let offset = 0;
    for (const frame of frames) { clip.set(frame, offset); offset += frame.length; }
    await this.playQwenClip(active, clip);
    if (active.source === "qwen") this.cacheQwenClip(active.text, clip);
  }

  private async playQwenClip(active: Active, clip: Int16Array): Promise<void> {
    // An AudioBufferSourceNode scheduled while suspended is not yet audible.
    if (this.context?.state !== "running") await active.contextReady;
    if (!this.isPending(active) || active.controller.signal.aborted) return;
    if (!this.schedulePcm(active, clip)) throw new Error("本地 Qwen 播放上下文暂不可用");
    this.won(active, "qwen");
  }

  private schedulePcm(active: Active, samples: Int16Array): boolean {
    const context = this.context;
    if (!context || context.state !== "running") return false;
    try {
      const buffer = context.createBuffer(1, samples.length, QWEN_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      active.qwenSources.add(source);
      source.onended = () => { active.qwenSources.delete(source); source.disconnect(); };
      source.start(context.currentTime + 0.02);
      return true;
    } catch { return false; }
  }

  private getCachedQwenClip(text: string): Int16Array | undefined {
    const key = text.toLocaleLowerCase("en-US");
    const clip = this.qwenClips.get(key);
    if (clip) { this.qwenClips.delete(key); this.qwenClips.set(key, clip); }
    return clip;
  }

  private cacheQwenClip(text: string, clip: Int16Array): void {
    if (clip.length > MAX_QWEN_CACHED_SAMPLES) return;
    const key = text.toLocaleLowerCase("en-US");
    const previous = this.qwenClips.get(key);
    if (previous) { this.qwenCachedSamples -= previous.length; this.qwenClips.delete(key); }
    this.qwenClips.set(key, clip);
    this.qwenCachedSamples += clip.length;
    while (this.qwenClips.size > MAX_QWEN_CACHED_WORDS || this.qwenCachedSamples > MAX_QWEN_CACHED_SAMPLES) {
      const oldest = this.qwenClips.keys().next().value;
      if (!oldest) break;
      this.qwenCachedSamples -= this.qwenClips.get(oldest)!.length;
      this.qwenClips.delete(oldest);
    }
  }

  private maybeFail(active: Active) {
    if (!this.isPending(active) || !active.remoteFailed || !active.qwenFailed) return;
    this.report(active, "failed", undefined,
      active.accent === "uk"
        ? "英式有道发音暂不可用，请重试。未使用不匹配的美式 AI 音色。"
        : "发音暂不可用，请检查有道网络与 Qwen3-TTS 服务后重试。");
    this.stop();
  }

  private isPending(active: Active) {
    return this.active === active && !active.stopped && !active.source;
  }

  private stopRemote(active: Active) {
    active.audio.removeEventListener("playing", active.onPlaying);
    active.audio.removeEventListener("error", active.onError);
    try {
      active.audio.pause();
      active.audio.removeAttribute("src");
      active.audio.load();
    } catch { /* The session is already canceled. */ }
  }

  private stopQwen(active: Active) {
    for (const source of active.qwenSources) {
      try { source.onended = null; source.stop(); source.disconnect(); } catch { /* Already ended. */ }
    }
    active.qwenSources.clear();
  }

  private clearTimers(active: Active) {
    if (active.fallbackTimer) clearTimeout(active.fallbackTimer);
    if (active.deadline) clearTimeout(active.deadline);
    if (active.qwenDeadline) clearTimeout(active.qwenDeadline);
  }

  private now() { return this.deps.clock?.() ?? performance.now(); }
  private report(active: Active, status: WordAudioEvent["status"], source?: WordAudioSource, message?: string) {
    const event: WordAudioEvent = { text: active.text, accent: active.accent, status,
      ...(source ? { source } : {}), latencyMs: Math.round(this.now() - active.startTime),
      ...(message ? { message } : {}) };
    if (this.deps.notify) this.deps.notify(event);
    else window.dispatchEvent(new CustomEvent<WordAudioEvent>(WORD_AUDIO_EVENT, { detail: event }));
  }
  private stopOtherReadingAudio() {
    for (const name of ["magazine-reader:stop-reply-audio",
      "magazine-reader:stop-english-sentence-audio",
      "magazine-reader:stop-selection-speech",
      "magazine-reader:pause-chinese-audio"]) {
      window.dispatchEvent(new Event(name));
    }
  }
}

let singleton: WordPronunciationPlayer | null = null;
export function getWordPronunciationPlayer(): WordPronunciationPlayer {
  if (!singleton) {
    singleton = new WordPronunciationPlayer();
    window.addEventListener(STOP_WORD_AUDIO_EVENT, () => singleton?.stop());
    window.addEventListener("pagehide", () => singleton?.stop());
  }
  return singleton;
}

export function playWordPronunciation(text: string, accent: WordAccent) {
  getWordPronunciationPlayer().play(text, accent);
}
