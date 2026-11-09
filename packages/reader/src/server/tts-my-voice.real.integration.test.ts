import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildServer } from "./app.js";
import { MY_VOICE_BASE_URL, MY_VOICE_MODEL } from "./services/tts-api-settings-service.js";

/** Opt-in and isolated. Never sends the personal voice or key to a public API.
 * Uses the real locally running Base bf16 service at 127.0.0.1:18441. */
it.skipIf(process.env.VANTILO_MY_VOICE_REAL_API !== "1")(
  "routes Chinese audiobook my_voice through the real bf16 API with a stable seed without touching the old provider",
  async () => {
    const keyFile = process.env.VANTILO_MY_VOICE_KEY_FILE;
    if (!keyFile) throw new Error("VANTILO_MY_VOICE_KEY_FILE must identify the private local API key");
    const key = (await readFile(keyFile, "utf8")).trim();
    const root = await mkdtemp(path.join(tmpdir(), "reader-private-tts-real-"));
    const app = await buildServer({ projectRoot: root, ttsApiSettingsRoot: root, serveFrontend: false, aiProviderEnv: {} });
    try {
      const saved = await app.inject({ method: "PUT", url: "/api/tts-settings/my-voice",
        payload: { baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: key } });
      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain(key);
      const tested = await app.inject({ method: "POST", url: "/api/tts-settings/my-voice/test",
        payload: { baseUrl: MY_VOICE_BASE_URL, model: MY_VOICE_MODEL, apiKey: "" } });
      expect(tested.statusCode).toBe(200);
      const hashes: string[] = [];
      for (let i = 0; i < 2; i++) {
        const answer = await app.inject({ method: "POST", url: "/api/prep/tts",
          payload: { text: "这是我的声音，欢迎收听。", language: "zh-CN", voice: "my_voice", seed: 20261109 } });
        expect(answer.statusCode).toBe(200);
        expect(answer.headers["content-type"]).toContain("application/x-ndjson");
        const frames = answer.body.trim().split("\n").map(line => JSON.parse(line) as { type: string; pcm?: string; sampleRate?: number; stop?: string });
        expect(frames.at(-1)).toMatchObject({ type: "end", stop: "complete" });
        const pcm = Buffer.concat(frames.filter(frame => frame.type === "chunk").map(frame => {
          expect(frame.sampleRate).toBe(24000);
          return Buffer.from(frame.pcm!, "base64");
        }));
        expect(pcm.length).toBeGreaterThan(10000);
        hashes.push(createHash("sha256").update(pcm).digest("hex"));
      }
      expect(hashes[1]).toEqual(hashes[0]);
      const originals = (await app.inject({ method: "GET", url: "/api/tts-settings" })).json();
      expect(originals.hasApiKey).toBe(false);
      expect((await app.inject({ method: "POST", url: "/api/prep/tts",
        payload: { text: "Hello", language: "en-US", voice: "my_voice" } })).statusCode).toBe(400);
    } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  }, 120_000,
);
