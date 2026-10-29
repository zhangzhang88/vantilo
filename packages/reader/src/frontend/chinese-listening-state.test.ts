import { describe, expect, it } from "vitest";
import { CHINESE_LISTENING_KEY, loadChineseListeningRecords, resolveChineseListeningPosition, saveChineseListeningPosition, splitChineseSpeech, type ChineseListeningPosition } from "./chinese-listening-state";
import { buildUserDataBackup, parseUserDataBackup, restoreUserDataBackup } from "./user-data-backup";
const memory = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } }; };
const record: ChineseListeningPosition = { documentId: "reading:book:a:one", paragraphIndex: 1, sourceText: "Source two.", chunkIndex: 2, chunkText: "中文原段。", seconds: 6.5, rate: 1.25, completed: false };
describe("Chinese listening state", () => {
  it("round-trips location, segment and speed in backups without audio", () => {
    const storage = memory(); saveChineseListeningPosition(storage, record);
    const backup = parseUserDataBackup(JSON.stringify(buildUserDataBackup(storage)));
    const restored = memory(); restoreUserDataBackup(restored, backup);
    expect(loadChineseListeningRecords(restored)).toEqual([record]);
    expect(JSON.stringify(backup)).not.toContain("blob:");
    saveChineseListeningPosition(restored, { ...record, seconds: 8 });
    expect(loadChineseListeningRecords(restored)).toEqual([{ ...record, seconds: 8 }]);
  });
  it("guards source snapshots, relocates unique matches and isolates chapters", () => {
    expect(resolveChineseListeningPosition([record], record.documentId, ["Source two.", "Other"])).toMatchObject({ paragraphIndex: 0 });
    expect(resolveChineseListeningPosition([record], record.documentId, ["Changed", "Different"])).toBeUndefined();
    expect(resolveChineseListeningPosition([record], "reading:book:a:other", ["Source two."])).toBeUndefined();
    expect(resolveChineseListeningPosition([record], record.documentId, ["Source two.", "Other", "Source two."])).toBeUndefined();
  });
  it("rejects corrupt data and impossible timestamps before restore", () => {
    const storage = memory(); storage.setItem(CHINESE_LISTENING_KEY, "broken");
    expect(loadChineseListeningRecords(storage)).toEqual([]);
    storage.setItem(CHINESE_LISTENING_KEY, JSON.stringify([{ ...record, seconds: -2 }]));
    expect(loadChineseListeningRecords(storage)).toEqual([]);
    expect(() => parseUserDataBackup(JSON.stringify({ ...buildUserDataBackup(memory()), data: { [CHINESE_LISTENING_KEY]: [{ ...record, rate: 9 }] } }))).toThrow();
  });
  it("splits punctuation and long unpunctuated Chinese without dropping content", () => {
    const text = "这是完整的第一句话。" + "很长的中文😀".repeat(100) + "！\n这是最后一句。";
    const chunks = splitChineseSpeech(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every(chunk => Array.from(chunk).length <= 130)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(splitChineseSpeech(" \n ")).toEqual([]);
  });
});
