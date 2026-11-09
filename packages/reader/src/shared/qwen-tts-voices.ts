/** Built-in CustomVoice speakers supported by speech.cpp Qwen3-TTS 0.6B. */
export const QWEN_TTS_VOICES = [
  { id: "serena", name: "Serena", description: "温柔舒缓 · 中文女声", group: "中文" },
  { id: "vivian", name: "Vivian", description: "明亮年轻 · 中文女声", group: "中文" },
  { id: "uncle_fu", name: "Uncle Fu", description: "成熟低沉 · 中文男声", group: "中文" },
  { id: "dylan", name: "Dylan", description: "年轻自然 · 北京口音男声", group: "中文" },
  { id: "eric", name: "Eric", description: "活泼明快 · 四川口音男声", group: "中文" },
  { id: "ryan", name: "Ryan", description: "节奏鲜明 · 英语男声", group: "其他语言" },
  { id: "aiden", name: "Aiden", description: "阳光清晰 · 美式男声", group: "其他语言" },
  { id: "ono_anna", name: "Ono Anna", description: "轻快活泼 · 日语女声", group: "其他语言" },
  { id: "sohee", name: "Sohee", description: "温暖柔和 · 韩语女声", group: "其他语言" },
] as const;

export type QwenTtsVoice = (typeof QWEN_TTS_VOICES)[number]["id"];
/** Private Base model clone, routed to the separate local TTS API. */
export const MY_VOICE_TTS_ID = "my_voice" as const;
export type ChineseAudiobookVoice = QwenTtsVoice | typeof MY_VOICE_TTS_ID;
export const CHINESE_AUDIOBOOK_VOICES = [
  ...QWEN_TTS_VOICES.filter(voice => voice.group === "中文"),
  { id: MY_VOICE_TTS_ID, name: "我的声音", description: "个人克隆 · 中文男声", group: "中文" },
] as const;
export function isChineseAudiobookVoice(value: unknown): value is ChineseAudiobookVoice {
  return typeof value === "string" && CHINESE_AUDIOBOOK_VOICES.some(item => item.id === value);
}
export const DEFAULT_QWEN_TTS_VOICE: QwenTtsVoice = "serena";
export const QWEN_TTS_VOICE_STORAGE_KEY = "magazine-reader-qwen-tts-voice-v1";

/** English sentence practice has its own voice preference, separate from Chinese audiobooks. */
export const QWEN_TTS_ENGLISH_VOICES = QWEN_TTS_VOICES.filter(voice =>
  voice.id === "aiden" || voice.id === "ryan");
export type EnglishQwenTtsVoice = "aiden" | "ryan";
export const DEFAULT_QWEN_TTS_ENGLISH_VOICE: EnglishQwenTtsVoice = "aiden";
export const QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY = "magazine-reader-qwen-tts-english-voice-v1";

export function isEnglishQwenTtsVoice(value: unknown): value is EnglishQwenTtsVoice {
  return value === "aiden" || value === "ryan";
}

export function loadEnglishQwenTtsVoice(storage: Pick<Storage, "getItem">): EnglishQwenTtsVoice {
  try {
    const saved = storage.getItem(QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY);
    return isEnglishQwenTtsVoice(saved) ? saved : DEFAULT_QWEN_TTS_ENGLISH_VOICE;
  } catch {
    return DEFAULT_QWEN_TTS_ENGLISH_VOICE;
  }
}

export function saveEnglishQwenTtsVoice(storage: Pick<Storage, "setItem">, voice: EnglishQwenTtsVoice): void {
  storage.setItem(QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY, voice);
}

export function isQwenTtsVoice(value: unknown): value is QwenTtsVoice {
  return typeof value === "string" && QWEN_TTS_VOICES.some(voice => voice.id === value);
}

export function loadQwenTtsVoice(storage: Pick<Storage, "getItem">): QwenTtsVoice {
  try {
    const saved = storage.getItem(QWEN_TTS_VOICE_STORAGE_KEY);
    return isQwenTtsVoice(saved) ? saved : DEFAULT_QWEN_TTS_VOICE;
  } catch {
    return DEFAULT_QWEN_TTS_VOICE;
  }
}

export function saveQwenTtsVoice(storage: Pick<Storage, "setItem">, voice: QwenTtsVoice): void {
  storage.setItem(QWEN_TTS_VOICE_STORAGE_KEY, voice);
}
