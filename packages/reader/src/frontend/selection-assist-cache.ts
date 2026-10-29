import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";
import type { SelectionAssistAction } from "../shared/types";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export interface SelectionAssistCacheTarget {
  key: string;
  document: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  paragraphIndex: number;
  startOffset: number;
  sourceText: string;
}

export interface SelectionAssistCachedResult {
  result: string;
  model: string;
  provider: "easycliproxy";
  generatedAt: string;
}

export interface SelectionAssistCacheRecord extends SelectionAssistCacheTarget {
  translate?: SelectionAssistCachedResult;
  explain?: SelectionAssistCachedResult;
}

export const SELECTION_ASSIST_CACHE_KEY = "magazine-reader-selection-assist-cache-v1";
const MAX_SELECTION_ASSIST_CACHE = 5_000;

export function selectionAssistCacheKey(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  startOffset: number;
  sourceText: string;
}): string {
  const document = readingDocumentIdentityForInput(input);
  return [document.documentId, input.paragraphIndex, input.startOffset, input.sourceText.length].join(":");
}

export function selectionAssistCacheTarget(input: ReadingDocumentIdentityInput & {
  paragraphIndex: number;
  startOffset: number;
  sourceText: string;
}): SelectionAssistCacheTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: selectionAssistCacheKey({ document, paragraphIndex: input.paragraphIndex, startOffset: input.startOffset, sourceText: input.sourceText }),
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    paragraphIndex: input.paragraphIndex,
    startOffset: input.startOffset,
    sourceText: input.sourceText,
  };
}

function isCachedResult(value: unknown): value is SelectionAssistCachedResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SelectionAssistCachedResult>;
  return typeof item.result === "string"
    && typeof item.model === "string"
    && item.provider === "easycliproxy"
    && typeof item.generatedAt === "string";
}

function isSelectionAssistCacheRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SelectionAssistCacheRecord> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  return hasIdentity
    && typeof item.paragraphIndex === "number"
    && typeof item.startOffset === "number"
    && typeof item.sourceText === "string"
    && (item.translate === undefined || isCachedResult(item.translate))
    && (item.explain === undefined || isCachedResult(item.explain));
}

export function loadSelectionAssistCache(storage: ReadStorage): SelectionAssistCacheRecord[] {
  const raw = storage.getItem(SELECTION_ASSIST_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSelectionAssistCacheRecord)
      .slice(0, MAX_SELECTION_ASSIST_CACHE)
      .map((item) => {
        const stored = item as SelectionAssistCacheRecord & { issueId?: string; articleId?: string };
        return { ...stored, ...selectionAssistCacheTarget(stored) };
      });
  } catch {
    return [];
  }
}

export function saveSelectionAssistCache(storage: WriteStorage, records: SelectionAssistCacheRecord[]): void {
  storage.setItem(SELECTION_ASSIST_CACHE_KEY, JSON.stringify(records.slice(0, MAX_SELECTION_ASSIST_CACHE)));
}

export function findSelectionAssistCacheRecord(
  records: SelectionAssistCacheRecord[],
  target: SelectionAssistCacheTarget,
): SelectionAssistCacheRecord | undefined {
  return records.find((record) => record.key === target.key && record.sourceText === target.sourceText);
}

export function findSelectionAssistCachedResult(
  records: SelectionAssistCacheRecord[],
  target: SelectionAssistCacheTarget,
  action: SelectionAssistAction,
): SelectionAssistCachedResult | undefined {
  return findSelectionAssistCacheRecord(records, target)?.[action];
}

export function upsertSelectionAssistCachedResult(
  records: SelectionAssistCacheRecord[],
  target: SelectionAssistCacheTarget,
  action: SelectionAssistAction,
  result: SelectionAssistCachedResult,
): SelectionAssistCacheRecord[] {
  const existing = findSelectionAssistCacheRecord(records, target);
  const record: SelectionAssistCacheRecord = {
    ...target,
    ...(existing?.translate ? { translate: existing.translate } : {}),
    ...(existing?.explain ? { explain: existing.explain } : {}),
    [action]: result,
  };
  const withoutCurrentTarget = records.filter((item) => item.key !== target.key);
  return [record, ...withoutCurrentTarget].slice(0, MAX_SELECTION_ASSIST_CACHE);
}
