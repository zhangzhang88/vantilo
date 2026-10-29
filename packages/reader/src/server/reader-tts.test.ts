import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { buildServer } from "./app.js";

it("pins numeric Chinese chunks to Chinese speech while preserving English and legacy language detection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-language-"));
  const requests: Array<{ text: string; voice: string }> = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    requests.push(JSON.parse(options!.body as string));
    return new Response("ID3temporary", { headers: { "Content-Type": "audio/mpeg" } });
  });
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, cialloTtsFetchImpl: fetchImpl });
  try {
    const cases = [
      { payload: { text: "38%", language: "zh-CN" }, text: "百分之三十八", voice: "zh-CN-XiaochenMultilingualNeural" },
      { payload: { text: "38.5％", language: "zh-CN" }, text: "百分之三十八点五", voice: "zh-CN-XiaochenMultilingualNeural" },
      { payload: { text: "这是38%的研究结果。" }, text: "这是百分之三十八的研究结果。", voice: "zh-CN-XiaochenMultilingualNeural" },
      { payload: { text: "38%", language: "en-US" }, text: "38%", voice: "en-US-AriaNeural" },
      { payload: { text: "Results rose to 38%." }, text: "Results rose to 38%.", voice: "en-US-AriaNeural" },
      { payload: { text: "38%" }, text: "38%", voice: "en-US-AriaNeural" },
    ];
    for (const { payload, text, voice } of cases) {
      const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(requests.at(-1)).toMatchObject({ text, voice });
    }
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "38%", language: "invalid" } })).statusCode).toBe(400);
    expect(requests).toHaveLength(cases.length);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it("reuses local Ciallo narration without OAuth, credentials, persistent audio or paid fallbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-reader-tts-"));
  const fetchImpl = vi.fn(async () => new Response("ID3temporary", { headers: { "Content-Type": "audio/mpeg" } }));
  const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, cialloTtsFetchImpl: fetchImpl });
  try {
    expect((await app.inject({ method: "GET", url: "/api/prep/auth" })).json().connected).toBe(false);
    const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "这一段中文可以直接听。" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tts.ztr8.uk/api/tts");
    expect(JSON.parse(options.body as string)).toMatchObject({ voice: "zh-CN-XiaochenMultilingualNeural", rate: 0, pitch: 0 });
    expect(JSON.stringify(options.headers)).not.toMatch(/authorization|token|api.key/i);
    expect((await readdir(root, { recursive: true })).some(name => name.endsWith(".mp3"))).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", headers: { origin: "https://other.example" }, payload: { text: "中文" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "x".repeat(12_001) } })).statusCode).toBe(400);
    fetchImpl.mockImplementationOnce(async () => new Response("not mp3", { headers: { "Content-Type": "audio/mpeg" } }));
    expect((await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text: "中文" } })).statusCode).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
