import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findParagraphTranslation,
  inspectParagraphTranslation,
  headingTranslationTarget,
  titleTranslationTarget,
  translationCacheMetadata,
  loadParagraphTranslations,
  PARAGRAPH_TRANSLATIONS_KEY,
  paragraphTranslationTarget,
  saveParagraphTranslations,
  upsertParagraphTranslation,
  type ParagraphTranslationRecord,
} from "./paragraph-translation-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function record(overrides: Partial<ParagraphTranslationRecord> = {}): ParagraphTranslationRecord {
  const target = paragraphTranslationTarget({
    issueId: "economist:2026-09-19",
    articleId: "article-1",
    paragraphIndex: 2,
    sourceText: "Target paragraph.",
  });
  return {
    ...target,
    translationZh: "目标段落。",
    profileId: "gpt-profile",
    model: "gpt-6-luna",
    provider: "easycliproxy",
    generatedAt: "2026-09-23T08:00:00.000Z",
    ...overrides,
  };
}

describe("paragraph translation state", () => {
  it("ignores old decoration translations without deleting stored records", () => {
    const storage = new MemoryStorage();
    const decoration = record({ sourceText: "—", translationZh: "未提供需要翻译的目标段落。" });
    const normal = record();
    saveParagraphTranslations(storage, [decoration, normal]);
    const loaded = loadParagraphTranslations(storage);
    expect(loaded).toHaveLength(2);
    expect(findParagraphTranslation(loaded, paragraphTranslationTarget(decoration))).toBeUndefined();
    expect(findParagraphTranslation(loaded, paragraphTranslationTarget(normal))).toEqual(normal);
  });
  it("persists records and canonicalizes legacy Economist issue ids", () => {
    const storage = new MemoryStorage();
    const item = record();
    storage.setItem(PARAGRAPH_TRANSLATIONS_KEY, JSON.stringify([{ ...item, issueId: "2026-09-19", key: "stale-key" }]));

    const [loaded] = loadParagraphTranslations(storage);
    expect(loaded.issueId).toBe("economist:2026-09-19");
    expect(loaded.key).toBe("reading:article:economist:2026-09-19:article-1:2");
    expect(loaded.document).toMatchObject({ kind: "article", issueId: "economist:2026-09-19", articleId: "article-1" });
    expect(loaded.profileId).toBe("gpt-profile");

    saveParagraphTranslations(storage, [loaded]);
    expect(storage.getItem(PARAGRAPH_TRANSLATIONS_KEY)).toContain("目标段落。");
  });

  it("reuses a cached translation regardless of which AI profile is currently active", () => {
    const item = record();
    const target = paragraphTranslationTarget(item);
    expect(findParagraphTranslation([item], target)).toEqual(item);
  });

  it("restores a completed translation from persistent storage for another reading mode", () => {
    const storage = new MemoryStorage();
    const item = record();
    saveParagraphTranslations(storage, [item]);
    const restored = loadParagraphTranslations(storage);
    expect(findParagraphTranslation(restored, paragraphTranslationTarget(item))?.translationZh).toBe("目标段落。");
  });

  it("reports cache miss reasons without exposing source text", () => {
    const item = record();
    const changed = paragraphTranslationTarget({ ...item, sourceText: "Changed paragraph." });
    expect(inspectParagraphTranslation([item], changed)).toEqual({ hit: false, reason: "source-changed" });
    expect(inspectParagraphTranslation([], paragraphTranslationTarget(item))).toEqual({ hit: false, reason: "document-or-location-miss" });
    expect(findParagraphTranslation([item], changed)).toBeUndefined();
  });

  it("uses Book ReadingDocument identity without manufacturing Magazine fields", () => {
    const document = bookChapterReadingDocumentIdentity("book:isbn:9780226239873", "chapter:008:thinking-in-print");
    const target = paragraphTranslationTarget({ document, paragraphIndex: 4, sourceText: "Book paragraph." });
    expect(target.key).toBe(`${document.documentId}:4`);
    expect(target.issueId).toBeUndefined();
    expect(target.articleId).toBeUndefined();
  });

  it("persists an article title under a stable independent translation identity", () => {
    const storage = new MemoryStorage();
    const target = titleTranslationTarget({ issueId: "economist:2026-09-19", articleId: "article-1", sourceText: "A Stable Title" });
    const item: ParagraphTranslationRecord = { ...target, translationZh: "稳定的标题", model: "gpt-6-luna", provider: "easycliproxy", generatedAt: "2026-09-27T08:00:00.000Z" };
    expect(target.key).toBe("reading:article:economist:2026-09-19:article-1:title");
    saveParagraphTranslations(storage, [item]);
    expect(findParagraphTranslation(loadParagraphTranslations(storage), target)).toEqual(item);
    expect(target.key).not.toBe(headingTranslationTarget({ document: target.document, headingIndex: 0, sourceText: "A Stable Title" }).key);
  });

  it("persists heading translations under the same book translation cache", () => {
    const storage = new MemoryStorage();
    const document = bookChapterReadingDocumentIdentity("book:isbn:9780226239873", "chapter:008:thinking-in-print");
    const target = headingTranslationTarget({ document, headingIndex: 2, sourceText: "Why Research Matters" });
    const item: ParagraphTranslationRecord = {
      ...target,
      translationZh: "研究为何重要",
      model: "gpt-6-luna",
      provider: "easycliproxy",
      generatedAt: "2026-09-27T08:00:00.000Z",
    };

    expect(target.key).toBe(`${document.documentId}:heading:2`);
    expect(target.document.documentId).toBe("reading:book:book:isbn:9780226239873:chapter:008:thinking-in-print");
    saveParagraphTranslations(storage, [item]);
    const [loaded] = loadParagraphTranslations(storage);
    expect(loaded).toMatchObject({ ...target, translationZh: "研究为何重要" });
    expect(findParagraphTranslation([loaded], target)).toEqual(loaded);
    expect(storage.getItem(PARAGRAPH_TRANSLATIONS_KEY)).toContain("Why Research Matters");
  });

  it("keeps model-specific translations independently and resolves the requested model", () => {
    const target = paragraphTranslationTarget(record());
    const modelA = record({ ...translationCacheMetadata({ profileId: "profile-a", model: "model-a", contextBefore: "before", contextAfter: "after" }), profileId: "profile-a", model: "model-a" });
    const modelB = record({ ...translationCacheMetadata({ profileId: "profile-b", model: "model-b", contextBefore: "before", contextAfter: "after" }), profileId: "profile-b", model: "model-b", translationZh: "模型 B 译文" });
    const records = upsertParagraphTranslation(upsertParagraphTranslation([], modelA), modelB);
    expect(records).toHaveLength(2);
    expect(findParagraphTranslation(records, target, { profileId: "profile-a", model: "model-a", contextBefore: "before", contextAfter: "after" })).toMatchObject({ translationZh: "目标段落。" });
    expect(findParagraphTranslation(records, target, { profileId: "profile-b", model: "model-b", contextBefore: "before", contextAfter: "after" })).toMatchObject({ translationZh: "模型 B 译文" });
    expect(inspectParagraphTranslation(records, target, { profileId: "profile-b", model: "model-b", contextBefore: "different", contextAfter: "after" })).toMatchObject({ hit: false, reason: "context-mismatch" });
  });

  it("manual retranslation replaces the cached record at the same paragraph location and model", () => {
    const original = record();
    const gemini = record({
      translationZh: "Gemini 的新翻译。",
      profileId: "gemini-profile",
      model: "gemini-3.1-flash-lite",
      generatedAt: "2026-09-23T09:00:00.000Z",
    });
    const next = upsertParagraphTranslation([original], gemini);

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      translationZh: "Gemini 的新翻译。",
      profileId: "gemini-profile",
      model: "gemini-3.1-flash-lite",
    });
  });
});
