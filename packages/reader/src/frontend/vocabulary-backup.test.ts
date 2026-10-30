import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity";
import { SAVED_SELECTIONS_KEY, type SavedSelection } from "./selection-state";
import { VOCABULARY_REVIEW_SCHEDULE_KEY, type VocabularyReviewScheduleRecord } from "./vocabulary-review-schedule";
import { WORD_CONTEXT_MEANINGS_KEY, wordContextOccurrenceKey, type WordContextMeaningRecord } from "./word-context-state";
import {
  buildVocabularyBackupData,
  canonicalVocabularyJson,
  captureVocabularyStorageRaw,
  createVocabularyBackupDocument,
  findMissingVocabularySources,
  mergeVocabularyData,
  parseVocabularyBackup,
  restoreVocabularyDataTransaction,
  type VocabularyBackupData,
  type VocabularyReadStorage,
  type VocabularyTransactionStorage,
} from "./vocabulary-backup";
import { recoverVocabularyRestoreJournal } from "./vocabulary-backup-startup";

const require = createRequire(import.meta.url);
const mainProcessBackup = require("../../../../electron/vocabulary-backup-service.cjs") as {
  createVocabularyBackupDocument(options: { snapshot: VocabularyBackupData; appVersion: string; createdAt: string }): VocabularyBackupV1;
  writeVocabularyBackupAtomic(options: { savePath: string; document: VocabularyBackupV1 }): Promise<{ path: string; sha256: string }>;
};
import type { VocabularyBackupV1 } from "./vocabulary-backup";

class TestStorage implements VocabularyTransactionStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const document = bookChapterReadingDocumentIdentity("book:fixture", "chapter:1");
const selection = (overrides: Partial<SavedSelection> = {}): SavedSelection => ({
  id: "selection-device-a-1", document, articleTitle: "Fixture Book", text: "bank", context: "The bank held the river back.",
  paragraphIndex: 4, startOffset: 10, createdAt: "2026-10-01T00:00:00.000Z", usageExplanationZh: "这里指河岸。", translationZh: "河岸", translationSource: "user", familiarity: 2,
  ...overrides,
});
const contextual = (overrides: Partial<WordContextMeaningRecord> = {}): WordContextMeaningRecord => {
  const base = { document, paragraphIndex: 4, startOffset: 10, text: "bank" };
  return {
    ...base,
    key: wordContextOccurrenceKey(base), paragraph: "The bank held the river back.", sentence: "The bank held the river back.", generatedAt: "2026-10-02T00:00:00.000Z",
    meaningZh: "河岸", explanationZh: "河流两侧的土地。", meaningEn: "land beside a river", explanationEn: "The land along a river.", examplesEn: ["We sat on the river bank."], partOfSpeech: "noun", model: "test-model", provider: "easycliproxy", meaningSource: "ai",
    ...overrides,
  };
};
const schedule = (overrides: Partial<VocabularyReviewScheduleRecord> = {}): VocabularyReviewScheduleRecord => ({
  key: "bank", text: "bank", familiarity: 2, intervalDays: 3, reviewCount: 1,
  lastReviewedAt: "2026-10-03T00:00:00.000Z", dueAt: "2026-10-06T00:00:00.000Z", ...overrides,
});
function putData(storage: TestStorage, data: VocabularyBackupData) {
  storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify(data.savedSelections));
  storage.setItem(WORD_CONTEXT_MEANINGS_KEY, JSON.stringify(data.contextualMeanings));
  storage.setItem(VOCABULARY_REVIEW_SCHEDULE_KEY, JSON.stringify(data.reviewSchedules));
}
function fixtureStorage(overrides: { selections?: SavedSelection[]; contexts?: WordContextMeaningRecord[]; schedules?: VocabularyReviewScheduleRecord[] } = {}) {
  const storage = new TestStorage();
  storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify(overrides.selections ?? [selection()]));
  storage.setItem(WORD_CONTEXT_MEANINGS_KEY, JSON.stringify(overrides.contexts ?? [contextual()]));
  storage.setItem(VOCABULARY_REVIEW_SCHEDULE_KEY, JSON.stringify(overrides.schedules ?? [schedule()]));
  return storage;
}

describe("vocabulary-only backup and merge", () => {
  it("exports saved words, user meaning, familiarity and source links from the real storage keys", () => {
    const data = buildVocabularyBackupData(fixtureStorage());
    expect(data.savedSelections[0]).toMatchObject({ text: "bank", translationZh: "河岸", familiarity: 2, document: { documentId: document.documentId } });
  });

  it("keeps contextual Chinese and English meanings, examples and review counts", () => {
    const data = buildVocabularyBackupData(fixtureStorage());
    expect(data.contextualMeanings[0]).toMatchObject({ meaningZh: "河岸", meaningEn: "land beside a river", examplesEn: ["We sat on the river bank."] });
    expect(data.reviewSchedules[0]).toMatchObject({ reviewCount: 1, dueAt: "2026-10-06T00:00:00.000Z" });
  });

  it("preserves multiword entries and distinct meanings for separate occurrences of the same word", () => {
    const phrase = selection({ id: "phrase", text: "look after", context: "Look after the little bank of plants." , paragraphIndex: 8, startOffset: 0 });
    const verbOccurrence = selection({ id: "verb", startOffset: 40, usageExplanationZh: "此处作动词。" });
    const nounContext = contextual({ partOfSpeech: "noun" });
    const verbContext = contextual({ startOffset: 40, partOfSpeech: "verb", meaningZh: "使倾斜", explanationZh: "使飞机或车辆转向一侧。" });
    const storage = fixtureStorage({ selections: [selection(), verbOccurrence, phrase], contexts: [nounContext, verbContext] });
    const data = buildVocabularyBackupData(storage);
    expect(data.savedSelections.map(item => item.text)).toContain("look after");
    expect(data.contextualMeanings).toHaveLength(2);
    expect(data.contextualMeanings.map(item => item.partOfSpeech).sort()).toEqual(["noun", "verb"]);
  });

  it("excludes unrelated API, Agent, Codex, Chromium, Reader and cache keys", async () => {
    const storage = fixtureStorage();
    for (const key of ["reader-custom-api-v1.json", "api-key", "encryptedApiKey", "codex-oauth", "agent-sessions", "chromium-cookie", "reader-cache", "reading-progress", "epub-library"]) storage.setItem(key, "synthetic-secret-must-not-export");
    const doc = await createVocabularyBackupDocument(buildVocabularyBackupData(storage), "0.1.13", "2026-10-30T00:00:00.000Z");
    expect(JSON.stringify(doc)).not.toContain("synthetic-secret-must-not-export");
    expect(doc.exclusions.join(" ")).toContain("API Key");
    expect(Object.keys(doc.data)).toEqual(["savedSelections", "contextualMeanings", "reviewSchedules"]);
  });

  it("clips paragraph context and never exports full source text", () => {
    const long = `left ${"article body ".repeat(100)} bank ${"more text ".repeat(80)} end`;
    const storage = fixtureStorage({ selections: [selection({ context: long })], contexts: [contextual({ paragraph: long, sentence: long })] });
    const data = buildVocabularyBackupData(storage);
    expect(data.savedSelections[0]!.context.length).toBeLessThanOrEqual(320);
    expect(data.contextualMeanings[0]!.paragraph.length).toBeLessThanOrEqual(320);
    expect(data.contextualMeanings[0]!.sentence.length).toBeLessThanOrEqual(320);
    expect(JSON.stringify(data)).not.toContain(long);
  });

  it("rejects malformed source storage rather than silently exporting an incomplete backup", () => {
    const storage = new TestStorage(); storage.setItem(SAVED_SELECTIONS_KEY, "not-json");
    expect(() => buildVocabularyBackupData(storage)).toThrow("不是有效 JSON");
  });

  it("records unique vocabulary count and the counts for associated record collections", async () => {
    const second = selection({ id: "selection-2", text: "bank", startOffset: 30, paragraphIndex: 9 });
    const data = buildVocabularyBackupData(fixtureStorage({ selections: [selection(), second] }));
    const doc = await createVocabularyBackupDocument(data, "0.1.13", "2026-10-30T00:00:00.000Z");
    expect(doc.counts).toMatchObject({ vocabulary: 1, savedSelections: 2, contextualMeanings: 1, reviewSchedules: 1 });
  });

  it("validates a canonical SHA-256 document and exact file size", async () => {
    const data = buildVocabularyBackupData(fixtureStorage());
    const doc = await createVocabularyBackupDocument(data, "0.1.13", "2026-10-30T00:00:00.000Z");
    const serialized = JSON.stringify(doc, null, 2) + "\n";
    expect((await parseVocabularyBackup(serialized)).integrity.sha256).toBe(doc.integrity.sha256);
    expect(Buffer.byteLength(serialized)).toBe(doc.integrity.fileBytes);
  });

  it("parses the exact JSON document produced by Electron Main Process", async () => {
    const data = buildVocabularyBackupData(fixtureStorage());
    const mainDocument = mainProcessBackup.createVocabularyBackupDocument({ snapshot: data, appVersion: "0.1.13", createdAt: "2026-10-30T00:00:00.000Z" });
    const serialized = JSON.stringify(mainDocument, null, 2) + "\n";
    expect((await parseVocabularyBackup(serialized)).data.savedSelections[0]?.text).toBe("bank");
  });

  it("rejects malformed JSON and unsupported backup versions before any write", async () => {
    await expect(parseVocabularyBackup("{" )).rejects.toThrow("不是有效 JSON");
    const doc = await createVocabularyBackupDocument(buildVocabularyBackupData(fixtureStorage()), "0.1.13");
    await expect(parseVocabularyBackup(JSON.stringify({ ...doc, backupFormatVersion: 99 }))).rejects.toThrow("不支持词汇备份格式版本");
  });

  it("rejects hash tampering, count mismatches and unrecognized secret fields", async () => {
    const doc = await createVocabularyBackupDocument(buildVocabularyBackupData(fixtureStorage()), "0.1.13");
    const tampered = structuredClone(doc); tampered.data.savedSelections[0]!.translationZh = "篡改";
    await expect(parseVocabularyBackup(JSON.stringify(tampered))).rejects.toThrow("SHA-256 校验失败");
    const badCount = structuredClone(doc); badCount.counts.savedSelections += 1;
    await expect(parseVocabularyBackup(JSON.stringify(badCount))).rejects.toThrow("数量与实际内容不一致");
    const extra = structuredClone(doc) as unknown as Record<string, any>;
    extra.data.savedSelections[0].apiKey = "synthetic-key";
    await expect(parseVocabularyBackup(JSON.stringify(extra))).rejects.toThrow("无效或不兼容");
    const malformedFamiliarity = structuredClone(doc) as unknown as Record<string, any>;
    malformedFamiliarity.data.savedSelections[0].familiarity = "2";
    await expect(parseVocabularyBackup(JSON.stringify(malformedFamiliarity))).rejects.toThrow("无效或不兼容");
  });

  it("merges cross-device IDs by stable document, paragraph, word and offset", () => {
    const current = { savedSelections: [selection({ id: "device-a", usageExplanationZh: "local note", familiarity: 3 })], contextualMeanings: [], reviewSchedules: [] };
    const backup = { savedSelections: [selection({ id: "device-b", usageExplanationZh: "backup note", familiarity: 1 })], contextualMeanings: [], reviewSchedules: [] };
    const merged = mergeVocabularyData(current, backup);
    expect(merged.data.savedSelections).toHaveLength(1);
    expect(merged.data.savedSelections[0]).toMatchObject({ id: "device-a", usageExplanationZh: "local note", familiarity: 3 });
    expect(merged.preview.mergeableRecords).toBe(1);
    expect(merged.preview.conflictCount).toBeGreaterThan(0);
  });

  it("does not merge the same word saved at a different occurrence", () => {
    const current = { savedSelections: [selection({ startOffset: 10 })], contextualMeanings: [], reviewSchedules: [] };
    const backup = { savedSelections: [selection({ id: "other", startOffset: 80 })], contextualMeanings: [], reviewSchedules: [] };
    expect(mergeVocabularyData(current, backup).data.savedSelections).toHaveLength(2);
  });

  it("does not cross-device merge identical words when the legacy records have no occurrence offset", () => {
    const current = { savedSelections: [selection({ id: "device-a", startOffset: undefined })], contextualMeanings: [], reviewSchedules: [] };
    const backup = { savedSelections: [selection({ id: "device-b", startOffset: undefined, usageExplanationZh: "另一处语境" })], contextualMeanings: [], reviewSchedules: [] };
    const merged = mergeVocabularyData(current, backup);
    expect(merged.data.savedSelections).toHaveLength(2);
    expect(merged.data.savedSelections.map(item => item.usageExplanationZh)).toContain("另一处语境");
  });

  it("reports missing source books and magazines without dropping their vocabulary records", () => {
    const present = selection({ id: "present", document });
    const missing = selection({ id: "missing", document: bookChapterReadingDocumentIdentity("book:missing", "chapter:gone") });
    const data = { savedSelections: [present, missing], contextualMeanings: [], reviewSchedules: [] };
    const availability = findMissingVocabularySources(data, new Set(["book:fixture"]), new Set());
    expect(availability).toEqual({ missingDocumentIds: ["reading:book:book:missing:chapter:gone"], documentCount: 2 });
    expect(mergeVocabularyData({ savedSelections: [], contextualMeanings: [], reviewSchedules: [] }, data).data.savedSelections).toHaveLength(2);
  });

  it("accepts an imported user meaning over a generated local meaning but preserves local notes", () => {
    const current = { savedSelections: [selection({ translationZh: "河边", translationSource: "auto", usageExplanationZh: "local" })], contextualMeanings: [contextual()], reviewSchedules: [] };
    const backup = { savedSelections: [selection({ id: "device-b", translationZh: "河岸", translationSource: "user", usageExplanationZh: "backup" })], contextualMeanings: [contextual({ meaningZh: "河岸" , meaningSource: "user" })], reviewSchedules: [] };
    const merged = mergeVocabularyData(current, backup);
    expect(merged.data.savedSelections[0]).toMatchObject({ translationZh: "河岸", translationSource: "user", usageExplanationZh: "local" });
    expect(merged.data.contextualMeanings[0]).toMatchObject({ meaningZh: "河岸", meaningSource: "user" });
  });

  it("keeps conflicting existing user meanings and reports the conflict", () => {
    const current = { savedSelections: [selection({ translationZh: "现有释义", translationSource: "user" })], contextualMeanings: [contextual({ meaningZh: "现有语境", meaningSource: "user" })], reviewSchedules: [] };
    const backup = { savedSelections: [selection({ id: "device-b", translationZh: "备份释义", translationSource: "user" })], contextualMeanings: [contextual({ meaningZh: "备份语境", meaningSource: "user" })], reviewSchedules: [] };
    const merged = mergeVocabularyData(current, backup);
    expect(merged.data.savedSelections[0]?.translationZh).toBe("现有释义");
    expect(merged.data.contextualMeanings[0]?.meaningZh).toBe("现有语境");
    expect(merged.preview.conflictCount).toBeGreaterThanOrEqual(2);
  });

  it("merges review history without adding duplicate review counts", () => {
    const local = schedule({ reviewCount: 4, lastReviewedAt: "2026-10-05T00:00:00.000Z" });
    const incoming = schedule({ reviewCount: 7, lastReviewedAt: "2026-10-04T00:00:00.000Z", familiarity: 3 });
    const merged = mergeVocabularyData({ savedSelections: [], contextualMeanings: [], reviewSchedules: [local] }, { savedSelections: [], contextualMeanings: [], reviewSchedules: [incoming] });
    expect(merged.data.reviewSchedules[0]).toMatchObject({ reviewCount: 7, familiarity: 2, lastReviewedAt: local.lastReviewedAt });
  });

  it("is idempotent when the same backup is imported repeatedly", () => {
    const first = mergeVocabularyData({ savedSelections: [], contextualMeanings: [], reviewSchedules: [] }, { savedSelections: [selection()], contextualMeanings: [contextual()], reviewSchedules: [schedule()] }).data;
    const second = mergeVocabularyData(first, { savedSelections: [selection({ id: "another-device" })], contextualMeanings: [contextual()], reviewSchedules: [schedule({ reviewCount: 1 })] }).data;
    expect(second.savedSelections).toHaveLength(1); expect(second.contextualMeanings).toHaveLength(1); expect(second.reviewSchedules[0]?.reviewCount).toBe(1);
  });

  it("aborts a stale preview before creating a recovery journal", () => {
    const storage = fixtureStorage(); const old = captureVocabularyStorageRaw(storage); storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify([selection({ id: "changed" })]));
    const incoming = { savedSelections: [], contextualMeanings: [], reviewSchedules: [] };
    expect(() => restoreVocabularyDataTransaction(storage, incoming, entries => writeEntries(storage, entries), old)).toThrow("已有变化");
    expect(storage.getItem("vantilo-vocabulary-restore-journal-v1")).toBeNull();
  });

  it("rolls back a partially applied merge after a write failure", () => {
    const storage = fixtureStorage(); const before = captureVocabularyStorageRaw(storage);
    const originalWrite = (entries: Record<string, string | null>) => writeEntries(storage, entries);
    let failOnce = true;
    const write = (entries: Record<string, string | null>) => {
      if (failOnce && entries[SAVED_SELECTIONS_KEY] !== before[SAVED_SELECTIONS_KEY]) {
        failOnce = false; storage.setItem(SAVED_SELECTIONS_KEY, entries[SAVED_SELECTIONS_KEY]!); throw new Error("synthetic write failure");
      }
      originalWrite(entries);
    };
    expect(() => restoreVocabularyDataTransaction(storage, { savedSelections: [selection({ id: "new" })], contextualMeanings: [], reviewSchedules: [] }, write)).toThrow("synthetic write failure");
    expect(captureVocabularyStorageRaw(storage)).toEqual(before);
    expect(storage.getItem("vantilo-vocabulary-restore-journal-v1")).toBeNull();
  });

  it("recovers an interrupted PREPARED journal before accepting new data", () => {
    const storage = fixtureStorage(); const before = captureVocabularyStorageRaw(storage);
    storage.setItem("vantilo-vocabulary-restore-journal-v1", JSON.stringify({ version: 1, phase: "PREPARED", createdAt: "2026-10-30T00:00:00.000Z", original: before }));
    storage.setItem(SAVED_SELECTIONS_KEY, "[]");
    expect(recoverVocabularyRestoreJournal(storage)).toEqual({ status: "rolled-back" });
    expect(captureVocabularyStorageRaw(storage)).toEqual(before);
  });

  it("recovers a request-ID journal left by an interrupted merge", () => {
    const storage = fixtureStorage(); const before = captureVocabularyStorageRaw(storage); const transactionId = "4a88468d-502d-419e-804c-cc8636fb83a4";
    let failures = 0;
    const write = (entries: Record<string, string | null>) => {
      if (failures < 2) { failures += 1; throw new Error("synthetic interrupted transaction"); }
      writeEntries(storage, entries);
    };
    expect(() => restoreVocabularyDataTransaction(storage, { savedSelections: [selection({ id: "new" })], contextualMeanings: [], reviewSchedules: [] }, write, before, transactionId)).toThrow("自动回滚");
    expect(JSON.parse(storage.getItem("vantilo-vocabulary-restore-journal-v1") || "null").transactionId).toBe(transactionId);
    expect(recoverVocabularyRestoreJournal(storage)).toEqual({ status: "rolled-back" });
    expect(captureVocabularyStorageRaw(storage)).toEqual(before);
  });

  it("cleans a COMMITTED journal without rolling back verified data", () => {
    const storage = fixtureStorage(); const current = captureVocabularyStorageRaw(storage);
    storage.setItem("vantilo-vocabulary-restore-journal-v1", JSON.stringify({ version: 1, phase: "COMMITTED", createdAt: "2026-10-30T00:00:00.000Z", original: current }));
    expect(recoverVocabularyRestoreJournal(storage)).toEqual({ status: "committed-cleaned" });
    expect(captureVocabularyStorageRaw(storage)).toEqual(current);
  });

  it("fails closed on a damaged recovery journal and preserves it", () => {
    const storage = fixtureStorage(); storage.setItem("vantilo-vocabulary-restore-journal-v1", "not-json");
    expect(() => recoverVocabularyRestoreJournal(storage)).toThrow();
    expect(storage.getItem("vantilo-vocabulary-restore-journal-v1")).toBe("not-json");
  });

  it("completes an isolated localStorage backup and restore round trip on a fresh profile", async () => {
    const sourceDom = new JSDOM("", { url: "http://127.0.0.1:5175/source-profile" });
    const targetDom = new JSDOM("", { url: "http://127.0.0.1:5175/target-profile" });
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "vantilo-vocabulary-roundtrip-"));
    try {
      const source = sourceDom.window.localStorage; const target = targetDom.window.localStorage;
      source.setItem(SAVED_SELECTIONS_KEY, JSON.stringify([selection()]));
      source.setItem(WORD_CONTEXT_MEANINGS_KEY, JSON.stringify([contextual()]));
      source.setItem(VOCABULARY_REVIEW_SCHEDULE_KEY, JSON.stringify([schedule()]));
      source.setItem("synthetic-api-key", "synthetic-secret");
      const rendererDocument = await createVocabularyBackupDocument(buildVocabularyBackupData(source), "0.1.13", "2026-10-30T00:00:00.000Z");
      const written = await mainProcessBackup.writeVocabularyBackupAtomic({ savePath: path.join(temporaryDirectory, "fixture.json"), document: rendererDocument });
      const file = await readFile(written.path, "utf8");
      const parsed = await parseVocabularyBackup(file);
      const expectedRaw = captureVocabularyStorageRaw(target);
      restoreVocabularyDataTransaction(target, parsed.data, entries => writeEntries(target, entries), expectedRaw);
      expect(canonicalVocabularyJson(buildVocabularyBackupData(target))).toBe(canonicalVocabularyJson(buildVocabularyBackupData(source)));
      expect(target.getItem("synthetic-api-key")).toBeNull();
      expect(written.sha256).toBe(parsed.integrity.sha256);
    } finally { sourceDom.window.close(); targetDom.window.close(); await rm(temporaryDirectory, { recursive: true, force: true }); }
  });
});

function writeEntries(storage: VocabularyTransactionStorage, entries: Record<string, string | null>) {
  for (const [key, value] of Object.entries(entries)) if (value === null) storage.removeItem(key); else storage.setItem(key, value);
}
