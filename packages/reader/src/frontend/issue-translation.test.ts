// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookRecord } from "../shared/book-data-contract";
import type { ParagraphTranslationRecord } from "./paragraph-translation-state";

const cacheStore = new Map<string, ParagraphTranslationRecord>();

vi.mock("./issue-translation-cache", () => ({
  loadIssueTranslations: vi.fn(async (engineId: string, issueId: string) =>
    [...cacheStore.entries()]
      .filter(([key, record]) => key.startsWith(`${engineId}::`) && record.issueId === issueId)
      .map(([, record]) => record)),
  loadBookTranslations: vi.fn(async (engineId: string, documentIds: string[]) => {
    const allowed = new Set(documentIds);
    return [...cacheStore.entries()]
      .filter(([key, record]) => key.startsWith(`${engineId}::`) && allowed.has(record.document.documentId))
      .map(([, record]) => record);
  }),
  loadIssueDocumentTranslations: vi.fn(async (engineId: string, documentId: string) =>
    [...cacheStore.entries()]
      .filter(([key, record]) => key.startsWith(`${engineId}::`) && record.document.documentId === documentId)
      .map(([, record]) => record)),
  readIssueTranslation: vi.fn(async (engineId: string, key: string) => cacheStore.get(`${engineId}::${key}`)),
  saveIssueTranslation: vi.fn(async (engineId: string, record: ParagraphTranslationRecord) => {
    cacheStore.set(`${engineId}::${record.key}`, record);
  }),
}));

import { findListeningTranslation, loadDocumentTranslations } from "./chinese-translation-reuse";
import {
  chapterTranslationTargets,
  ensureBookChineseCatalog,
  loadBookChapterTranslationStatus,
  planIssueTranslation,
  runIssueTranslation,
} from "./issue-translation";
import { getReaderStorage } from "./reader-storage";
import { bookReaderCollection } from "./reading-document-view";

const QWEN_ENGINE_ID = "qwen:qwen3.5-4b-mlx-4bit@32f3e8ecf65426fc3306969496342d504bfa13f3";

function createThreeChapterBook(): BookRecord {
  return {
    schemaVersion: 1,
    kind: "book",
    id: "book:meta:order-test",
    sourceFilename: "beyond-feelings.epub",
    sourceFingerprint: "fp:beyond-feelings",
    title: "Beyond Feelings",
    authors: ["Vincent Ryan Ruggiero"],
    language: "en",
    publisher: null,
    publishedAt: null,
    identifiers: [],
    epubVersion: "3.0",
    navigationType: "nav",
    cover: null,
    numberedChapterCount: 3,
    parts: [],
    chapters: [
      {
        id: "chapter:001:who",
        bookId: "book:meta:order-test",
        partId: null,
        order: 1,
        role: "chapter",
        title: "WHO ARE YOU?",
        href: "ch1.xhtml",
        documentPath: "OEBPS/ch1.xhtml",
        contentFingerprint: "fp:1",
        headings: ["The Question"],
        paragraphs: [
          "Suppose someone asked who you are.",
          "It would be harder than giving your name.",
        ],
        blocks: [
          { kind: "heading", level: 2, text: "The Question" },
          { kind: "paragraph", paragraphIndex: 0, text: "Suppose someone asked who you are." },
          { kind: "paragraph", paragraphIndex: 1, text: "It would be harder than giving your name." },
        ],
        wordCount: 14,
      },
      {
        id: "chapter:002:thinking",
        bookId: "book:meta:order-test",
        partId: null,
        order: 2,
        role: "chapter",
        title: "WHAT IS CRITICAL THINKING?",
        href: "ch2.xhtml",
        documentPath: "OEBPS/ch2.xhtml",
        contentFingerprint: "fp:2",
        headings: [],
        paragraphs: ["Critical thinking examines assumptions."],
        blocks: [{ kind: "paragraph", paragraphIndex: 0, text: "Critical thinking examines assumptions." }],
        wordCount: 4,
      },
      {
        id: "chapter:003:truth",
        bookId: "book:meta:order-test",
        partId: null,
        order: 3,
        role: "chapter",
        title: "WHAT IS TRUTH?",
        href: "ch3.xhtml",
        documentPath: "OEBPS/ch3.xhtml",
        contentFingerprint: "fp:3",
        headings: [],
        paragraphs: ["Truth is discovered rather than created."],
        blocks: [{ kind: "paragraph", paragraphIndex: 0, text: "Truth is discovered rather than created." }],
        wordCount: 6,
      },
    ],
  };
}

describe("book issue-translation ordering and immediate cache reuse", () => {
  beforeEach(() => {
    cacheStore.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans full-book translation strictly in TOC order from Chapter 1 even if startChapterId is set", async () => {
    const collection = bookReaderCollection(createThreeChapterBook());
    const plan = await planIssueTranslation(
      { kind: "book", collection, startChapterId: "chapter:003:truth" },
      QWEN_ENGINE_ID,
    );
    expect(plan.documents.map(doc => doc.article.id)).toEqual([
      "chapter:001:who",
      "chapter:002:thinking",
      "chapter:003:truth",
    ]);
  });

  it("reuses Chapter 1 translations immediately while full-book translation is still paused mid-book", async () => {
    const collection = bookReaderCollection(createThreeChapterBook());
    const plan = await planIssueTranslation({ kind: "book", collection }, QWEN_ENGINE_ID);
    const controller = new AbortController();
    const seenDocumentIds: Array<string | undefined> = [];

    const chapterOneTargets = chapterTranslationTargets(collection.documents[0]);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      calls += 1;
      if (calls > chapterOneTargets.length) {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }
      return new Response(
        JSON.stringify({
          engineId: body.engineId,
          translation: `译文：${body.text}`,
          model: "qwen3.5-4b",
          provider: "qwen-mlx",
          profileId: "32f3e8ecf65426fc3306969496342d504bfa13f3",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }));

    await expect(
      runIssueTranslation(plan, QWEN_ENGINE_ID, controller.signal, progress => {
        seenDocumentIds.push(progress.currentDocumentId);
      }),
    ).rejects.toThrow();

    expect(seenDocumentIds).toContain(collection.documents[0].identity.documentId);

    const chapterOne = collection.documents[0];
    const loaded = await loadDocumentTranslations(getReaderStorage(), chapterOne.identity, QWEN_ENGINE_ID);
    for (const target of chapterOneTargets) {
      const context = {
        contextBefore: target.targetKind ? undefined : chapterOne.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : chapterOne.paragraphs[target.paragraphIndex + 1],
      };
      const hit = findListeningTranslation(loaded, target, context, true);
      expect(hit?.translationZh).toBe(`译文：${target.sourceText}`);
    }

    const status = await loadBookChapterTranslationStatus(collection, QWEN_ENGINE_ID);
    expect(status["chapter:001:who"]).toEqual({
      translated: chapterOneTargets.length,
      total: chapterOneTargets.length,
    });
    expect(status["chapter:002:thinking"].translated).toBe(0);
    expect(status["chapter:003:truth"].translated).toBe(0);
  });

  it("generates missing book Chinese TOC incrementally during full-book translation and skips when already ready", async () => {
    const events: Array<{ kind: string; id: string; state?: string }> = [];
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      events.push({ kind: detail.kind, id: detail.id, state: detail.record?.state });
    };
    window.addEventListener("vantilo-catalog-updated", onUpdated);
    const progressCalls: Array<[number, number]> = [];
    const postedBodies: Array<Record<string, unknown>> = [];
    let postCount = 0;
    const SAVED_CATALOG_ENGINE = "custom-api:112233445566";
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (!options?.method || options.method === "GET") {
        if (url === "/api/vantilo-catalog/settings") {
          return new Response(
            JSON.stringify({
              engineId: SAVED_CATALOG_ENGINE,
              engines: [
                { id: SAVED_CATALOG_ENGINE, label: "Saved Catalog Model" },
                { id: QWEN_ENGINE_ID, label: "Local Qwen" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ state: "idle", titles: { parts: {}, chapters: {} } }), { status: 200 });
      }
      postedBodies.push(JSON.parse(String(options.body)));
      postCount += 1;
      if (postCount === 1) {
        return new Response(
          JSON.stringify({ state: "pending", done: 1, total: 2, titles: { parts: {}, chapters: { "chapter:001:who": "你是谁？" } } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          state: "ready",
          model: "qwen3.5-4b",
          titles: { parts: {}, chapters: { "chapter:001:who": "你是谁？", "chapter:002:thinking": "什么是批判性思考？" } },
        }),
        { status: 200 },
      );
    }));

    try {
      const titles = await ensureBookChineseCatalog(
        "book:meta:order-test",
        QWEN_ENGINE_ID,
        new AbortController().signal,
        (done, total) => progressCalls.push([done, total]),
      );
      expect(titles).toEqual({
        "chapter:001:who": "你是谁？",
        "chapter:002:thinking": "什么是批判性思考？",
      });
      expect(postCount).toBe(2);
      expect(postedBodies).toEqual([
        { engineId: SAVED_CATALOG_ENGINE, regenerate: false, preserveSetting: true },
        { engineId: SAVED_CATALOG_ENGINE, regenerate: false, preserveSetting: true },
      ]);
      expect(progressCalls).toEqual([[0, 0], [1, 2]]);
      expect(events).toEqual([
        { kind: "book", id: "book:meta:order-test", state: "pending" },
        { kind: "book", id: "book:meta:order-test", state: "ready" },
      ]);

      // Already-ready catalog should not invoke POST again.
      const readyFetcher = vi.fn(async () =>
        new Response(
          JSON.stringify({ state: "ready", titles: { parts: {}, chapters: { "chapter:001:who": "你是谁？" } } }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", readyFetcher);
      const cachedTitles = await ensureBookChineseCatalog(
        "book:meta:order-test",
        QWEN_ENGINE_ID,
        new AbortController().signal,
      );
      expect(cachedTitles).toEqual({ "chapter:001:who": "你是谁？" });
      expect(readyFetcher).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("vantilo-catalog-updated", onUpdated);
    }
  });

  it("skips auto-generating book catalog without POSTing to the body translation engine when catalog settings fail", async () => {
    const scenarios: Array<{
      name: string;
      settingsHandler: () => Promise<Response>;
    }> = [
      {
        name: "503 response",
        settingsHandler: async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
      },
      {
        name: "invalid JSON response",
        settingsHandler: async () => new Response("not-json", { status: 200 }),
      },
      {
        name: "network error",
        settingsHandler: async () => { throw new TypeError("Failed to fetch"); },
      },
      {
        name: "saved catalog engine missing from available list",
        settingsHandler: async () => new Response(JSON.stringify({
          engineId: "custom-api:lan-catalog-removed",
          savedEngineId: "custom-api:lan-catalog-removed",
          defaultEngineId: "custom-api:cloud-body",
          engines: [{ id: "custom-api:cloud-body" }],
        }), { status: 200 }),
      },
      {
        name: "no saved catalog engine and selected body engine removed while cloud default exists",
        settingsHandler: async () => new Response(JSON.stringify({
          engineId: "custom-api:cloud-default",
          savedEngineId: null,
          defaultEngineId: "custom-api:cloud-default",
          engines: [{ id: "custom-api:cloud-default" }],
        }), { status: 200 }),
      },
    ];

    for (const scenario of scenarios) {
      const postUrls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST") {
          postUrls.push(url);
          return new Response(JSON.stringify({ state: "ready", titles: { chapters: {} } }), { status: 200 });
        }
        if (url === "/api/vantilo-catalog/settings") {
          return scenario.settingsHandler();
        }
        return new Response(JSON.stringify({ state: "idle", titles: { parts: {}, chapters: {} } }), { status: 200 });
      }));

      const result = await ensureBookChineseCatalog(
        "book:meta:order-test",
        scenario.name.includes("selected body engine removed") ? "custom-api:lan-body-removed" : "custom-api:cloud-body",
        new AbortController().signal,
      );
      expect(result, scenario.name).toBeUndefined();
      expect(postUrls, scenario.name).toEqual([]);
    }
  });
});
