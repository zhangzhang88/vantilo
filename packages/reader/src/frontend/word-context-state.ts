import type { WordContextResponse } from "../shared/types";
import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";

export interface WordContextMeaningRecord extends WordContextResponse {
  meaningVersion?: 2;
  key: string;
  document?: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  paragraphIndex: number;
  startOffset: number;
  text: string;
  paragraph: string;
  sentence: string;
  generatedAt: string;
  meaningSource?: "ai" | "user";
  editedAt?: string;
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const WORD_CONTEXT_MEANINGS_KEY = "economist-reader-word-context-v1";

function normalizeTarget(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function wordContextOccurrenceKey(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  startOffset: number;
  text: string;
}): string {
  const document = readingDocumentIdentityForInput(input);
  return [
    document.documentId,
    input.paragraphIndex,
    input.startOffset,
    encodeURIComponent(normalizeTarget(input.text)),
  ].join(":");
}

export interface SentenceOccurrenceRange {
  startOffset: number;
  endOffset: number;
  text: string;
}

export function sentenceRangeForOccurrence(paragraph: string, startOffset: number, targetLength: number): SentenceOccurrenceRange {
  if (!paragraph) return { startOffset: 0, endOffset: 0, text: "" };
  const safeStart = Math.max(0, Math.min(startOffset, paragraph.length));
  const targetEnd = Math.max(safeStart, Math.min(paragraph.length, safeStart + Math.max(targetLength, 1)));

  let sentenceStart = 0;
  for (let index = safeStart - 1; index >= 0; index -= 1) {
    if (/[.!?]/.test(paragraph[index] ?? "")) {
      sentenceStart = index + 1;
      break;
    }
  }

  let sentenceEnd = paragraph.length;
  for (let index = targetEnd; index < paragraph.length; index += 1) {
    if (/[.!?]/.test(paragraph[index] ?? "")) {
      sentenceEnd = index + 1;
      break;
    }
  }

  while (sentenceStart < sentenceEnd && /\s/.test(paragraph[sentenceStart] ?? "")) sentenceStart += 1;
  while (sentenceEnd > sentenceStart && /\s/.test(paragraph[sentenceEnd - 1] ?? "")) sentenceEnd -= 1;

  return {
    startOffset: sentenceStart,
    endOffset: sentenceEnd,
    text: paragraph.slice(sentenceStart, sentenceEnd),
  };
}

export function sentenceForOccurrence(paragraph: string, startOffset: number, targetLength: number): string {
  return sentenceRangeForOccurrence(paragraph, startOffset, targetLength).text;
}

function isWordContextMeaningRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WordContextMeaningRecord> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  return hasIdentity
    && typeof item.paragraphIndex === "number"
    && typeof item.startOffset === "number"
    && typeof item.text === "string"
    && typeof item.paragraph === "string"
    && typeof item.sentence === "string"
    && typeof item.meaningZh === "string"
    && typeof item.explanationZh === "string"
    && (item.meaningEn === undefined || typeof item.meaningEn === "string")
    && (item.explanationEn === undefined || typeof item.explanationEn === "string")
    && (item.examplesEn === undefined || (Array.isArray(item.examplesEn) && item.examplesEn.every((entry) => typeof entry === "string")))
    && typeof item.partOfSpeech === "string"
    && typeof item.model === "string"
    && item.provider === "easycliproxy"
    && typeof item.generatedAt === "string"
    && (item.meaningSource === undefined || item.meaningSource === "ai" || item.meaningSource === "user")
    && (item.editedAt === undefined || typeof item.editedAt === "string");
}

export function loadWordContextMeanings(storage: ReadStorage): WordContextMeaningRecord[] {
  const raw = storage.getItem(WORD_CONTEXT_MEANINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isWordContextMeaningRecord)
      .slice(0, 2_000)
      .map((item) => {
        const stored = item as WordContextMeaningRecord & { issueId?: string; articleId?: string };
        const document = readingDocumentIdentityForInput(stored);
        const migrated = {
          ...stored,
          document,
          ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
          meaningEn: typeof stored.meaningEn === "string" ? stored.meaningEn : "",
          explanationEn: typeof stored.explanationEn === "string" ? stored.explanationEn : "",
          examplesEn: Array.isArray(stored.examplesEn) ? stored.examplesEn.filter((entry): entry is string => typeof entry === "string") : [],
          meaningSource: stored.meaningSource ?? "ai",
        };
        return { ...migrated, key: wordContextOccurrenceKey(migrated) };
      });
  } catch {
    return [];
  }
}

export function saveWordContextMeanings(storage: WriteStorage, records: WordContextMeaningRecord[]): void {
  storage.setItem(WORD_CONTEXT_MEANINGS_KEY, JSON.stringify(records.slice(0, 2_000)));
}

export function findWordContextMeaning(
  records: WordContextMeaningRecord[],
  input: ReadingDocumentIdentityInput & {
    paragraphIndex: number;
    startOffset: number;
    text: string;
    paragraph: string;
  },
): WordContextMeaningRecord | undefined {
  const document = readingDocumentIdentityForInput(input);
  const key = wordContextOccurrenceKey({ ...input, document });
  return records.find((record) => {
    if (record.paragraph !== input.paragraph) return false;
    if (record.key === key) return true;
    let recordDocument: ReadingDocumentIdentity;
    try { recordDocument = readingDocumentIdentityForInput(record); } catch { return false; }
    return recordDocument.documentId === document.documentId
      && record.paragraphIndex === input.paragraphIndex
      && record.startOffset === input.startOffset
      && normalizeTarget(record.text) === normalizeTarget(input.text);
  });
}

export function hasEnglishWordContext(record: WordContextMeaningRecord | undefined): boolean {
  return Boolean(record?.meaningEn.trim() && record.explanationEn.trim() && record.examplesEn.length >= 2);
}

export function upsertWordContextMeaning(
  records: WordContextMeaningRecord[],
  record: WordContextMeaningRecord,
): WordContextMeaningRecord[] {
  const withoutCurrent = records.filter((item) => item.key !== record.key);
  return [record, ...withoutCurrent].slice(0, 2_000);
}

export function setWordContextMeaningUserOverride(
  records: WordContextMeaningRecord[],
  key: string,
  meaningZh: string,
  now = new Date(),
): WordContextMeaningRecord[] {
  const normalizedMeaning = meaningZh.trim();
  if (!normalizedMeaning) return records;

  let changed = false;
  const next = records.map((item) => {
    if (item.key !== key) return item;
    if (item.meaningZh === normalizedMeaning && item.meaningSource === "user") return item;
    changed = true;
    return {
      ...item,
      meaningZh: normalizedMeaning,
      meaningSource: "user" as const,
      editedAt: now.toISOString(),
    };
  });
  return changed ? next : records;
}
