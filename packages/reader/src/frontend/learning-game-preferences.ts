import { LEARNING_VOICES, type LearningVoiceId } from "../shared/learning-audio";
export const LEARNING_GAME_PREFERENCES_KEY = "magazine-reader:learning-game-preferences:v1";
export interface LearningGamePreferences { version: 1; voice: LearningVoiceId; theme: "app" | "light" | "dark" | "system"; background: "default" | "warm" | "green"; }
export const defaultGamePreferences: LearningGamePreferences = { version: 1,voice: LEARNING_VOICES[0].id,theme: "app",background: "default" };
export function validGamePreferences(value: unknown): value is LearningGamePreferences {
  if (!value || typeof value !== "object") return false;
  const item = value as LearningGamePreferences;
  return item.version === 1 && LEARNING_VOICES.some(voice => voice.id === item.voice) && ["app","light","dark","system"].includes(item.theme) && ["default","warm","green"].includes(item.background);
}
export function loadGamePreferences(storage: { getItem(key: string): string | null }): LearningGamePreferences {
  try { const value: unknown = JSON.parse(storage.getItem(LEARNING_GAME_PREFERENCES_KEY) ?? "null"); return validGamePreferences(value) ? value : defaultGamePreferences; } catch { return defaultGamePreferences; }
}
