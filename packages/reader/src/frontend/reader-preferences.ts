export type ReaderTheme = "paper" | "sepia" | "green" | "night";
export type AppThemePreset = "light" | "sepia" | "green" | "dark" | "system";
export type ReaderWidth = "narrow" | "medium" | "wide";
export type ReaderFontFamily = "serif" | "sans";
export type ReaderLineHeight = "compact" | "standard" | "relaxed";
export type PronunciationAccent = "us" | "uk";

export interface ReaderPreferences {
  version: 1;
  theme: ReaderTheme;
  themePreset?: AppThemePreset;
  fontSize: number;
  readerWidth: ReaderWidth;
  fontFamily: ReaderFontFamily;
  lineHeight: ReaderLineHeight;
  showVocabularyBackgrounds: boolean;
  showChineseGlosses: boolean;
  pronunciationAccent: PronunciationAccent;
  autoPronounceOnWordClick: boolean;
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const READER_PREFERENCES_KEY = "magazine-reader-preferences-v1";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  version: 1,
  theme: "paper",
  themePreset: "system",
  fontSize: 18,
  readerWidth: "medium",
  fontFamily: "serif",
  lineHeight: "standard",
  showVocabularyBackgrounds: true,
  showChineseGlosses: true,
  pronunciationAccent: "us",
  autoPronounceOnWordClick: false,
};

function isReaderTheme(value: unknown): value is ReaderTheme {
  return value === "paper" || value === "sepia" || value === "green" || value === "night";
}

export function resolveReaderTheme(preferences: ReaderPreferences, systemDark: boolean): ReaderTheme {
  const mode = preferences.themePreset ?? (preferences.theme === "night" ? "dark" : preferences.theme === "paper" ? "light" : preferences.theme);
  if (mode === "dark" || (mode === "system" && systemDark)) return "night";
  return mode === "sepia" || mode === "green" ? mode : "paper";
}

function migratedThemePreset(parsed: Partial<ReaderPreferences> & { colorMode?: unknown; readingBackground?: unknown }): AppThemePreset {
  if (["light", "sepia", "green", "dark", "system"].includes(parsed.themePreset ?? "")) return parsed.themePreset!;
  if (parsed.colorMode === "system") return "system";
  if (parsed.colorMode === "dark") return "dark";
  if (parsed.colorMode === "light") return parsed.readingBackground === "sepia" || parsed.theme === "sepia" ? "sepia" : "light";
  if (parsed.theme === "night") return "dark";
  if (parsed.readingBackground === "sepia" || parsed.theme === "sepia") return "sepia";
  if (parsed.theme === "green") return "green";
  return parsed.theme === "paper" ? "light" : "system";
}

function isReaderWidth(value: unknown): value is ReaderWidth {
  return value === "narrow" || value === "medium" || value === "wide";
}

function isReaderFontFamily(value: unknown): value is ReaderFontFamily {
  return value === "serif" || value === "sans";
}

function isReaderLineHeight(value: unknown): value is ReaderLineHeight {
  return value === "compact" || value === "standard" || value === "relaxed";
}

function isPronunciationAccent(value: unknown): value is PronunciationAccent {
  return value === "us" || value === "uk";
}

function normalizedFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_READER_PREFERENCES.fontSize;
  return Math.max(15, Math.min(24, Math.round(value)));
}

export function loadReaderPreferences(storage: ReadStorage): ReaderPreferences {
  const raw = storage.getItem(READER_PREFERENCES_KEY);
  if (!raw) return DEFAULT_READER_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as (Partial<ReaderPreferences> & { colorMode?: unknown; readingBackground?: unknown }) | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_READER_PREFERENCES;
    return {
      version: 1,
      theme: isReaderTheme(parsed.theme) ? parsed.theme : DEFAULT_READER_PREFERENCES.theme,
      themePreset: migratedThemePreset(parsed),
      fontSize: normalizedFontSize(parsed.fontSize),
      readerWidth: isReaderWidth(parsed.readerWidth) ? parsed.readerWidth : DEFAULT_READER_PREFERENCES.readerWidth,
      fontFamily: isReaderFontFamily(parsed.fontFamily) ? parsed.fontFamily : DEFAULT_READER_PREFERENCES.fontFamily,
      lineHeight: isReaderLineHeight(parsed.lineHeight) ? parsed.lineHeight : DEFAULT_READER_PREFERENCES.lineHeight,
      showVocabularyBackgrounds: typeof parsed.showVocabularyBackgrounds === "boolean"
        ? parsed.showVocabularyBackgrounds
        : DEFAULT_READER_PREFERENCES.showVocabularyBackgrounds,
      showChineseGlosses: typeof parsed.showChineseGlosses === "boolean"
        ? parsed.showChineseGlosses
        : DEFAULT_READER_PREFERENCES.showChineseGlosses,
      pronunciationAccent: isPronunciationAccent(parsed.pronunciationAccent)
        ? parsed.pronunciationAccent
        : DEFAULT_READER_PREFERENCES.pronunciationAccent,
      autoPronounceOnWordClick: typeof parsed.autoPronounceOnWordClick === "boolean"
        ? parsed.autoPronounceOnWordClick
        : DEFAULT_READER_PREFERENCES.autoPronounceOnWordClick,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(storage: WriteStorage, preferences: ReaderPreferences): void {
  storage.setItem(READER_PREFERENCES_KEY, JSON.stringify(preferences));
}
