import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findParagraphTranslation,
  headingTranslationTarget,
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

  it("refuses stale cache when the source paragraph changed", () => {
    const item = record();
    const changed = paragraphTranslationTarget({ ...item, sourceText: "Changed paragraph." });
    expect(findParagraphTranslation([item], changed)).toBeUndefined();
  });

  it("uses Book ReadingDocument identity without manufacturing Magazine fields", () => {
    const document = bookChapterReadingDocumentIdentity("book:isbn:9780226239873", "chapter:008:thinking-in-print");
    const target = paragraphTranslationTarget({ document, paragraphIndex: 4, sourceText: "Book paragraph." });
    expect(target.key).toBe(`${document.documentId}:4`);
    expect(target.issueId).toBeUndefined();
    expect(target.articleId).toBeUndefined();
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

  it("manual retranslation replaces the cached record at the same paragraph location", () => {
    const original = record();
    const gemini = record({
      translationZh: "Gemini 的新翻译。",
      profileId: "gemini-profile",
      model: "gemini-3.1-flash-lite",
      generatedAt: "2026-09-23T09:00:00.000Z",
    });
    const next = upsertParagraphTranslation([original], gemini);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      translationZh: "Gemini 的新翻译。",
      profileId: "gemini-profile",
      model: "gemini-3.1-flash-lite",
    });
  });
});
