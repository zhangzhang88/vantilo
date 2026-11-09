import { splitChineseSpeech } from "./chinese-listening-state";
import type { SpeechCursor, SpeechPhase } from "./chinese-audio-types";
import type { SpeechPcmChunk } from "./chinese-tts-stream";
import { PcmPitchPreservingStretch } from "./pcm-pitch-preserving-stretch";

type TimedCursor = { cursor: SpeechCursor; seconds: number };
type AudioTimeline = TimedCursor & { start: number; end: number; rate: number };

// Judge readiness using actual buffered PCM and recent delivery speed, rather
// than imposing a fixed 8-second audio quota or mandatory loading timer.
const MIN_STARTUP_SECONDS = 3;
const MAX_STARTUP_SECONDS = 10;
const UNOBSERVED_STARTUP_SECONDS = 6;
const LOW_BUFFER_SECONDS = 1.5;
const MAX_SCHEDULED_SECONDS = 14;
// Start after a small real PCM reserve is available. The previous gate waited
// for complete speech units and several seconds of reserve, even though the
// TTS transport had already delivered usable frames.
const FIRST_PLAY_MIN_BUFFER_SECONDS = 2;
const FIRST_PLAY_MAX_BUFFER_SECONDS = 3.5;

export function adaptivePlaybackTarget(rtf: number | null, recentGapSeconds = 0): number {
  if (rtf === null) return UNOBSERVED_STARTUP_SECONDS;
  const target = MIN_STARTUP_SECONDS + Math.max(0, rtf - 0.45) * 5
    + Math.min(2, Math.max(0, recentGapSeconds) * 0.6);
  return Math.max(MIN_STARTUP_SECONDS, Math.min(MAX_STARTUP_SECONDS, target));
}

export function firstPlayReady(_completedChunks: number, playableSeconds: number, dynamicTarget: number): boolean {
  const reserve = Math.max(FIRST_PLAY_MIN_BUFFER_SECONDS,
    Math.min(FIRST_PLAY_MAX_BUFFER_SECONDS, dynamicTarget * 0.5));
  return playableSeconds >= reserve;
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
export class WebAudioPcmSink implements PcmAudioSink {
  private context = new AudioContext();
  private nextStart = this.context.currentTime + 0.04;
  private sources = new Set<AudioBufferSourceNode>();
  private timeline: AudioTimeline[] = [];
  private completed = false;
  private finishResolver?: () => void;
  private timer: ReturnType<typeof setInterval>;
  private rate = 1;
  private stopped = false;
  private stretch: PcmPitchPreservingStretch | null = null;
  private stretchCursor?: SpeechCursor;
  private segmentRate = 1;
  private progressSeconds = 0;
  constructor(private onPosition: (position: TimedCursor) => void) {
    // Constructed synchronously from the click handler so browser audio activation is permitted.
    void this.context.resume().catch(() => {});
    this.timer = setInterval(() => { const current = this.position(); if (current) this.onPosition(current); }, 250);
  }

  append(frame: SpeechPcmChunk, cursor: SpeechCursor, offsetSeconds: number, resumeSeconds: number) {
    if (this.stopped) return;
    if (frame.sampleRate !== 24000) throw new Error("不支持的本地音频采样率");
    const skipSamples = Math.max(0, Math.min(frame.samples.length, Math.ceil((resumeSeconds - offsetSeconds) * frame.sampleRate)));
    const count = frame.samples.length - skipSamples;
    if (!count) return;
    // Speeding up an AudioBufferSourceNode also raises vocal pitch. Stretch
    // the PCM time axis separately so voices retain their natural pitch.
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
    this.schedule(this.stretch ? this.stretch.push(samples) : samples, cursor);
  }

  private schedule(samples: Float32Array, cursor: SpeechCursor) {
    if (this.stopped || !samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = 1;
    source.connect(this.context.destination);
    const start = Math.max(this.nextStart, this.context.currentTime + 0.02);
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
    if (this.stopped || !this.sources.size) return Promise.resolve();
    return new Promise(resolve => { this.finishResolver = resolve; });
  }
  pause() { if (!this.stopped) void this.context.suspend().catch(() => {}); }
  resume() { if (!this.stopped) void this.context.resume().catch(() => {}); }
  setRate(rate: number) {
    // Keep already scheduled sources at their original rate so their start/end
    // positions stay sample-accurate; the new rate applies to subsequent frames.
    this.rate = rate;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stretch = null;
    this.stretchCursor = undefined;
    clearInterval(this.timer);
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear();
    this.finishResolver?.(); this.finishResolver = undefined;
    void this.context.close().catch(() => {});
  }
}

interface PlayerDependencies {
  indices: number[];
  getText: (index: number) => Promise<string>;
  synthesize: (text: string, signal: AbortSignal) => AsyncIterable<SpeechPcmChunk>;
  splitText?: (text: string) => string[];
  phase: (phase: SpeechPhase, error?: string) => void;
  position: (cursor: SpeechCursor, seconds: number, completed: boolean) => void;
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
  private rebuffering = false;
  private generationFinished = false;
  private monitorTimer?: ReturnType<typeof setInterval>;

  constructor(private dependencies: PlayerDependencies) {}
  setRate(rate: number) { this.rate = rate; this.sink?.setRate(rate); }
  pause() {
    if (!this.controller) return;
    this.paused = true; this.sink?.pause();
    if (this.latest) this.dependencies.position(this.latest.cursor, this.latest.seconds, false);
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
    if (this.latest) this.dependencies.position(this.latest.cursor, this.sink?.position()?.seconds ?? this.latest.seconds, false);
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
      this.dependencies.position(value.cursor, value.seconds, false);
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
    this.dependencies.bufferProgress?.(0, UNOBSERVED_STARTUP_SECONDS);
    try {
      const sink = (this.dependencies.sink ?? (callback => new WebAudioPcmSink(callback)))(publish);
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
      const readyTarget = () => adaptivePlaybackTarget(actualGenerationRtf ?? streamRtf, recentGapSeconds);
      const reportStartup = () => this.dependencies.bufferProgress?.(startupAudioSeconds / this.rate, readyTarget());
      const supervise = !this.dependencies.sink || this.dependencies.monitorTestSink === true;
      const checkBuffer = () => {
        if (!valid() || !supervise || this.paused || this.bufferingFirstPlayback || firstAudio) return;
        const ahead = sink.bufferedSeconds();
        if (!this.rebuffering && !this.generationFinished && ahead < LOW_BUFFER_SECONDS) {
          this.rebuffering = true;
          sink.pause();
          this.dependencies.bufferProgress?.(ahead, readyTarget());
          this.dependencies.phase("loading");
          diagnostic("low_buffer", current ?? cursor, { availableSeconds: ahead, targetSeconds: readyTarget(), rtf: streamRtf ?? undefined });
        } else if (this.rebuffering) {
          const target = readyTarget();
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
          if (supervise) this.monitorTimer = setInterval(checkBuffer, 120);
        }
        if (this.rebuffering) checkBuffer();
      };
      const releaseStartup = async () => {
        if (!this.bufferingFirstPlayback) return;
        if (!valid()) return;
        if (this.paused) await new Promise<void>(resolve => { this.wake = resolve; });
        if (!valid()) return;
        diagnostic("startup_ready", current ?? cursor, {
          availableSeconds: startupAudioSeconds / this.rate, targetSeconds: readyTarget(),
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
        const chunks = (this.dependencies.splitText ?? splitChineseSpeech)(await this.dependencies.getText(current.paragraphIndex));
        if (!valid()) break;
        if (!chunks.length) throw new Error("这一段没有可朗读的中文");
        const chunkIndex: number = current.chunkText && chunks[current.chunkIndex] !== current.chunkText ? 0 : Math.min(current.chunkIndex, chunks.length - 1);
        const selected: SpeechCursor = { paragraphIndex: current.paragraphIndex, chunkIndex, chunkText: chunks[chunkIndex] };
        const resumeSeconds = current.chunkText && current.chunkText !== chunks[chunkIndex] ? 0 : current.seconds ?? 0;
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
        for await (const frame of this.dependencies.synthesize(chunks[chunkIndex], signal)) {
          if (!valid()) break;
          if (frame.sampleRate !== 24000 || !frame.samples.length) throw new Error("TTS 音频块无效");
          if (!firstPcmReported) {
            firstPcmReported = true;
            diagnostic("first_pcm", selected, {
              generationMs: this.dependencies.generationFirstFrameMs?.(chunks[chunkIndex])
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
          while (valid() && sink.bufferedSeconds() > MAX_SCHEDULED_SECONDS) await new Promise(resolve => setTimeout(resolve, 60));
          if (!valid()) break;
          if (this.bufferingFirstPlayback) {
            startupFrames.push({ frame, cursor: selected, offset: offsetSeconds, resume: resumeSeconds });
            startupAudioSeconds += Math.max(0, offsetSeconds + frame.samples.length / frame.sampleRate - Math.max(offsetSeconds, resumeSeconds));
            reportStartup();
            // Release the first playable PCM reserve while Qwen is still
            // generating the rest of this utterance. Playback monitoring then
            // pauses before the queue drains if synthesis falls behind.
            if (firstPlayReady(completedStartupChunks, startupAudioSeconds / this.rate, readyTarget())) {
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
        }
        if (!valid()) break;
        flushInitial(); // A very short utterance may end before 650 ms.
        const measuredRtf = this.dependencies.generationRtf?.(chunks[chunkIndex]) ?? null;
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
          // First-play protection: completed, consecutive units and a larger
          // reserve. A fully completed short article bypasses this at EOF.
          if (firstPlayReady(completedStartupChunks, available, readyTarget())) {
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
        while (valid() && sink.bufferedSeconds() > MAX_SCHEDULED_SECONDS) await new Promise(resolve => setTimeout(resolve, 60));
      }
      if (!valid()) return;
      if (this.bufferingFirstPlayback && !startupFrames.length) throw new Error("本地朗读没有生成可播放音频");
      // All remaining audio has finished generating, so even a short clip is
      // safe to start immediately without reaching a partial-stream quota.
      if (this.bufferingFirstPlayback) {
        this.dependencies.bufferProgress?.(startupAudioSeconds / this.rate,
          Math.min(startupAudioSeconds / this.rate, readyTarget()));
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
