import type { SentenceExpression, SentenceExpressionKind } from "../shared/types";
import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";
import { sentenceRangeForOccurrence } from "./word-context-state";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export interface SentenceTranslationTarget {
  contextVersion?: 2;
  contextFingerprint?: string;
  key: string;
  document: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  paragraphIndex: number;
  startOffset: number;
  sourceText: string;
}

export interface SentenceTranslationRecord extends SentenceTranslationTarget {
  expressions?: SentenceExpression[];
  translationZh: string;
  model: string;
  provider: "easycliproxy" | "learning-material";
  generatedAt: string;
}

export const SENTENCE_TRANSLATIONS_KEY = "magazine-reader-sentence-translations-v1";
const MAX_SENTENCE_TRANSLATIONS = 5_000;

export function sentenceContextFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

export function sentenceTranslationKey(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  startOffset: number;
}): string {
  const document = readingDocumentIdentityForInput(input);
  return [document.documentId, input.paragraphIndex, input.startOffset].join(":");
}

export function sentenceTranslationTarget(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  startOffset: number;
  sourceText: string;
  paragraphContext?: string;
}): SentenceTranslationTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: sentenceTranslationKey({ document, paragraphIndex: input.paragraphIndex, startOffset: input.startOffset }),
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    paragraphIndex: input.paragraphIndex,
    startOffset: input.startOffset,
    sourceText: input.sourceText,
    ...(input.paragraphContext !== undefined ? { contextVersion: 2 as const, contextFingerprint: sentenceContextFingerprint(input.paragraphContext) } : {}),
  };
}

export function sentenceTranslationTargetForOccurrence(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  paragraph: string;
  startOffset: number;
  targetLength: number;
}): SentenceTranslationTarget {
  const sentence = sentenceRangeForOccurrence(input.paragraph, input.startOffset, input.targetLength);
  return sentenceTranslationTarget({
    document: readingDocumentIdentityForInput(input),
    paragraphIndex: input.paragraphIndex,
    startOffset: sentence.startOffset,
    sourceText: sentence.text,
    paragraphContext: input.paragraph,
  });
}

function isSentenceTranslationRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SentenceTranslationRecord> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  return hasIdentity
    && typeof item.paragraphIndex === "number"
    && typeof item.startOffset === "number"
    && typeof item.sourceText === "string"
    && typeof item.translationZh === "string"
    && typeof item.model === "string"
    && (item.provider === "easycliproxy" || item.provider === "learning-material")
    && typeof item.generatedAt === "string";
}

export function loadSentenceTranslations(storage: ReadStorage): SentenceTranslationRecord[] {
  const raw = storage.getItem(SENTENCE_TRANSLATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSentenceTranslationRecord)
      .slice(0, MAX_SENTENCE_TRANSLATIONS)
      .map((item) => {
        const stored = item as SentenceTranslationRecord & { issueId?: string; articleId?: string };
        const target = sentenceTranslationTarget(stored);
        const expressions = Array.isArray(stored.expressions) ? stored.expressions.filter((item) => item && typeof item.text === "string" && stored.sourceText.includes(item.text) && typeof item.explanationZh === "string").slice(0, 4).map((item) => ({ text: item.text, ...(["collocation", "pattern", "contextual", "keyword"].includes(item.kind ?? "") ? { kind: item.kind as SentenceExpressionKind } : {}), explanationZh: item.explanationZh, ...(typeof item.meaningZh === "string" && item.meaningZh.trim() && item.meaningZh.length <= 120 ? { meaningZh: item.meaningZh.trim(), ...(item.meaningVersion === 2 ? { meaningVersion: 2 as const } : {}) } : {}) })) : undefined;
        return { ...stored, ...target, expressions };
      });
  } catch {
    return [];
  }
}

export function saveSentenceTranslations(storage: WriteStorage, records: SentenceTranslationRecord[]): void {
  storage.setItem(SENTENCE_TRANSLATIONS_KEY, JSON.stringify(records.slice(0, MAX_SENTENCE_TRANSLATIONS)));
}

export function findSentenceTranslation(
  records: SentenceTranslationRecord[],
  target: SentenceTranslationTarget,
): SentenceTranslationRecord | undefined {
  return records.find((record) => record.key === target.key && record.sourceText === target.sourceText
    && (!target.contextVersion || (record.contextVersion === target.contextVersion && record.contextFingerprint === target.contextFingerprint)));
}

export function upsertSentenceTranslation(
  records: SentenceTranslationRecord[],
  record: SentenceTranslationRecord,
): SentenceTranslationRecord[] {
  const withoutCurrentLocation = records.filter((item) => item.key !== record.key);
  return [record, ...withoutCurrentLocation].slice(0, MAX_SENTENCE_TRANSLATIONS);
}
