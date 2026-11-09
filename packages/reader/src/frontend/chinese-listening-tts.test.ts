import { describe, expect, it, vi } from "vitest";
import { streamChineseListeningTts } from "./chinese-listening-tts";
import { qwenTtsSeed } from "../shared/qwen-tts-seed";
import { streamChineseTts } from "./chinese-tts-stream";

describe("Chinese audiobook stable seed transport", () => {
  it("passes the exact Chinese chunk, selected voice and repeatable seed without changing PCM frames", async () => {
    const chunk = "过去几年，这家公司一直在研究区块链。";
    const first = { sampleRate: 24000, samples: new Int16Array([1, -2, 3]) };
    const second = { sampleRate: 24000, samples: new Int16Array([4, -5]) };
    const generate = vi.fn(async function* () {
      yield first;
      yield second;
    }) as typeof streamChineseTts;
    const controller = new AbortController();
    const result = [];
    for await (const frame of streamChineseListeningTts(chunk, controller.signal, "serena", generate)) result.push(frame);
    expect(result).toEqual([first, second]);
    expect(generate).toHaveBeenCalledWith(chunk, controller.signal, "zh-CN", "serena", qwenTtsSeed(chunk, "serena"));
    for await (const _frame of streamChineseListeningTts(chunk, controller.signal, "serena", generate)) { /* repeat */ }
    expect(generate.mock.calls[1][4]).toBe(generate.mock.calls[0][4]);
  });

  it("changes the seed when the voice or chunk changes, without changing the chosen voice", async () => {
    const generate = vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array([100]) };
    }) as typeof streamChineseTts;
    const controller = new AbortController();
    for await (const _ of streamChineseListeningTts("你好，世界。", controller.signal, "serena", generate)) {}
    for await (const _ of streamChineseListeningTts("你好，世界。", controller.signal, "vivian", generate)) {}
    for await (const _ of streamChineseListeningTts("你好，未来。", controller.signal, "serena", generate)) {}
    expect(generate.mock.calls.map(call => call[3])).toEqual(["serena", "vivian", "serena"]);
    const [a, b, c] = generate.mock.calls.map(call => call[4]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
  it("uses a distinct stable seed and dedicated my_voice identifier", async () => {
    const generate = vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array([1]) };
    }) as typeof streamChineseTts;
    const signal = new AbortController().signal;
    for await (const _ of streamChineseListeningTts("新的声音。", signal, "my_voice", generate)) {}
    for await (const _ of streamChineseListeningTts("新的声音。", signal, "my_voice", generate)) {}
    expect(generate.mock.calls[0]).toEqual(["新的声音。", signal, "zh-CN", "my_voice", qwenTtsSeed("新的声音。", "my_voice")]);
    expect(generate.mock.calls[1][4]).toBe(generate.mock.calls[0][4]);
    expect(qwenTtsSeed("新的声音。", "my_voice")).not.toBe(qwenTtsSeed("新的声音。", "serena"));
  });

  it("retains the original streaming and abort behavior, rather than buffering a whole paragraph", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const secondReady = new Promise<void>(resolve => { finish = resolve; });
    const generate = vi.fn(async function* () {
      yield { sampleRate: 24000, samples: new Int16Array([11]) };
      await secondReady;
      if (!controller.signal.aborted) yield { sampleRate: 24000, samples: new Int16Array([22]) };
    }) as typeof streamChineseTts;
    const stream = streamChineseListeningTts("可以继续朗读。", controller.signal, "uncle_fu", generate);
    expect((await stream.next()).value?.samples[0]).toBe(11);
    controller.abort();
    finish();
    expect((await stream.next()).done).toBe(true);
    expect(generate.mock.calls[0][1]).toBe(controller.signal);
  });
});
