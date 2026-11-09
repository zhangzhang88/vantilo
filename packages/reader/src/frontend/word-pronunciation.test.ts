import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WordPronunciationPlayer, wordAudioUrl, WORD_FALLBACK_DELAY_MS,
  type WordAudioEvent,
} from "./word-pronunciation";

class FakeAudio extends EventTarget {
  preload = "none";
  currentTime = 0;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  private resolvePlay!: () => void;
  private rejectPlay!: (error: Error) => void;
  play = vi.fn(() => new Promise<void>((resolve, reject) => {
    this.resolvePlay = resolve; this.rejectPlay = reject;
  }));
  constructor(public readonly url: string) { super(); }
  succeed() { this.dispatchEvent(new Event("playing")); this.resolvePlay(); }
  fail() { this.dispatchEvent(new Event("error")); this.rejectPlay(new Error("media unavailable")); }
}

const pcm = { sampleRate: 24000, samples: new Int16Array(2400).fill(3000) };
function setup(tts = vi.fn(async function* (_text: string, _signal: AbortSignal) { yield pcm; })) {
  const audioInstances: FakeAudio[] = [];
  const sourceNodes: Array<{
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    buffer: { duration: number; getChannelData: () => Float32Array } | null;
  }> = [];
  const ctx = {
    state: "running", currentTime: 0, destination: {},
    resume: vi.fn(async () => {}),
    createBuffer: vi.fn((_channels: number, count: number, rate: number) => {
      const channel = new Float32Array(count);
      return { duration: count / rate, getChannelData: () => channel };
    }),
    createBufferSource: vi.fn(() => {
      const src = {
        buffer: null, onended: null,
        start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
      };
      sourceNodes.push(src); return src;
    }),
  };
  const notify = vi.fn<(event: WordAudioEvent) => void>();
  const player = new WordPronunciationPlayer({
    audio: url => {
      const audio = new FakeAudio(url);
      audioInstances.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
    audioContext: () => ctx as unknown as AudioContext,
    tts: tts as unknown as typeof import("./chinese-tts-stream").streamChineseTts,
    notify,
    clock: () => Date.now(),
  });
  return { player, audioInstances, sourceNodes, ctx, tts, notify };
}
const played = (notify: ReturnType<typeof vi.fn>) =>
  notify.mock.calls.map(([e]: [WordAudioEvent]) => e).filter(e => e.status === "playing");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("word audio: fastest available high-quality source only", () => {
  it("requests local cached/Youdao audio synchronously without dictionary or system voices", async () => {
    const f = setup();
    expect(wordAudioUrl("Reading", "us")).toBe("/api/word-audio?word=Reading&accent=us");
    f.player.play("Reading", "us");
    expect(f.audioInstances).toHaveLength(1);
    expect(f.audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(f.audioInstances[0].url).toBe("/api/word-audio?word=Reading&accent=us");
    await vi.advanceTimersByTimeAsync(110);
    f.audioInstances[0].succeed();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.tts).not.toHaveBeenCalled();
    expect(played(f.notify)).toEqual([expect.objectContaining({
      source:"youdao",text:"Reading",accent:"us",latencyMs:110,
    })]);
    f.player.stop();
  });

  it("starts a Qwen3-TTS PCM fallback at 400ms, cancels the late Youdao media, and never speaks twice", async () => {
    const f = setup();
    f.player.play("forest", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS-1);
    expect(f.tts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(f.tts).toHaveBeenCalledWith("forest",expect.any(AbortSignal),"en-US","aiden");
    expect(f.sourceNodes).toHaveLength(1);
    expect(f.sourceNodes[0].start).toHaveBeenCalledTimes(1);
    expect(f.audioInstances[0].pause).toHaveBeenCalled();
    f.audioInstances[0].succeed();
    await Promise.resolve();
    expect(played(f.notify).map(e=>e.source)).toEqual(["qwen"]);
    f.player.stop();
  });

  it("assembles delayed Qwen PCM into one continuous word clip instead of scheduling gaps", async () => {
    const tts = vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(2400).fill(1000) };
      await new Promise(resolve => setTimeout(resolve, 210));
      yield { sampleRate: 24000, samples: new Int16Array(2400).fill(2000) };
      await new Promise(resolve => setTimeout(resolve, 350));
      yield { sampleRate: 24000, samples: new Int16Array(2400).fill(3000) };
    });
    const f = setup(tts);
    f.player.play("incredible", "us");
    await vi.advanceTimersByTimeAsync(400);
    expect(f.sourceNodes).toHaveLength(0);
    expect(played(f.notify)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(210);
    expect(f.sourceNodes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(350);
    expect(f.sourceNodes).toHaveLength(1);
    expect(f.sourceNodes[0].start).toHaveBeenCalledTimes(1);
    expect(f.sourceNodes[0].buffer?.duration).toBeCloseTo(0.3);
    const combined = f.sourceNodes[0].buffer!.getChannelData();
    expect(combined).toHaveLength(7200);
    expect(combined[0]).toBeCloseTo(1000 / 32768);
    expect(combined[2400]).toBeCloseTo(2000 / 32768);
    expect(combined[4800]).toBeCloseTo(3000 / 32768);
    expect(played(f.notify).map(event => event.source)).toEqual(["qwen"]);
    f.player.stop();
  });

  it("reuses the finished word PCM from session memory instead of synthesizing twice", async () => {
    const f = setup();
    f.player.play("river", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    expect(f.tts).toHaveBeenCalledTimes(1);
    expect(f.sourceNodes).toHaveLength(1);
    f.player.stop();
    f.player.play("RIVER", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    expect(f.tts).toHaveBeenCalledTimes(1);
    expect(f.sourceNodes).toHaveLength(2);
    expect(f.sourceNodes[0].stop).toHaveBeenCalled();
    expect(played(f.notify)).toHaveLength(2);
    f.player.stop();
  });

  it("lets Youdao win while Qwen is buffering and never plays delayed Qwen audio", async () => {
    const tts = vi.fn(async function* () {
      yield pcm;
      await new Promise(resolve => setTimeout(resolve, 500));
      yield pcm;
    });
    const f = setup(tts);
    f.player.play("light", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    expect(f.sourceNodes).toHaveLength(0);
    f.audioInstances[0].succeed();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.sourceNodes).toHaveLength(0);
    expect(played(f.notify).map(event => event.source)).toEqual(["youdao"]);
    f.player.stop();
  });

  it("never plays an incomplete Qwen word when the generator fails", async () => {
    const tts = vi.fn(async function* () {
      yield pcm;
      throw new Error("audio stream interrupted");
    });
    const f = setup(tts);
    f.player.play("failure", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    expect(f.sourceNodes).toHaveLength(0);
    f.audioInstances[0].succeed();
    expect(played(f.notify).map(event => event.source)).toEqual(["youdao"]);
    f.player.stop();
  });

  it("does not announce Qwen playback in a suspended audio context", async () => {
    const f = setup();
    f.ctx.state = "suspended";
    let resume!: () => void;
    f.ctx.resume.mockImplementation(() => new Promise<void>(resolve => {
      resume = () => { f.ctx.state = "running"; resolve(); };
    }));
    f.player.play("forest", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    expect(played(f.notify)).toHaveLength(0);
    expect(f.sourceNodes).toHaveLength(0);
    resume();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(played(f.notify)).toEqual([expect.objectContaining({ source: "qwen" })]);
    expect(f.sourceNodes).toHaveLength(1);
    f.player.stop();
  });

  it("does not silently use US Qwen voices when the user selected British pronunciation", async () => {
    const f = setup();
    f.player.play("water", "uk");
    f.audioInstances[0].fail();
    await Promise.resolve();
    expect(f.tts).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
      status:"failed", accent:"uk", message:expect.stringContaining("英式"),
    }));
    expect(played(f.notify)).toHaveLength(0);
    f.player.stop();
  });

  it("retains the four-second UK timeout without involving Qwen", async () => {
    const f = setup();
    f.player.play("river", "uk");
    await vi.advanceTimersByTimeAsync(3_999);
    expect(f.notify.mock.calls.flat().some(event => event.status === "failed")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", accent: "uk", message: expect.stringContaining("英式"),
    }));
    expect(f.tts).not.toHaveBeenCalled();
  });

  it("times out slow Qwen synthesis without playing an incomplete word", async () => {
    const tts = vi.fn(async function* () {
      yield pcm;
      await new Promise(resolve => setTimeout(resolve, 7_000));
      yield pcm;
    });
    const f = setup(tts);
    f.player.play("sluggish", "us");
    await vi.advanceTimersByTimeAsync(6_500);
    expect(f.sourceNodes).toHaveLength(0);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", accent: "us" }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.sourceNodes).toHaveLength(0);
  });

  it("latest click wins and a stale Qwen response cannot speak the previous word", async () => {
    let release!: () => void;
    const tts = vi.fn(async function* (text: string, signal: AbortSignal) {
      if (text === "first") await new Promise<void>(resolve => { release=resolve; });
      if (!signal.aborted) yield pcm;
    });
    const f = setup(tts);
    f.player.play("first", "us");
    await vi.advanceTimersByTimeAsync(400);
    f.player.play("second", "us");
    expect(f.audioInstances[0].pause).toHaveBeenCalled();
    release();
    await Promise.resolve();await Promise.resolve();
    f.audioInstances[1].succeed();
    await Promise.resolve();
    expect(played(f.notify)).toEqual([expect.objectContaining({text:"second",source:"youdao"})]);
    expect(f.sourceNodes).toHaveLength(0);
    f.player.stop();
  });

  it("reports an explicit failure only after both Youdao and Qwen failed", async () => {
    const tts = vi.fn(async function* () { throw new Error("Qwen not connected"); yield pcm; });
    const f = setup(tts);
    f.player.play("distant", "us");
    f.audioInstances[0].fail();
    await Promise.resolve();await Promise.resolve();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
      status:"failed", message:expect.stringContaining("Qwen3-TTS"),
    }));
    expect(played(f.notify)).toHaveLength(0);
    f.player.stop();
  });

  it("allows late Youdao audio to win after Qwen generation fails, without replay", async () => {
    const tts = vi.fn(async function* () { throw new Error("busy"); yield pcm; });
    const f = setup(tts);
    f.player.play("light", "us");
    await vi.advanceTimersByTimeAsync(WORD_FALLBACK_DELAY_MS);
    await Promise.resolve();
    f.audioInstances[0].succeed();
    await Promise.resolve();
    expect(played(f.notify)).toHaveLength(1);
    expect(played(f.notify)[0]).toMatchObject({text:"light",source:"youdao"});
    expect(f.notify.mock.calls.flat().some(e=>e.status==="failed")).toBe(false);
    f.player.stop();
  });
});
