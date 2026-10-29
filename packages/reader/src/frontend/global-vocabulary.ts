import type { BookSummary } from "../shared/book-data-contract";
import { readingDocumentIdentityFromLegacyFields, type ReadingDocumentIdentity } from "../shared/reading-document-identity";
import { PUBLICATIONS } from "../shared/publication";
import type { PublicationId } from "../shared/types";
import { findArticle, type ReaderIssue } from "./reader-model";
import { findSavedTextOccurrences, savedSelectionDocument, savedSelectionFamiliarity, type FamiliarityLevel, type SavedSelection } from "./selection-state";
import { sentenceForOccurrence, type WordContextMeaningRecord } from "./word-context-state";

export type VocabularySourceId = PublicationId | "books";

export interface GlobalVocabularyContext {
  document?: ReadingDocumentIdentity;
  id: string;
  issueId?: string;
  articleId?: string;
  articleTitle: string;
  publicationId: VocabularySourceId;
  publicationName: string;
  paragraphIndex: number;
  startOffset: number;
  text: string;
  paragraph: string;
  sentence: string;
  usageExplanationZh?: string;
  meaningZh?: string;
  meaningEn?: string;
  contextRecordKey?: string;
}

export interface GlobalVocabularyItem {
  key: string;
  text: string;
  translationZh?: string;
  translationSource?: SavedSelection["translationSource"];
  familiarity: FamiliarityLevel;
  articleCount: number;
  contextCount: number;
  publicationIds: VocabularySourceId[];
  contexts: GlobalVocabularyContext[];
}

export function globalVocabularyTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function publicationIdForIssue(issueId: string, issues: ReaderIssue[]): PublicationId {
  const known = issues.find((issue) => issue.id === issueId)?.publicationId;
  if (known) return known;
  const prefix = issueId.split(":", 1)[0] as PublicationId;
  return prefix in PUBLICATIONS ? prefix : "economist";
}

function publicationNameForIssue(issueId: string, issues: ReaderIssue[]): string {
  const issue = issues.find((candidate) => candidate.id === issueId);
  if (issue) return issue.publicationName;
  return PUBLICATIONS[publicationIdForIssue(issueId, issues)].name;
}

export function vocabularyContextDocument(context: GlobalVocabularyContext): ReadingDocumentIdentity {
  const document = readingDocumentIdentityFromLegacyFields(context);
  if (!document) throw new Error("Vocabulary context document is missing");
  return document;
}

function sourceMetadata(document: ReadingDocumentIdentity, issues: ReaderIssue[], books: BookSummary[]) {
  if (document.kind !== "article") return {
    publicationId: "books" as const,
    publicationName: (books.find((book) => book.id === document.bookId)?.title ?? "电子书") + (document.kind === "book-lesson" ? " · 精选阅读" : ""),
  };
  return { publicationId: publicationIdForIssue(document.issueId, issues), publicationName: publicationNameForIssue(document.issueId, issues) };
}

function fallbackContext(selection: SavedSelection, issues: ReaderIssue[], books: BookSummary[]): GlobalVocabularyContext {
  const document = savedSelectionDocument(selection)!;
  const match = document.kind === "article" ? findArticle(issues, document.articleId, document.issueId) : undefined;
  const paragraph = match?.article.paragraphs[selection.paragraphIndex] ?? selection.context;
  const occurrence = findSavedTextOccurrences([paragraph], selection.text)[0];
  const startOffset = selection.startOffset !== undefined && paragraph.slice(selection.startOffset, selection.startOffset + selection.text.length) === selection.text ? selection.startOffset : occurrence?.startOffset ?? Math.max(0, paragraph.toLocaleLowerCase("en-US").indexOf(globalVocabularyTextKey(selection.text)));
  return {
    id: `saved:${selection.id}`,
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    articleTitle: match?.article.title ?? selection.articleTitle,
    ...sourceMetadata(document, issues, books),
    paragraphIndex: selection.paragraphIndex,
    startOffset,
    text: selection.text,
    paragraph,
    sentence: sentenceForOccurrence(paragraph, startOffset, selection.text.length) || selection.context || paragraph,
    usageExplanationZh: selection.usageExplanationZh,
  };
}

export function buildGlobalVocabularyItems(
  selections: SavedSelection[],
  contextRecords: WordContextMeaningRecord[],
  issues: ReaderIssue[],
  books: BookSummary[] = [],
): GlobalVocabularyItem[] {
  const grouped = new Map<string, SavedSelection[]>();
  for (const selection of selections) {
    const identity = savedSelectionDocument(selection);
    if (!identity) continue;
    const key = globalVocabularyTextKey(selection.text);
    if (!key) continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(selection);
    grouped.set(key, bucket);
  }

  const items: GlobalVocabularyItem[] = [];
  for (const [key, wordSelections] of grouped) {
    const representative = wordSelections[0];
    let translationZh = representative.translationZh?.trim() || undefined;
    let translationSource = representative.translationSource;
    let familiarity = savedSelectionFamiliarity(representative);

    for (const selection of wordSelections.slice(1)) {
      const candidateTranslation = selection.translationZh?.trim();
      if (selection.translationSource === "user" && translationSource !== "user" && candidateTranslation) {
        translationZh = candidateTranslation;
        translationSource = "user";
      } else if (!translationZh && candidateTranslation) {
        translationZh = candidateTranslation;
        translationSource = selection.translationSource;
      }
      familiarity = Math.max(familiarity, savedSelectionFamiliarity(selection)) as FamiliarityLevel;
    }

    // Familiarity 0 means "ignore": keep the SavedSelection records for article behavior,
    // but do not promote the expression into the learning-oriented global vocabulary view.
    if (familiarity === 0) continue;

    const selectionDocumentIds = new Set(wordSelections.map((selection) => savedSelectionDocument(selection)!.documentId));
    const matchingRecords = contextRecords.flatMap((record) => {
      const document = readingDocumentIdentityFromLegacyFields(record);
      return document && selectionDocumentIds.has(document.documentId) && globalVocabularyTextKey(record.text) === key
        ? [{ record, document }] : [];
    });
    const contexts: GlobalVocabularyContext[] = matchingRecords.map(({ record, document }) => {
      const match = document.kind === "article" ? findArticle(issues, document.articleId, document.issueId) : undefined;
      return {
        id: `context:${record.key}`,
        document,
        ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
        articleTitle: match?.article.title ?? wordSelections.find((selection) => savedSelectionDocument(selection)?.documentId === document.documentId)?.articleTitle ?? "原文",
        ...sourceMetadata(document, issues, books),
        paragraphIndex: record.paragraphIndex,
        startOffset: record.startOffset,
        text: record.text,
        paragraph: record.paragraph,
        sentence: record.sentence,
        meaningZh: record.meaningZh,
        meaningEn: record.meaningEn,
        contextRecordKey: record.key,
        usageExplanationZh: wordSelections.find((selection) => savedSelectionDocument(selection)?.documentId === document.documentId && selection.paragraphIndex === record.paragraphIndex)?.usageExplanationZh,
      };
    });
    for (const selection of wordSelections) {
      const document = savedSelectionDocument(selection)!;
      const alreadyCovered = matchingRecords.some(({ record, document: candidate }) =>
        candidate.documentId === document.documentId && record.paragraphIndex === selection.paragraphIndex);
      if (!alreadyCovered) contexts.push(fallbackContext(selection, issues, books));
    }

    contexts.sort((a, b) => {
      const articleOrder = a.articleTitle.localeCompare(b.articleTitle, "en");
      if (articleOrder) return articleOrder;
      if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex;
      return a.startOffset - b.startOffset;
    });

    const identities = wordSelections.map((selection) => savedSelectionDocument(selection)!);
    const articleCount = new Set(identities.map((identity) => identity.documentId)).size;
    const publicationIds = [...new Set(identities.map((identity) => sourceMetadata(identity, issues, books).publicationId))];
    items.push({
      key,
      text: representative.text,
      translationZh,
      translationSource,
      familiarity,
      articleCount,
      contextCount: contexts.length,
      publicationIds,
      contexts,
    });
  }

  return items.sort((a, b) => a.familiarity - b.familiarity || a.text.localeCompare(b.text, "en", { sensitivity: "base" }));
}
