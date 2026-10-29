import { vocabularyContextDocument, type GlobalVocabularyContext, type GlobalVocabularyItem } from "./global-vocabulary";
import { savedSelectionDocument, isLearningFamiliarity, savedHighlightSegments, type FamiliarityLevel, type SavedSelection } from "./selection-state";
import { findWordContextMeaning, sentenceRangeForOccurrence, type WordContextMeaningRecord } from "./word-context-state";
import { isVocabularyReviewDue, type VocabularyReviewScheduleRecord } from "./vocabulary-review-schedule";

export function buildVocabularyReviewQueue(items: GlobalVocabularyItem[]): GlobalVocabularyItem[] {
  return items
    .filter((item) => isLearningFamiliarity(item.familiarity) && item.contexts.some((context) => context.sentence.trim()))
    .sort((a, b) => a.familiarity - b.familiarity || a.text.localeCompare(b.text, "en", { sensitivity: "base" }));
}

export function buildDueVocabularyReviewQueue(
  items: GlobalVocabularyItem[],
  schedules: VocabularyReviewScheduleRecord[],
  now = new Date(),
): GlobalVocabularyItem[] {
  return buildVocabularyReviewQueue(items).filter((item) =>
    isVocabularyReviewDue(schedules, item.text, item.familiarity, now),
  );
}

export function deferCurrentVocabularyReviewKey(reviewKeys: string[]): string[] {
  if (reviewKeys.length <= 1) return [...reviewKeys];
  return [...reviewKeys.slice(1), reviewKeys[0]];
}

export function preferredVocabularyReviewContext(item: GlobalVocabularyItem): GlobalVocabularyContext | null {
  return item.contexts.find((context) =>
    context.sentence.trim() && (context.meaningZh?.trim() || context.meaningEn?.trim()),
  ) ?? item.contexts.find((context) => context.sentence.trim()) ?? null;
}

export interface VocabularyReviewSentenceSegment {
  text: string;
  meaningZh?: string;
  familiarity?: FamiliarityLevel;
  saved?: boolean;
  isTarget?: boolean;
}

export function vocabularyReviewSentenceSegments(
  context: GlobalVocabularyContext,
  selections: SavedSelection[],
  contextRecords: WordContextMeaningRecord[],
): VocabularyReviewSentenceSegment[] {
  const sentenceRange = sentenceRangeForOccurrence(
    context.paragraph,
    context.startOffset,
    Math.max(context.text.length, 1),
  );
  const sentenceText = sentenceRange.text || context.sentence;
  if (!sentenceText) return [];

  const document = vocabularyContextDocument(context);
  const articleSelections = selections.filter((selection) => savedSelectionDocument(selection)?.documentId === document.documentId);

  return savedHighlightSegments(sentenceText, articleSelections).map((segment) => {
    const startOffset = sentenceRange.startOffset + (segment.startOffset ?? 0);
    const isTarget = startOffset === context.startOffset
      && segment.text.trim().toLocaleLowerCase("en-US") === context.text.trim().toLocaleLowerCase("en-US");
    if (!segment.saved) return { text: segment.text, isTarget };
    const record = findWordContextMeaning(contextRecords, {
      document,
      paragraphIndex: context.paragraphIndex,
      startOffset,
      text: segment.text,
      paragraph: context.paragraph,
    });
    const meaningZh = record?.meaningZh.trim();
    return {
      text: segment.text,
      meaningZh: meaningZh || undefined,
      familiarity: segment.familiarity,
      saved: true,
      isTarget,
    };
  });
}
