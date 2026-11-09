import { ChineseStreamingAudioPlayer } from "./chinese-streaming-audio-player";
import { streamChineseTts } from "./chinese-tts-stream";
import { splitEnglishSentenceForTts } from "./english-sentence-tts";
import { getReaderStorage } from "./reader-storage";
import { DEFAULT_QWEN_TTS_ENGLISH_VOICE, loadEnglishQwenTtsVoice } from "../shared/qwen-tts-voices";
import { SelectionSpeechClipCache, getEnglishSpeechClipCache } from "./selection-speech-clips";
import type { SpeechPhase } from "./chinese-audio-types";

export const STOP_SELECTION_SPEECH_EVENT = "magazine-reader:stop-selection-speech";
export const SELECTION_SPEECH_EVENT = "magazine-reader:selection-speech";
export const SELECTION_SPEECH_QWEN_TIMEOUT_MS = 4_500;
export const SHORT_SELECTION_SPEECH_QWEN_TIMEOUT_MS = 8_000;
const MAX_SHORT_SELECTION_CHARACTERS = 160;

export type SelectionSpeechStatus = "loading" | "qwen" | "system" | "failed" | "stopped";
export type SelectionSpeechReport = { text: string; status: SelectionSpeechStatus; message?: string };
type StreamingPlayer = Pick<ChineseStreamingAudioPlayer, "start" | "stop">;

/** Selection-only speech: Qwen first; macOS voice is an explicit last resort.
 * Word pronunciation never calls this module or speechSynthesis.
 */
export class SelectionSpeechPlayer {
  private serial = 0;
  private stream: StreamingPlayer | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private spokenByQwen = false;
  private currentText = "";
  private readonly clips: SelectionSpeechClipCache;

  constructor(private readonly deps: {
    streaming?: (text: string, onPhase: (phase: SpeechPhase, error?: string) => void) => StreamingPlayer;
    synthesis?: () => SpeechSynthesis;
    utterance?: (text: string) => SpeechSynthesisUtterance;
    report?: (event: SelectionSpeechReport) => void;
    tts?: typeof streamChineseTts;
  } = {}) { this.clips = deps.tts ? new SelectionSpeechClipCache(deps.tts) : getEnglishSpeechClipCache(); }

  play(raw: string, regenerate = false): void {
    this.stop();
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || text.length > 2_000) return;
    const serial = this.serial;
    this.currentText = text;
    this.spokenByQwen = false;
    for (const name of ["magazine-reader:stop-word-audio", "magazine-reader:stop-english-sentence-audio",
      "magazine-reader:pause-chinese-audio", "magazine-reader:stop-reply-audio"]) {
      window.dispatchEvent(new Event(name));
    }
    this.publish(text, "loading");
    const shortSelection = text.length <= MAX_SHORT_SELECTION_CHARACTERS;
    let voice = DEFAULT_QWEN_TTS_ENGLISH_VOICE;
    try { voice = loadEnglishQwenTtsVoice(getReaderStorage()); } catch { /* Use the original default if storage is inaccessible. */ }
    const onPhase = (phase: SpeechPhase, error?: string) => {
      // Late Qwen callbacks after the deadline must never steal the speaker
      // back from a system fallback already underway.
      if (serial !== this.serial || this.utterance) return;
      if (phase === "playing") {
        this.spokenByQwen = true;
        this.clearFallback();
        this.publish(text, "qwen");
      } else if (phase === "error") {
        if (this.spokenByQwen) {
          this.publish(text, "failed", error ?? "Qwen 朗读中断");
          this.stop(false);
        } else this.useSystemFallback(text, serial);
      } else if (phase === "complete") {
        this.clearFallback();
        this.stream = null;
        this.publish(text, "stopped");
      }
    };
    try {
      this.stream = this.deps.streaming?.(text, onPhase) ?? new ChineseStreamingAudioPlayer({
        indices: [0],
        getText: async () => text,
        splitText: shortSelection ? value => [value] : splitEnglishSentenceForTts,
        synthesize: (chunk, signal) => shortSelection
          ? this.clips.synthesize(chunk, voice, signal, regenerate)
          : (this.deps.tts ?? streamChineseTts)(chunk, signal, "en-US", voice),
        phase: onPhase,
        position: () => {},
      });
      this.fallbackTimer = setTimeout(() => {
        if (serial === this.serial && !this.spokenByQwen) this.useSystemFallback(text, serial);
      }, shortSelection ? SHORT_SELECTION_SPEECH_QWEN_TIMEOUT_MS : SELECTION_SPEECH_QWEN_TIMEOUT_MS);
      void this.stream.start({ paragraphIndex: 0, chunkIndex: 0 });
    } catch {
      this.useSystemFallback(text, serial);
    }
  }

  stop(notify = true): void {
    this.serial++;
    this.clearFallback();
    this.stream?.stop();
    this.stream = null;
    if (this.utterance) {
      try { (this.deps.synthesis?.() ?? window.speechSynthesis)?.cancel(); } catch { /* Speech backend unavailable */ }
      this.utterance = null;
    }
    if (notify && this.currentText) this.publish(this.currentText, "stopped");
    this.currentText = "";
    this.spokenByQwen = false;
  }

  private useSystemFallback(text: string, serial: number) {
    if (serial !== this.serial || this.spokenByQwen || this.utterance) return;
    this.clearFallback();
    this.stream?.stop();
    this.stream = null;
    try {
      const synthesis = this.deps.synthesis?.() ?? window.speechSynthesis;
      if (!synthesis) throw new Error("系统语音不可用");
      const utterance = this.deps.utterance?.(text) ?? new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onstart = () => { if (serial === this.serial) this.publish(text, "system"); };
      utterance.onerror = () => {
        if (serial === this.serial) { this.publish(text, "failed", "Qwen 和系统朗读均不可用"); this.stop(false); }
      };
      utterance.onend = () => { if (serial === this.serial) this.stop(); };
      this.utterance = utterance;
      synthesis.speak(utterance);
    } catch {
      if (serial === this.serial) { this.publish(text, "failed", "Qwen 和系统朗读均不可用"); this.stop(false); }
    }
  }

  private clearFallback() {
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }
  private publish(text: string, status: SelectionSpeechStatus, message?: string) {
    const payload: SelectionSpeechReport = { text, status, ...(message ? { message } : {}) };
    if (this.deps.report) this.deps.report(payload);
    else window.dispatchEvent(new CustomEvent(SELECTION_SPEECH_EVENT, { detail: payload }));
  }
}

let singleton: SelectionSpeechPlayer | null = null;
export function getSelectionSpeechPlayer(): SelectionSpeechPlayer {
  if (!singleton) {
    singleton = new SelectionSpeechPlayer();
    window.addEventListener(STOP_SELECTION_SPEECH_EVENT, () => singleton?.stop());
    window.addEventListener("pagehide", () => singleton?.stop());
  }
  return singleton;
}
export function stopSelectionSpeech() { singleton?.stop(); }
export function playSelectionSpeech(text: string, regenerate = false) { getSelectionSpeechPlayer().play(text, regenerate); }
