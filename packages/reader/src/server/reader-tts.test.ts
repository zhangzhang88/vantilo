import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { buildServer } from "./app.js";
import type { ChineseSpeechSource } from "./services/speech-cpp-tts.js";
import type { QwenTtsVoice } from "../shared/qwen-tts-voices.js";

function fixture() {
  const requests: Array<{ text: string; language?: string; voice?: QwenTtsVoice; seed?: number }> = [];
  const source: ChineseSpeechSource = {
    warm: vi.fn(async () => {}),
    synthesize: vi.fn((text: string, _signal: AbortSignal, language?: "zh" | "en", voice?: QwenTtsVoice, seed?: number) => {
      requests.push({ text, language, voice, seed });
      return Readable.from([
        JSON.stringify({ type: "chunk", pcm: "AAAAAA==", sampleRate: 24000 }) + "\n",
        JSON.stringify({ type: "end", stop: "complete" }) + "\n",
      ]);
    }),
    close: vi.fn(),
  };
  return { source, requests };
}

it("normalizes Chinese numbers, respects explicit language, and streams PCM without MP3", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-language-"));
  const { source, requests } = fixture();
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, speechTtsSource: source });
  try {
    const cases = [
      { payload: { text: "38%", language: "zh-CN" }, text: "百分之三十八", language: "zh" },
      { payload: { text: "38.5％", language: "zh-CN" }, text: "百分之三十八点五", language: "zh" },
      { payload: { text: "这是38%的研究结果。" }, text: "这是百分之三十八的研究结果。", language: "zh" },
      { payload: { text: "38%", language: "en-US" }, text: "38%", language: "en" },
      { payload: { text: "Results rose to 38%." }, text: "Results rose to 38%.", language: "en" },
      { payload: { text: "38%" }, text: "38%", language: "en" },
    ];
    for (const { payload, text, language } of cases) {
      const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["content-type"]).toContain("application/x-ndjson");
      expect(response.body).toContain('"type":"chunk"');
      expect(response.body).toContain('"type":"end"');
      expect(requests.at(-1)).toMatchObject({ text, language });
      expect(requests.at(-1)?.voice).toBe("serena");
    }
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "38%", language: "invalid" } })).statusCode).toBe(400);
    expect(requests).toHaveLength(cases.length);
    expect(source.close).not.toHaveBeenCalled();
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  expect(source.close).toHaveBeenCalledOnce();
});

it("accepts all nine built-in voices and rejects unknown voice parameters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-voices-"));
  const { source, requests } = fixture();
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, speechTtsSource: source });
  try {
    for (const voice of ["serena", "vivian", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"]) {
      const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "测试不同音色。", language: "zh-CN", voice } });
      expect(response.statusCode).toBe(200);
      expect(requests.at(-1)?.voice).toBe(voice);
    }
    const invalid = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "测试", voice: "../../anything" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toContain("音色无效");
    expect(requests).toHaveLength(9);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it("accepts an optional fixed seed and rejects malformed seeds before synthesis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-seed-"));
  const { source, requests } = fixture();
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, speechTtsSource: source });
  try {
    const seeded = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "Alexander Dobrindt", language: "en-US", voice: "aiden", seed: 1234567 } });
    expect(seeded.statusCode).toBe(200);
    expect(requests).toEqual([{ text: "Alexander Dobrindt", language: "en", voice: "aiden", seed: 1234567 }]);
    for (const seed of [-1, 1.25, "1234567", 2_147_483_648, null]) {
      const rejected = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "Hello", seed } });
      expect(rejected.statusCode).toBe(400);
    }
    expect(requests).toHaveLength(1);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it("passes the stable seed and Chinese voice through the audiobook streaming route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-chinese-seed-"));
  const { source, requests } = fixture();
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, speechTtsSource: source });
  try {
    for (const voice of ["serena", "vivian"] as const) {
      const seeded = await app.inject({
        method: "POST", url: "/api/prep/tts",
        payload: { text: "今天的气温是38%。", language: "zh-CN", voice, seed: 1098765 },
      });
      expect(seeded.statusCode).toBe(200);
      expect(seeded.body).toContain('"type":"chunk"');
      expect(seeded.body).toContain('"type":"end"');
      expect(requests.at(-1)).toEqual({
        text: "今天的气温是百分之三十八。", language: "zh", voice, seed: 1098765,
      });
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it("keeps local-only security and does not persist or fall back to Ciallo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-"));
  const { source, requests } = fixture();
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, speechTtsSource: source });
  try {
    expect((await app.inject({ method: "GET", url: "/api/prep/auth" })).json().connected).toBe(false);
    const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "这一段中文可以直接听。" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(requests).toHaveLength(1);
    expect((await readdir(root, { recursive: true })).some(name => name.endsWith(".mp3"))).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", headers: { origin: "https://other.example" }, payload: { text: "中文" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "x".repeat(501) } })).statusCode).toBe(400);
    expect(requests).toHaveLength(1);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
