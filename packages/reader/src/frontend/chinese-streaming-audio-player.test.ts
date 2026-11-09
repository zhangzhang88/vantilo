import { describe, expect, it, vi } from "vitest";
import { adaptivePlaybackTarget, firstPlayReady, ChineseStreamingAudioPlayer, WebAudioPcmSink, type ChineseAudioDiagnosticEvent, type PcmAudioSink } from "./chinese-streaming-audio-player";
import type { SpeechCursor } from "./chinese-audio-types";
import type { SpeechPcmChunk } from "./chinese-tts-stream";

const pcm = { sampleRate: 24000, samples: new Int16Array(2400) };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(synthesize = vi.fn(async function* (_text: string, _signal: AbortSignal) { yield pcm; }),
  options: { monitor?: boolean; bufferedSeconds?: () => number; onAppend?: (frame: SpeechPcmChunk) => void; now?: () => number;
    splitText?: (value: string) => string[]; diagnostic?: (value: ChineseAudioDiagnosticEvent) => void;
    generationRtf?: (text: string) => number | null } = {}) {
  const phase = vi.fn(), position = vi.fn(), appends: Array<{cursor:SpeechCursor;offset:number;resume:number}> = [];
  const actions = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), setRate: vi.fn(), finish: vi.fn(async () => {}) };
  let last: {cursor:SpeechCursor;seconds:number} | null = null;
  const sink: PcmAudioSink = {
    append(frame, cursor, offset, resume) { options.onAppend?.(frame); appends.push({cursor,offset,resume}); last = { cursor, seconds: offset + 0.1 }; },
    position() { return last; },
    bufferedSeconds: () => options.bufferedSeconds?.() ?? 0,
    finish: actions.finish, pause: actions.pause, resume: actions.resume, stop: actions.stop, setRate: actions.setRate,
  };
  const player = new ChineseStreamingAudioPlayer({ indices: [0,1], getText: async i => `第${i}段中文。`, synthesize, phase, position,
    sink: () => sink, monitorTestSink: options.monitor, now: options.now,
    splitText: options.splitText, diagnostic: options.diagnostic, generationRtf: options.generationRtf });
  return { player, phase, position, appends, actions, synthesize };
}

describe("Streaming Chinese audiobooks", () => {
  it("starts from the first PCM reserve without waiting for a third chunk", async () => {
    let releaseThird!: () => void;
    const third = new Promise<void>(resolve => { releaseThird = resolve; });
    let count = 0;
    const diagnostics: ChineseAudioDiagnosticEvent[] = [];
    const f = fixture(vi.fn(async function* () {
      count++;
      if (count === 3) await third;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 4) };
    }), {
      splitText: text => text.includes("第0") ? ["first", "second"] : ["third"],
      generationRtf: () => 0.65,
      diagnostic: item => diagnostics.push(item),
    });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(count).toBe(3);
    expect(f.appends).toHaveLength(2);
    expect(diagnostics.find(event => event.event === "startup_ready"))
      .toMatchObject({ completedChunks: 0, availableSeconds: 4 });
    releaseThird();
    await run;
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("complete");
  });

  it("starts when a safe reserve is ready even if the following chunk is pending", async () => {
    let releaseThird!: () => void;
    const third = new Promise<void>(resolve => { releaseThird = resolve; });
    let count = 0;
    const diagnostics: ChineseAudioDiagnosticEvent[] = [];
    const f = fixture(vi.fn(async function* () {
      count++;
      if (count === 3) await third;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 6) };
    }), {
      splitText: text => text.includes("第0") ? ["first", "second"] : ["third"],
      generationRtf: () => 1.5,
      diagnostic: item => diagnostics.push(item),
    });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(count).toBe(3);
    expect(f.appends.length).toBeGreaterThan(0);
    expect(diagnostics.find(event => event.event === "startup_ready")).toMatchObject({ availableSeconds: 6 });
    releaseThird();
    await run;
    expect(f.appends.length).toBeGreaterThanOrEqual(3);
  });

  it("starts sooner for faster TTS but remains cautious when generation is slow", () => {
    expect(firstPlayReady(0, 2.9, 6)).toBe(false);
    expect(firstPlayReady(0, 3, 6)).toBe(true);
    expect(firstPlayReady(0, 1.9, 3)).toBe(false);
    expect(firstPlayReady(0, 2, 3)).toBe(true);
    expect(firstPlayReady(0, 3.49, 10)).toBe(false);
    expect(firstPlayReady(0, 3.5, 10)).toBe(true);
  });

  it("starts on the first completed PCM reserve without waiting for more chunks", async () => {
    let next!: () => void;
    const third = new Promise<void>(resolve => { next = resolve; });
    let count = 0;
    const diagnostics: ChineseAudioDiagnosticEvent[] = [];
    const f = fixture(vi.fn(async function* () {
      count++;
      if (count === 3) await third;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * (count === 3 ? 5 : 3)) };
    }), {
      splitText: value => value.includes("第0") ? ["A", "B"] : ["C"],
      diagnostic: item => diagnostics.push(item),
    });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(count).toBe(3);
    expect(f.appends.length).toBeGreaterThan(0);
    expect(diagnostics.find(item => item.event === "startup_ready"))
      .toMatchObject({ completedChunks: 0, availableSeconds: 3 });
    next();
    await run;
    expect(diagnostics.filter(item => item.event === "chunk_ready")).toHaveLength(3);
    expect(f.appends.map(item => item.cursor.paragraphIndex)).toEqual([0, 0, 1]);
  });

  it("releases one fully generated long reserve before the following paragraph finishes", async () => {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    let count = 0;
    const diagnostics: ChineseAudioDiagnosticEvent[] = [];
    const f = fixture(vi.fn(async function* () {
      count++;
      if (count === 2) await next;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * (count === 1 ? 25 : 2)) };
    }), { diagnostic: item => diagnostics.push(item) });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(count).toBe(2);
    expect(f.appends.length).toBeGreaterThan(0);
    expect(diagnostics.find(item => item.event === "startup_ready"))
      .toMatchObject({ completedChunks: 0, availableSeconds: 25 });
    release();
    await run;
  });

  it("starts while the following paragraph is still being synthesized", async () => {
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    let unit = 0;
    const f = fixture(vi.fn(async function* () {
      unit++;
      if (unit === 1) {
        yield { sampleRate: 24000, samples: new Int16Array(24000 * 2) };
        yield { sampleRate: 24000, samples: new Int16Array(24000 * 2) };
      } else {
        await tail;
        yield { sampleRate: 24000, samples: new Int16Array(24000 * 5) };
      }
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(unit).toBe(2);
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("playing");
    release();
    await run;
    expect(f.appends.map(item => item.cursor.paragraphIndex)).toEqual([0, 0, 1]);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });

  it("uses observed PCM gaps to retain a larger startup reserve", async () => {
    let time = 0;
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(vi.fn(async function* () {
      time = 5000;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
      time = 6000;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
      await tail;
      time = 6100;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
    }), { now: () => time });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("playing");
    release();
    await run;
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("complete");
  });

  it("raises the readiness threshold as measured generation slows or becomes irregular", () => {
    expect(adaptivePlaybackTarget(null)).toBe(6);
    expect(adaptivePlaybackTarget(0.3, 0.02)).toBeCloseTo(3.012);
    expect(adaptivePlaybackTarget(0.9, 0)).toBeGreaterThan(5);
    expect(adaptivePlaybackTarget(1.6, 1.8)).toBeGreaterThan(9);
    expect(adaptivePlaybackTarget(10, 10)).toBe(10);
  });

  it("holds partial audio until a safe reserve accumulates, without a fixed timer", async () => {
    let continueGeneration!: () => void;
    const later = new Promise<void>(resolve => { continueGeneration = resolve; });
    const f = fixture(vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 4) };
      await later;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 5) };
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("playing");
    continueGeneration();
    await run;
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });

  it("supervises live scheduled audio: pauses before depletion, waits until reserve recovers, then resumes", async () => {
    let next!: () => void;
    const nextFrame = new Promise<void>(resolve => { next = resolve; });
    let remaining = 0;
    let request = 0;
    const f = fixture(vi.fn(async function* () {
      request++;
      if (request === 2) await nextFrame;
      // One complete long chunk can safely start before the second arrives.
      yield { sampleRate: 24000, samples: new Int16Array(24000 * (request === 1 ? 25 : 7)) };
    }), {
      monitor: true,
      bufferedSeconds: () => remaining,
      onAppend: frame => { remaining += frame.samples.length / frame.sampleRate; },
    });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("playing");
    remaining = 1.0; // Simulate playback consuming almost all scheduled audio.
    await new Promise(resolve => setTimeout(resolve, 160));
    expect(f.actions.pause).toHaveBeenCalled();
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("loading");
    expect(f.actions.resume.mock.calls.length).toBe(1); // startup release only
    remaining = 2.0; // Still below adaptive (minimum 3-second) recovery target.
    await new Promise(resolve => setTimeout(resolve, 160));
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("loading");
    next();
    await run;
    expect(f.actions.resume).toHaveBeenCalledTimes(2);
    expect(f.phase.mock.calls).toContainEqual(["playing"]);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("complete");
  });

  it("starts a fully cached short audiobook immediately, without a fixed loading timer", async () => {
    const ready = { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
    const f = fixture(vi.fn(async function* () { yield ready; }));
    const startedAt = Date.now();
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    expect(Date.now() - startedAt).toBeLessThan(600);
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });

  it("stays silent when only one unfinished second is available, then plays completed audio", async () => {
    let next!: () => void;
    const secondReady = new Promise<void>(resolve => { next = resolve; });
    const f = fixture(vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(24000) }; // only 1 second
      await secondReady;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 2) }; // +2 seconds
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.appends).toHaveLength(0);
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("loading");
    next();
    await run;
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });

  it("keeps the first PCM silent while paused during loading and only starts after resume", async () => {
    let release!: () => void;
    const moreAudio = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(24000) };
      await moreAudio;
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    f.player.pause();
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("paused");
    release();
    await flush();
    expect(f.appends).toHaveLength(0);
    f.player.resume();
    expect(f.phase.mock.calls.at(-1)?.[0]).toBe("loading");
    await run;
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "paused", "loading", "playing", "complete"]);
    expect(f.appends.length).toBeGreaterThan(0);
  });

  it("buffers across successive text chunks rather than starting with an isolated short chunk", async () => {
    let continueSecond!: () => void;
    const secondReady = new Promise<void>(resolve => { continueSecond = resolve; });
    let part = 0;
    const f = fixture(vi.fn(async function* () {
      part++;
      if (part === 2) await secondReady;
      yield { sampleRate: 24000, samples: new Int16Array(part === 1 ? 24000 : 48000) };
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.appends).toHaveLength(0);
    expect(part).toBe(2);
    continueSecond();
    await run;
    expect(f.appends.map(item => item.cursor.paragraphIndex)).toEqual([0, 1]);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });

  it("checks each new stream but starts a fully cached replay without delay", async () => {
    const f = fixture(vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
    }));
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    const laterClickAt = Date.now();
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    expect(Date.now() - laterClickAt).toBeLessThan(400);
    expect(f.phase.mock.calls.filter(args => args[0] === "playing")).toHaveLength(2);
  });

  it("drops all unscheduled cold-start PCM when stopped and retries the startup gate on the next click", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let attempt = 0;
    const f = fixture(vi.fn(async function* () {
      attempt++;
      if (attempt === 1) {
        yield { sampleRate: 24000, samples: new Int16Array(2400) };
        await pending;
      } else {
        yield { sampleRate: 24000, samples: new Int16Array(24000 * 3) };
      }
    }));
    const aborted = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    f.player.stop(); release();
    await aborted;
    expect(f.appends).toHaveLength(0);
    const retry = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await retry;
    expect(f.appends.length).toBeGreaterThan(0);
    expect(f.phase.mock.calls.filter(args => args[0] === "playing")).toHaveLength(1);
  });

  it("holds the first tiny PCM frames until a small playable buffer is available", async () => {
    let release!: () => void;
    const second = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(4800) }; // 200ms
      await second;
      yield { sampleRate: 24000, samples: new Int16Array(12000) }; // +500ms
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    expect(f.appends).toHaveLength(0);
    expect(f.phase.mock.calls.some(call => call[0] === "playing")).toBe(false);
    release();
    await run;
    expect(f.appends.length).toBe(4);
    expect(f.appends.slice(0, 2).map(chunk => chunk.offset)).toEqual([0, 0.2]);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading", "playing", "complete"]);
  });
  it("schedules the first PCM frame and continues through paragraphs without buffering whole audio blobs", async () => {
    const f = fixture();
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    expect(f.synthesize).toHaveBeenCalledTimes(2);
    expect(f.appends.map(item => item.cursor.paragraphIndex)).toEqual([0,1]);
    expect(f.phase.mock.calls.map(args => args[0])).toEqual(["loading","playing","complete"]);
    expect(f.position).toHaveBeenLastCalledWith(expect.objectContaining({ paragraphIndex: 1 }), 0.1, true);
  });
  it("supports pause/resume, rate selection, and cancellation without showing an error", async () => {
    let release!: () => void;
    const f = fixture(vi.fn(async function* (_text: string, signal: AbortSignal) {
      yield pcm;
      await new Promise<void>(resolve => { release = resolve; });
      if (!signal.aborted) yield pcm;
    }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    f.player.pause();
    expect(f.actions.pause).toHaveBeenCalledOnce();
    f.player.setRate(1.25);
    expect(f.actions.setRate).toHaveBeenLastCalledWith(1.25);
    f.player.resume();
    // Resuming a manually paused *loading* state should remain silent until
    // enough PCM exists, rather than opening the AudioContext prematurely.
    expect(f.actions.resume).not.toHaveBeenCalled();
    f.player.stop(); release(); await run;
    expect(f.actions.stop).toHaveBeenCalled();
    expect(f.phase.mock.calls.some(args => args[0] === "error")).toBe(false);
  });
  it("resumes matching translated chunks at the saved audio offset", async () => {
    const f = fixture();
    await f.player.start({ paragraphIndex: 1, chunkIndex: 0, chunkText: "第1段中文。", seconds: 0.05 });
    expect(f.appends[0].resume).toBe(0.05);
    const g = fixture();
    await g.player.start({ paragraphIndex: 1, chunkIndex: 5, chunkText: "过时译文", seconds: 5 });
    expect(g.appends[0].resume).toBe(0);
  });
});

describe("WebAudio pitch-safe PCM scheduling", () => {
  it("schedules pitch-preserved PCM at playbackRate=1 even for 1.5x listening", async () => {
    const instances: Array<{
      buffers: Array<{ duration: number; samples: Float32Array }>;
      sources: Array<{ playbackRate: { value: number }; onended: null | (() => void); start: (at: number) => void; disconnect: () => void }>;
      currentTime: number;
    }> = [];
    class MockContext {
      currentTime = 0;
      destination = {};
      buffers: Array<{ duration: number; samples: Float32Array }> = [];
      sources: Array<{ playbackRate: { value: number }; onended: null | (() => void); start: (at: number) => void; disconnect: () => void }> = [];
      constructor() { instances.push(this); }
      createBuffer(_channels: number, length: number, rate: number) {
        const buffer = { duration: length / rate, samples: new Float32Array(length),
          getChannelData: (_channel: number) => buffer.samples };
        this.buffers.push(buffer);
        return buffer;
      }
      createBufferSource() {
        const source = {
          buffer: null as unknown,
          playbackRate: { value: 1 },
          onended: null as null | (() => void),
          connect: () => {},
          disconnect: () => {},
          start: (_at: number) => {},
          stop: () => {},
        };
        this.sources.push(source);
        return source;
      }
      resume() { return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    vi.stubGlobal("AudioContext", MockContext);
    const sink = new WebAudioPcmSink(() => {});
    try {
      const signal = new Int16Array(24000);
      for (let i = 0; i < signal.length; i++) signal[i] = Math.round(10000 * Math.sin(i * 2 * Math.PI * 220 / 24000));
      sink.setRate(1.5);
      const cursor = { paragraphIndex: 0, chunkIndex: 0 };
      for (let i = 0; i < signal.length; i += 4096) {
        sink.append({ sampleRate: 24000, samples: signal.subarray(i, i + 4096) }, cursor, i / 24000, 0);
      }
      const complete = sink.finish();
      const audio = instances[0];
      expect(audio.sources.length).toBeGreaterThan(1);
      expect(audio.sources.every(source => source.playbackRate.value === 1)).toBe(true);
      const totalDuration = audio.buffers.reduce((total, buffer) => total + buffer.duration, 0);
      expect(totalDuration).toBeGreaterThan(0.60);
      expect(totalDuration).toBeLessThan(0.72);
      for (const source of audio.sources) source.onended?.();
      await complete;
    } finally {
      sink.stop();
      vi.unstubAllGlobals();
    }
  });
});
