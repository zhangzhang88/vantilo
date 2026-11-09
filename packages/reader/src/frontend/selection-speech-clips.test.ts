import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionSpeechClipCache, selectionSpeechSeed } from "./selection-speech-clips";
import type { SpeechPcmChunk } from "./chinese-tts-stream";
import type { EnglishQwenTtsVoice } from "../shared/qwen-tts-voices";

const pcm = (value: number, count = 2400): SpeechPcmChunk => ({
  sampleRate: 24000, samples: new Int16Array(count).fill(value),
});
const collect = async (cache: SelectionSpeechClipCache, text: string, voice: EnglishQwenTtsVoice, signal = new AbortController().signal) => {
  const result: SpeechPcmChunk[] = [];
  for await (const frame of cache.synthesize(text, voice, signal)) result.push(frame);
  return result;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("short selection PCM continuity and deterministic session cache", () => {
  it("waits for uneven PCM to complete before yielding one gap-free audio clip", async () => {
    const generation = vi.fn(async function* () {
      yield pcm(1000);
      await new Promise(resolve => setTimeout(resolve, 210));
      yield pcm(2000);
      await new Promise(resolve => setTimeout(resolve, 350));
      yield pcm(3000);
    });
    const cache = new SelectionSpeechClipCache(generation);
    const first = collect(cache, "Alexander Dobrindt", "aiden");
    await vi.advanceTimersByTimeAsync(210);
    await vi.advanceTimersByTimeAsync(350);
    const frames = await first;
    expect(frames).toHaveLength(1);
    expect(frames[0].samples).toHaveLength(7200);
    expect(frames[0].samples[0]).toBe(1000);
    expect(frames[0].samples[2400]).toBe(2000);
    expect(frames[0].samples[4800]).toBe(3000);
    expect(generation).toHaveBeenCalledWith("Alexander Dobrindt", expect.any(AbortSignal), "en-US", "aiden", selectionSpeechSeed("Alexander Dobrindt", "aiden"));

    const repeated = await collect(cache, "Alexander Dobrindt", "aiden");
    expect(repeated).toHaveLength(1);
    expect(repeated[0].samples).toBe(frames[0].samples);
    expect(generation).toHaveBeenCalledTimes(1);
  });

  it("keeps speaker and text identity separate and generates stable per-phrase seeds", async () => {
    const generation = vi.fn(async function* (_text, _signal, _locale, voice) {
      yield pcm(voice === "ryan" ? 2 : 1);
    });
    const cache = new SelectionSpeechClipCache(generation);
    await collect(cache, "Alexander Dobrindt", "aiden");
    await collect(cache, "Alexander Dobrindt", "ryan");
    await collect(cache, "Alexander Dobrindt!", "aiden");
    expect(generation).toHaveBeenCalledTimes(3);
    expect((await collect(cache, "Alexander Dobrindt", "aiden"))[0].samples[0]).toBe(1);
    expect((await collect(cache, "Alexander Dobrindt", "ryan"))[0].samples[0]).toBe(2);
    expect(generation).toHaveBeenCalledTimes(3);
    expect(selectionSpeechSeed("Alexander Dobrindt", "aiden")).toBe(selectionSpeechSeed("Alexander Dobrindt", "aiden"));
    expect(selectionSpeechSeed("Alexander Dobrindt", "aiden")).not.toBe(selectionSpeechSeed("Alexander Dobrindt", "ryan"));
    expect(selectionSpeechSeed("Alexander Dobrindt", "aiden")).toBeGreaterThanOrEqual(0);
    expect(selectionSpeechSeed("Alexander Dobrindt", "aiden")).toBeLessThanOrEqual(2_147_483_647);
  });

  it("never caches an interrupted or failed generation, and can retry later", async () => {
    let attempts = 0;
    const generation = vi.fn(async function* () {
      attempts++;
      yield pcm(900);
      if (attempts === 1) throw new Error("unexpected end");
      yield pcm(1200);
    });
    const cache = new SelectionSpeechClipCache(generation);
    await expect(collect(cache, "late audio", "aiden")).rejects.toThrow("unexpected end");
    const recovered = await collect(cache, "late audio", "aiden");
    expect(recovered[0].samples).toHaveLength(4800);
    expect(generation).toHaveBeenCalledTimes(2);
    await collect(cache, "late audio", "aiden");
    expect(generation).toHaveBeenCalledTimes(2);
  });

  it("cancels a stale delayed selection without emitting or caching its audio", async () => {
    const controller = new AbortController();
    const generation = vi.fn(async function* () {
      yield pcm(200);
      await new Promise(resolve => setTimeout(resolve, 320));
      yield pcm(300);
    });
    const cache = new SelectionSpeechClipCache(generation);
    const pending = collect(cache, "old selection", "aiden", controller.signal);
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await vi.advanceTimersByTimeAsync(320);
    expect(await pending).toEqual([]);
    const retry = collect(cache, "old selection", "aiden");
    await vi.advanceTimersByTimeAsync(320);
    expect(await retry).toHaveLength(1);
    expect(generation).toHaveBeenCalledTimes(2);
  });

  it("does not accept empty or oversized generated audio", async () => {
    const empty = new SelectionSpeechClipCache(async function* () { /* no frames */ });
    await expect(collect(empty, "empty", "aiden")).rejects.toThrow("未返回完整");
    const oversized = new SelectionSpeechClipCache(async function* () { yield pcm(100, 24000 * 16 + 1); });
    await expect(collect(oversized, "abnormal", "aiden")).rejects.toThrow("异常");
    const wrongRate = new SelectionSpeechClipCache(async function* () { yield { sampleRate: 16000, samples: new Int16Array(80) }; });
    await expect(collect(wrongRate, "wrong rate", "aiden")).rejects.toThrow("异常");
  });

  it("evicts older cached clips beyond the bounded LRU size", async () => {
    const generation = vi.fn(async function* () { yield pcm(333); });
    const cache = new SelectionSpeechClipCache(generation);
    for (let i = 0; i < 25; i++) await collect(cache, `phrase ${i}`, "aiden");
    await collect(cache, "phrase 24", "aiden");
    expect(generation).toHaveBeenCalledTimes(25);
    await collect(cache, "phrase 0", "aiden");
    expect(generation).toHaveBeenCalledTimes(26);
  });

  it("permits intentional regeneration with a fresh seed without losing the previous good clip on failure", async () => {
    let generationCount = 0;
    const generate = vi.fn(async function* () {
      generationCount++;
      if (generationCount === 3) throw new Error("model failed to regenerate");
      yield pcm(generationCount, generationCount === 2 ? 4800 : 2400);
    });
    const cache = new SelectionSpeechClipCache(generate);
    expect((await collect(cache, "Alexander Dobrindt", "aiden"))[0].samples[0]).toBe(1);
    const refreshed = [];
    for await (const frame of cache.synthesize("Alexander Dobrindt", "aiden", new AbortController().signal, true)) refreshed.push(frame);
    expect(refreshed[0].samples[0]).toBe(2);
    expect(refreshed[0].samples).toHaveLength(4800);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][4]).not.toBe(generate.mock.calls[1][4]);
    await expect((async () => {
      for await (const _frame of cache.synthesize("Alexander Dobrindt", "aiden", new AbortController().signal, true)) { /* drain */ }
    })()).rejects.toThrow("failed to regenerate");
    expect((await collect(cache, "Alexander Dobrindt", "aiden"))[0].samples[0]).toBe(2);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("streams initial sentence PCM immediately while storing the complete audio for a later replay", async () => {
    const generation = vi.fn(async function* () {
      yield pcm(123, 2400);
      await new Promise(resolve => setTimeout(resolve, 350));
      yield pcm(456, 4800);
    });
    const cache = new SelectionSpeechClipCache(generation);
    const iterator = cache.stream("Alexander Dobrindt spoke.", "aiden", new AbortController().signal);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.samples).toHaveLength(2400);
    const waitingForSecond = iterator.next();
    await vi.advanceTimersByTimeAsync(350);
    const second = await waitingForSecond;
    expect(second.value?.samples).toHaveLength(4800);
    expect((await iterator.next()).done).toBe(true);
    const replay = [];
    for await (const chunk of cache.stream("Alexander Dobrindt spoke.", "aiden", new AbortController().signal)) replay.push(chunk);
    expect(replay).toHaveLength(1);
    expect(replay[0].samples).toHaveLength(7200);
    expect(replay[0].samples[0]).toBe(123);
    expect(replay[0].samples[2400]).toBe(456);
    expect(generation).toHaveBeenCalledTimes(1);
  });

  it("shares the completed English PCM between sentence streaming and selected-text full playback", async () => {
    const generation = vi.fn(async function* () { yield pcm(888); yield pcm(999); });
    const cache = new SelectionSpeechClipCache(generation);
    for await (const _ of cache.stream("Alexander Dobrindt", "ryan", new AbortController().signal)) { /* first streaming play */ }
    const fromSelection = await collect(cache, "Alexander Dobrindt", "ryan");
    expect(fromSelection).toHaveLength(1);
    expect(fromSelection[0].samples).toHaveLength(4800);
    expect(generation).toHaveBeenCalledTimes(1);
  });

  it("does not cache an aborted or failed sentence, including one that already streamed a first chunk", async () => {
    let attempt = 0;
    const generation = vi.fn(async function* () {
      attempt++;
      yield pcm(88);
      if (attempt === 1) throw new Error("truncated response");
      yield pcm(99);
    });
    const cache = new SelectionSpeechClipCache(generation);
    const first = cache.stream("a test sentence", "aiden", new AbortController().signal);
    expect((await first.next()).value?.samples[0]).toBe(88);
    await expect(first.next()).rejects.toThrow("truncated response");
    for await (const _ of cache.stream("a test sentence", "aiden", new AbortController().signal)) { /* retry */ }
    expect(generation).toHaveBeenCalledTimes(2);
    const replay = [];
    for await (const chunk of cache.stream("a test sentence", "aiden", new AbortController().signal)) replay.push(chunk);
    expect(replay).toHaveLength(1);
    expect(generation).toHaveBeenCalledTimes(2);
  });

  it("clears cached audio when the TTS provider or configuration changes", async () => {
    const generation = vi.fn(async function* () { yield pcm(123); });
    const cache = new SelectionSpeechClipCache(generation);
    await collect(cache, "Hello again.", "aiden");
    await collect(cache, "Hello again.", "aiden");
    expect(generation).toHaveBeenCalledTimes(1);
    cache.clear();
    await collect(cache, "Hello again.", "aiden");
    expect(generation).toHaveBeenCalledTimes(2);
  });

  it("keeps long English sentence playback streaming without an unbounded cache", async () => {
    const generation = vi.fn(async function* () {
      yield pcm(111, 24000 * 30);
      yield pcm(222, 24000 * 20);
    });
    const cache = new SelectionSpeechClipCache(generation);
    const first = [];
    for await (const chunk of cache.stream("a long sentence", "aiden", new AbortController().signal)) first.push(chunk);
    expect(first).toHaveLength(2);
    expect(first[0].samples.length + first[1].samples.length).toBe(24000 * 50);
    const second = [];
    for await (const chunk of cache.stream("a long sentence", "aiden", new AbortController().signal)) second.push(chunk);
    expect(second).toHaveLength(2);
    expect(generation).toHaveBeenCalledTimes(2);
  });
});
