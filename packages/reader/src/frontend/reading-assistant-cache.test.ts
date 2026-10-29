import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findReadingAssistantCache,
  loadReadingAssistantCache,
  readingAssistantArticleSignature,
  readingAssistantCacheTarget,
  saveReadingAssistantCache,
  upsertReadingAssistantCache,
} from "./reading-assistant-cache";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("reading assistant cache", () => {
  it("changes the article signature when canonical paragraph content changes", () => {
    const original = readingAssistantArticleSignature(["First paragraph.", "Second paragraph."]);
    expect(readingAssistantArticleSignature(["First paragraph.", "Second paragraph."])).toBe(original);
    expect(readingAssistantArticleSignature(["First paragraph.", "Second paragraph changed."])).not.toBe(original);
  });

  it("persists a preset answer and only reuses it for the same article signature", () => {
    const storage = new MemoryStorage();
    const target = readingAssistantCacheTarget({
      issueId: "economist:2026-09-19",
      articleId: "a1",
      presetId: "core-idea",
      question: "这篇文章最核心的观点是什么？",
      articleSignature: readingAssistantArticleSignature(["Article body."]),
    });
    const records = upsertReadingAssistantCache([], {
      ...target,
      answer: "缓存回答",
      paragraphIndexes: [0],
      mode: "quick",
      model: "gpt-6-luna",
      provider: "easycliproxy",
      generatedAt: "2026-09-27T07:00:00.000Z",
    });
    saveReadingAssistantCache(storage, records);
    const loaded = loadReadingAssistantCache(storage);
    expect(findReadingAssistantCache(loaded, target)?.answer).toBe("缓存回答");
    expect(findReadingAssistantCache(loaded, { ...target, articleSignature: "changed" })).toBeUndefined();
  });

  it("caches a Book preset by Book ReadingDocument identity", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const target = readingAssistantCacheTarget({
      document,
      presetId: "core-idea",
      question: "这篇文章最核心的观点是什么？",
      articleSignature: "1:12:abcdef01",
    });
    expect(target.key).toBe(`${document.documentId}:core-idea`);
    expect(target.issueId).toBeUndefined();
    expect(target.articleId).toBeUndefined();
  });

  it("replaces the same preset cache when it is regenerated with another mode and model", () => {
    const target = readingAssistantCacheTarget({
      issueId: "economist:2026-09-19",
      articleId: "a1",
      presetId: "assumptions-counterarguments",
      question: "作者有哪些隐含前提或可能的反例？",
      articleSignature: "2:20:abc12345",
    });
    const quick = upsertReadingAssistantCache([], {
      ...target,
      answer: "Luna answer",
      paragraphIndexes: [1],
      mode: "quick",
      model: "gpt-6-luna",
      provider: "easycliproxy",
      generatedAt: "2026-09-27T07:00:00.000Z",
    });
    const deep = upsertReadingAssistantCache(quick, {
      ...target,
      answer: "Sol answer",
      paragraphIndexes: [2],
      mode: "deep",
      model: "gpt-6-sol",
      provider: "easycliproxy",
      generatedAt: "2026-09-27T07:01:00.000Z",
    });
    expect(deep).toHaveLength(1);
    expect(findReadingAssistantCache(deep, target)).toMatchObject({ answer: "Sol answer", mode: "deep", model: "gpt-6-sol" });
  });
});
