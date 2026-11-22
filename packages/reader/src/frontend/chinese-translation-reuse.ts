import {
  findParagraphTranslation,
  loadParagraphTranslations,
  saveParagraphTranslations,
  upsertParagraphTranslation,
  translationCacheMetadata,
  type ParagraphTranslationRecord,
  type ParagraphTranslationTarget,
  type TranslationCacheContext,
} from "./paragraph-translation-state";
import type { ReaderStorageBackend } from "./reader-storage";

import { loadIssueDocumentTranslations, readIssueTranslation, saveIssueTranslation } from "./issue-translation-cache";
import type { ReadingDocumentIdentity } from "../shared/reading-document-identity";

type ListeningStorage = Pick<ReaderStorageBackend, "getItem" | "setItem">;

export function isListeningTranslationEngine(value: unknown): value is string {
  return typeof value === "string" && /^(?:custom-api:[a-f0-9]{12}|codex:[a-zA-Z0-9._-]{1,128}|qwen:[a-zA-Z0-9._-]{1,128}@[a-f0-9]{40})$/.test(value);
}

export function loadListeningTranslationEngine(storage: Pick<ListeningStorage, "getItem">): string | undefined {
  try {
    const saved = storage.getItem("vantilo-translation-engine-v1");
    return isListeningTranslationEngine(saved) ? saved : undefined;
  } catch { return undefined; }
}

/** The translation preview persists each selected engine into a separate key. */
export function chineseTranslationStorage(storage: ListeningStorage, engineId?: string): ListeningStorage {
  if (engineId === undefined) return storage;
  return {
    getItem: key => storage.getItem(`${key}:vantilo-v2:${engineId}`),
    setItem: (key, value) => storage.setItem(`${key}:vantilo-v2:${engineId}`, value),
  };
}

/** In an engine-isolated cache, match exact source and context without applying
 * the legacy /api/translate provider identity to a custom-API or Codex record. */
export function findListeningTranslation(
  records: ParagraphTranslationRecord[],
  target: ParagraphTranslationTarget,
  context: TranslationCacheContext,
  engineScoped: boolean,
): ParagraphTranslationRecord | undefined {
  if (!engineScoped) return findParagraphTranslation(records, target, context);
  const expectedContext = translationCacheMetadata(context).contextFingerprint;
  return records.find(record =>
    record.key === target.key
    && record.sourceText === target.sourceText
    && (!record.targetLanguage || record.targetLanguage === "zh-CN")
    && (record.contextFingerprint
      ? record.contextFingerprint === expectedContext
      : !(context.contextBefore || context.contextAfter)),
  );
}

export function restoredListeningTranslations(
  records: ParagraphTranslationRecord[],
  targets: Array<{ target: ParagraphTranslationTarget; contextBefore?: string; contextAfter?: string }>,
  engineScoped: boolean,
): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const entry of targets) {
    const cached = findListeningTranslation(records, entry.target, {
      contextBefore: entry.contextBefore, contextAfter: entry.contextAfter,
    }, engineScoped);
    if (cached) texts[entry.target.key] = cached.translationZh;
  }
  return texts;
}

export function loadListeningTranslations(storage: ListeningStorage, engineId?: string): ParagraphTranslationRecord[] {
  return loadParagraphTranslations(chineseTranslationStorage(storage, engineId));
}

export async function loadDocumentTranslations(storage: ListeningStorage, document: ReadingDocumentIdentity, engineId?: string) {
  const existing = loadListeningTranslations(storage, engineId);
  if (!engineId || document.kind === "book-lesson") return existing;
  const batch = await loadIssueDocumentTranslations(engineId, document.documentId).catch(cacheReadError);
  return [...existing, ...batch].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

function cacheReadError(cause: unknown): never {
  throw new Error("无法读取已保存的译文，请重试。", { cause });
}

export async function lookupDocumentTranslation(
  storage: ListeningStorage, target: ParagraphTranslationTarget, context: TranslationCacheContext, engineId?: string,
) {
  const existing = findListeningTranslation(loadListeningTranslations(storage, engineId), target, context, Boolean(engineId));
  if (!engineId || target.document.kind === "book-lesson") return existing;
  const record = await readIssueTranslation(engineId, target.key).catch(error => {
    if (existing) return undefined;
    return cacheReadError(error);
  });
  const batch = record && findListeningTranslation([record], target, context, true);
  return batch && (!existing || batch.generatedAt >= existing.generatedAt) ? batch : existing;
}

export async function saveDocumentTranslation(storage: ListeningStorage, record: ParagraphTranslationRecord, engineId?: string) {
  if (engineId && record.document.kind !== "book-lesson") {
    await saveIssueTranslation(engineId, record);
    return;
  }
  saveParagraphTranslations(chineseTranslationStorage(storage, engineId), upsertParagraphTranslation(loadListeningTranslations(storage, engineId), record));
}

export interface TranslationTimings {
  queueMs: number;
  preparationMs: number;
  modelMs: number;
}

type ListeningTranslation = {
  translation: string; model: string; provider: ParagraphTranslationRecord["provider"]; profileId?: string;
};

function readListeningTranslation(value: unknown, engineId: string): ListeningTranslation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (result.engineId !== engineId || typeof result.translation !== "string" || !result.translation.trim()
    || typeof result.model !== "string" || !result.model.trim()
    || !["easycliproxy", "custom-api", "vantilo-agent", "qwen-mlx", "qwen-gguf"].includes(String(result.provider))) return undefined;
  return { translation: result.translation, model: result.model, provider: result.provider as ParagraphTranslationRecord["provider"],
    ...(typeof result.profileId === "string" ? { profileId: result.profileId } : {}) };
}

export async function translateListeningBatch(texts: string[], engineId: string, signal: AbortSignal) {
  const response = await fetch("/api/vantilo-translation/batch", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engineId, texts }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.error || "批量翻译失败"), { status: response.status });
  if (data?.engineId !== engineId || !Array.isArray(data.results) || data.results.length !== texts.length) {
    throw new Error("批量翻译返回的模型或段落数量不匹配");
  }
  const timings: TranslationTimings | undefined = data.timings;
  const validTimings = timings && [timings.queueMs, timings.preparationMs, timings.modelMs]
    .every(ms => Number.isFinite(ms) && ms >= 0);
  return {
    results: (data.results as unknown[]).map(item => readListeningTranslation(item, engineId)),
    timings: validTimings ? timings : undefined,
  };
}

/** Only a missing segment enters the selected translation engine's endpoint. */
export async function translateMissingListeningText(text: string, engineId: string, signal: AbortSignal, background = false, finishCurrent = false): Promise<{
  translation: string; model: string; provider: ParagraphTranslationRecord["provider"]; profileId?: string;
}> {
  const response = await fetch("/api/vantilo-translation/translate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, engineId, ...(background ? { background } : {}), ...(finishCurrent ? { finishCurrent } : {}) }), signal,
  });
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("翻译服务响应格式无效");
  const result = value as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(typeof result.error === "string" ? result.error : "中文翻译失败"), { status: response.status });
  if (result.engineId !== engineId) throw new Error("翻译引擎已变化，请重试");
  const translation = readListeningTranslation(result, engineId);
  if (!translation) throw new Error("翻译服务返回了无效的译文或来源");
  return translation;
}
