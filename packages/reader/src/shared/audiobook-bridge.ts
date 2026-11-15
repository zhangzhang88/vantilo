import { isChineseAudiobookVoice, type ChineseAudiobookVoice } from "./qwen-tts-voices.js";

export const AUDIOBOOK_RATES = [.75, 1, 1.25, 1.5] as const;
export const AUDIOBOOK_SLEEP_MINUTES = [0, 15, 30, 45, 60] as const;
export type AudiobookMode = "original" | "translation";
export type AudiobookPhase = "idle" | "loading" | "playing" | "paused" | "complete" | "error";

export interface AudiobookControlsState {
  phase: AudiobookPhase;
  error: string;
  rate: number;
  voice: ChineseAudiobookVoice;
  paragraphIndex: number;
  paragraphNumber: number;
  paragraphCount: number;
}

export interface AudiobookSnapshot extends AudiobookControlsState {
  sessionId: number;
  mode: AudiobookMode;
  sourceId: string;
  title: string;
  sourceLabel?: string;
  returnToBilingual?: boolean;
  cover?: string;
  chapterId: string;
  chapters: { id: string; title: string }[];
  sleepMinutes: number;
}

export type AudiobookAction =
  | { type: "toggle" | "return" | "return-original" | "close" }
  | { type: "jump"; seconds: -15 | 15 }
  | { type: "rate"; value: number }
  | { type: "voice"; value: ChineseAudiobookVoice }
  | { type: "chapter"; id: string }
  | { type: "sleep"; minutes: number };

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function isAudiobookAction(value: unknown): value is AudiobookAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  switch (item.type) {
    case "toggle": case "return": case "return-original": case "close": return true;
    case "jump": return item.seconds === -15 || item.seconds === 15;
    case "rate": return AUDIOBOOK_RATES.some(rate => rate === item.value);
    case "voice": return isChineseAudiobookVoice(item.value);
    case "chapter": return boundedText(item.id, 512) && item.id.length > 0;
    case "sleep": return AUDIOBOOK_SLEEP_MINUTES.some(minutes => minutes === item.minutes);
    default: return false;
  }
}

export function isAudiobookSnapshot(value: unknown): value is AudiobookSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as AudiobookSnapshot;
  return Number.isSafeInteger(item.sessionId) && item.sessionId > 0
    && (item.mode === "original" || item.mode === "translation")
    && boundedText(item.sourceId, 512) && !!item.sourceId && boundedText(item.title, 1024)
    && (item.sourceLabel === undefined || boundedText(item.sourceLabel, 1024))
    && (item.returnToBilingual === undefined || (item.mode === "translation" && typeof item.returnToBilingual === "boolean"))
    && (item.cover === undefined || (boundedText(item.cover, 32_768) && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(item.cover)))
    && boundedText(item.chapterId, 512)
    && ["idle", "loading", "playing", "paused", "complete", "error"].includes(item.phase)
    && boundedText(item.error, 512) && isChineseAudiobookVoice(item.voice)
    && AUDIOBOOK_RATES.some(rate => rate === item.rate) && AUDIOBOOK_SLEEP_MINUTES.some(minutes => minutes === item.sleepMinutes)
    && Number.isSafeInteger(item.paragraphIndex) && item.paragraphIndex >= 0
    && Number.isSafeInteger(item.paragraphNumber) && item.paragraphNumber >= 0
    && Number.isSafeInteger(item.paragraphCount) && item.paragraphCount >= item.paragraphNumber
    && Array.isArray(item.chapters) && item.chapters.length <= 10_000
    && item.chapters.every(chapter => chapter && boundedText(chapter.id, 512) && boundedText(chapter.title, 1024))
    && (item.chapters.some(chapter => chapter.id === item.chapterId)
      || (item.phase === "error" && item.chapterId === "" && item.chapters.length === 0));
}
