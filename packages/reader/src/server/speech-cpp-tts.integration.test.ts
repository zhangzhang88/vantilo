import { expect, it } from "vitest";
import { SpeechCppTts } from "./services/speech-cpp-tts.js";

/** Opt-in hardware smoke: requires the already verified local speech.cpp binary and GGUF; never downloads. */
it.skipIf(process.env.VANTILO_TTS_INTEGRATION !== "1")("streams genuine Qwen3-TTS PCM on the local Metal worker", async () => {
  const service = new SpeechCppTts();
  const controller = new AbortController();
  try {
    await service.warm();
    for (const voice of ["serena", "uncle_fu"] as const) {
      const frames: Array<{ type?: string; pcm?: string; sampleRate?: number; stop?: string }> = [];
      for await (const data of service.synthesize("你好，这是来自本地模型的中文声音。", controller.signal, "zh", voice)) {
        for (const line of data.toString().trim().split("\n").filter(Boolean)) frames.push(JSON.parse(line));
      }
      expect(frames.some(frame => frame.type === "chunk" && frame.sampleRate === 24000 && !!frame.pcm), voice).toBe(true);
      expect(frames.at(-1), voice).toMatchObject({ type: "end", stop: "complete" });
    }
  } finally {
    controller.abort();
    service.close();
  }
}, 60000);

it.skipIf(process.env.VANTILO_TTS_INTEGRATION !== "1")("generates real English PCM with both Aiden and Ryan without network TTS", async () => {
  const service = new SpeechCppTts();
  const controller = new AbortController();
  try {
    await service.warm();
    for (const voice of ["aiden", "ryan"] as const) {
      let chunks = 0;
      let nonSilent = false;
      let complete = false;
      for await (const data of service.synthesize("This is a short sentence for English listening practice.", controller.signal, "en", voice)) {
        for (const line of data.toString().trim().split("\n").filter(Boolean)) {
          const frame = JSON.parse(line) as { type?: string; pcm?: string; stop?: string; sampleRate?: number };
          if (frame.type === "chunk") {
            expect(frame.sampleRate).toBe(24000);
            chunks++;
            if (frame.pcm) {
              const pcm = Buffer.from(frame.pcm, "base64");
              for (let i = 0; i + 1 < pcm.length; i += 2) {
                if (Math.abs(pcm.readInt16LE(i)) > 500) { nonSilent = true; break; }
              }
            }
          }
          if (frame.type === "end") complete = frame.stop === "complete";
        }
      }
      expect(chunks, `${voice}: missing PCM`).toBeGreaterThan(0);
      expect(nonSilent, `${voice}: only silence`).toBe(true);
      expect(complete, `${voice}: synthesis did not finish`).toBe(true);
    }
  } finally {
    controller.abort();
    service.close();
  }
}, 60000);
