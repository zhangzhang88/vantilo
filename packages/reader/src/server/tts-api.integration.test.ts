import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReadableStream } from "node:stream/web";
import { describe, expect, it, vi } from "vitest";
import { HttpSpeechTts } from "./services/http-speech-tts.js";
import { MY_VOICE_BASE_URL, MY_VOICE_MODEL, TtsApiSettingsService, validateTtsApiBaseUrl } from "./services/tts-api-settings-service.js";
import { buildServer } from "./app.js";

const config = { baseUrl: "http://192.168.3.54:18439/v1", model: "qwen3-tts-0.6b", apiKey: "test-only-key" };

describe("Independent Qwen TTS API", () => {
  it("keeps the private bf16 profile separate from the existing CustomVoice settings and never exposes either API key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reader-dual-tts-"));
    try {
      const original = await TtsApiSettingsService.create(root);
      const clone = await TtsApiSettingsService.create(root, "my_voice");
      expect(clone.publicSettings()).toMatchObject({ mode: "worker", model: MY_VOICE_MODEL, hasApiKey: false });
      await original.save(config);
      await clone.save({ baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: "private-clone-test-key" });
      expect(clone.publicSettings()).toMatchObject({ mode: "api", model: MY_VOICE_MODEL, baseUrl: MY_VOICE_BASE_URL, hasApiKey: true });
      expect(original.publicSettings()).toMatchObject({ mode: "api", model: config.model, baseUrl: config.baseUrl });
      expect(JSON.stringify(clone.publicSettings())).not.toContain("private-clone-test-key");
      expect((await stat(path.join(root, "tts", "tts-api-my-voice.local.json"))).mode & 0o077).toBe(0);
      const restored = await TtsApiSettingsService.create(root, "my_voice");
      expect(restored.resolveDraft({ baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: "" }).apiKey).toBe("private-clone-test-key");
      expect((await readFile(path.join(root, "tts", "tts-api.local.json"), "utf8"))).toContain(config.apiKey);
      expect((await readFile(path.join(root, "tts", "tts-api-my-voice.local.json"), "utf8"))).not.toContain(config.apiKey);
      expect(() => restored.resolveDraft({ ...config, apiKey: "any" })).toThrow("模型");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("routes my_voice only to bf16 while the existing Chinese and English voice routes stay unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reader-dual-tts-routing-"));
    const network: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request, opts?: RequestInit) => {
      if (String(url).endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      const body = JSON.parse(String(opts?.body)) as Record<string, unknown>;
      network.push({ url: String(url), body, auth: new Headers(opts?.headers).get("authorization") ?? "" });
      return new Response(new Uint8Array([0, 0, 1, 0]), { headers: { "content-type": "audio/pcm" } });
    });
    vi.stubGlobal("fetch", fakeFetch);
    const app = await buildServer({ projectRoot: root, ttsApiSettingsRoot: root, serveFrontend: false, aiProviderEnv: {} });
    try {
      expect((await app.inject({ method: "POST", url: "/api/prep/tts",
        payload: { text: "你好", language: "zh-CN", voice: "my_voice" } })).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: "/api/prep/tts",
        payload: { text: "Hello", language: "en-US", voice: "my_voice" } })).statusCode).toBe(400);
      const original = await app.inject({ method: "PUT", url: "/api/tts-settings", payload: config });
      expect(original.statusCode).toBe(200);
      const clone = await app.inject({ method: "PUT", url: "/api/tts-settings/my-voice",
        payload: { baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: "separate-secret-test-only" } });
      expect(clone.statusCode).toBe(200);
      expect(clone.body).not.toContain("separate-secret-test-only");
      expect((await app.inject({ method: "POST", url: "/api/tts-settings/my-voice/test",
        payload: { baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: "" } })).statusCode).toBe(200);
      for (const [voice, language, text, seed] of [
        ["my_voice", "zh-CN", "我的中文朗读。", 1234],
        ["serena", "zh-CN", "原来的声音。", 2345],
        ["aiden", "en-US", "English voice.", 3456],
      ] as const) {
        const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text, voice, language, seed } });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('"type":"end"');
      }
      expect(network).toHaveLength(3);
      expect(network[0]).toMatchObject({ url: MY_VOICE_BASE_URL + "/audio/speech", auth: "Bearer separate-secret-test-only",
        body: { voice: "my_voice", model: MY_VOICE_MODEL, seed: 1234, language: "zh" } });
      expect(network[1]).toMatchObject({ url: config.baseUrl + "/audio/speech", auth: "Bearer " + config.apiKey,
        body: { voice: "serena", model: config.model, seed: 2345 } });
      expect(network[2]).toMatchObject({ url: config.baseUrl + "/audio/speech",
        body: { voice: "aiden", language: "en", seed: 3456 } });
      expect((await app.inject({ method: "GET", url: "/api/tts-settings" })).json().baseUrl).toBe(config.baseUrl);
      expect((await app.inject({ method: "GET", url: "/api/tts-settings/my-voice" })).json().baseUrl).toBe(MY_VOICE_BASE_URL);
    } finally {
      await app.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true });
    }
  });
  it("only accepts local/private IP literals and saves credentials under 0600 without exposing them", async () => {
    expect(validateTtsApiBaseUrl(config.baseUrl)).toBe(config.baseUrl);
    for (const url of ["https://example.com/v1", "http://public.example/v1", "http://8.8.8.8/v1",
      "http://127.0.0.1:18439/internal", "http://127.0.0.1:18439/v1?token=secret",
      "http://name:secret@127.0.0.1:18439/v1"]) {
      expect(() => validateTtsApiBaseUrl(url), url).toThrow();
    }
    const root = await mkdtemp(path.join(tmpdir(), "reader-tts-settings-"));
    try {
      const settings = await TtsApiSettingsService.create(root);
      expect(settings.publicSettings()).toMatchObject({ mode: "worker", hasApiKey: false });
      expect(await settings.save(config)).toMatchObject({
        mode: "api", baseUrl: config.baseUrl, hasApiKey: true,
      });
      expect(JSON.stringify(settings.publicSettings())).not.toContain(config.apiKey);
      const filepath = path.join(root, "tts", "tts-api.local.json");
      expect((await stat(filepath)).mode & 0o077).toBe(0);
      expect((await readFile(filepath, "utf8"))).toContain(config.apiKey);
      const reopened = await TtsApiSettingsService.create(root);
      expect(reopened.resolveDraft({ ...config, apiKey: "" }).apiKey).toBe(config.apiKey);
      expect(() => reopened.resolveDraft({ ...config, baseUrl: "http://192.168.3.55:18439/v1", apiKey: "" })).toThrow("API Key");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reframes arbitrarily split raw PCM to NDJSON with unchanged samples, selected language and speaker", async () => {
    const expected = Buffer.from([0, 128, 0, 0, 255, 127, 33, 1]);
    const calls: Array<{ url: string; body: Record<string, unknown> | null; auth: string | undefined }> = [];
    const fake = vi.fn(async (url: string | URL | Request, opts?: RequestInit) => {
      calls.push({
        url: String(url),
        body: opts?.body ? JSON.parse(String(opts.body)) : null,
        auth: new Headers(opts?.headers).get("authorization") ?? undefined,
      });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(expected.subarray(0, 1));
          controller.enqueue(expected.subarray(1, 5));
          controller.enqueue(expected.subarray(5));
          controller.close();
        },
      }) as unknown as BodyInit, { status: 200, headers: { "content-type": "audio/pcm" } });
    });
    const service = new HttpSpeechTts(() => config, fake as typeof fetch);
    const lines: Array<{ type: string; pcm?: string; sampleRate?: number; stop?: string }> = [];
    try {
      for await (const raw of service.synthesize("Hello.", new AbortController().signal, "en", "aiden")) {
        for (const line of String(raw).split("\n").filter(Boolean)) lines.push(JSON.parse(line));
      }
      expect(lines.at(-1)).toMatchObject({ type: "end", stop: "complete" });
      const received = Buffer.concat(lines.filter(line => line.type === "chunk").map(line => Buffer.from(line.pcm!, "base64")));
      expect(received).toEqual(expected);
      expect(lines.every(line => line.type !== "chunk" || line.sampleRate === 24000)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(config.baseUrl + "/audio/speech");
      expect(calls[0].body).toMatchObject({ input: "Hello.", model: "qwen3-tts-0.6b", voice: "aiden", language: "en", response_format: "pcm" });
      expect(calls[0].auth).toBe("Bearer test-only-key");
    } finally { service.close(); }
  });

  it("retries without seed when an older local gateway rejects the optional field", async () => {
    const sent: Record<string, unknown>[] = [];
    const fake = vi.fn(async (_url: string | URL | Request, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body)) as Record<string, unknown>;
      sent.push(body);
      if (body.seed !== undefined) return new Response("Unsupported request parameter", { status: 400 });
      return new Response(new Uint8Array([0, 0, 5, 0]), { headers: { "content-type": "audio/pcm" } });
    });
    const service = new HttpSpeechTts(() => config, fake as typeof fetch);
    try {
      let combined = "";
      for await (const item of service.synthesize("Alexander Dobrindt", new AbortController().signal, "en", "aiden", 12345)) combined += String(item);
      expect(combined).toContain('"type":"end"');
      expect(sent).toHaveLength(2);
      expect(sent[0].seed).toBe(12345);
      expect(sent[1]).not.toHaveProperty("seed");
      expect(sent[1].input).toBe("Alexander Dobrindt");
      for await (const _item of service.synthesize("A second phrase", new AbortController().signal, "en", "aiden", 67890)) { /* drain */ }
      expect(sent).toHaveLength(3);
      expect(sent[2]).not.toHaveProperty("seed");
    } finally { service.close(); }
  });

  it("reports unauthorized API errors as a safe stream message without leaking credentials", async () => {
    const service = new HttpSpeechTts(() => config, vi.fn(async () => new Response("", { status: 401 })) as typeof fetch);
    try {
      let combined = "";
      for await (const data of service.synthesize("Secret text", new AbortController().signal)) combined += String(data);
      expect(combined).toContain("TTS API Key 无效");
      expect(combined).not.toContain("test-only-key");
      expect(combined).not.toContain("Secret text");
    } finally { service.close(); }
  });

  it("accepts local settings only via Reader localhost routes and never returns the saved API Key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reader-tts-api-route-"));
    const app = await buildServer({ projectRoot: root, ttsApiSettingsRoot: root, serveFrontend: false, aiProviderEnv: {} });
    try {
      const unauthorized = await app.inject({ method: "GET", url: "/api/tts-settings", headers: { origin: "https://remote.invalid" } });
      expect(unauthorized.statusCode).toBe(403);
      const saved = await app.inject({ method: "PUT", url: "/api/tts-settings", payload: config });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ mode: "api", hasApiKey: true, baseUrl: config.baseUrl });
      expect(saved.body).not.toContain(config.apiKey);
      const status = await app.inject({ method: "GET", url: "/api/tts-settings" });
      expect(status.json().mode).toBe("api");
      expect(status.body).not.toContain(config.apiKey);
      expect((await app.inject({ method: "PUT", url: "/api/tts-settings", payload: { ...config, baseUrl: "http://example.org/v1" } })).statusCode).toBe(400);
    } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  });
});
