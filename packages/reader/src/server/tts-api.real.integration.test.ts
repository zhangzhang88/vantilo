import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildServer } from "./app.js";

/** Opt-in actual speech.cpp HTTP test; the Reader uses an isolated synthetic library.
 * The API key is read only from a caller-provided private file, never logged. */
it.skipIf(process.env.VANTILO_TTS_REAL_API !== "1")(
  "converts real LAN Qwen3-TTS HTTP PCM into Reader NDJSON without starting a second model",
  async () => {
    const keyPath = process.env.VANTILO_TTS_KEY_FILE;
    if (!keyPath) throw new Error("VANTILO_TTS_KEY_FILE required");
    const key = (await readFile(keyPath, "utf8")).trim();
    const root = await mkdtemp(path.join(tmpdir(), "reader-tts-real-api-"));
    const app = await buildServer({ projectRoot: root, ttsApiSettingsRoot: root, serveFrontend: false, aiProviderEnv: {} });
    try {
      const url = process.env.VANTILO_TTS_BASE_URL ?? "http://127.0.0.1:18439/v1";
      const saved = await app.inject({ method: "PUT", url: "/api/tts-settings",
        payload: { baseUrl: url, model: "qwen3-tts-0.6b", apiKey: key } });
      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain(key);
      const test = await app.inject({ method: "POST", url: "/api/tts-settings/test",
        payload: { baseUrl: url, model: "qwen3-tts-0.6b", apiKey: "" } });
      expect(test.statusCode).toBe(200);
      for (const [language, voice, text] of [
        ["en-US", "aiden", "Hello, this is my English sentence reading."],
        ["zh-CN", "serena", "你好，这是中文听书的声音。"],
      ]) {
        const response = await app.inject({ method: "POST", url: "/api/prep/tts", payload: { text, language, voice } });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("application/x-ndjson");
        const frames = response.body.trim().split("\n").map(line => JSON.parse(line) as { type: string; pcm?: string; stop?: string });
        expect(frames.some(frame => frame.type === "chunk" && frame.pcm && Buffer.from(frame.pcm, "base64").length > 0), voice).toBe(true);
        expect(frames.at(-1), voice).toMatchObject({ type: "end", stop: "complete" });
      }
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000,
);
