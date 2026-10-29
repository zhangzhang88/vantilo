import { describe, expect, it } from "vitest";
import type { ReaderIssue } from "./reader-model";
import type { SavedSelection } from "./selection-state";
import type { WordContextMeaningRecord } from "./word-context-state";
import { buildGlobalVocabularyItems } from "./global-vocabulary";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity";
import { buildDueVocabularyReviewQueue, vocabularyReviewSentenceSegments } from "./vocabulary-review";

const issues: ReaderIssue[] = [
  {
    id: "economist:2026-09-19",
    publicationId: "economist",
    publicationName: "The Economist",
    date: "2026-09-19",
    displayDate: "2026年9月19日",
    label: "The Economist · 2026-09-19",
    description: "",
    progress: 0,
    coverKicker: "THE ECONOMIST",
    coverMark: "E",
    coverTitle: "SEP\n19",
    coverSubtitle: "",
    sections: [{
      name: "Finance & economics",
      nameZh: "金融与经济",
      articles: [{
        id: "a1",
        issueId: "economist:2026-09-19",
        author: "",
        section: "Finance & economics",
        sectionZh: "金融与经济",
        title: "Bank story",
        titleZh: "",
        subtitle: "",
        subtitleZh: "",
        summaryZh: "",
        minutes: 1,
        progress: 0,
        paragraphs: ["The river bank was quiet.", "The bank approved the loan."],
        wordCount: 12,
        sourceUrl: null,
      }],
    }],
  },
  {
    id: "wired:2026-09-02",
    publicationId: "wired",
    publicationName: "Wired",
    date: "2026-09-02",
    displayDate: "2026年9月2日",
    label: "Wired · 2026-09-02",
    description: "",
    progress: 0,
    coverKicker: "WIRED",
    coverMark: "W",
    coverTitle: "SEP\n2",
    coverSubtitle: "",
    sections: [],
  },
];

const selections: SavedSelection[] = [
  {
    id: "s1",
    issueId: "economist:2026-09-19",
    articleId: "a1",
    articleTitle: "Bank story",
    text: "bank",
    context: "The river bank was quiet.",
    paragraphIndex: 0,
    createdAt: "2026-09-22T01:00:00.000Z",
    translationZh: "银行；河岸",
    translationSource: "auto",
    familiarity: 2,
  },
  {
    id: "s2",
    issueId: "economist:2026-09-19",
    articleId: "a1",
    articleTitle: "Bank story",
    text: "Bank",
    context: "The bank approved the loan.",
    paragraphIndex: 1,
    createdAt: "2026-09-22T01:01:00.000Z",
    translationZh: "银行；河岸",
    familiarity: 2,
  },
  {
    id: "s3",
    issueId: "wired:2026-09-02",
    articleId: "w1",
    articleTitle: "A Wired bank story",
    text: "bank",
    context: "A different bank appears here.",
    paragraphIndex: 3,
    createdAt: "2026-09-22T01:02:00.000Z",
    translationZh: "金融机构；河岸",
    translationSource: "user",
    familiarity: 3,
  },
];

const contexts: WordContextMeaningRecord[] = [
  {
    key: "economist:2026-09-19:a1:0:10:bank",
    issueId: "economist:2026-09-19",
    articleId: "a1",
    paragraphIndex: 0,
    startOffset: 10,
    text: "bank",
    paragraph: "The river bank was quiet.",
    sentence: "The river bank was quiet.",
    meaningZh: "河岸",
    explanationZh: "这里指河边。",
    meaningEn: "the land beside a river",
    explanationEn: "",
    examplesEn: [],
    partOfSpeech: "noun",
    model: "gpt-6-luna",
    provider: "easycliproxy",
    generatedAt: "2026-09-22T01:03:00.000Z",
    meaningSource: "ai",
  },
];

describe("global vocabulary aggregation", () => {
  it("includes book contexts in the shared vocabulary and review queue without mixing chapter identities", () => {
    const document = bookChapterReadingDocumentIdentity("book:one", "chapter:1");
    const other = bookChapterReadingDocumentIdentity("book:two", "chapter:1");
    const bookWord: SavedSelection = { ...selections[0], id: "book-word", issueId: undefined, articleId: undefined, document, articleTitle: "Chapter One", context: "The river bank was quiet." };
    const record = { ...contexts[0], document, issueId: undefined, articleId: undefined, key: "book-context", meaningSource: "user" as const };
    const items = buildGlobalVocabularyItems([...selections, bookWord, { ...bookWord, document: other, id: "other-book" }], [...contexts, record], issues);
    const item = items[0];
    expect(item.articleCount).toBe(4);
    expect(item.publicationIds).toContain("books");
    expect(item.contexts.filter((context) => context.document?.kind === "book-chapter")).toHaveLength(2);
    const context = item.contexts.find((context) => context.document?.documentId === document.documentId)!;
    expect(context.meaningZh).toBe("河岸");
    expect(context.issueId).toBeUndefined();
    expect(vocabularyReviewSentenceSegments(context, [bookWord], [record]).some((segment) => segment.meaningZh === "河岸")).toBe(true);
    expect(buildDueVocabularyReviewQueue(buildGlobalVocabularyItems([bookWord], [record], []), [])).toHaveLength(1);
  });

  it("deduplicates words across magazines and prefers the user meaning", () => {
    const [item] = buildGlobalVocabularyItems(selections, contexts, issues);
    expect(item.text.toLowerCase()).toBe("bank");
    expect(item.translationZh).toBe("金融机构；河岸");
    expect(item.translationSource).toBe("user");
    expect(item.familiarity).toBe(3);
    expect(item.articleCount).toBe(2);
    expect(item.publicationIds).toEqual(expect.arrayContaining(["economist", "wired"]));
  });

  it("excludes ignored words from the global vocabulary without deleting their saved state", () => {
    const ignored: SavedSelection = {
      id: "ignored-the",
      issueId: "economist:2026-09-19",
      articleId: "a1",
      articleTitle: "Bank story",
      text: "the",
      context: "The river bank was quiet.",
      paragraphIndex: 0,
      createdAt: "2026-09-22T01:04:00.000Z",
      translationZh: "这个",
      familiarity: 0,
    };

    const items = buildGlobalVocabularyItems([...selections, ignored], contexts, issues);
    expect(items.some((item) => item.text.toLowerCase() === "the")).toBe(false);
    expect(ignored.familiarity).toBe(0);
  });

  it("keeps occurrence-specific context and adds saved-selection fallbacks", () => {
    const [item] = buildGlobalVocabularyItems(selections, contexts, issues);
    expect(item.contextCount).toBe(3);
    expect(item.contexts.some((context) => context.meaningZh === "河岸" && context.startOffset === 10)).toBe(true);
    expect(item.contexts.some((context) => context.sentence.includes("approved the loan"))).toBe(true);
    expect(item.contexts.some((context) => context.publicationId === "wired")).toBe(true);
  });
});
