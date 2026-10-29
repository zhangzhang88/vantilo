import { isTranslatableText } from "../shared/translation-text.js";
import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export interface ParagraphTranslationTarget {
  key: string;
  document: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  paragraphIndex: number;
  targetKind?: "heading";
  headingIndex?: number;
  sourceText: string;
}

export interface ParagraphTranslationRecord extends ParagraphTranslationTarget {
  translationZh: string;
  profileId?: string;
  model: string;
  provider: "easycliproxy";
  generatedAt: string;
}

export const PARAGRAPH_TRANSLATIONS_KEY = "magazine-reader-paragraph-translations-v1";
const MAX_PARAGRAPH_TRANSLATIONS = 5_000;

export function paragraphTranslationKey(input: ReadingDocumentIdentityInput & { paragraphIndex: number }): string {
  const document = readingDocumentIdentityForInput(input);
  return [document.documentId, input.paragraphIndex].join(":");
}

export function paragraphTranslationTarget(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  sourceText: string;
}): ParagraphTranslationTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: paragraphTranslationKey({ document, paragraphIndex: input.paragraphIndex }),
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    paragraphIndex: input.paragraphIndex,
    sourceText: input.sourceText,
  };
}

export function headingTranslationTarget(input: ReadingDocumentIdentityInput & {
  headingIndex: number;
  sourceText: string;
}): ParagraphTranslationTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: `${document.documentId}:heading:${input.headingIndex}`,
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    paragraphIndex: input.headingIndex,
    targetKind: "heading",
    headingIndex: input.headingIndex,
    sourceText: input.sourceText,
  };
}

function isParagraphTranslationRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ParagraphTranslationRecord> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  const isHeading = item.targetKind === "heading" && Number.isInteger(item.headingIndex) && (item.headingIndex ?? -1) >= 0;
  const isParagraph = item.targetKind === undefined && Number.isInteger(item.paragraphIndex) && (item.paragraphIndex ?? -1) >= 0;
  return hasIdentity
    && (isHeading || isParagraph)
    && typeof item.sourceText === "string"
    && Boolean(item.sourceText)
    && typeof item.translationZh === "string"
    && Boolean(item.translationZh.trim())
    && (item.profileId === undefined || typeof item.profileId === "string")
    && typeof item.model === "string"
    && Boolean(item.model)
    && item.provider === "easycliproxy"
    && typeof item.generatedAt === "string"
    && Number.isFinite(Date.parse(item.generatedAt));
}

export function loadParagraphTranslations(storage: ReadStorage): ParagraphTranslationRecord[] {
  const raw = storage.getItem(PARAGRAPH_TRANSLATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isParagraphTranslationRecord)
      .slice(0, MAX_PARAGRAPH_TRANSLATIONS)
      .map((item) => {
        const stored = item as ParagraphTranslationRecord & { issueId?: string; articleId?: string };
        return stored.targetKind === "heading"
          ? { ...stored, ...headingTranslationTarget(stored as ParagraphTranslationRecord & { headingIndex: number }) }
          : { ...stored, ...paragraphTranslationTarget(stored as ParagraphTranslationRecord & { paragraphIndex: number }) };
      });
  } catch {
    return [];
  }
}

export function saveParagraphTranslations(storage: WriteStorage, records: ParagraphTranslationRecord[]): void {
  storage.setItem(PARAGRAPH_TRANSLATIONS_KEY, JSON.stringify(records.slice(0, MAX_PARAGRAPH_TRANSLATIONS)));
}

export function findParagraphTranslation(
  records: ParagraphTranslationRecord[],
  target: ParagraphTranslationTarget,
): ParagraphTranslationRecord | undefined {
  if (!isTranslatableText(target.sourceText)) return undefined;
  return records.find((record) => record.key === target.key && record.sourceText === target.sourceText);
}

export function upsertParagraphTranslation(
  records: ParagraphTranslationRecord[],
  record: ParagraphTranslationRecord,
): ParagraphTranslationRecord[] {
  const withoutCurrentLocation = records.filter((item) => item.key !== record.key);
  return [record, ...withoutCurrentLocation].slice(0, MAX_PARAGRAPH_TRANSLATIONS);
}
