import { afterEach, expect, it, vi } from "vitest";
import { articleReadingDocumentIdentity } from "../shared/reading-document-identity";
import { PARAGRAPH_TRANSLATIONS_KEY, paragraphTranslationTarget, titleTranslationTarget, translationCacheMetadata, type ParagraphTranslationRecord } from "./paragraph-translation-state";
import { chineseTranslationStorage, findListeningTranslation, loadListeningTranslations, restoredListeningTranslations, translateMissingListeningText } from "./chinese-translation-reuse";

const engine = "custom-api:012345abcdef";
const document = articleReadingDocumentIdentity("economist:2026-10-31", "fixture-article");
const title = titleTranslationTarget({ document, sourceText: "The world this week" });
const paragraph = paragraphTranslationTarget({ document, paragraphIndex: 0, sourceText: "The world has changed in the last few days." });
const record = (target = paragraph, contextBefore?: string, contextAfter?: string): ParagraphTranslationRecord => ({
  ...target, translationZh: target === title ? "本周世界" : "这几天世界发生了变化。",
  provider: "easycliproxy", model: "model-from-selected-engine",
  ...translationCacheMetadata({ provider: "easycliproxy", model: "model-from-selected-engine", targetLanguage: "zh-CN", contextBefore, contextAfter }),
  generatedAt: "2026-11-06T08:00:00.000Z",
});
function memoryStorage() {
  const data = new Map<string, string>();
  return { data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
afterEach(() => vi.unstubAllGlobals());

it("restores completed title and paragraphs exclusively from the selected engine cache", () => {
  const storage = memoryStorage();
  chineseTranslationStorage(storage, engine).setItem(PARAGRAPH_TRANSLATIONS_KEY, JSON.stringify([record(title), record()]));
  chineseTranslationStorage(storage, "codex:gpt-6").setItem(PARAGRAPH_TRANSLATIONS_KEY, JSON.stringify([{ ...record(), translationZh: "另一模型译文" }]));
  const chosen = loadListeningTranslations(storage, engine);
  const restored = restoredListeningTranslations(chosen, [{ target: title }, { target: paragraph }], true);
  expect(restored).toEqual({ [title.key]: "本周世界", [paragraph.key]: "这几天世界发生了变化。" });
  expect(loadListeningTranslations(storage, "codex:gpt-6")[0]?.translationZh).toBe("另一模型译文");
  expect(storage.getItem(PARAGRAPH_TRANSLATIONS_KEY)).toBeNull();
});

it("rejects changed source text and neighboring context without borrowing another model's translation", () => {
  const translated = record(paragraph, "earlier", "later");
  expect(findListeningTranslation([translated], paragraph, { contextBefore: "earlier", contextAfter: "later" }, true)).toBeTruthy();
  expect(findListeningTranslation([translated], paragraph, { contextBefore: "changed", contextAfter: "later" }, true)).toBeUndefined();
  expect(findListeningTranslation([translated], { ...paragraph, sourceText: "New content" }, { contextBefore: "earlier", contextAfter: "later" }, true)).toBeUndefined();
});

it("uses the selected engine endpoint only for a missing translation, rejecting stale engine responses", async () => {
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    return new Response(JSON.stringify({ engineId: request.engineId, translation: "缺失译文", model: "selected", provider: "custom-api" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await translateMissingListeningText("Missing source.", engine, new AbortController().signal)).toMatchObject({ translation: "缺失译文", model: "selected" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/vantilo-translation/translate");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ engineId: "other-engine", translation: "无效", model: "other", provider: "custom-api" }), { status: 200 })));
  await expect(translateMissingListeningText("Missing source.", engine, new AbortController().signal)).rejects.toThrow("翻译引擎已变化");
});
