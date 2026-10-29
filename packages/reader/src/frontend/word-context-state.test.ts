import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  findWordContextMeaning,
  hasEnglishWordContext,
  loadWordContextMeanings,
  saveWordContextMeanings,
  sentenceForOccurrence,
  sentenceRangeForOccurrence,
  setWordContextMeaningUserOverride,
  upsertWordContextMeaning,
  WORD_CONTEXT_MEANINGS_KEY,
  wordContextOccurrenceKey,
  type WordContextMeaningRecord,
} from "./word-context-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const base = {
  issueId: "economist:2026-09-19",
  articleId: "story",
  paragraphIndex: 0,
  text: "bank",
};

function record(startOffset: number, paragraph: string, meaningZh: string): WordContextMeaningRecord {
  return {
    ...base,
    key: wordContextOccurrenceKey({ ...base, startOffset }),
    startOffset,
    paragraph,
    sentence: sentenceForOccurrence(paragraph, startOffset, base.text.length),
    meaningZh,
    explanationZh: `这里表示${meaningZh}。`,
    meaningEn: "the land beside a river",
    explanationEn: "This sense refers to land beside a river.",
    examplesEn: ["We sat on the bank.", "Trees lined the river bank."],
    partOfSpeech: "noun",
    model: "gpt-6-luna",
    provider: "easycliproxy",
    generatedAt: "2026-09-21T12:00:00.000Z",
  };
}

describe("word context state", () => {
  it("extracts the exact sentence around an occurrence", () => {
    const paragraph = "Mary sat on the bank. The grass was wet. Then she went home.";
    const start = paragraph.indexOf("bank");
    expect(sentenceForOccurrence(paragraph, start, 4)).toBe("Mary sat on the bank.");
  });

  it("returns sentence offsets for precise reading navigation", () => {
    const paragraph = "First sentence.   Mary sat on the bank. The grass was wet.";
    const start = paragraph.indexOf("bank");
    expect(sentenceRangeForOccurrence(paragraph, start, 4)).toEqual({
      startOffset: paragraph.indexOf("Mary"),
      endOffset: paragraph.indexOf(".", paragraph.indexOf("Mary")) + 1,
      text: "Mary sat on the bank.",
    });
  });

  it("gives different cache keys to the same word in different occurrences", () => {
    const first = wordContextOccurrenceKey({ ...base, startOffset: 16 });
    const second = wordContextOccurrenceKey({ ...base, startOffset: 48 });
    expect(first).not.toBe(second);
  });

  it("migrates older cached records and marks them for English-learning enrichment", () => {
    const storage = new MemoryStorage();
    const paragraph = "Mary sat on the bank.";
    const legacy = { ...record(paragraph.indexOf("bank"), paragraph, "河岸"), issueId: "2026-09-19" } as Record<string, unknown>;
    legacy.key = "2026-09-19:story:0:16:bank";
    delete legacy.meaningEn;
    delete legacy.explanationEn;
    delete legacy.examplesEn;
    storage.setItem(WORD_CONTEXT_MEANINGS_KEY, JSON.stringify([legacy]));

    const [loaded] = loadWordContextMeanings(storage);
    expect(loaded?.issueId).toBe("economist:2026-09-19");
    expect(loaded?.key.startsWith("reading:article:economist:2026-09-19:")) .toBe(true);
    expect(loaded?.document).toMatchObject({ kind: "article", issueId: "economist:2026-09-19", articleId: "story" });
    expect(loaded).toMatchObject({ meaningZh: "河岸", meaningEn: "", explanationEn: "", examplesEn: [] });
    expect(hasEnglishWordContext(loaded)).toBe(false);
  });

  it("keeps Book word-context identity separate from Magazine fields", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const paragraph = "The book uses evidence carefully.";
    const startOffset = paragraph.indexOf("evidence");
    const key = wordContextOccurrenceKey({ document, paragraphIndex: 0, startOffset, text: "evidence" });
    expect(key).toBe(`${document.documentId}:0:${startOffset}:evidence`);
    expect(findWordContextMeaning([{ ...record(0, "bank.", "河岸"), document, issueId: undefined, articleId: undefined, key, text: "evidence", paragraph, startOffset }], { document, paragraphIndex: 0, startOffset, text: "evidence", paragraph })?.document).toEqual(document);
  });

  it("keeps different contextual meanings for the same word", () => {
    const paragraphA = "Mary sat on the bank by the river.";
    const paragraphB = "Mary went to the bank to withdraw money.";
    const riverBank = record(paragraphA.indexOf("bank"), paragraphA, "河岸");
    const moneyBank = {
      ...record(paragraphB.indexOf("bank"), paragraphB, "银行"),
      paragraphIndex: 1,
      key: wordContextOccurrenceKey({ ...base, paragraphIndex: 1, startOffset: paragraphB.indexOf("bank") }),
    };
    const records = upsertWordContextMeaning(upsertWordContextMeaning([], riverBank), moneyBank);

    expect(findWordContextMeaning(records, { ...base, startOffset: paragraphA.indexOf("bank"), paragraph: paragraphA })?.meaningZh).toBe("河岸");
    expect(findWordContextMeaning(records, { ...base, paragraphIndex: 1, startOffset: paragraphB.indexOf("bank"), paragraph: paragraphB })?.meaningZh).toBe("银行");
  });

  it("lets a user override one occurrence without changing the same word elsewhere", () => {
    const paragraphA = "Mary sat on the bank by the river.";
    const paragraphB = "Mary went to the bank to withdraw money.";
    const riverBank = record(paragraphA.indexOf("bank"), paragraphA, "河岸");
    const moneyBank = {
      ...record(paragraphB.indexOf("bank"), paragraphB, "银行"),
      paragraphIndex: 1,
      key: wordContextOccurrenceKey({ ...base, paragraphIndex: 1, startOffset: paragraphB.indexOf("bank") }),
    };
    const records = upsertWordContextMeaning(upsertWordContextMeaning([], riverBank), moneyBank);
    const edited = setWordContextMeaningUserOverride(records, riverBank.key, "河边", new Date("2026-09-21T15:30:00.000Z"));

    expect(edited.find((item) => item.key === riverBank.key)).toMatchObject({
      meaningZh: "河边",
      meaningSource: "user",
      editedAt: "2026-09-21T15:30:00.000Z",
    });
    expect(edited.find((item) => item.key === moneyBank.key)?.meaningZh).toBe("银行");
  });

  it("persists occurrence meanings in localStorage-compatible storage", () => {
    const storage = new MemoryStorage();
    const paragraph = "Mary sat on the bank.";
    const item = record(paragraph.indexOf("bank"), paragraph, "河岸");
    saveWordContextMeanings(storage, [item]);
    expect(loadWordContextMeanings(storage)).toEqual([{
      ...item,
      document: {
        kind: "article",
        documentId: "reading:article:economist:2026-09-19:story",
        issueId: "economist:2026-09-19",
        articleId: "story",
      },
      meaningSource: "ai",
    }]);
    expect(hasEnglishWordContext(item)).toBe(true);
    expect(storage.getItem(WORD_CONTEXT_MEANINGS_KEY)).toContain("河岸");
  });
});
