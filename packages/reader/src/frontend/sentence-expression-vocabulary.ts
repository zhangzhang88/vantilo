import type { SentenceExpression } from "../shared/types";
import type { SentenceTranslationTarget } from "./sentence-translation-state";
import { addSavedSelection, savedSelectionBelongsToDocument, savedSelectionFamiliarity, type SavedSelection } from "./selection-state";

export function findSavedSentenceExpression(records: SavedSelection[], target: SentenceTranslationTarget, expression: SentenceExpression): SavedSelection | undefined {
  return records.find((record) => savedSelectionBelongsToDocument(record, target.document) && record.paragraphIndex === target.paragraphIndex && record.text.trim().toLocaleLowerCase("en-US") === expression.text.trim().toLocaleLowerCase("en-US"));
}

export function hasSavedSentenceExpression(records: SavedSelection[], target: SentenceTranslationTarget, expression: SentenceExpression): boolean {
  return Boolean(findSavedSentenceExpression(records, target, expression)?.translationZh?.trim());
}

export async function completeSentenceExpressionMeaning(expression: SentenceExpression, resolve: () => Promise<{ meaningZh: string; explanationZh?: string } | undefined>): Promise<SentenceExpression> {
  const checked = expression.meaningVersion === 2 && expression.meaningZh?.trim() ? undefined : await resolve();
  const meaningZh = checked?.meaningZh?.trim() || (expression.meaningVersion === 2 ? expression.meaningZh?.trim() : undefined);
  if (!meaningZh || meaningZh.length > 120) throw new Error("未能补齐简短释义，请重试。");
  return { ...expression, meaningZh, meaningVersion: 2, explanationZh: checked?.explanationZh?.trim() || expression.explanationZh };
}

export function saveSentenceExpression(records: SavedSelection[], target: SentenceTranslationTarget, expression: SentenceExpression, paragraph: string, articleTitle: string, now = new Date()): SavedSelection[] {
  const text = expression.text.trim();
  const sentenceOffset = target.sourceText.indexOf(text);
  if (!text || sentenceOffset < 0 || paragraph.slice(target.startOffset, target.startOffset + target.sourceText.length) !== target.sourceText || !expression.meaningZh?.trim()) return records;
  const here = findSavedSentenceExpression(records, target, expression);
  if (here?.translationZh?.trim() && (here.translationSource === "user" || here.meaningVersion === 2)) return records;
  if (here) return records.map((record) => record === here ? { ...record, translationZh: expression.meaningZh!.trim(), translationSource: "auto", meaningVersion: 2, usageExplanationZh: expression.explanationZh } : record);
  const prior = records.find((record) => record.text.toLocaleLowerCase("en-US") === text.toLocaleLowerCase("en-US"));
  const preserveUserMeaning = prior?.translationSource === "user" && Boolean(prior.translationZh?.trim());
  let generatedAt = now;
  while (records.some((record) => record.id === `${target.document.documentId}:${generatedAt.getTime()}`)) generatedAt = new Date(generatedAt.getTime() + 1);
  const added = addSavedSelection(records, {
    document: target.document, articleTitle, text, context: paragraph, paragraphIndex: target.paragraphIndex,
    startOffset: target.startOffset + sentenceOffset,
    translationZh: preserveUserMeaning ? prior!.translationZh : expression.meaningZh,
    translationSource: preserveUserMeaning ? "user" : "auto",
    usageExplanationZh: expression.explanationZh,
    meaningVersion: 2,
    familiarity: prior ? savedSelectionFamiliarity(prior) : 1,
  }, generatedAt);
  // Existing learning state and user-edited meanings in other sources remain authoritative.
  const existing = new Map(records.map((record) => [record.id, record]));
  return added.map((record) => existing.get(record.id) ?? record);
}

export function needsContextualMeaningRepair(record: SavedSelection): boolean {
  return !record.translationZh?.trim() || (/\s/.test(record.text.trim()) && record.translationSource !== "user" && record.meaningVersion !== 2);
}
