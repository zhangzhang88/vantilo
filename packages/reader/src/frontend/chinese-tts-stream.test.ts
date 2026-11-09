import { afterEach, expect, it, vi } from "vitest";
import { streamChineseTts } from "./chinese-tts-stream";

afterEach(() => vi.unstubAllGlobals());

function responseWithFrames(...frames: object[]) {
  const text = frames.map(frame => JSON.stringify(frame) + "\n").join("");
  const encoded = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliberately split a JSON line mid-codepoint / mid-base64 field.
      controller.enqueue(encoded.slice(0, 11));
      controller.enqueue(encoded.slice(11));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

it("starts decoding PCM frames while streaming without waiting for an MP3 Blob", async () => {
  const pcm = Buffer.from([0, 128, 0, 0, 255, 127]).toString("base64");
  const fetchMock = vi.fn(async () => responseWithFrames({ type: "chunk", sampleRate: 24000, pcm }, { type: "end", stop: "complete" }));
  vi.stubGlobal("fetch", fetchMock);
  const results = [];
  for await (const part of streamChineseTts("中文朗读", new AbortController().signal)) results.push(part);
  expect(results).toHaveLength(1);
  expect([...results[0].samples]).toEqual([-32768, 0, 32767]);
  expect(fetchMock.mock.calls).toHaveLength(1);
});

it("rejects unfinished or truncated model output instead of silently skipping speech", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => responseWithFrames({ type: "chunk", pcm: "AAAAAA==", sampleRate: 24000 }, { type: "end", stop: "model_limit" })));
  await expect((async () => { for await (const _chunk of streamChineseTts("中文", new AbortController().signal)) { /* drain */ } })()).rejects.toThrow("没有完整生成");
});

it("shows a meaningful error instead of falling back to third-party TTS", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => responseWithFrames({ type: "error", message: "本地模型未找到" })));
  await expect((async () => { for await (const _chunk of streamChineseTts("中文", new AbortController().signal)) { /* drain */ } })()).rejects.toThrow("本地模型未找到");
});

it("sends the selected voice in the streaming request and keeps the same PCM format", async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return responseWithFrames({ type: "chunk", pcm: "AAAAAA==", sampleRate: 24000 }, { type: "end", stop: "complete" });
  }));
  let chunks = 0;
  for await (const _chunk of streamChineseTts("测试", new AbortController().signal, "zh-CN", "uncle_fu")) chunks++;
  expect(chunks).toBe(1);
  expect(body).toMatchObject({ text: "测试", language: "zh-CN", voice: "uncle_fu" });
  expect(body).not.toHaveProperty("seed");
});

it("sends a stable seed only for explicitly seeded speech requests", async () => {
  let body: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return responseWithFrames({ type: "chunk", pcm: "AAAAAA==", sampleRate: 24000 }, { type: "end", stop: "complete" });
  }));
  for await (const _chunk of streamChineseTts("Alexander Dobrindt", new AbortController().signal, "en-US", "aiden", 1234567)) { /* drain */ }
  expect(body).toMatchObject({ text: "Alexander Dobrindt", language: "en-US", voice: "aiden", seed: 1234567 });
});
