import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";
import type { ReadingAssistantMode } from "../shared/types";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const READING_ASSISTANT_PRESETS = [
  { id: "core-idea", question: "这篇文章最核心的观点是什么？" },
  { id: "argument-structure", question: "作者是怎样一步步论证的？" },
  { id: "simple-explanation", question: "用简单中文解释这篇文章。" },
  { id: "assumptions-counterarguments", question: "作者有哪些隐含前提或可能的反例？" },
] as const;

export type ReadingAssistantPresetId = (typeof READING_ASSISTANT_PRESETS)[number]["id"];

export interface ReadingAssistantCacheTarget {
  key: string;
  document: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  presetId: ReadingAssistantPresetId;
  question: string;
  articleSignature: string;
}

export interface ReadingAssistantCacheRecord extends ReadingAssistantCacheTarget {
  answer: string;
  paragraphIndexes: number[];
  mode: ReadingAssistantMode;
  model: string;
  provider: "easycliproxy";
  generatedAt: string;
}

export const READING_ASSISTANT_CACHE_KEY = "magazine-reader-reading-assistant-cache-v1";
const MAX_READING_ASSISTANT_CACHE = 5_000;
const PRESET_IDS = new Set<string>(READING_ASSISTANT_PRESETS.map((preset) => preset.id));

export function readingAssistantArticleSignature(paragraphs: string[]): string {
  let hash = 0x811c9dc5;
  let totalLength = 0;
  paragraphs.forEach((paragraph, index) => {
    const part = `${index}\u0000${paragraph}\u0001`;
    totalLength += paragraph.length;
    for (let offset = 0; offset < part.length; offset += 1) {
      hash ^= part.charCodeAt(offset);
      hash = Math.imul(hash, 0x01000193);
    }
  });
  return `${paragraphs.length}:${totalLength}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function readingAssistantCacheKey(input: ReadingDocumentIdentityInput & {
  presetId: ReadingAssistantPresetId;
}): string {
  const document = readingDocumentIdentityForInput(input);
  return [document.documentId, input.presetId].join(":");
}

export function readingAssistantCacheTarget(input: ReadingDocumentIdentityInput & {
  presetId: ReadingAssistantPresetId;
  question: string;
  articleSignature: string;
}): ReadingAssistantCacheTarget {
  const document = readingDocumentIdentityForInput(input);
  return {
    key: readingAssistantCacheKey({ document, presetId: input.presetId }),
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
    presetId: input.presetId,
    question: input.question,
    articleSignature: input.articleSignature,
  };
}

function isReadingAssistantCacheRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ReadingAssistantCacheRecord> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  return hasIdentity
    && typeof item.presetId === "string"
    && PRESET_IDS.has(item.presetId)
    && typeof item.question === "string"
    && Boolean(item.question.trim())
    && typeof item.articleSignature === "string"
    && Boolean(item.articleSignature)
    && typeof item.answer === "string"
    && Boolean(item.answer.trim())
    && Array.isArray(item.paragraphIndexes)
    && item.paragraphIndexes.every((index) => Number.isInteger(index) && index >= 0)
    && (item.mode === "quick" || item.mode === "deep")
    && typeof item.model === "string"
    && Boolean(item.model)
    && item.provider === "easycliproxy"
    && typeof item.generatedAt === "string"
    && Number.isFinite(Date.parse(item.generatedAt));
}

export function loadReadingAssistantCache(storage: ReadStorage): ReadingAssistantCacheRecord[] {
  const raw = storage.getItem(READING_ASSISTANT_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isReadingAssistantCacheRecord)
      .slice(0, MAX_READING_ASSISTANT_CACHE)
      .map((item) => {
        const stored = item as ReadingAssistantCacheRecord & { issueId?: string; articleId?: string };
        return { ...stored, ...readingAssistantCacheTarget(stored), paragraphIndexes: stored.paragraphIndexes.slice(0, 8) };
      });
  } catch {
    return [];
  }
}

export function saveReadingAssistantCache(storage: WriteStorage, records: ReadingAssistantCacheRecord[]): void {
  storage.setItem(READING_ASSISTANT_CACHE_KEY, JSON.stringify(records.slice(0, MAX_READING_ASSISTANT_CACHE)));
}

export function findReadingAssistantCache(
  records: ReadingAssistantCacheRecord[],
  target: ReadingAssistantCacheTarget,
): ReadingAssistantCacheRecord | undefined {
  return records.find((record) => record.key === target.key
    && record.question === target.question
    && record.articleSignature === target.articleSignature);
}

export function upsertReadingAssistantCache(
  records: ReadingAssistantCacheRecord[],
  record: ReadingAssistantCacheRecord,
): ReadingAssistantCacheRecord[] {
  const withoutCurrentPreset = records.filter((item) => item.key !== record.key);
  return [record, ...withoutCurrentPreset].slice(0, MAX_READING_ASSISTANT_CACHE);
}
