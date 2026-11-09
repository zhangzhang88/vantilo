import type { ChineseAudiobookVoice } from "./qwen-tts-voices.js";

/** Stable unsigned 31-bit seed accepted by speech.cpp.
 * Generate from the exact synthesis text and chosen voice, without persisting
 * any listening data. A seed reduces variation but does not guarantee fidelity.
 */
export function qwenTtsSeed(text: string, voice: ChineseAudiobookVoice): number {
  let hash = 2166136261;
  for (const char of `${voice}\0${text}`) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  return hash >>> 1;
}
