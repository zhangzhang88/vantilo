import { describe, expect, it } from "vitest";
import type { GlobalVocabularyContext, GlobalVocabularyItem } from "./global-vocabulary";
import type { FamiliarityLevel, SavedSelection } from "./selection-state";
import type { WordContextMeaningRecord } from "./word-context-state";
import { buildDueVocabularyReviewQueue, buildVocabularyReviewQueue, deferCurrentVocabularyReviewKey, preferredVocabularyReviewContext, vocabularyReviewSentenceSegments } from "./vocabulary-review";

function context(id: string, meaningZh?: string): GlobalVocabularyContext {
  return {
    id,
    issueId: "economist:2026-09-19",
    articleId: "article-1",
    articleTitle: "A test article",
    publicationId: "economist",
    publicationName: "The Economist",
    paragraphIndex: 0,
    startOffset: 0,
    text: id,
    paragraph: `A sentence with ${id}.`,
    sentence: `A sentence with ${id}.`,
    meaningZh,
  };
}

function item(text: string, familiarity: FamiliarityLevel, contexts: GlobalVocabularyContext[]): GlobalVocabularyItem {
  return {
    key: text,
    text,
    familiarity,
    articleCount: 1,
    contextCount: contexts.length,
    publicationIds: ["economist"],
    contexts,
  };
}

describe("vocabulary review", () => {
  it("queues learning states 1-4 and excludes ignored, known or contextless words", () => {
    const queue = buildVocabularyReviewQueue([
      item("familiar", 4, [context("familiar")]),
      item("known", 5, [context("known")]),
      item("ignored", 0, [context("ignored")]),
      item("unknown", 1, [context("unknown")]),
      item("missing", 2, []),
      item("seen", 2, [context("seen")]),
    ]);

    expect(queue.map((entry) => entry.text)).toEqual(["unknown", "seen", "familiar"]);
  });

  it("queues only words whose review schedule is due", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    const items = [
      item("new", 1, [context("new")]),
      item("later", 2, [context("later")]),
      item("due", 3, [context("due")]),
    ];
    const queue = buildDueVocabularyReviewQueue(items, [
      {
        key: "later",
        text: "later",
        familiarity: 2,
        intervalDays: 3,
        reviewCount: 1,
        lastReviewedAt: "2026-09-21T00:00:00.000Z",
        dueAt: "2026-09-24T00:00:00.000Z",
      },
      {
        key: "due",
        text: "due",
        familiarity: 3,
        intervalDays: 7,
        reviewCount: 1,
        lastReviewedAt: "2026-09-14T00:00:00.000Z",
        dueAt: "2026-09-21T00:00:00.000Z",
      },
    ], now);
    expect(queue.map((entry) => entry.text)).toEqual(["new", "due"]);
  });

  it("moves a deferred review key to the end without completing it", () => {
    expect(deferCurrentVocabularyReviewKey(["first", "second", "third"])).toEqual(["second", "third", "first"]);
    expect(deferCurrentVocabularyReviewKey(["only"])).toEqual(["only"]);
    expect(deferCurrentVocabularyReviewKey([])).toEqual([]);
  });

  it("marks only the exact reviewed occurrence when the same word appears twice", () => {
    const paragraph = "The bank approved a loan near the river bank.";
    const secondBankOffset = paragraph.lastIndexOf("bank");
    const reviewContext: GlobalVocabularyContext = {
      id: "context:second-bank",
      issueId: "economist:2026-09-19",
      articleId: "article-1",
      articleTitle: "A test article",
      publicationId: "economist",
      publicationName: "The Economist",
      paragraphIndex: 0,
      startOffset: secondBankOffset,
      text: "bank",
      paragraph,
      sentence: paragraph,
      meaningZh: "河岸",
    };
    const selections: SavedSelection[] = [{
      id: "bank-selection",
      issueId: reviewContext.issueId,
      articleId: reviewContext.articleId,
      articleTitle: reviewContext.articleTitle,
      text: "bank",
      context: paragraph,
      paragraphIndex: 0,
      createdAt: "2026-09-22T04:00:00.000Z",
      familiarity: 2,
    }];

    const segments = vocabularyReviewSentenceSegments(reviewContext, selections, []);
    const bankSegments = segments.filter((segment) => segment.text.toLocaleLowerCase("en-US") === "bank");
    expect(bankSegments).toHaveLength(2);
    expect(bankSegments.map((segment) => segment.isTarget)).toEqual([false, true]);
  });

  it("prefers a saved context that already has a meaning", () => {
    const plain = context("bank-plain");
    const explained = context("bank-explained", "河岸");
    const chosen = preferredVocabularyReviewContext(item("bank", 2, [plain, explained]));

    expect(chosen?.id).toBe("bank-explained");
    expect(chosen?.meaningZh).toBe("河岸");
  });

  it("reveals only already-saved contextual Chinese glosses in the review sentence", () => {
    const paragraph = "They sat on the bank by the river.";
    const bankOffset = paragraph.indexOf("bank");
    const reviewContext: GlobalVocabularyContext = {
      id: "context:bank",
      issueId: "economist:2026-09-19",
      articleId: "article-1",
      articleTitle: "A test article",
      publicationId: "economist",
      publicationName: "The Economist",
      paragraphIndex: 0,
      startOffset: bankOffset,
      text: "bank",
      paragraph,
      sentence: paragraph,
      meaningZh: "河岸",
    };
    const selections: SavedSelection[] = [
      {
        id: "bank-selection",
        issueId: reviewContext.issueId,
        articleId: reviewContext.articleId,
        articleTitle: reviewContext.articleTitle,
        text: "bank",
        context: paragraph,
        paragraphIndex: 0,
        createdAt: "2026-09-22T04:00:00.000Z",
        familiarity: 2,
      },
      {
        id: "river-selection",
        issueId: reviewContext.issueId,
        articleId: reviewContext.articleId,
        articleTitle: reviewContext.articleTitle,
        text: "river",
        context: paragraph,
        paragraphIndex: 0,
        createdAt: "2026-09-22T04:01:00.000Z",
        familiarity: 3,
      },
    ];
    const contextRecords: WordContextMeaningRecord[] = [{
      key: `${reviewContext.issueId}:${reviewContext.articleId}:0:${bankOffset}:bank`,
      issueId: reviewContext.issueId,
      articleId: reviewContext.articleId,
      paragraphIndex: 0,
      startOffset: bankOffset,
      text: "bank",
      paragraph,
      sentence: paragraph,
      meaningZh: "河岸",
      explanationZh: "这里指河边的岸。",
      meaningEn: "the land beside a river",
      explanationEn: "Here, bank means the land beside a river.",
      examplesEn: [],
      partOfSpeech: "noun",
      model: "gpt-6-luna",
      provider: "easycliproxy",
      generatedAt: "2026-09-22T04:02:00.000Z",
      meaningSource: "ai",
    }];

    const segments = vocabularyReviewSentenceSegments(reviewContext, selections, contextRecords);
    expect(segments.find((segment) => segment.text === "bank")).toMatchObject({
      meaningZh: "河岸",
      familiarity: 2,
      saved: true,
      isTarget: true,
    });
    expect(segments.find((segment) => segment.text === "river")).toMatchObject({
      text: "river",
      familiarity: 3,
      saved: true,
      isTarget: false,
    });
    expect(segments.map((segment) => segment.text).join("")).toBe(paragraph);
  });
});
