import { DEFAULT_QWEN_TTS_VOICE, isChineseAudiobookVoice, loadQwenTtsVoice, CHINESE_AUDIOBOOK_VOICES, type ChineseAudiobookVoice } from "../shared/qwen-tts-voices";
import { loadChineseListeningRecords } from "./chinese-listening-state";

export const CHINESE_AUDIOBOOK_PREFERENCES_KEY = "magazine-reader-chinese-audiobook-preferences-v1";
export const CHINESE_AUDIOBOOK_RATES = [0.75, 1, 1.25, 1.5] as const;
export type ChineseAudiobookPreferences = { version: 1; voice: ChineseAudiobookVoice; rate: number };

export function validChineseAudiobookPreferences(value: unknown): value is ChineseAudiobookPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ChineseAudiobookPreferences>;
  return item.version === 1 && isChineseAudiobookVoice(item.voice)
    && CHINESE_AUDIOBOOK_VOICES.some(voice => voice.id === item.voice)
    && CHINESE_AUDIOBOOK_RATES.some(rate => rate === item.rate);
}

export function loadChineseAudiobookPreferences(storage: Pick<Storage, "getItem">): ChineseAudiobookPreferences {
  try {
    const value = storage.getItem(CHINESE_AUDIOBOOK_PREFERENCES_KEY);
    if (value !== null) {
      const parsed: unknown = JSON.parse(value);
      if (validChineseAudiobookPreferences(parsed)) return parsed;
    }
  } catch { /* Preserve usable defaults when storage is unavailable or malformed. */ }
  // Upgrade existing users without overwriting a previously selected voice or rate.
  let legacyVoice = DEFAULT_QWEN_TTS_VOICE;
  let legacyRate = 1;
  try {
    const voice = loadQwenTtsVoice(storage);
    if (CHINESE_AUDIOBOOK_VOICES.some(item => item.id === voice)) legacyVoice = voice;
    const records = loadChineseListeningRecords(storage);
    if (records.length && CHINESE_AUDIOBOOK_RATES.some(rate => rate === records[0].rate)) legacyRate = records[0].rate;
  } catch { /* Ignore unavailable legacy data. */ }
  return { version: 1, voice: legacyVoice, rate: legacyRate };
}

export function saveChineseAudiobookPreferences(storage: Pick<Storage, "setItem">, preferences: ChineseAudiobookPreferences): void {
  if (!validChineseAudiobookPreferences(preferences)) throw new Error("听书音色或语速无效");
  storage.setItem(CHINESE_AUDIOBOOK_PREFERENCES_KEY, JSON.stringify(preferences));
}
