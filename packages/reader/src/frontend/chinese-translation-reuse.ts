import {
  findParagraphTranslation,
  loadParagraphTranslations,
  translationCacheMetadata,
  type ParagraphTranslationRecord,
  type ParagraphTranslationTarget,
  type TranslationCacheContext,
} from "./paragraph-translation-state";
import type { ReaderStorageBackend } from "./reader-storage";

type ListeningStorage = Pick<ReaderStorageBackend, "getItem" | "setItem">;

/** The translation preview persists each selected engine into a separate key. */
export function chineseTranslationStorage(storage: ListeningStorage, engineId?: string): ListeningStorage {
  if (!engineId) return storage;
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

/** Only a missing segment enters the selected translation engine's endpoint. */
export async function translateMissingListeningText(text: string, engineId: string, signal: AbortSignal): Promise<{
  translation: string; model: string; provider: ParagraphTranslationRecord["provider"]; profileId?: string;
}> {
  const response = await fetch("/api/vantilo-translation/translate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, engineId }), signal,
  });
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("翻译服务响应格式无效");
  const result = value as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "中文翻译失败");
  if (result.engineId !== engineId) throw new Error("翻译引擎已变化，请重试");
  if (typeof result.translation !== "string" || !result.translation.trim() || typeof result.model !== "string" || !result.model.trim()
    || !["easycliproxy", "custom-api", "vantilo-agent", "qwen-mlx", "qwen-gguf"].includes(String(result.provider))) {
    throw new Error("翻译服务返回了无效的译文或来源");
  }
  return { translation: result.translation, model: result.model, provider: result.provider as ParagraphTranslationRecord["provider"],
    ...(typeof result.profileId === "string" ? { profileId: result.profileId } : {}) };
}
