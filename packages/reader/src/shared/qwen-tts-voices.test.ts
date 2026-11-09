import { expect, it } from "vitest";
import { DEFAULT_QWEN_TTS_ENGLISH_VOICE, DEFAULT_QWEN_TTS_VOICE, isEnglishQwenTtsVoice, isQwenTtsVoice, loadEnglishQwenTtsVoice, loadQwenTtsVoice, QWEN_TTS_ENGLISH_VOICES, QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY, QWEN_TTS_VOICES, QWEN_TTS_VOICE_STORAGE_KEY, saveEnglishQwenTtsVoice, saveQwenTtsVoice } from "./qwen-tts-voices";

it("offers nine distinct official speakers, with Serena as the default", () => {
  expect(QWEN_TTS_VOICES).toHaveLength(9);
  expect(new Set(QWEN_TTS_VOICES.map(voice => voice.id)).size).toBe(9);
  expect(DEFAULT_QWEN_TTS_VOICE).toBe("serena");
  expect(QWEN_TTS_VOICES.filter(voice => voice.group === "中文")).toHaveLength(5);
  expect(isQwenTtsVoice("uncle_fu")).toBe(true);
  expect(isQwenTtsVoice("../../../test")).toBe(false);
});

it("persists the selected voice and falls back safely on invalid or inaccessible data", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
  expect(loadQwenTtsVoice(storage)).toBe("serena");
  saveQwenTtsVoice(storage, "vivian");
  expect(entries.get(QWEN_TTS_VOICE_STORAGE_KEY)).toBe("vivian");
  expect(loadQwenTtsVoice(storage)).toBe("vivian");
  entries.set(QWEN_TTS_VOICE_STORAGE_KEY, "unknown-voice");
  expect(loadQwenTtsVoice(storage)).toBe("serena");
  expect(loadQwenTtsVoice({ getItem: () => { throw new Error("Denied"); } })).toBe("serena");
});

it("limits English sentence practice to Aiden and Ryan, with a separate preference from Chinese audiobooks", () => {
  expect(QWEN_TTS_ENGLISH_VOICES.map(item => item.id)).toEqual(["ryan", "aiden"]);
  expect(DEFAULT_QWEN_TTS_ENGLISH_VOICE).toBe("aiden");
  expect(isEnglishQwenTtsVoice("ryan")).toBe(true);
  expect(isEnglishQwenTtsVoice("serena")).toBe(false);
  const entries = new Map<string, string>([[QWEN_TTS_VOICE_STORAGE_KEY, "serena"]]);
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
  expect(loadEnglishQwenTtsVoice(storage)).toBe("aiden");
  saveEnglishQwenTtsVoice(storage, "ryan");
  expect(entries.get(QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY)).toBe("ryan");
  expect(loadEnglishQwenTtsVoice(storage)).toBe("ryan");
  expect(loadQwenTtsVoice(storage)).toBe("serena");
  entries.set(QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY, "vivian");
  expect(loadEnglishQwenTtsVoice(storage)).toBe("aiden");
  expect(loadEnglishQwenTtsVoice({ getItem: () => { throw new Error("Storage unavailable"); } })).toBe("aiden");
});
