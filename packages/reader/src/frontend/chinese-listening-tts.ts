import { streamChineseTts } from "./chinese-tts-stream";
import { qwenTtsSeed } from "../shared/qwen-tts-seed";
import type { ChineseAudiobookVoice } from "../shared/qwen-tts-voices";

/** Keep the audiobook's existing chunked PCM streaming and resume semantics.
 * Each synthesis chunk always has the same seed for the same text and voice.
 */
export function streamChineseListeningTts(
  text: string,
  signal: AbortSignal,
  voice: ChineseAudiobookVoice,
  synthesize: typeof streamChineseTts = streamChineseTts,
) {
  return synthesize(text, signal, "zh-CN", voice, qwenTtsSeed(text, voice));
}
