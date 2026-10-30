import { describe, expect, it } from "vitest";
import { bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import { sentenceTranslationTarget } from "./sentence-translation-state";
import { hasSavedSentenceExpression, saveSentenceExpression, completeSentenceExpressionMeaning, needsContextualMeaningRepair } from "./sentence-expression-vocabulary";
import { savedHighlightSegments, saveSavedSelections, loadSavedSelections, type SavedSelection } from "./selection-state";
import { buildGlobalVocabularyItems } from "./global-vocabulary";

const paragraph = "We take an active part in sport. It means we take an active part in making our world.";
const sentence = "It means we take an active part in making our world.";
const document = bookLessonReadingDocumentIdentity("book:test", "lesson:test");
const target = sentenceTranslationTarget({ document, paragraphIndex: 2, startOffset: paragraph.indexOf(sentence), sourceText: sentence, paragraphContext: paragraph });
const expression = { text: "take an active part in", meaningZh: "积极参与……", explanationZh: "表示主动参与某事，而不只是被动接受。" };
const active: SavedSelection = { id: "active", document, articleTitle: "Title", text: "active", context: paragraph, paragraphIndex: 2, createdAt: "2026-10-16", translationZh: "积极的", familiarity: 2 };

describe("save a sentence expression", () => {
  it("saves a new phrase with meaning and usage separately, and highlights the whole phrase without removing the word", () => {
    const records = saveSentenceExpression([active], target, expression, paragraph, "Title");
    expect(records).toHaveLength(2); expect(records[1]).toBe(active);
    expect(records[0]).toMatchObject({ text: expression.text, translationZh: expression.meaningZh, usageExplanationZh: expression.explanationZh, familiarity: 1, context: paragraph, startOffset: paragraph.lastIndexOf(expression.text) });
    expect(savedHighlightSegments(sentence, records).filter((segment) => segment.saved).map((segment) => segment.text)).toEqual([expression.text]);
    const item = buildGlobalVocabularyItems(records, [], []).find((item) => item.text === expression.text)!;
    expect(item.contexts[0].startOffset).toBe(paragraph.lastIndexOf(expression.text));
    expect(item.contexts[0].sentence).toBe(sentence);
    expect(item.contexts[0].usageExplanationZh).toBe(expression.explanationZh);
  });
  it("disables duplicates in this source and preserves existing familiarity and user meanings in another source", () => {
    const records = saveSentenceExpression([], target, expression, paragraph, "Title");
    expect(hasSavedSentenceExpression(records, target, expression)).toBe(true);
    expect(saveSentenceExpression(records, target, expression, paragraph, "Title")).toBe(records);
    const prior = { ...records[0], document: bookLessonReadingDocumentIdentity("other", "other"), familiarity: 4 as const, translationZh: "用户释义", translationSource: "user" as const };
    const added = saveSentenceExpression([prior], target, expression, paragraph, "Title");
    expect(added[0]).toMatchObject({ translationZh: "用户释义", familiarity: 4 });
    expect(added[1]).toBe(prior);
  });
  it("resolves old expression caches before saving instead of storing a phrase without a short meaning", async () => {
    const legacy = { text: expression.text, explanationZh: expression.explanationZh };
    expect(saveSentenceExpression([], target, legacy, paragraph, "Title")).toEqual([]);
    const ready = await completeSentenceExpressionMeaning(legacy, async () => ({ meaningZh: "积极参与" }));
    const records = saveSentenceExpression([], target, ready, paragraph, "Title");
    expect(records[0].translationZh).toBe("积极参与");
    let raw = ""; const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    saveSavedSelections(storage, records); expect(loadSavedSelections(storage)[0]).toMatchObject({ translationZh: "积极参与", usageExplanationZh: expression.explanationZh });
    await expect(completeSentenceExpressionMeaning(legacy, async () => undefined)).rejects.toThrow("重试");
  });
  it("repairs an existing blank meaning without changing its identity or familiarity", () => {
    const missing = { ...active, text: expression.text, translationZh: undefined, familiarity: 3 as const };
    const repaired = saveSentenceExpression([missing], target, expression, paragraph, "Title");
    expect(repaired).toHaveLength(1);
    expect(repaired[0]).toMatchObject({ id: missing.id, translationZh: expression.meaningZh, familiarity: 3 });
    expect(hasSavedSentenceExpression([missing], target, expression)).toBe(false);
    expect(hasSavedSentenceExpression(repaired, target, expression)).toBe(true);
  });
  it("rejects fabricated expressions and stale source offsets", () => {
    expect(saveSentenceExpression([active], target, { ...expression, text: "missing" }, paragraph, "Title")).toEqual([active]);
    expect(saveSentenceExpression([active], target, expression, "Changed paragraph.", "Title")).toEqual([active]);
  });
});

it("rechecks nonempty legacy automatic glosses and preserves manual meanings", async () => {
  const legacy = { ...active, text: expression.text, translationZh: "旧直译", translationSource: "auto" as const };
  expect(needsContextualMeaningRepair(legacy)).toBe(true);
  const ready = await completeSentenceExpressionMeaning({ ...expression, meaningZh: "旧直译" }, async () => ({ meaningZh: "积极参与", explanationZh: "在本句中指主动参与。" }));
  const [updated] = saveSentenceExpression([legacy], target, ready, paragraph, "Title");
  expect(updated).toMatchObject({ id: legacy.id, meaningVersion: 2, translationZh: "积极参与", usageExplanationZh: "在本句中指主动参与。" });
  expect(needsContextualMeaningRepair(updated)).toBe(false);
  const manual = { ...legacy, translationSource: "user" as const };
  expect(needsContextualMeaningRepair(manual)).toBe(false);
  const dictionaryFallback = { ...active, translationZh: "三", translationSource: "dictionary" as const };
  expect(needsContextualMeaningRepair(dictionaryFallback)).toBe(true);
  expect(needsContextualMeaningRepair({ ...dictionaryFallback, translationZh: "三个", translationSource: "auto" })).toBe(false);
  expect(saveSentenceExpression([manual], target, ready, paragraph, "Title")[0]).toBe(manual);
  await expect(completeSentenceExpressionMeaning(ready, async () => { throw new Error("must reuse verified result"); })).resolves.toEqual(ready);
});
