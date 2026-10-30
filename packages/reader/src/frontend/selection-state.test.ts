import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  addSavedSelection,
  removeSavedSelectionFromDocument,
  restoreRemovedSelections,
  findSavedTextOccurrences,
  loadSavedSelections,
  SAVED_SELECTIONS_KEY,
  savedHighlightSegments,
  savedSelectionFamiliarity,
  setSavedSelectionFamiliarity,
  setSavedSelectionTranslation,
  saveSavedSelections,
} from "./selection-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const input = {
  issueId: "economist:2026-09-19",
  articleId: "ai-boom",
  articleTitle: "The trickle-down economics of the AI boom",
  text: "riding a wave of investment",
  context: "Taiwan's economy has been riding a wave of investment in artificial intelligence.",
  paragraphIndex: 2,
};

describe("selection state", () => {
  it("persists saved selections in localStorage-compatible storage", () => {
    const storage = new MemoryStorage();
    const selections = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    saveSavedSelections(storage, selections);

    expect(loadSavedSelections(storage)).toEqual(selections);
    expect(storage.getItem(SAVED_SELECTIONS_KEY)).toContain("riding a wave of investment");
    expect(selections[0]?.familiarity).toBe(1);
  });

  it("does not duplicate the same excerpt from the same paragraph", () => {
    const first = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const second = addSavedSelection(first, input, new Date("2026-09-21T12:01:00.000Z"));
    expect(second).toHaveLength(1);
  });

  it("highlights saved expressions case-insensitively wherever they reappear", () => {
    const selections = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const segments = savedHighlightSegments(
      "A later article says Taiwan is RIDING A WAVE OF INVESTMENT again.",
      selections,
    );

    expect(segments.filter((segment) => segment.saved).map((segment) => segment.text)).toEqual([
      "RIDING A WAVE OF INVESTMENT",
    ]);
    expect(segments.find((segment) => segment.saved)?.familiarity).toBe(1);
  });

  it("does not highlight a saved word inside a larger English word", () => {
    const selections = addSavedSelection([], { ...input, text: "AI" }, new Date("2026-09-21T12:00:00.000Z"));
    const segments = savedHighlightSegments("AI matters, but RAIL also contains those letters.", selections);
    expect(segments.filter((segment) => segment.saved).map((segment) => segment.text)).toEqual(["AI"]);
  });

  it("finds every exact occurrence in article order without matching inside larger words", () => {
    expect(findSavedTextOccurrences([
      "The river bank was quiet. A banker walked by.",
      "The bank approved the loan. BANK customers waited.",
    ], "bank")).toEqual([
      { paragraphIndex: 0, startOffset: 10, endOffset: 14 },
      { paragraphIndex: 1, startOffset: 4, endOffset: 8 },
      { paragraphIndex: 1, startOffset: 28, endOffset: 32 },
    ]);
  });

  it("attaches one cached Chinese meaning to every saved occurrence of the same expression", () => {
    const first = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const second = addSavedSelection(first, { ...input, articleId: "another-article", paragraphIndex: 7 }, new Date("2026-09-21T12:05:00.000Z"));
    const translated = setSavedSelectionTranslation(second, "RIDING A WAVE OF INVESTMENT", "乘着一波投资热潮");

    expect(translated.every((item) => item.translationZh === "乘着一波投资热潮")).toBe(true);
    expect(translated.every((item) => item.translationSource === "user")).toBe(true);
    const highlighted = savedHighlightSegments("We are riding a wave of investment again.", translated);
    expect(highlighted.find((segment) => segment.saved)?.translationZh).toBe("乘着一波投资热潮");
  });

  it("keeps an existing saved location and preserves an automatically supplied translation source", () => {
    const first = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const enriched = addSavedSelection(first, {
      ...input,
      translationZh: "乘着一波投资热潮",
      translationSource: "auto",
    }, new Date("2026-09-21T12:01:00.000Z"));
    expect(enriched).toHaveLength(1);
    expect(enriched[0]).toMatchObject({ translationZh: "乘着一波投资热潮", translationSource: "auto" });
  });

  it("preserves dictionary fallback provenance through storage and highlight segments", () => {
    const storage = new MemoryStorage();
    const dictionary = addSavedSelection([], { ...input, text: "three", translationZh: "三", translationSource: "dictionary" }, new Date("2026-09-21T12:00:00.000Z"));
    saveSavedSelections(storage, dictionary);
    const loaded = loadSavedSelections(storage);
    expect(loaded[0]).toMatchObject({ translationZh: "三", translationSource: "dictionary" });
    expect(savedHighlightSegments("three is a number.", loaded).find((segment) => segment.saved)).toMatchObject({ translationZh: "三", translationSource: "dictionary" });
  });

  it("marks a vocabulary translation as user-authored even when the text stays the same", () => {
    const automatic = addSavedSelection([], {
      ...input,
      translationZh: "乘着一波投资热潮",
      translationSource: "auto",
    }, new Date("2026-09-21T12:00:00.000Z"));
    const edited = setSavedSelectionTranslation(automatic, input.text, "乘着一波投资热潮");
    expect(edited[0]).toMatchObject({ translationZh: "乘着一波投资热潮", translationSource: "user" });
  });

  it("does not let a later automatic meaning overwrite a user-customized vocabulary meaning", () => {
    const automatic = addSavedSelection([], {
      ...input,
      translationZh: "自动释义",
      translationSource: "auto",
    }, new Date("2026-09-21T12:00:00.000Z"));
    const customized = setSavedSelectionTranslation(automatic, input.text, "我的释义");
    const resaved = addSavedSelection(customized, {
      ...input,
      translationZh: "新的自动释义",
      translationSource: "auto",
    }, new Date("2026-09-21T12:05:00.000Z"));
    expect(resaved[0]).toMatchObject({ translationZh: "我的释义", translationSource: "user" });
  });

  it("uses learning states 1–4 for highlights while ignored and known remove the body highlight", () => {
    const selections = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const levelFour = setSavedSelectionFamiliarity(selections, "RIDING A WAVE OF INVESTMENT", 4);
    expect(levelFour[0]?.familiarity).toBe(4);
    expect(savedHighlightSegments(input.context, levelFour).find((segment) => segment.saved)?.familiarity).toBe(4);

    const ignored = setSavedSelectionFamiliarity(levelFour, input.text, 0);
    expect(ignored[0]?.familiarity).toBe(0);
    expect(savedHighlightSegments(input.context, ignored).some((segment) => segment.saved)).toBe(false);

    const restored = setSavedSelectionFamiliarity(ignored, input.text, 2);
    expect(savedHighlightSegments(input.context, restored).find((segment) => segment.saved)?.familiarity).toBe(2);

    const known = setSavedSelectionFamiliarity(restored, input.text, 5);
    expect(known[0]?.familiarity).toBe(5);
    expect(savedHighlightSegments(input.context, known).some((segment) => segment.saved)).toBe(false);
  });

  it("re-saving a level-5 expression returns it to familiarity level 1", () => {
    const selections = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"));
    const mastered = setSavedSelectionFamiliarity(selections, input.text, 5);
    const resaved = addSavedSelection(mastered, input, new Date("2026-09-21T12:01:00.000Z"));
    expect(resaved).toHaveLength(1);
    expect(resaved[0]?.familiarity).toBe(1);
  });

  it("migrates the old mastered flag into the six-state familiarity model", () => {
    const storage = new MemoryStorage();
    const legacy = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"))[0]!;
    const { familiarity: _familiarity, ...legacyBase } = legacy;
    storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify([
      { ...legacyBase, id: "known", mastered: true },
      { ...legacyBase, id: "learning", mastered: false },
    ]));

    const loaded = loadSavedSelections(storage);
    expect(savedSelectionFamiliarity(loaded[0]!)).toBe(5);
    expect(savedSelectionFamiliarity(loaded[1]!)).toBe(1);
    expect(loaded.every((item) => item.mastered === undefined)).toBe(true);
  });

  it("migrates legacy Economist date-only issue ids", () => {
    const storage = new MemoryStorage();
    const legacy = addSavedSelection([], input, new Date("2026-09-21T12:00:00.000Z"))[0]!;
    storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify([{ ...legacy, issueId: "2026-09-19" }]));
    expect(loadSavedSelections(storage)[0]?.issueId).toBe("economist:2026-09-19");
  });

  it("stores Book vocabulary occurrences without fake Magazine identity", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const { issueId: _issueId, articleId: _articleId, ...common } = input;
    const bookSelection = addSavedSelection([], { ...common, document, articleTitle: "Chapter One" }, new Date("2026-09-21T13:00:00.000Z"));
    expect(bookSelection[0]).toMatchObject({ document, articleTitle: "Chapter One" });
    expect(bookSelection[0]?.issueId).toBeUndefined();
    expect(bookSelection[0]?.articleId).toBeUndefined();
    const magazineAndBook = addSavedSelection(bookSelection, input, new Date("2026-09-21T13:01:00.000Z"));
    expect(magazineAndBook).toHaveLength(2);
  });

  it("survives malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_SELECTIONS_KEY, "not-json");
    expect(loadSavedSelections(storage)).toEqual([]);
  });
  it("removes a mistaken phrase from only the chosen document, including repeated saved occurrences", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:one");
    const other = bookChapterReadingDocumentIdentity("book:test", "chapter:two");
    const base = { ...input, document, issueId: undefined, articleId: undefined, text: "ake an active par", id: "wrong-1", createdAt: "2026-10-16", familiarity: 0 as const, translationZh: "旧释义" };
    const selections = [base, { ...base, id: "wrong-2", paragraphIndex: 3 }, { ...base, id: "other", document: other }, { ...base, id: "active", text: "active" }];
    const result = removeSavedSelectionFromDocument(selections, document, "AKE AN ACTIVE PAR");
    expect(result.removed.map((item) => item.id)).toEqual(["wrong-1", "wrong-2"]);
    expect(result.remaining.map((item) => item.id)).toEqual(["other", "active"]);
    expect(restoreRemovedSelections(result.remaining, result.removed)).toEqual(selections);
    expect(removeSavedSelectionFromDocument(selections, document, "missing").removed).toEqual([]);
  });
  it("undo retains later corrections and new phrases without overwriting or duplicating them", () => {
    const original = addSavedSelection([], input, new Date("2026-10-16T01:00:00Z"))[0];
    const replacement = { ...original, id: "replacement", translationZh: "用户新改的释义", familiarity: 4 as const };
    const corrected = { ...original, id: "correct", text: "take an active part" };
    expect(restoreRemovedSelections([replacement, corrected], [original])).toEqual([replacement, corrected]);
    expect(restoreRemovedSelections([original, corrected], [original])).toEqual([original, corrected]);
  });

});
