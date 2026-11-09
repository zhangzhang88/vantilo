/** Browser transport for speech.cpp PCM frames. The response is consumed as it arrives, never as a complete Blob. */
import { DEFAULT_QWEN_TTS_VOICE, type ChineseAudiobookVoice } from "../shared/qwen-tts-voices";
export interface SpeechPcmChunk {
  sampleRate: number;
  samples: Int16Array;
}

function pcmFromBase64(encoded: string): Int16Array {
  if (!encoded || encoded.length > 1_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("TTS PCM 音频块无效");
  const bytes = atob(encoded);
  if (bytes.length % 2 !== 0 || bytes.length === 0) throw new Error("TTS PCM 音频块长度错误");
  const samples = new Int16Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const unsigned = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
    samples[i] = unsigned >= 32768 ? unsigned - 65536 : unsigned;
  }
  return samples;
}

export async function* streamChineseTts(text: string, signal: AbortSignal, language: "zh-CN" | "en-US" = "zh-CN", voice: ChineseAudiobookVoice = DEFAULT_QWEN_TTS_VOICE, seed?: number): AsyncGenerator<SpeechPcmChunk> {
  const response = await fetch("/api/prep/tts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language, voice, ...(seed === undefined ? {} : { seed }) }), signal,
  });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json(); detail = typeof body.error === "string" ? body.error : ""; } catch { /* Keep generic error. */ }
    throw new Error(detail || "本地 Qwen3-TTS 暂不可用，请检查模型和 speech.cpp。");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) {
    throw new Error("Qwen3-TTS 没有返回流式音频");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", ended = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 2_000_000) throw new Error("TTS 音频响应超过单帧限制");
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const frame: unknown = JSON.parse(line);
        if (!frame || typeof frame !== "object") throw new Error("TTS 音频协议无效");
        const data = frame as Record<string, unknown>;
        if (data.type === "error") throw new Error(typeof data.message === "string" ? data.message : "本地 TTS 生成失败");
        if (data.type === "cancelled") throw new Error("本地朗读已取消");
        if (data.type === "end") {
          if (data.stop !== "complete") throw new Error("本地 TTS 没有完整生成音频");
          ended = true; break;
        }
        if (data.type !== "chunk" || data.sampleRate !== 24000 || typeof data.pcm !== "string") throw new Error("TTS 音频协议无效");
        yield { sampleRate: 24000, samples: pcmFromBase64(data.pcm) };
      }
      if (ended || done) break;
    }
    if (!ended) throw new Error("本地 TTS 音频流意外中断");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
