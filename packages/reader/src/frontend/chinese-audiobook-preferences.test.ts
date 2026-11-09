import { describe, expect, it } from "vitest";
import {
  CHINESE_AUDIOBOOK_PREFERENCES_KEY, loadChineseAudiobookPreferences,
  saveChineseAudiobookPreferences, validChineseAudiobookPreferences,
} from "./chinese-audiobook-preferences";
import { CHINESE_LISTENING_KEY } from "./chinese-listening-state";
import { QWEN_TTS_VOICE_STORAGE_KEY } from "../shared/qwen-tts-voices";
import { buildUserDataBackup, parseUserDataBackup, restoreUserDataBackup } from "./user-data-backup";

const memory = () => {
  const entries = new Map<string,string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
};

describe("global Chinese audiobook preferences", () => {
  it("keeps the most recent rate and voice across separate documents and restarts", () => {
    const storage = memory();
    expect(loadChineseAudiobookPreferences(storage)).toEqual({ version: 1, voice: "serena", rate: 1 });
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "vivian", rate: 1.25 });
    expect(loadChineseAudiobookPreferences(storage)).toEqual({ version: 1, voice: "vivian", rate: 1.25 });
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "uncle_fu", rate: 1.5 });
    expect(loadChineseAudiobookPreferences(storage)).toEqual({ version: 1, voice: "uncle_fu", rate: 1.5 });
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "my_voice", rate: 1.25 });
    expect(loadChineseAudiobookPreferences(storage)).toMatchObject({ voice: "my_voice", rate: 1.25 });
  });
  it("migrates previous voice and most recent rate without overriding a new global setting", () => {
    const storage = memory();
    storage.setItem(QWEN_TTS_VOICE_STORAGE_KEY, "vivian");
    storage.setItem(CHINESE_LISTENING_KEY, JSON.stringify([{ documentId: "old", paragraphIndex: 0,
      sourceText: "source", chunkIndex: 0, chunkText: "", seconds: 0, rate: 0.75, completed: false }]));
    expect(loadChineseAudiobookPreferences(storage)).toMatchObject({ voice: "vivian", rate: 0.75 });
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "serena", rate: 1.25 });
    expect(loadChineseAudiobookPreferences(storage)).toMatchObject({ voice: "serena", rate: 1.25 });
  });
  it("ignores corrupt data and rejects unsupported speeds or non-Chinese voices", () => {
    const storage = memory();
    storage.setItem(CHINESE_AUDIOBOOK_PREFERENCES_KEY, "{broken");
    expect(loadChineseAudiobookPreferences(storage)).toMatchObject({ voice: "serena", rate: 1 });
    expect(validChineseAudiobookPreferences({ version: 1, voice: "aiden", rate: 1 })).toBe(false);
    expect(validChineseAudiobookPreferences({ version: 1, voice: "serena", rate: 2 })).toBe(false);
    expect(() => saveChineseAudiobookPreferences(storage, { version: 1, voice: "serena", rate: 2 })).toThrow();
    expect(loadChineseAudiobookPreferences({ getItem: () => { throw Error("storage unavailable"); } })).toMatchObject({ voice: "serena", rate: 1 });
  });
  it("round-trips global listening preferences in backups, rejecting invalid input", () => {
    const storage = memory();
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "dylan", rate: 1.25 });
    const backup = buildUserDataBackup(storage);
    expect(backup.data[CHINESE_AUDIOBOOK_PREFERENCES_KEY]).toEqual({ version: 1, voice: "dylan", rate: 1.25 });
    const destination = memory();
    restoreUserDataBackup(destination, parseUserDataBackup(JSON.stringify(backup)));
    expect(loadChineseAudiobookPreferences(destination)).toMatchObject({ voice: "dylan", rate: 1.25 });
    saveChineseAudiobookPreferences(storage, { version: 1, voice: "my_voice", rate: 1 });
    const withMyVoice = parseUserDataBackup(JSON.stringify(buildUserDataBackup(storage)));
    restoreUserDataBackup(destination, withMyVoice);
    expect(loadChineseAudiobookPreferences(destination)).toMatchObject({ voice: "my_voice", rate: 1 });
    expect(() => parseUserDataBackup(JSON.stringify({
      ...backup, data: { [CHINESE_AUDIOBOOK_PREFERENCES_KEY]: { version: 1, voice: "aiden", rate: 7 } },
    }))).toThrow("听书");
  });
});
