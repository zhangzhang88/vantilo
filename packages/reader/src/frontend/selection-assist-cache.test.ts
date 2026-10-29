import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findSelectionAssistCachedResult,
  loadSelectionAssistCache,
  saveSelectionAssistCache,
  SELECTION_ASSIST_CACHE_KEY,
  selectionAssistCacheTarget,
  upsertSelectionAssistCachedResult,
  type SelectionAssistCachedResult,
} from "./selection-assist-cache";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function cached(result: string, generatedAt: string): SelectionAssistCachedResult {
  return {
    result,
    model: "gpt-6-luna",
    provider: "easycliproxy",
    generatedAt,
  };
}

describe("selection assist cache", () => {
  const target = selectionAssistCacheTarget({
    issueId: "economist:2026-09-19",
    articleId: "article-1",
    paragraphIndex: 2,
    startOffset: 18,
    sourceText: "riding a wave",
  });

  it("keeps translation and explanation independently reusable for one exact occurrence", () => {
    const translated = upsertSelectionAssistCachedResult([], target, "translate", cached("乘势而上", "2026-09-22T12:00:00.000Z"));
    const explained = upsertSelectionAssistCachedResult(translated, target, "explain", cached("这里表示借助一股强劲趋势。", "2026-09-22T12:01:00.000Z"));

    expect(findSelectionAssistCachedResult(explained, target, "translate")?.result).toBe("乘势而上");
    expect(findSelectionAssistCachedResult(explained, target, "explain")?.result).toBe("这里表示借助一股强劲趋势。");
  });

  it("does not reuse the same words from a different location or a different selection length", () => {
    const records = upsertSelectionAssistCachedResult([], target, "translate", cached("乘势而上", "2026-09-22T12:00:00.000Z"));
    const otherLocation = selectionAssistCacheTarget({ ...target, startOffset: 61 });
    const longerSelection = selectionAssistCacheTarget({ ...target, sourceText: "riding a wave of investment" });

    expect(findSelectionAssistCachedResult(records, otherLocation, "translate")).toBeUndefined();
    expect(findSelectionAssistCachedResult(records, longerSelection, "translate")).toBeUndefined();
  });

  it("uses Book ReadingDocument identity for Book selections", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const bookTarget = selectionAssistCacheTarget({ document, paragraphIndex: 3, startOffset: 5, sourceText: "source phrase" });
    expect(bookTarget.key).toBe(`${document.documentId}:3:5:13`);
    expect(bookTarget.issueId).toBeUndefined();
    expect(bookTarget.articleId).toBeUndefined();
  });

  it("persists cached results and canonicalizes legacy Economist issue ids", () => {
    const storage = new MemoryStorage();
    const records = upsertSelectionAssistCachedResult([], target, "explain", cached("语境解释", "2026-09-22T12:00:00.000Z"));
    const legacy = [{ ...records[0], issueId: "2026-09-19", key: "stale-key" }];
    storage.setItem(SELECTION_ASSIST_CACHE_KEY, JSON.stringify(legacy));

    const loaded = loadSelectionAssistCache(storage);
    expect(loaded[0]?.issueId).toBe("economist:2026-09-19");
    expect(findSelectionAssistCachedResult(loaded, target, "explain")?.result).toBe("语境解释");

    saveSelectionAssistCache(storage, loaded);
    expect(storage.getItem(SELECTION_ASSIST_CACHE_KEY)).toContain("语境解释");
  });
});
