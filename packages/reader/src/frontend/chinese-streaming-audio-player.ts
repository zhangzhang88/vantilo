import { resolveSpeechChunk, splitChineseSpeech } from "./chinese-listening-state";
import type { SpeechCursor, SpeechPhase } from "./chinese-audio-types";
import type { SpeechPcmChunk } from "./chinese-tts-stream";
import { SpeechLoudness } from "./speech-loudness";
import { PcmPitchPreservingStretch } from "./pcm-pitch-preserving-stretch";

type TimedCursor = { cursor: SpeechCursor; seconds: number };
type ChunkDuration = TimedCursor & { complete: boolean; lastInParagraph: boolean };
type AudioTimeline = TimedCursor & { start: number; end: number; rate: number };

// Judge readiness using actual buffered PCM and recent delivery speed, rather
// than imposing a fixed 8-second audio quota or mandatory loading timer.
const MIN_STARTUP_SECONDS = 3;
const MAX_STARTUP_SECONDS = 10;
const UNOBSERVED_STARTUP_SECONDS = 6;
const NEAR_EMPTY_SECONDS = 0.25;
const MIN_RECOVERY_SECONDS = 6;
const MAX_SCHEDULED_SECONDS = 14;

export function adaptivePlaybackTarget(rtf: number | null, recentGapSeconds = 0): number {
  if (rtf === null) return UNOBSERVED_STARTUP_SECONDS;
  const target = MIN_STARTUP_SECONDS + Math.max(0, rtf - 0.45) * 5
    + Math.min(2, Math.max(0, recentGapSeconds) * 0.6);
  return Math.max(MIN_STARTUP_SECONDS, Math.min(MAX_STARTUP_SECONDS, target));
}

export function firstPlaybackTarget(rtf: number | null, recentGapSeconds: number, afterStall: boolean): number {
  const target = adaptivePlaybackTarget(rtf, recentGapSeconds);
  if (afterStall || (rtf !== null && rtf >= 0.85) || recentGapSeconds >= 1.25) {
    return Math.max(MIN_RECOVERY_SECONDS, target);
  }
  return Math.max(2, target / 2);
}

export type ChineseAudioDiagnosticEvent = {
  event: "start" | "first_pcm" | "chunk_ready" | "startup_ready" | "low_buffer" | "buffer_recovered" | "complete" | "error";
  paragraphIndex: number;
  chunkIndex: number;
  elapsedMs: number;
  availableSeconds?: number;
  targetSeconds?: number;
  completedChunks?: number;
  generationMs?: number;
  rtf?: number;
};

export interface PcmAudioSink {
  append(frame: SpeechPcmChunk, cursor: SpeechCursor, offsetSeconds: number, resumeSeconds: number): void;
  position(): TimedCursor | null;
  bufferedSeconds(): number;
  finish(): Promise<void>;
  pause(): void;
  resume(): void;
  setRate(rate: number): void;
  stop(): void;
}

/** Schedules short PCM buffers on one AudioContext, with no MP3 encoding or whole-utterance wait. */
const GAIN_RAMP_SECONDS = 0.012;
const PAUSE_FADE_DELAY_MS = 15;
const AUDIO_STALL_RECOVERY_MS = 2500;
const UNDERRUN_FADE_SAMPLES = 96; // 4 ms at 24 kHz

export class WebAudioPcmSink implements PcmAudioSink {
  private context = new AudioContext();
  private outputGain?: GainNode;
  private nextStart = this.context.currentTime + 0.04;
  private sources = new Set<AudioBufferSourceNode>();
  private timeline: AudioTimeline[] = [];
  private completed = false;
  private finishResolver?: () => void;
  private timer: ReturnType<typeof setInterval>;
  private rate = 1;
  private stopped = false;
  private desiredRunning = true;
  private stateSyncRunning = false;
  private lastObservedAudioTime = this.context.currentTime;
  private lastAudioAdvanceWallMs = performance.now();
  private stallKickInFlight = false;
  private stretch: PcmPitchPreservingStretch | null = null;
  private stretchCursor?: SpeechCursor;
  private segmentRate = 1;
  private progressSeconds = 0;
  private loudness?: SpeechLoudness;
  constructor(private onPosition: (position: TimedCursor) => void, balanceLoudness = false) {
    if (balanceLoudness) this.loudness = new SpeechLoudness();
    if (typeof this.context.createGain === "function") {
      this.outputGain = this.context.createGain();
      this.outputGain.gain.value = 1;
      this.outputGain.connect(this.context.destination);
    }
    this.context.onstatechange = () => {
      if (!this.stopped && this.desiredRunning && typeof this.context.state === "string" && this.context.state !== "running") {
        this.syncAudioState();
      }
    };
    // Constructed synchronously from the click handler so browser audio activation is permitted.
    this.syncAudioState();
    this.timer = setInterval(() => {
      if (this.stopped) return;
      this.ensureAudioRunning();
      const current = this.position();
      if (current) this.onPosition(current);
    }, 75);
  }

  private rampGain(target: number) {
    if (!this.outputGain) return;
    const gain = this.outputGain.gain;
    const now = this.context.currentTime;
    if (typeof gain.cancelScheduledValues === "function" && typeof gain.linearRampToValueAtTime === "function") {
      try {
        gain.cancelScheduledValues(now);
        if (typeof gain.setValueAtTime === "function") gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(target, now + GAIN_RAMP_SECONDS);
        return;
      } catch { /* Fall through to direct assignment on minimal mocks. */ }
    }
    gain.value = target;
  }

  private syncAudioState() {
    if (this.stopped || this.stateSyncRunning) return;
    this.stateSyncRunning = true;
    void (async () => {
      try {
        let attempts = 0;
        while (!this.stopped && attempts < 4) {
          attempts++;
          const wantRunning = this.desiredRunning;
          const state = typeof this.context.state === "string" ? this.context.state : undefined;
          if (wantRunning) {
            if (state === "running") {
              this.rampGain(1);
              break;
            }
            if (this.outputGain && state === "suspended") {
              try { this.outputGain.gain.value = 0; } catch { /* ignore */ }
            }
            try { await this.context.resume(); } catch { break; }
            if (this.stopped) break;
            if (this.desiredRunning) {
              this.lastObservedAudioTime = this.context.currentTime;
              this.lastAudioAdvanceWallMs = performance.now();
              this.rampGain(1);
            }
            if (typeof this.context.state !== "string" || this.context.state === "running") {
              if (this.desiredRunning) break;
            } else {
              break;
            }
          } else {
            if (state === "suspended") break;
            if (this.outputGain && state === "running") {
              this.rampGain(0);
              await new Promise(resolve => setTimeout(resolve, PAUSE_FADE_DELAY_MS));
              if (this.stopped || this.desiredRunning) continue;
            }
            try { await this.context.suspend(); } catch { break; }
            if (this.stopped) break;
            if (!this.desiredRunning && (typeof this.context.state !== "string" || this.context.state === "suspended")) {
              break;
            }
          }
        }
      } finally {
        this.stateSyncRunning = false;
      }
    })();
  }

  private ensureAudioRunning() {
    if (this.stopped || !this.desiredRunning) return;
    const state = typeof this.context.state === "string" ? this.context.state : undefined;
    if (state && state !== "running") {
      this.syncAudioState();
      return;
    }
    if (!this.sources.size || this.nextStart <= this.context.currentTime) {
      this.lastObservedAudioTime = this.context.currentTime;
      this.lastAudioAdvanceWallMs = performance.now();
      return;
    }
    const audioNow = this.context.currentTime;
    const wallNow = performance.now();
    if (audioNow > this.lastObservedAudioTime + 1e-4) {
      this.lastObservedAudioTime = audioNow;
      this.lastAudioAdvanceWallMs = wallNow;
      return;
    }
    // Recover from a stalled Chromium/CoreAudio output clock where state claims
    // "running" while currentTime stops advancing with active sources queued.
    if (!this.stallKickInFlight && !this.stateSyncRunning && wallNow - this.lastAudioAdvanceWallMs >= AUDIO_STALL_RECOVERY_MS) {
      this.stallKickInFlight = true;
      this.lastAudioAdvanceWallMs = wallNow;
      void (async () => {
        try {
          if (this.stopped || !this.desiredRunning) return;
          try { await this.context.suspend(); } catch { /* ignore */ }
          if (this.stopped || !this.desiredRunning) return;
          try { await this.context.resume(); } catch { /* ignore */ }
          if (!this.stopped && this.desiredRunning) {
            this.lastObservedAudioTime = this.context.currentTime;
            this.lastAudioAdvanceWallMs = performance.now();
            this.rampGain(1);
          }
        } finally {
          this.stallKickInFlight = false;
        }
      })();
    }
  }

  append(frame: SpeechPcmChunk, cursor: SpeechCursor, offsetSeconds: number, resumeSeconds: number) {
    if (this.stopped) return;
    if (frame.sampleRate !== 24000) throw new Error("不支持的本地音频采样率");
    const skipSamples = Math.max(0, Math.min(frame.samples.length, Math.ceil((resumeSeconds - offsetSeconds) * frame.sampleRate)));
    const count = frame.samples.length - skipSamples;
    if (!count) return;
    // Speeding up an AudioBufferSourceNode also raises vocal pitch. Stretch
    // the PCM time axis separately so voices retain their natural pitch.
    if (this.stretchCursor !== cursor) this.loudness?.beginChunk();
    if (this.stretchCursor && (this.stretchCursor !== cursor || this.segmentRate !== this.rate)) {
      this.flushStretch();
      this.stretchCursor = undefined;
    }
    if (!this.stretchCursor) {
      this.stretchCursor = cursor;
      this.segmentRate = this.rate;
      this.progressSeconds = offsetSeconds + skipSamples / frame.sampleRate;
      this.stretch = this.rate === 1 ? null : new PcmPitchPreservingStretch(this.rate, frame.sampleRate);
    }
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) samples[i] = frame.samples[i + skipSamples] / 32768;
    this.loudness?.apply(samples);
    this.schedule(this.stretch ? this.stretch.push(samples) : samples, cursor);
  }

  private schedule(samples: Float32Array, cursor: SpeechCursor) {
    if (this.stopped || !samples.length) return;
    const now = this.context.currentTime;
    const hadGap = this.timeline.length > 0 && this.nextStart < now;
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    const channelData = buffer.getChannelData(0);
    channelData.set(samples);
    if (hadGap) {
      const fadeSamples = Math.min(UNDERRUN_FADE_SAMPLES, channelData.length);
      for (let i = 0; i < fadeSamples; i++) channelData[i] *= i / fadeSamples;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = 1;
    source.connect(this.outputGain ?? this.context.destination);
    const start = this.nextStart >= now ? this.nextStart : now + 0.02;
    const seconds = this.progressSeconds;
    const end = start + buffer.duration;
    this.timeline.push({ cursor, seconds, start, end, rate: this.segmentRate });
    this.progressSeconds += buffer.duration * this.segmentRate;
    // Bound retained position metadata: old chunks aren't needed once playback moves on.
    if (this.timeline.length > 200) this.timeline.splice(0, 100);
    this.nextStart = end;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (this.completed && !this.sources.size) this.finishResolver?.();
    };
    source.start(start);
    if (this.desiredRunning) this.ensureAudioRunning();
  }

  private flushStretch() {
    if (this.stretch && this.stretchCursor) this.schedule(this.stretch.finish(), this.stretchCursor);
    this.stretch = null;
  }

  position(): TimedCursor | null {
    const now = this.context.currentTime;
    let selected: AudioTimeline | undefined;
    for (const entry of this.timeline) {
      if (entry.start <= now) selected = entry;
      else break;
    }
    if (!selected) return null;
    return { cursor: selected.cursor, seconds: selected.seconds + Math.min(Math.max(now - selected.start, 0), selected.end - selected.start) * selected.rate };
  }
  bufferedSeconds(): number { return Math.max(0, this.nextStart - this.context.currentTime); }
  finish(): Promise<void> {
    this.flushStretch();
    this.completed = true;
    if (this.desiredRunning) this.ensureAudioRunning();
    if (this.stopped || !this.sources.size) return Promise.resolve();
    return new Promise(resolve => { this.finishResolver = resolve; });
  }
  pause() {
    if (this.stopped) return;
    this.desiredRunning = false;
    this.syncAudioState();
  }
  resume() {
    if (this.stopped) return;
    this.desiredRunning = true;
    this.lastObservedAudioTime = this.context.currentTime;
    this.lastAudioAdvanceWallMs = performance.now();
    this.syncAudioState();
  }
  setRate(rate: number) {
    // Keep already scheduled sources at their original rate so their start/end
    // positions stay sample-accurate; the new rate applies to subsequent frames.
    this.rate = rate;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.desiredRunning = false;
    this.stretch = null;
    this.stretchCursor = undefined;
    clearInterval(this.timer);
    this.context.onstatechange = null;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear();
    try { this.outputGain?.disconnect(); } catch { /* Already disconnected. */ }
    this.outputGain = undefined;
    this.finishResolver?.(); this.finishResolver = undefined;
    void this.context.close().catch(() => {});
  }
}

interface PlayerDependencies {
  indices: number[];
  getText: (index: number) => Promise<string>;
  synthesize: (text: string, signal: AbortSignal) => AsyncIterable<SpeechPcmChunk>;
  transformText?: (text: string) => string;
  splitText?: (text: string) => string[];
  balanceLoudness?: boolean;
  phase: (phase: SpeechPhase, error?: string) => void;
  position: (cursor: SpeechCursor, seconds: number, completed: boolean, durationSeconds?: number) => void;
  sink?: (position: (value: TimedCursor) => void) => PcmAudioSink;
  /** Exposes real playable audio seconds for the UI's loading indicator. */
  bufferProgress?: (availableSeconds: number, targetSeconds: number) => void;
  /** Test doubles opt in explicitly; the actual WebAudio sink is supervised. */
  monitorTestSink?: boolean;
  /** Monotonic clock injection for deterministic TTS throughput regression tests. */
  now?: () => number;
  /** TTS synthesis RTF from prebuffer generation, not cached PCM delivery. */
  generationRtf?: (text: string) => number | null;
  generationFirstFrameMs?: (text: string) => number | null;
  /** Numeric, text-free diagnostics; speech content and API keys are excluded. */
  diagnostic?: (item: ChineseAudioDiagnosticEvent) => void;
}

export class ChineseStreamingAudioPlayer {
  private controller?: AbortController;
  private sink?: PcmAudioSink;
  private paused = false;
  private wake?: () => void;
  private rate = 1;
  private latest?: TimedCursor;
  private bufferingFirstPlayback = false;
  private readonly durations = new Map<string, ChunkDuration>();
  private rebuffering = false;
  private hasRebuffered = false;
  private generationFinished = false;
  private monitorTimer?: ReturnType<typeof setInterval>;

  constructor(private dependencies: PlayerDependencies) {}
  setRate(rate: number) { this.rate = rate; this.sink?.setRate(rate); }
  clearSeekHistory() { this.durations.clear(); this.hasRebuffered = false; }

  currentCursor(): SpeechCursor | undefined {
    return (this.sink?.position() ?? this.latest)?.cursor;
  }

  seekCursor(fallback: SpeechCursor, deltaSeconds: number): SpeechCursor {
    const current = this.sink?.position() ?? this.latest ?? { cursor: fallback, seconds: fallback.seconds ?? 0 };
    const order = (a: SpeechCursor, b: SpeechCursor) =>
      a.paragraphIndex - b.paragraphIndex || a.chunkIndex - b.chunkIndex;
    const chunks = [...this.durations.values()].sort((a, b) => order(a.cursor, b.cursor));
    let index = chunks.findIndex(chunk => order(chunk.cursor, current.cursor) === 0);
    let seconds = current.seconds + deltaSeconds;
    if (index < 0) return { ...current.cursor, seconds: Math.min(current.seconds, Math.max(0, seconds)) };

    while (seconds < 0 && index > 0) {
      const previous = chunks[index - 1];
      const currentChunk = chunks[index].cursor;
      if (!previous.complete || !this.adjacentChunks(previous, currentChunk)) break;
      seconds += previous.seconds;
      index--;
    }
    while (seconds >= chunks[index].seconds && chunks[index].complete && index < chunks.length - 1) {
      if (!this.adjacentChunks(chunks[index], chunks[index + 1].cursor)) break;
      seconds -= chunks[index].seconds;
      index++;
    }
    const target = chunks[index];
    const max = Math.max(0, target.seconds - 0.05);
    return { ...target.cursor, seconds: Math.max(0, Math.min(seconds, max)) };
  }

  private adjacentChunks(previous: ChunkDuration, next: SpeechCursor) {
    if (previous.cursor.paragraphIndex === next.paragraphIndex) return next.chunkIndex === previous.cursor.chunkIndex + 1;
    const index = this.dependencies.indices.indexOf(previous.cursor.paragraphIndex);
    return previous.lastInParagraph && next.chunkIndex === 0 && this.dependencies.indices[index + 1] === next.paragraphIndex;
  }

  pause() {
    if (!this.controller) return;
    this.paused = true; this.sink?.pause();
    const position = this.sink?.position() ?? this.latest;
    if (position) {
      const info = this.durations.get(`${position.cursor.paragraphIndex}:${position.cursor.chunkIndex}`);
      this.dependencies.position(position.cursor, position.seconds, false, info?.complete && info.seconds > 0 ? info.seconds : undefined);
    }
    this.dependencies.phase("paused");
  }
  resume() {
    if (!this.controller) return;
    this.paused = false;
    if (!this.bufferingFirstPlayback && !this.rebuffering) this.sink?.resume();
    this.wake?.(); this.wake = undefined;
    this.dependencies.phase(this.bufferingFirstPlayback || this.rebuffering ? "loading" : "playing");
  }
  stop() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
    const position = this.sink?.position() ?? this.latest;
    if (position) this.dependencies.position(position.cursor, position.seconds, false);
    this.controller?.abort(); this.controller = undefined;
    this.wake?.(); this.wake = undefined;
    this.sink?.stop(); this.sink = undefined;
    this.paused = false; this.latest = undefined;
    this.bufferingFirstPlayback = false;
    this.rebuffering = false;
    this.generationFinished = false;
  }
  async start(cursor: SpeechCursor) {
    this.stop();
    const controller = new AbortController(); this.controller = controller;
    const signal = controller.signal, valid = () => !signal.aborted;
    const publish = (value: TimedCursor) => {
      if (!valid()) return;
      this.latest = value;
      const info = this.durations.get(`${value.cursor.paragraphIndex}:${value.cursor.chunkIndex}`);
      const durationSeconds = info?.complete && info.seconds > 0 ? info.seconds : undefined;
      this.dependencies.position(value.cursor, value.seconds, false, durationSeconds);
    };
    this.dependencies.phase("loading");
    const clock = () => this.dependencies.now?.() ?? performance.now();
    const startedAt = clock();
    const diagnostic = (event: ChineseAudioDiagnosticEvent["event"], at: SpeechCursor,
      details: Partial<Omit<ChineseAudioDiagnosticEvent, "event" | "paragraphIndex" | "chunkIndex" | "elapsedMs">> = {}) => {
      this.dependencies.diagnostic?.({
        event, paragraphIndex: at.paragraphIndex, chunkIndex: at.chunkIndex,
        elapsedMs: Math.max(0, Math.round(clock() - startedAt)), ...details,
      });
    };
    diagnostic("start", cursor);
    // A new seek/voice is a new stream; verify readiness again. Ordinary
    // pause/resume on this stream does not restart its buffer gate.
    this.bufferingFirstPlayback = true;
    this.dependencies.bufferProgress?.(0, firstPlaybackTarget(null, 0, this.hasRebuffered));
    try {
      const sink = (this.dependencies.sink ?? (callback => new WebAudioPcmSink(callback, this.dependencies.balanceLoudness)))(publish);
      this.sink = sink; sink.setRate(this.rate);
      let current: SpeechCursor | null = cursor, firstAudio = true;
      let firstPcmReported = false;
      const startupFrames: Array<{ frame: SpeechPcmChunk; cursor: SpeechCursor; offset: number; resume: number }> = [];
      let startupAudioSeconds = 0;
      let completedStartupChunks = 0;
      let streamRtf: number | null = null;
      let actualGenerationRtf: number | null = null;
      let recentGapSeconds = 0;
      let lastFrameAt: number | null = null;
      const now = clock;
      const currentRtf = () => actualGenerationRtf ?? streamRtf;
      const startupTarget = () => firstPlaybackTarget(currentRtf(), recentGapSeconds, this.hasRebuffered);
      const recoveryTarget = () => Math.max(MIN_RECOVERY_SECONDS, adaptivePlaybackTarget(currentRtf(), recentGapSeconds));
      const reportStartup = () => this.dependencies.bufferProgress?.(startupAudioSeconds / this.rate, startupTarget());
      const supervise = !this.dependencies.sink || this.dependencies.monitorTestSink === true;
      const checkBuffer = () => {
        if (!valid() || !supervise || this.paused || this.bufferingFirstPlayback || firstAudio) return;
        const ahead = sink.bufferedSeconds();
        if (!this.rebuffering && !this.generationFinished && ahead < NEAR_EMPTY_SECONDS) {
          this.rebuffering = true;
          this.hasRebuffered = true;
          sink.pause();
          this.dependencies.bufferProgress?.(ahead, recoveryTarget());
          this.dependencies.phase("loading");
          diagnostic("low_buffer", current ?? cursor, { availableSeconds: ahead, targetSeconds: recoveryTarget(), rtf: currentRtf() ?? undefined });
        } else if (this.rebuffering) {
          const target = recoveryTarget();
          this.dependencies.bufferProgress?.(ahead, target);
          if (ahead >= target || this.generationFinished) {
            this.rebuffering = false;
            sink.resume();
            this.dependencies.phase("playing");
            diagnostic("buffer_recovered", current ?? cursor, { availableSeconds: ahead, targetSeconds: target, rtf: streamRtf ?? undefined });
          }
        }
      };
      const append = (frame: SpeechPcmChunk, at: SpeechCursor, offset: number, resume: number) => {
        sink.append(frame, at, offset, resume);
        if (firstAudio && offset + frame.samples.length / frame.sampleRate > resume) {
          firstAudio = false;
          if (!this.paused) this.dependencies.phase("playing");
          if (supervise) this.monitorTimer = setInterval(checkBuffer, 80);
        }
        if (this.rebuffering) checkBuffer();
      };
      const releaseStartup = async () => {
        if (!this.bufferingFirstPlayback) return;
        if (!valid()) return;
        if (this.paused) await new Promise<void>(resolve => { this.wake = resolve; });
        if (!valid()) return;
        diagnostic("startup_ready", current ?? cursor, {
          availableSeconds: startupAudioSeconds / this.rate, targetSeconds: startupTarget(),
          completedChunks: completedStartupChunks, rtf: streamRtf ?? undefined,
        });
        // No fixed minimum loading time. A sufficient reserve or a completed
        // audiobook range is ready as soon as the PCM is actually available.
        this.bufferingFirstPlayback = false;
        // Resume a user-paused AudioContext before releasing the first PCM.
        // No source has been scheduled yet, so this cannot play prematurely.
        sink.resume();
        for (const item of startupFrames) append(item.frame, item.cursor, item.offset, item.resume);
        startupFrames.length = 0;
      };
      while (current && valid()) {
        if (this.paused) await new Promise<void>(resolve => { this.wake = resolve; });
        if (!valid()) break;
        const rawParagraph = await this.dependencies.getText(current.paragraphIndex);
        if (!valid()) break;
        const speechParagraph = this.dependencies.transformText ? this.dependencies.transformText(rawParagraph) : rawParagraph;
        const chunks = (this.dependencies.splitText ?? splitChineseSpeech)(speechParagraph);
        if (!valid()) break;
        if (!chunks.length) {
          const nextIndex: number = this.dependencies.indices.indexOf(current.paragraphIndex) + 1;
          if (this.dependencies.transformText && nextIndex > 0 && nextIndex < this.dependencies.indices.length) {
            current = { paragraphIndex: this.dependencies.indices[nextIndex], chunkIndex: 0 };
            continue;
          }
          if (this.dependencies.transformText && !this.bufferingFirstPlayback) {
            current = null;
            break;
          }
          throw new Error("这一段没有可朗读的中文");
        }
        const { chunkIndex: resolvedChunkIndex, seconds: resumeSeconds } = resolveSpeechChunk(chunks, current);
        let chunkIndex = resolvedChunkIndex;
        let rawChunk = chunks[chunkIndex];
        let rawOffset = current.speechOffset ?? 0;
        const targetText = current.chunkText
          ? (this.dependencies.transformText ? this.dependencies.transformText(current.chunkText) : current.chunkText).trim()
          : "";
        if (targetText && (rawOffset <= 0 || rawOffset >= rawChunk.length || !rawChunk.slice(rawOffset).trimStart().startsWith(targetText.slice(0, Math.min(8, targetText.length))))) {
          const matchedInChunk = rawChunk.indexOf(targetText);
          if (matchedInChunk >= 0) {
            rawOffset = matchedInChunk;
          } else {
            for (let idx = 0; idx < chunks.length; idx++) {
              const pos = chunks[idx].indexOf(targetText);
              if (pos >= 0) {
                chunkIndex = idx;
                rawChunk = chunks[idx];
                rawOffset = pos;
                break;
              }
            }
          }
        }
        const hasValidSlice = rawOffset > 0 && rawOffset < rawChunk.length && rawChunk.slice(rawOffset).trim().length > 0;
        const spokenText = hasValidSlice ? rawChunk.slice(rawOffset) : rawChunk;
        const selected: SpeechCursor = {
          paragraphIndex: current.paragraphIndex,
          chunkIndex,
          chunkText: spokenText,
          ...(hasValidSlice ? { speechOffset: rawOffset } : {}),
        };
        const durationKey = `${selected.paragraphIndex}:${selected.chunkIndex}`;
        const existingDuration = this.durations.get(durationKey);
        const duration = existingDuration && existingDuration.cursor.chunkText === spokenText
          ? existingDuration
          : { cursor: selected, seconds: 0, complete: false, lastInParagraph: chunkIndex === chunks.length - 1 };
        this.durations.set(durationKey, duration);
        let offsetSeconds = 0, hasAudio = false;
        // Tiny PCM frames can be generated slower than real-time during a
        // cold model start. Queue a small amount before scheduling the first
        // audible samples of a chunk to prevent immediate underflow.
        const initialFrames: Array<{ frame: SpeechPcmChunk; offset: number }> = [];
        let initialDuration = 0;
        const pushFrame = (frame: SpeechPcmChunk, offset: number) => {
          append(frame, selected, offset, resumeSeconds);
          if (!hasAudio && offset + frame.samples.length / frame.sampleRate > resumeSeconds) {
            hasAudio = true;
          }
        };
        const flushInitial = () => {
          for (const frame of initialFrames) pushFrame(frame.frame, frame.offset);
          initialFrames.length = 0;
        };
        const chunkRequestStartedAt = now();
        for await (const frame of this.dependencies.synthesize(spokenText, signal)) {
          if (!valid()) break;
          if (frame.sampleRate !== 24000 || !frame.samples.length) throw new Error("TTS 音频块无效");
          if (!firstPcmReported) {
            firstPcmReported = true;
            diagnostic("first_pcm", selected, {
              generationMs: this.dependencies.generationFirstFrameMs?.(spokenText)
                ?? Math.max(0, Math.round(now() - chunkRequestStartedAt)),
            });
          }
          const arrivedAt = now();
          // Account for first-chunk startup latency as well as later PCM gaps.
          // Otherwise a slow first response followed by a fast second frame
          // incorrectly looks like a reliably fast synthesizer.
          const gap = Math.max(0, (arrivedAt - (lastFrameAt ?? chunkRequestStartedAt)) / 1000);
          const playableSeconds = frame.samples.length / frame.sampleRate / this.rate;
          if (playableSeconds > 0) {
            const observation = Math.min(5, gap / playableSeconds);
            streamRtf = streamRtf === null ? observation : streamRtf * 0.65 + observation * 0.35;
            recentGapSeconds = Math.max(recentGapSeconds * 0.7, gap);
          }
          lastFrameAt = arrivedAt;
          // Keep at most a bounded reserve ahead of playback; the former 3 s
          // limit prevented sufficient headroom during a cold model stall.
          while (valid() && sink.bufferedSeconds() > MAX_SCHEDULED_SECONDS) {
            if (this.rebuffering) checkBuffer();
            await new Promise(resolve => setTimeout(resolve, 60));
          }
          if (!valid()) break;
          if (this.bufferingFirstPlayback) {
            startupFrames.push({ frame, cursor: selected, offset: offsetSeconds, resume: resumeSeconds });
            startupAudioSeconds += Math.max(0, offsetSeconds + frame.samples.length / frame.sampleRate - Math.max(offsetSeconds, resumeSeconds));
            reportStartup();
            // Release the first playable PCM reserve while Qwen is still
            // generating the rest of this utterance. Playback monitoring then
            // pauses before the queue drains if synthesis falls behind.
            if (startupAudioSeconds / this.rate >= startupTarget()) {
              await releaseStartup();
              hasAudio = true;
              if (!valid()) break;
            }
          } else if (!hasAudio && initialDuration < 0.65) {
            initialFrames.push({ frame, offset: offsetSeconds });
            initialDuration += frame.samples.length / frame.sampleRate;
            if (initialDuration >= 0.65) flushInitial();
          } else pushFrame(frame, offsetSeconds);
          offsetSeconds += frame.samples.length / frame.sampleRate;
          duration.seconds = Math.max(duration.seconds, offsetSeconds);
        }
        if (!valid()) break;
        duration.complete = true;
        flushInitial(); // A very short utterance may end before 650 ms.
        const measuredRtf = this.dependencies.generationRtf?.(spokenText) ?? null;
        if (measuredRtf !== null && Number.isFinite(measuredRtf)) {
          // Weight the latest warmed chunk most heavily: its steady-state
          // generation time matters more than the first model cold start.
          const effectiveRtf = Math.min(8, Math.max(0, measuredRtf * this.rate));
          actualGenerationRtf = actualGenerationRtf === null
            ? effectiveRtf : actualGenerationRtf * 0.2 + effectiveRtf * 0.8;
        }
        diagnostic("chunk_ready", selected, {
          availableSeconds: this.bufferingFirstPlayback ? startupAudioSeconds / this.rate : sink.bufferedSeconds(),
          generationMs: Math.max(0, Math.round(now() - chunkRequestStartedAt)),
          rtf: actualGenerationRtf ?? (
            offsetSeconds > 0 ? Math.max(0, (now() - chunkRequestStartedAt) * this.rate / (offsetSeconds * 1000)) : undefined),
        });
        if (this.bufferingFirstPlayback) {
          completedStartupChunks++;
          const available = startupAudioSeconds / this.rate;
          if (available >= startupTarget()) {
            await releaseStartup();
            if (!valid()) break;
          }
        }
        const nextIndex: number = this.dependencies.indices.indexOf(current.paragraphIndex) + 1;
        current = chunkIndex + 1 < chunks.length
          ? { paragraphIndex: selected.paragraphIndex, chunkIndex: chunkIndex + 1 }
          : nextIndex > 0 && nextIndex < this.dependencies.indices.length
            ? { paragraphIndex: this.dependencies.indices[nextIndex], chunkIndex: 0 } : null;
        // A faster-than-realtime synthesizer must not queue a whole book into WebAudio memory.
        while (valid() && sink.bufferedSeconds() > MAX_SCHEDULED_SECONDS) {
          if (this.rebuffering) checkBuffer();
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      }
      if (!valid()) return;
      if (this.bufferingFirstPlayback && !startupFrames.length) throw new Error("本地朗读没有生成可播放音频");
      // All remaining audio has finished generating, so even a short clip is
      // safe to start immediately without reaching a partial-stream quota.
      if (this.bufferingFirstPlayback) {
        this.dependencies.bufferProgress?.(startupAudioSeconds / this.rate,
          Math.min(startupAudioSeconds / this.rate, startupTarget()));
      }
      await releaseStartup();
      if (!valid()) return;
      this.generationFinished = true;
      // Don't stall the final few seconds waiting for new PCM that will never
      // arrive: the last frame is already scheduled and can play to completion.
      checkBuffer();
      await sink.finish();
      if (!valid()) return;
      const last = sink.position() ?? this.latest;
      if (last) this.dependencies.position(last.cursor, last.seconds, true);
      if (this.monitorTimer) clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
      this.controller = undefined; this.sink?.stop(); this.sink = undefined; this.latest = undefined;
      this.dependencies.phase("complete");
      diagnostic("complete", last?.cursor ?? cursor);
    } catch (error) {
      if (valid()) {
        diagnostic("error", cursor);
        this.stop(); this.dependencies.phase("error", error instanceof Error ? error.message : "本地朗读失败，请重试");
      }
    }
  }
}
