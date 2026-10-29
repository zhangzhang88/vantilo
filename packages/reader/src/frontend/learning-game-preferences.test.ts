import { expect, it } from "vitest";
import { defaultGamePreferences, LEARNING_GAME_PREFERENCES_KEY, loadGamePreferences, validGamePreferences } from "./learning-game-preferences";
import { buildUserDataBackup, parseUserDataBackup, serializeUserDataBackup } from "./user-data-backup";
it("validates the original two voices and appearance choices, and includes them in backups", () => {
  const data = new Map<string,string>(), storage = { getItem: (key: string) => data.get(key) ?? null,setItem: (key: string,value: string) => { data.set(key,value); },removeItem: (key: string) => { data.delete(key); } };
  expect(loadGamePreferences(storage)).toEqual(defaultGamePreferences);
  expect(defaultGamePreferences.theme).toBe("app");
  for (const theme of ["app", "light", "dark", "system"]) {
    expect(validGamePreferences({ ...defaultGamePreferences, theme })).toBe(true);
  }
  const saved = { ...defaultGamePreferences,voice: "en-US-GuyNeural",theme: "dark",background: "warm" };
  storage.setItem(LEARNING_GAME_PREFERENCES_KEY,JSON.stringify(saved)); expect(loadGamePreferences(storage)).toEqual(saved);
  expect(parseUserDataBackup(serializeUserDataBackup(buildUserDataBackup(storage))).data[LEARNING_GAME_PREFERENCES_KEY]).toEqual(saved);
  expect(validGamePreferences({ ...saved,voice: "unprepared-voice" })).toBe(false);
  expect(validGamePreferences({ ...saved,theme: "other" })).toBe(false);
  storage.setItem(LEARNING_GAME_PREFERENCES_KEY,"broken"); expect(loadGamePreferences(storage)).toEqual(defaultGamePreferences);
});
