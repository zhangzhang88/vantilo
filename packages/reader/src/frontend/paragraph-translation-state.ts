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
  targetKind?: "heading" | "title";
  headingIndex?: number;
  sourceText: string;
}

export interface ParagraphTranslationRecord extends ParagraphTranslationTarget {
  translationZh: string;
  profileId?: string;
  model: string;
  provider: "easycliproxy";
  generatedAt: string;
  targetLanguage?: string;
  configFingerprint?: string;
  contextFingerprint?: string;
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

export function titleTranslationTarget(input: ReadingDocumentIdentityInput & { sourceText: string }): ParagraphTranslationTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: `${document.documentId}:title`, document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    paragraphIndex: -1, targetKind: "title", sourceText: input.sourceText,
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
  const isTitle = item.targetKind === "title" && item.paragraphIndex === -1;
  const isHeading = item.targetKind === "heading" && Number.isInteger(item.headingIndex) && (item.headingIndex ?? -1) >= 0;
  const isParagraph = item.targetKind === undefined && Number.isInteger(item.paragraphIndex) && (item.paragraphIndex ?? -1) >= 0;
  return hasIdentity
    && (isTitle || isHeading || isParagraph)
    && typeof item.sourceText === "string"
    && Boolean(item.sourceText)
    && typeof item.translationZh === "string"
    && Boolean(item.translationZh.trim())
    && (item.profileId === undefined || typeof item.profileId === "string")
    && typeof item.model === "string"
    && Boolean(item.model)
    && item.provider === "easycliproxy"
    && typeof item.generatedAt === "string"
    && Number.isFinite(Date.parse(item.generatedAt))
    && (item.targetLanguage === undefined || typeof item.targetLanguage === "string")
    && (item.configFingerprint === undefined || typeof item.configFingerprint === "string")
    && (item.contextFingerprint === undefined || typeof item.contextFingerprint === "string");
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
        return stored.targetKind === "title"
          ? { ...stored, ...titleTranslationTarget(stored) }
          : stored.targetKind === "heading"
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

export interface TranslationCacheContext {
  profileId?: string;
  model?: string;
  provider?: string;
  targetLanguage?: string;
  promptVersion?: string;
  contextBefore?: string;
  contextAfter?: string;
}

function compactHash(value: string): string {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function translationCacheMetadata(context: TranslationCacheContext): Pick<ParagraphTranslationRecord, "targetLanguage" | "configFingerprint" | "contextFingerprint"> {
  const targetLanguage = context.targetLanguage ?? "zh-CN";
  const promptVersion = context.promptVersion ?? "paragraph-translation-v1";
  const configFingerprint = [context.provider ?? "easycliproxy", context.profileId ?? "legacy-profile", context.model ?? "legacy-model", targetLanguage, promptVersion].join("|");
  const contextFingerprint = compactHash(JSON.stringify([context.contextBefore ?? "", context.contextAfter ?? ""]));
  return { targetLanguage, configFingerprint, contextFingerprint };
}

export type ParagraphTranslationCacheLookup =
  | { hit: true; record: ParagraphTranslationRecord }
  | { hit: false; reason: "not-translatable" | "document-or-location-miss" | "source-changed" | "profile-mismatch" | "model-mismatch" | "target-language-mismatch" | "config-mismatch" | "context-mismatch" };

export function inspectParagraphTranslation(
  records: ParagraphTranslationRecord[],
  target: ParagraphTranslationTarget,
  context?: TranslationCacheContext,
): ParagraphTranslationCacheLookup {
  if (!isTranslatableText(target.sourceText)) return { hit: false, reason: "not-translatable" };
  const sameLocation = records.filter((record) => record.key === target.key);
  const sameSource = sameLocation.filter((record) => record.sourceText === target.sourceText);
  if (!sameSource.length) return { hit: false, reason: sameLocation.length ? "source-changed" : "document-or-location-miss" };
  if (!context) return { hit: true, record: sameSource[0] };
  const expected = translationCacheMetadata(context);
  const compatible = sameSource.find(record =>
    (context.profileId === undefined || record.profileId === context.profileId)
    && (context.model === undefined || record.model === context.model)
    && (record.targetLanguage === undefined || record.targetLanguage === expected.targetLanguage)
    && (record.configFingerprint === undefined || record.configFingerprint === expected.configFingerprint)
    && (record.contextFingerprint === undefined
      ? !(context.contextBefore || context.contextAfter)
      : record.contextFingerprint === expected.contextFingerprint));
  if (compatible) return { hit: true, record: compatible };
  if (context.profileId && sameSource.every(record => record.profileId !== context.profileId)) return { hit: false, reason: "profile-mismatch" };
  if (context.model && sameSource.every(record => record.model !== context.model)) return { hit: false, reason: "model-mismatch" };
  if (sameSource.some(record => record.targetLanguage && record.targetLanguage !== expected.targetLanguage)) return { hit: false, reason: "target-language-mismatch" };
  if (sameSource.some(record => record.contextFingerprint ? record.contextFingerprint !== expected.contextFingerprint : Boolean(context.contextBefore || context.contextAfter))) return { hit: false, reason: "context-mismatch" };
  if (sameSource.some(record => record.configFingerprint && record.configFingerprint !== expected.configFingerprint)) return { hit: false, reason: "config-mismatch" };
  return { hit: false, reason: "config-mismatch" };
}

export function findParagraphTranslation(
  records: ParagraphTranslationRecord[],
  target: ParagraphTranslationTarget,
  context?: TranslationCacheContext,
): ParagraphTranslationRecord | undefined {
  const lookup = inspectParagraphTranslation(records, target, context);
  return lookup.hit ? lookup.record : undefined;
}

export function upsertParagraphTranslation(
  records: ParagraphTranslationRecord[],
  record: ParagraphTranslationRecord,
): ParagraphTranslationRecord[] {
  const withoutSameConfig = records.filter((item) => !(item.key === record.key && item.profileId === record.profileId && item.model === record.model && item.configFingerprint === record.configFingerprint && item.contextFingerprint === record.contextFingerprint));
  return [record, ...withoutSameConfig].slice(0, MAX_PARAGRAPH_TRANSLATIONS);
}
