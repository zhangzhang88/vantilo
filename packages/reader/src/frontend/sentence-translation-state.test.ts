import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findSentenceTranslation,
  loadSentenceTranslations,
  saveSentenceTranslations,
  SENTENCE_TRANSLATIONS_KEY,
  sentenceTranslationTarget,
  sentenceTranslationTargetForOccurrence,
  upsertSentenceTranslation,
  type SentenceTranslationRecord,
} from "./sentence-translation-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function record(translationZh = "人工智能有什么用？"): SentenceTranslationRecord {
  const target = sentenceTranslationTarget({
    issueId: "economist:2026-09-19",
    articleId: "article-1",
    paragraphIndex: 2,
    startOffset: 12,
    sourceText: "WHAT IS AI good for?",
  });
  return {
    ...target,
    translationZh,
    model: "gpt-6-luna",
    provider: "easycliproxy",
    generatedAt: "2026-09-22T12:00:00.000Z",
  };
}

describe("sentence translation state", () => {
  it("derives a stable sentence target from a word occurrence", () => {
    const paragraph = "First sentence. WHAT IS AI good for? One more sentence.";
    const wordOffset = paragraph.indexOf("good");
    const target = sentenceTranslationTargetForOccurrence({
      issueId: "economist:2026-09-19",
      articleId: "article-1",
      paragraphIndex: 2,
      paragraph,
      startOffset: wordOffset,
      targetLength: 4,
    });

    expect(target.sourceText).toBe("WHAT IS AI good for?");
    expect(target.startOffset).toBe(paragraph.indexOf("WHAT"));
    expect(target.key).toBe(`reading:article:economist:2026-09-19:article-1:2:${paragraph.indexOf("WHAT")}`);
  });

  it("persists records and migrates legacy Economist issue ids", () => {
    const storage = new MemoryStorage();
    const item = record();
    const legacy = { ...item, issueId: "2026-09-19", key: "stale-key" };
    storage.setItem(SENTENCE_TRANSLATIONS_KEY, JSON.stringify([legacy]));

    const [loaded] = loadSentenceTranslations(storage);
    expect(loaded.issueId).toBe("economist:2026-09-19");
    expect(loaded.key).toBe("reading:article:economist:2026-09-19:article-1:2:12");
    expect(loaded.document).toMatchObject({ kind: "article", issueId: "economist:2026-09-19", articleId: "article-1" });

    saveSentenceTranslations(storage, [loaded]);
    expect(storage.getItem(SENTENCE_TRANSLATIONS_KEY)).toContain("人工智能有什么用？");
  });

  it("keeps translations imported from a published learning material reusable", () => {
    const storage = new MemoryStorage();
    const imported = { ...record("备课材料中的译文。"), provider: "learning-material" as const };
    saveSentenceTranslations(storage,[imported]);
    expect(loadSentenceTranslations(storage)[0]).toMatchObject({ translationZh: "备课材料中的译文。",provider: "learning-material" });
  });

  it("creates Book sentence cache keys from the Book document identity", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const target = sentenceTranslationTarget({ document, paragraphIndex: 1, startOffset: 8, sourceText: "Book sentence." });
    expect(target.key).toBe(`${document.documentId}:1:8`);
    expect(target.issueId).toBeUndefined();
  });

  it("validates source text before reusing a translation", () => {
    const item = record();
    const matchingTarget = sentenceTranslationTarget(item);
    const changedSource = { ...matchingTarget, sourceText: "WHAT IS AGI good for?" };

    expect(findSentenceTranslation([item], matchingTarget)?.translationZh).toBe("人工智能有什么用？");
    expect(findSentenceTranslation([item], changedSource)).toBeUndefined();
  });

  it("replaces stale content at the same sentence location", () => {
    const original = record();
    const replacement: SentenceTranslationRecord = {
      ...original,
      sourceText: "WHAT IS AGI good for?",
      translationZh: "通用人工智能有什么用？",
      generatedAt: "2026-09-22T13:00:00.000Z",
    };
    const next = upsertSentenceTranslation([original], replacement);

    expect(next).toHaveLength(1);
    expect(next[0]?.sourceText).toBe("WHAT IS AGI good for?");
    expect(next[0]?.translationZh).toBe("通用人工智能有什么用？");
  });
  it("refreshes legacy literal translations and invalidates changed paragraph context", () => {
    const legacy = record();
    const target = sentenceTranslationTarget({ ...legacy, paragraphContext: "Before. " + legacy.sourceText });
    expect(findSentenceTranslation([legacy], target)).toBeUndefined();
    const updated = { ...legacy, ...target, expressions: [{ text: "good for", explanationZh: "这里问有什么用。" }] };
    expect(findSentenceTranslation([updated], target)).toBe(updated);
    const storage = new MemoryStorage(); saveSentenceTranslations(storage, [updated]);
    expect(findSentenceTranslation(loadSentenceTranslations(storage), target)?.expressions).toEqual(updated.expressions);
    const changed = sentenceTranslationTarget({ ...legacy, paragraphContext: "Changed context. " + legacy.sourceText });
    expect(findSentenceTranslation([updated], changed)).toBeUndefined();
    expect(target.key).toBe(changed.key);
  });

});

it("persists four expression categories and keeps old unclassified entries readable", () => {
  const storage = new MemoryStorage();
  const original = record();
  const expressions = (["collocation", "pattern", "contextual", "keyword"] as const).map((kind) => ({ text: original.sourceText, kind, meaningZh: "简短释义", meaningVersion: 2 as const, explanationZh: "用法说明" }));
  saveSentenceTranslations(storage, [{ ...original, expressions }]);
  expect(loadSentenceTranslations(storage)[0].expressions).toEqual(expressions);
});
