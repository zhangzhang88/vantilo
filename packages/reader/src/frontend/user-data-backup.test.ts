import { describe, expect, it } from "vitest";
import {
  buildUserDataBackup,
  clearUserData,
  parseUserDataBackup,
  restoreUserDataBackup,
  summarizeUserDataBackup,
  USER_DATA_STORAGE_KEYS,
} from "./user-data-backup";
import { NOTES_STATE_KEY } from "./notes-state";
import { READER_PREFERENCES_KEY } from "./reader-preferences";
import { READER_STATE_KEY } from "./reader-state";
import { READING_ASSISTANT_CACHE_KEY } from "./reading-assistant-cache";
import { SAVED_SELECTIONS_KEY } from "./selection-state";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const note = (id: string) => ({ id, issueId: "economist:2026-09-19", articleId: "a1", text: "A real note", createdAt: "2026-09-23T09:00:00.000Z" });

const preferences = {
  version: 1,
  theme: "night",
  fontSize: 19,
  readerWidth: "wide",
  fontFamily: "sans",
  lineHeight: "relaxed",
  showVocabularyBackgrounds: false,
  showChineseGlosses: true,
  pronunciationAccent: "uk",
};

function backupText(data: Record<string, unknown>): string {
  return JSON.stringify({
    app: "magazine-reader",
    version: 1,
    exportedAt: "2026-09-23T09:00:00.000Z",
    data,
  });
}

describe("user data backup", () => {
  it("includes the AI reading assistant preset cache in the managed data allowlist", () => {
    expect(USER_DATA_STORAGE_KEYS).toContain(READING_ASSISTANT_CACHE_KEY);
  });

  it("exports only the explicit Magazine Reader allowlist and summarizes stored categories", () => {
    const storage = new MemoryStorage();
    storage.setItem(READER_PREFERENCES_KEY, JSON.stringify(preferences));
    storage.setItem(READER_STATE_KEY, JSON.stringify({ version: 1, progress: { "economist:2026-09-19:a1": 42 }, lastPosition: null }));
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note("n1")] }));
    storage.setItem("unrelated-local-key", "server-api-secret");

    const backup = buildUserDataBackup(storage, new Date("2026-09-23T09:00:00.000Z"));
    expect(backup.data[READER_PREFERENCES_KEY]).toEqual(preferences);
    expect(backup.data[READER_STATE_KEY]).toEqual({ version: 1, progress: { "economist:2026-09-19:a1": 42 }, lastPosition: null });
    expect(backup.data[NOTES_STATE_KEY]).toEqual({ version: 1, items: [note("n1")] });
    expect(backup.data["unrelated-local-key"]).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain("server-api-secret");

    const summary = summarizeUserDataBackup(backup);
    expect(summary.categoryCount).toBe(3);
    expect(summary.entries.find((entry) => entry.key === NOTES_STATE_KEY)?.count).toBe(1);
  });

  it("rejects wrong envelopes, unknown keys and malformed allowlisted data before restore", () => {
    expect(() => parseUserDataBackup("not-json")).toThrow("有效的 JSON");
    expect(() => parseUserDataBackup(JSON.stringify({ app: "other", version: 1, exportedAt: "2026-09-23T09:00:00.000Z", data: {} }))).toThrow("受支持");
    expect(() => parseUserDataBackup(backupText({ unknown: [] }))).toThrow("未知数据项");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { version: 1, theme: "broken" } }))).toThrow("阅读偏好");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { version: 1, fontFamily: "broken" } }))).toThrow("阅读偏好");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { version: 1, lineHeight: "broken" } }))).toThrow("阅读偏好");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { ...preferences, colorMode: "broken" } }))).toThrow("阅读偏好");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { ...preferences, readingBackground: "broken" } }))).toThrow("阅读偏好");
    expect(() => parseUserDataBackup(backupText({ [READER_PREFERENCES_KEY]: { ...preferences, themePreset: "broken" } }))).toThrow("阅读偏好");
  });

  it("round-trips the unified global preset without losing typography", () => {
    const source = new MemoryStorage();
    const appearance = { ...preferences, theme: "green", themePreset: "green" };
    source.setItem(READER_PREFERENCES_KEY, JSON.stringify(appearance));
    const backup = parseUserDataBackup(JSON.stringify(buildUserDataBackup(source)));
    const target = new MemoryStorage();
    restoreUserDataBackup(target, backup);
    expect(JSON.parse(target.getItem(READER_PREFERENCES_KEY)!)).toEqual(appearance);
  });

  it("restores a full snapshot, removes missing allowlisted keys and preserves unrelated storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note("old")] }));
    storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify([{ id: "old-word" }]));
    storage.setItem("unrelated-local-key", "keep-me");

    const backup = parseUserDataBackup(backupText({
      [NOTES_STATE_KEY]: { version: 1, items: [note("restored")] },
      [READER_PREFERENCES_KEY]: preferences,
    }));
    restoreUserDataBackup(storage, backup);

    expect(JSON.parse(storage.getItem(NOTES_STATE_KEY) ?? "null")).toEqual({ version: 1, items: [note("restored")] });
    expect(storage.getItem(SAVED_SELECTIONS_KEY)).toBeNull();
    expect(storage.getItem("unrelated-local-key")).toBe("keep-me");
  });

  it("rolls back previously written keys when storage fails mid-restore", () => {
    class FailingStorage extends MemoryStorage {
      fail = false;
      override setItem(key: string, value: string) {
        if (this.fail && key === READER_PREFERENCES_KEY) throw new Error("quota");
        super.setItem(key, value);
      }
    }
    const storage = new FailingStorage();
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note("before")] }));
    storage.setItem(READER_PREFERENCES_KEY, JSON.stringify({ ...preferences, theme: "paper" }));
    const beforeNotes = storage.getItem(NOTES_STATE_KEY);
    const beforePreferences = storage.getItem(READER_PREFERENCES_KEY);
    const backup = parseUserDataBackup(backupText({
      [NOTES_STATE_KEY]: { version: 1, items: [note("after")] },
      [READER_PREFERENCES_KEY]: preferences,
    }));

    storage.fail = true;
    expect(() => restoreUserDataBackup(storage, backup)).toThrow("quota");
    storage.fail = false;
    expect(storage.getItem(NOTES_STATE_KEY)).toBe(beforeNotes);
    expect(storage.getItem(READER_PREFERENCES_KEY)).toBe(beforePreferences);
  });

  it("rejects invalid nested records before touching any storage", () => {
    for (const key of USER_DATA_STORAGE_KEYS.filter((key) => key !== READER_STATE_KEY && key !== READER_PREFERENCES_KEY)) {
      const versioned = [NOTES_STATE_KEY, "magazine-reader-read-later-v1", "magazine-reader-reading-history-v1"].includes(key);
      expect(() => parseUserDataBackup(backupText({ [key]: versioned ? { version: 1, items: [{}] } : [{}] }))).toThrow("格式不正确");
    }
    const storage = new MemoryStorage();
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note("keep")] }));
    const before = new Map(storage.values);
    const invalid = { app: "magazine-reader" as const, version: 1 as const, exportedAt: "2026-09-23T09:00:00Z", data: { [NOTES_STATE_KEY]: { version: 1, items: [{}] } } };
    expect(() => restoreUserDataBackup(storage, invalid)).toThrow("笔记");
    expect(storage.values).toEqual(before);
  });

  it("rejects malformed progress, book positions and note anchors while preserving legacy backups", () => {
    for (const state of [
      { progress: { a: "42" } }, { progress: { a: 101 } },
      { progress: {}, positions: { a: {} } },
      { progress: {}, bookProgress: { "reading:book:b:c": -1 } },
      { progress: {}, bookPositions: { a: {} } },
      { progress: {}, lastBookPosition: { documentId: "wrong", bookId: "b", chapterId: "c" } },
    ]) expect(() => parseUserDataBackup(backupText({ [READER_STATE_KEY]: { version: 1, ...state } }))).toThrow("阅读进度");
    expect(() => parseUserDataBackup(backupText({ [NOTES_STATE_KEY]: { version: 1, items: [{ ...note("n"), anchor: { kind: "selection", paragraphIndex: 0, paragraphText: "abc", startOffset: 0, endOffset: 9, selectedText: "abc" } }] } }))).toThrow("笔记");
    expect(() => parseUserDataBackup(backupText({ [READER_STATE_KEY]: { version: 1, progress: {}, lastPosition: null } }))).not.toThrow();
  });

  it("clears only allowlisted data", () => {
    const storage = new MemoryStorage();
    USER_DATA_STORAGE_KEYS.forEach((key) => storage.setItem(key, "{}"));
    storage.setItem("unrelated-local-key", "keep-me");
    clearUserData(storage);
    expect(USER_DATA_STORAGE_KEYS.every((key) => storage.getItem(key) === null)).toBe(true);
    expect(storage.getItem("unrelated-local-key")).toBe("keep-me");
  });
});

it("backs up and restores unified history, read later and lesson progress without credentials", () => {
  const backend = new MemoryStorage();
  const document = { kind: "book-lesson", bookId: "b", lessonId: "l", documentId: "reading:lesson:b:l" };
  const entry = { document, title: "精选阅读", sourceTitle: "Book", sourceFingerprint: "fixture" };
  const history = { version: 1, items: [{ ...entry, lastOpenedAt: "2026-10-16T01:00:00Z" }], lastRead: { ...entry, lastOpenedAt: "2026-10-16T01:00:00Z" } };
  const progress = { version: 1, progress: { [document.documentId]: 42 }, positions: { [document.documentId]: { paragraphIndex: 1, paragraphText: "Saved paragraph.", viewportOffset: 100 } } };
  backend.setItem("magazine-reader-reading-history-v1", JSON.stringify(history));
  backend.setItem("magazine-reader-read-later-v1", JSON.stringify({ version: 1, items: [{ ...entry, savedAt: "2026-10-16T01:00:00Z" }] }));
  backend.setItem("magazine-reader:lesson-reading:v1", JSON.stringify(progress));
  const backup = parseUserDataBackup(JSON.stringify(buildUserDataBackup(backend)));
  const restored = new MemoryStorage(); restoreUserDataBackup(restored, backup);
  expect(JSON.parse(restored.getItem("magazine-reader:lesson-reading:v1")!)).toEqual(progress);
  expect(JSON.parse(restored.getItem("magazine-reader-reading-history-v1")!)).toEqual(history);
  expect(JSON.parse(restored.getItem("magazine-reader-read-later-v1")!).items[0].document).toEqual(document);
  expect(() => parseUserDataBackup(backupText({ "magazine-reader:lesson-reading:v1": { version: 1, progress: { "reading:book:b:c": 42 }, positions: {} } }))).toThrow("格式不正确");
});
