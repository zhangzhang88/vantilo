import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  READER_PREFERENCES_KEY,
  saveReaderPreferences,
  resolveReaderTheme,
} from "./reader-preferences";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("reader preferences", () => {
  it("defaults to visible learning aids and paper reading settings", () => {
    const storage = new MemoryStorage();
    expect(loadReaderPreferences(storage)).toEqual(DEFAULT_READER_PREFERENCES);
    expect(DEFAULT_READER_PREFERENCES).toMatchObject({
      showVocabularyBackgrounds: true,
      showChineseGlosses: true,
      theme: "paper",
      fontSize: 18,
      readerWidth: "medium",
      fontFamily: "serif",
      lineHeight: "standard",
      pronunciationAccent: "us",
      autoPronounceOnWordClick: false,
    });
  });

  it("persists global reading and pronunciation preferences", () => {
    const storage = new MemoryStorage();
    const preferences = {
      ...DEFAULT_READER_PREFERENCES,
      theme: "night" as const,
      fontSize: 21,
      readerWidth: "wide" as const,
      fontFamily: "sans" as const,
      lineHeight: "relaxed" as const,
      showVocabularyBackgrounds: false,
      showChineseGlosses: false,
      pronunciationAccent: "uk" as const,
      autoPronounceOnWordClick: true,
    };
    saveReaderPreferences(storage, preferences);
    expect(loadReaderPreferences(storage)).toEqual(preferences);
    expect(storage.getItem(READER_PREFERENCES_KEY)).toContain("showVocabularyBackgrounds");
  });

  it("recovers safely from partial or malformed stored settings", () => {
    const storage = new MemoryStorage();
    storage.setItem(READER_PREFERENCES_KEY, JSON.stringify({ fontSize: 99, theme: "invalid", fontFamily: "invalid", lineHeight: "invalid", showChineseGlosses: false, autoPronounceOnWordClick: true }));
    expect(loadReaderPreferences(storage)).toEqual({
      ...DEFAULT_READER_PREFERENCES,
      fontSize: 24,
      showChineseGlosses: false,
      autoPronounceOnWordClick: true,
    });

    storage.setItem(READER_PREFERENCES_KEY, "not-json");
    expect(loadReaderPreferences(storage)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("preserves legacy explicit themes and reading typography when merging global theme settings", () => {
    const storage = new MemoryStorage();
    for (const theme of ["paper", "sepia", "night"] as const) {
      const raw = JSON.stringify({ version: 1, theme, fontSize: 23, fontFamily: "sans", lineHeight: "relaxed" });
      storage.setItem(READER_PREFERENCES_KEY, raw);
      const restored = loadReaderPreferences(storage);
      expect(restored).toMatchObject({ theme, fontSize: 23, fontFamily: "sans", lineHeight: "relaxed", themePreset: theme === "night" ? "dark" : theme === "paper" ? "light" : "sepia" });
      expect(resolveReaderTheme(restored, theme !== "night")).toBe(theme);
      expect(storage.getItem(READER_PREFERENCES_KEY)).toBe(raw);
    }
  });

  it("resolves all global presets and follows system changes only in system mode", () => {
    const preferences = { ...DEFAULT_READER_PREFERENCES, themePreset: "system" as const };
    expect(resolveReaderTheme(preferences, false)).toBe("paper");
    expect(resolveReaderTheme(preferences, true)).toBe("night");
    expect(resolveReaderTheme({ ...preferences, themePreset: "light" }, true)).toBe("paper");
    expect(resolveReaderTheme({ ...preferences, themePreset: "dark" }, false)).toBe("night");
    expect(resolveReaderTheme({ ...preferences, themePreset: "sepia" }, true)).toBe("sepia");
    expect(resolveReaderTheme({ ...preferences, themePreset: "green" }, true)).toBe("green");
    const storage = new MemoryStorage();
    saveReaderPreferences(storage, preferences);
    expect(loadReaderPreferences(storage)).toEqual(preferences);
  });

  it("merges the earlier separate mode and reading background into one preset", () => {
    const storage = new MemoryStorage();
    for (const [colorMode, readingBackground, expected] of [["light", "sepia", "sepia"], ["dark", "sepia", "dark"], ["system", "sepia", "system"], ["light", "paper", "light"]] as const) {
      storage.setItem(READER_PREFERENCES_KEY, JSON.stringify({ version: 1, theme: "paper", colorMode, readingBackground, fontSize: 21 }));
      expect(loadReaderPreferences(storage)).toMatchObject({ themePreset: expected, fontSize: 21 });
    }
  });
});
