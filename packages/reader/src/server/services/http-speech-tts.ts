import { PassThrough, type Readable } from "node:stream";
import type { QwenTtsVoice } from "../../shared/qwen-tts-voices.js";
import type { ChineseSpeechSource } from "./speech-cpp-tts.js";
import type { TtsApiProfile } from "./tts-api-settings-service.js";

const FRAME_BYTES = 8192;
const errorText = (status: number) => {
  if (status === 401 || status === 403) return "TTS API Key 无效或未授权";
  if (status === 429) return "TTS 服务繁忙，请稍后重试";
  return `TTS API 请求失败（HTTP ${status}）`;
};

/** Convert raw 24 kHz, mono, signed 16-bit PCM from speech.cpp HTTP to the
 * Reader's incremental NDJSON protocol. The browser still uses WebAudio PCM. */
export class HttpSpeechTts implements ChineseSpeechSource {
  private active = new Set<AbortController>();
  private closed = false;
  private supportsSeed: boolean | undefined;
  constructor(private profile: () => TtsApiProfile | null, private fetchImpl: typeof fetch = fetch) {}

  async warm() {
    const profile = this.profile();
    if (!profile) throw new Error("尚未配置 TTS API");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = profile.baseUrl.replace(/\/v1$/, "") + "/health";
      const response = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${profile.apiKey}` },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error(errorText(response.status));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TTS API")) throw error;
      throw new Error("无法连接 TTS API，请检查地址、服务和局域网");
    } finally { clearTimeout(timeout); }
  }

  synthesize(text: string, signal: AbortSignal, language: "zh" | "en" = "zh", voice: QwenTtsVoice | "my_voice" = "serena", seed?: number): Readable {
    const output = new PassThrough({ highWaterMark: 128 * 1024 });
    if (this.closed) { output.end(JSON.stringify({ type: "error", message: "TTS API 已关闭" }) + "\n"); return output; }
    const profile = this.profile();
    if (!profile) { output.end(JSON.stringify({ type: "error", message: "尚未配置 TTS API" }) + "\n"); return output; }
    const controller = new AbortController();
    this.active.add(controller);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    output.once("close", abort);
    if (signal.aborted) controller.abort();
    void this.produce(output, profile, text, language, voice, controller, seed).finally(() => {
      this.active.delete(controller);
      signal.removeEventListener("abort", abort);
      output.off("close", abort);
    });
    return output;
  }

  private async produce(
    output: PassThrough, profile: TtsApiProfile, text: string, language: "zh" | "en",
    voice: QwenTtsVoice | "my_voice", controller: AbortController, seed?: number,
  ) {
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const send = (requestSeed?: number) => this.fetchImpl(profile.baseUrl + "/audio/speech", {
        method: "POST", redirect: "error",
        headers: { "content-type": "application/json", authorization: `Bearer ${profile.apiKey}` },
        body: JSON.stringify({
          model: profile.model, input: text, voice, language, response_format: "pcm",
          ...(requestSeed === undefined ? {} : { seed: requestSeed }),
        }),
        signal: controller.signal,
      });
      // Older locally installed gateways reject unknown fields. Preserve
      // playback without a service restart; deterministic seed is best-effort
      // until that gateway version is upgraded.
      // Base bf16 always supports seed. Its 400 responses must never silently
      // drop determinism; legacy CustomVoice gateways alone permit fallback.
      const candidateSeed = voice === "my_voice" ? seed : this.supportsSeed === false ? undefined : seed;
      let response = await send(candidateSeed);
      if (response.status === 400 && candidateSeed !== undefined && voice !== "my_voice" && !controller.signal.aborted) {
        this.supportsSeed = false;
        await response.body?.cancel().catch(() => {});
        response = await send();
      } else if (response.ok && candidateSeed !== undefined) {
        this.supportsSeed = true;
      }
      if (!response.ok) throw new Error(errorText(response.status));
      if (!response.headers.get("content-type")?.toLowerCase().includes("audio/pcm") || !response.body) {
        throw new Error("TTS API 未返回正确的 PCM 音频格式");
      }
      const reader = response.body.getReader();
      let remainder = Buffer.alloc(0);
      let received = 0;
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value.length) continue;
          const raw = remainder.length ? Buffer.concat([remainder, Buffer.from(value)]) : Buffer.from(value);
          // PCM is 16-bit signed little endian; never split a sample in half.
          const aligned = raw.length - (raw.length % 2);
          remainder = raw.subarray(aligned);
          for (let offset = 0; offset < aligned; offset += FRAME_BYTES) {
            if (controller.signal.aborted) break;
            const pcm = raw.subarray(offset, Math.min(offset + FRAME_BYTES, aligned));
            received += pcm.length;
            if (!output.write(JSON.stringify({ type: "chunk", pcm: pcm.toString("base64"), sampleRate: 24000 }) + "\n")) {
              await new Promise<void>(resolve => {
                const done = () => { output.off("drain", done); output.off("close", done); resolve(); };
                output.once("drain", done);
                output.once("close", done);
              });
            }
          }
        }
      } finally { reader.releaseLock(); }
      if (controller.signal.aborted) return;
      if (remainder.length || received === 0) throw new Error("TTS API 音频流不完整或为空");
      output.end(JSON.stringify({ type: "end", stop: "complete" }) + "\n");
    } catch (error) {
      if (!controller.signal.aborted) {
        // Avoid exposing request URLs or Authorization headers from fetch errors.
        const safe = error instanceof Error && (/^TTS API /.test(error.message) || /音频流/.test(error.message))
          ? error.message : "TTS API 连接中断，请检查服务与局域网";
        output.end(JSON.stringify({ type: "error", message: safe }) + "\n");
      }
    } finally {
      clearTimeout(timeout);
      if (controller.signal.aborted) output.end();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
}
