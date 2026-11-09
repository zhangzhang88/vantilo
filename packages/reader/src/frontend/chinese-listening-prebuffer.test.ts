import { describe, expect, it, vi } from "vitest";
import { ChineseListeningPrebuffer } from "./chinese-listening-prebuffer";
import type { SpeechPcmChunk } from "./chinese-tts-stream";
import { qwenTtsSeed } from "../shared/qwen-tts-seed";
import { streamChineseListeningTts } from "./chinese-listening-tts";

const frame = (value: number): SpeechPcmChunk => ({ sampleRate: 24000, samples: new Int16Array(2400).fill(value) });
const read = async (prefetch: ChineseListeningPrebuffer, text: string, voice: "serena" | "vivian", signal = new AbortController().signal) => {
  const result: SpeechPcmChunk[] = [];
  for await (const chunk of prefetch.stream(text, signal, voice)) result.push(chunk);
  return result;
};

describe("Chinese audiobook cold-start prebuffer", () => {
  it("measures actual background TTS generation time rather than cached playback delivery", async () => {
    let elapsed = 0;
    const generate = vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array(24000) };
      elapsed = 1800;
      yield { sampleRate: 24000, samples: new Int16Array(24000) };
    }) as typeof streamChineseListeningTts;
    const warm = new ChineseListeningPrebuffer(generate, () => elapsed);
    expect(warm.generationRtf("段落", "serena")).toBeNull();
    await warm.prefetch("段落", "serena");
    expect(warm.generationRtf("段落", "serena")).toBeCloseTo(0.9);
    expect(warm.firstFrameMs("段落", "serena")).toBe(0);
    const audio = await read(warm, "段落", "serena");
    expect(audio).toHaveLength(2);
    expect(warm.generationRtf("段落", "vivian")).toBeNull();
    warm.reset();
    expect(warm.generationRtf("段落", "serena")).toBeNull();
    warm.dispose();
  });

  it("prefetches the first chunk silently, replays completed frames, and never synthesizes twice", async () => {
    const generate = vi.fn(async function* () { yield frame(11); yield frame(22); }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    await prebuffer.prefetch("欢迎收听", "serena");
    const playing = await read(prebuffer, "欢迎收听", "serena");
    expect(playing.map(chunk => chunk.samples[0])).toEqual([11,22]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toBe("欢迎收听");
    expect(generate.mock.calls[0][2]).toBe("serena");
    expect(qwenTtsSeed("欢迎收听", "serena")).toBe(qwenTtsSeed("欢迎收听", "serena"));
    prebuffer.dispose();
  });
  it("yields the first PCM frame immediately while the rest of the speech unit is still generating", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const generate = vi.fn(async function* () { yield frame(1); await wait; yield frame(2); }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    const started = prebuffer.prefetch("第一段", "serena");
    const playback = prebuffer.stream("第一段", new AbortController().signal, "serena");
    expect((await playback.next()).value?.samples[0]).toBe(1);
    let secondReady = false;
    const second = playback.next().then(result => { secondReady = true; return result; });
    await Promise.resolve();
    expect(secondReady).toBe(false);
    release();
    expect((await second).value?.samples[0]).toBe(2);
    expect((await playback.next()).done).toBe(true);
    await started;
    expect(generate).toHaveBeenCalledTimes(1);
    prebuffer.dispose();
  });
  it("never shares the wrong voice, and resets/aborts warmed audio on article exit or voice change", async () => {
    const controllers: AbortSignal[] = [];
    const generate = vi.fn(async function* (_text, signal) {
      controllers.push(signal);
      yield frame(17);
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    void prebuffer.prefetch("同一段", "serena");
    const reading = new AbortController();
    const playback = prebuffer.stream("同一段", reading.signal, "serena");
    const pending = playback.next();
    reading.abort(); // The player aborts its reader before voice/reset.
    prebuffer.reset();
    expect(controllers[0].aborted).toBe(true);
    expect((await pending).done).toBe(true);
    // A new voice cannot reuse the cancelled one; its independent synthesis
    // is free to begin and can be cancelled when leaving the article.
    const second = prebuffer.prefetch("同一段", "vivian");
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(2);
    prebuffer.dispose();
    await second;
  });
  it("limits the rolling background queue to four chunks and advances across paragraph boundaries", async () => {
    const generate = vi.fn(async function* () { yield frame(1); }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    for (const text of ["first", "second", "third", "fourth"]) await prebuffer.prefetch(text, "serena");
    expect(generate).toHaveBeenCalledTimes(4);
    expect(prebuffer.isComplete("first", "serena")).toBe(true);
    await prebuffer.prefetch("fifth", "serena");
    expect(generate).toHaveBeenCalledTimes(4);
    prebuffer.retainWindow(["second", "third", "fourth", "fifth"].map(text => ({ text, voice: "serena" })));
    expect(prebuffer.isComplete("first", "serena")).toBe(false);
    await prebuffer.prefetch("fifth", "serena");
    expect(prebuffer.isComplete("fifth", "serena")).toBe(true);
    expect(generate).toHaveBeenCalledTimes(5);
    prebuffer.dispose();
  });

  it("cancels stale in-flight prefetch when moving forward without treating partial PCM as complete", async () => {
    const signaled: AbortSignal[] = [];
    const generate = vi.fn(async function* (_text, signal) {
      signaled.push(signal);
      yield frame(5);
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    const first = prebuffer.prefetch("old paragraph", "serena");
    expect(prebuffer.isComplete("old paragraph", "serena")).toBe(false);
    prebuffer.retainWindow([{ text: "new paragraph", voice: "serena" }]);
    await first;
    expect(signaled[0].aborted).toBe(true);
    expect(prebuffer.isComplete("old paragraph", "serena")).toBe(false);
    prebuffer.dispose();
  });

  it("does not cancel an actively read PCM chunk when a new paragraph lookahead window replaces it", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const calls: AbortSignal[] = [];
    const generate = vi.fn(async function* (_text, signal) {
      calls.push(signal);
      yield frame(10);
      await wait;
      if (!signal.aborted) yield frame(20);
    }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    const warmed = prebuffer.prefetch("第一段", "serena");
    const playback = prebuffer.stream("第一段", new AbortController().signal, "serena");
    const pending = playback.next();
    await Promise.resolve();
    prebuffer.retainWindow([{ text: "第二段", voice: "serena" }]);
    expect(calls[0].aborted).toBe(false);
    release();
    expect((await pending).value?.samples[0]).toBe(10);
    expect((await playback.next()).value?.samples[0]).toBe(20);
    expect((await playback.next()).done).toBe(true);
    await warmed;
    expect(calls[0].aborted).toBe(true); // Evicted only after the active reader finishes.
    expect(generate).toHaveBeenCalledTimes(1);
    prebuffer.dispose();
  });

  it("never replays a sentence from the beginning after partial PCM has already been emitted", async () => {
    const generate = vi.fn(async function* () {
      yield frame(11);
      throw new Error("transient background TTS failure");
    }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    await prebuffer.prefetch("不应重复开头的句子。", "serena");
    const playback = prebuffer.stream("不应重复开头的句子。", new AbortController().signal, "serena");
    expect((await playback.next()).value?.samples[0]).toBe(11);
    await expect(playback.next()).rejects.toThrow("本地语音生成中断");
    expect(generate).toHaveBeenCalledTimes(1);
    prebuffer.dispose();
  });

  it("reports an actionable service error only after automatic recovery attempts also fail", async () => {
    const generate = vi.fn(async function* () {
      throw new Error("temporary model service failure");
    }) as typeof streamChineseListeningTts;
    const prebuffer = new ChineseListeningPrebuffer(generate);
    await prebuffer.prefetch("需要恢复的语音", "serena");
    await expect(read(prebuffer, "需要恢复的语音", "serena"))
      .rejects.toThrow("本地朗读暂时不可用，请检查 TTS 服务后重试");
    expect(generate).toHaveBeenCalledTimes(3); // One warm attempt, two automatic recovery attempts.
    prebuffer.dispose();
  });
});
