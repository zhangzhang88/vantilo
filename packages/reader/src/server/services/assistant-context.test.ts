import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseAssistantScope } from "../../shared/assistant-scope.js";
import { buildAssistantContext, readAssistantSources, type AssistantContext } from "./assistant-context.js";
import { CodexPrepService } from "./codex-prep-service.js";
import type { CodexAuthService } from "./codex-auth-service.js";
import type { BookImportService } from "./book-import-service.js";
import type { IssueService } from "./issue-service.js";
import { BookCategoryService } from "./book-category-service.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(os.tmpdir(), "mr-assistant-")); roots.push(value); return value; }
const auth = { accessToken: async () => "synthetic-token" } as unknown as CodexAuthService;
const context = (key = "assistant:books", fingerprint = "source-a"): AssistantContext => ({ key, fingerprint, label: "电子书", overview: "S1 Book One / Chapter One", read: raw => readAssistantSources([{ id: "S1", title: "Book One / Chapter One", paragraphs: ["Siblings have different experiences.", "We cannot infer an individual outcome."] }], raw) });

it("validates scopes and discards client-supplied source content", () => {
  expect(parseAssistantScope(JSON.stringify({ kind: "books", source: "fabricated" }))).toEqual({ kind: "books" });
  for (const raw of [undefined, "null", "{}", "[]", '{"kind":"chapter","bookId":"a"}', "invalid"]) expect(() => parseAssistantScope(raw)).toThrow();
});
it("reads only allowed sources and complete bounded paragraphs, and rejects malformed plans", () => {
  const sources = [{ id: "S1", title: "One", paragraphs: ["A complete opening.", "A sibling experience.", "Closing."] }];
  const text = readAssistantSources(sources, JSON.stringify({ reads: [{ id: "invented", start: 0, count: 3 }], queries: [] }));
  expect(text).toContain("none"); expect(text).not.toContain("A complete opening");
  expect(readAssistantSources(sources, JSON.stringify({ queries: ["sibling"] }))).toContain("[S1:P2]\nA sibling experience.");
  const bounded = readAssistantSources([{ id: "S1", title: "Long", paragraphs: ["x".repeat(25000), "Small complete paragraph."] }], '{"reads":[{"id":"S1","start":0,"count":2}]}');
  expect(bounded).not.toContain("xxxxx"); expect(bounded).toContain("Small complete paragraph.");
  expect(() => readAssistantSources(sources, "not a plan")).toThrow();
});
it("resolves book/issue/article/lesson scopes from real service data and fingerprints replacements", async () => {
  const directory = await root();
  const book = { id: "book:one", sourceFingerprint: "one", title: "Actual Book", authors: ["Author"], chapters: [{ id: "ch1", title: "Actual Chapter", paragraphs: ["Source paragraph."] }] };
  const books = { listBooks: async () => [book], getBook: async (id: string) => id === book.id ? book : null } as unknown as BookImportService;
  const issue = { id: "issue-one", sourceFingerprint: "issue-source", publicationId: "wired", publicationName: "Wired", label: "January", title: "Real Issue", date: "2026-01-01", articles: [{ id: "article-one", section: "Science", title: "Actual Article", bodyText: "First paragraph.\n\nSecond paragraph." }] };
  const issues = { listIssues: async () => [issue], getIssue: async (id: string) => id === issue.id ? issue : null } as unknown as IssueService;
  const prep = { list: () => [{ id: "lesson-one", sourceFingerprint: "one", titleZh: "简易材料", english: "Adapted text.", explanationZh: "改编说明" }] } as unknown as CodexPrepService;
  const categories = new BookCategoryService(path.join(directory, "categories.json")); await categories.set(book.id, "psychology");
  const all = await buildAssistantContext({ kind: "all" }, books, issues, prep, categories);
  expect(all.overview).toContain("Actual Book"); expect(all.overview).toContain("Actual Article"); expect(all.overview).toContain("心理学"); expect(all.overview).not.toContain("Source paragraph.");
  const bookOnly = await buildAssistantContext({ kind: "books" }, books, issues, prep, categories); expect(bookOnly.overview).not.toContain("Actual Article");
  const article = await buildAssistantContext({ kind: "article", issueId: issue.id, articleId: "article-one" }, books, issues, prep, categories);
  expect(article.document).toMatchObject({ paragraphCount: 2 });
  expect(article.document?.fullText).toContain("[S1:P2]\nSecond paragraph.");
  expect(article.read('{"reads":[{"id":"S1","start":1,"count":1}]}')).toContain("Second paragraph."); expect(article.overview).not.toContain("Actual Book");
  await expect(buildAssistantContext({ kind: "magazines" }, books, issues, prep, { assignments: async () => { throw new Error("unrelated book metadata unavailable"); } } as unknown as BookCategoryService)).resolves.toMatchObject({ label: "期刊书架" });
  const lesson = await buildAssistantContext({ kind: "lesson", bookId: book.id, lessonId: "lesson-one" }, books, issues, prep, categories);
  expect(lesson.document).toMatchObject({ paragraphCount: 1 });
  expect(lesson.document?.fullText).toContain("Adapted text.");
  expect(lesson.document?.fullText).not.toContain("改编说明");
  await expect(buildAssistantContext({ kind: "chapter", bookId: book.id, chapterId: "missing" }, books, issues, prep, categories)).rejects.toThrow("章节");
  book.sourceFingerprint = "replaced";
  expect((await buildAssistantContext({ kind: "books" }, books, issues, prep, categories)).fingerprint).not.toBe(bookOnly.fingerprint);
});
it("prioritizes the current paragraph and neighbors within the long-text evidence budget", () => {
  const paragraphs = Array.from({ length: 10 }, (_, index) => `Paragraph ${index + 1}. ${"x".repeat(4000)}`);
  const evidence = readAssistantSources([{ id: "S1", title: "Long chapter", paragraphs }], '{"reads":[{"id":"S1","start":0,"count":6}]}', 8);
  for (const index of [7, 8, 9]) expect(evidence).toContain(`[S1:P${index + 1}]\n${paragraphs[index]}`);
  expect(evidence).not.toContain("[S1:P6]");
});
it("answers a complete short article in one call, validates position and persists only verified citations", async () => {
  const directory = await root();
  const runner = vi.fn(async (_input: string) => "这是文章的依据。[P2] 不可用的引用。[P3][P999]");
  const current: AssistantContext = { ...context("assistant:article"), document: { paragraphCount: 3, fullText: "VERIFIED READ WINDOWS:\n[S1:P1]\nOpening.\n[S1:P2]\nEvidence." } };
  const service = new CodexPrepService(directory, auth, runner as never); await service.load();
  for (const currentParagraphIndex of [-1, 3, 1.5]) await expect(service.discussContext(current, "这一段", { currentParagraphIndex })).rejects.toThrow("位置无效");
  await expect(service.discussContext(context(), "本文", { currentParagraphIndex: 0 })).rejects.toThrow("位置无效");
  expect(runner).not.toHaveBeenCalled();
  const result = await service.discussContext(current, "解释当前段", { currentParagraphIndex: 1 });
  expect(runner).toHaveBeenCalledTimes(1);
  expect(runner.mock.calls[0]?.[0]).toContain("Current reading paragraph: P2");
  expect(result.paragraphIndexes).toEqual([1]); expect(result.answer).not.toContain("[P");
  service.close();
  const restarted = new CodexPrepService(directory, auth, runner as never); await restarted.load();
  expect(restarted.history(current.key, current.fingerprint)[1]).toMatchObject({ paragraphIndexes: [1], text: result.answer }); restarted.close();
});
it("long chapters keep bounded retrieval instead of claiming the whole chapter was read", async () => {
  const directory = await root();
  const book = { id: "book:long", sourceFingerprint: "long", title: "Long Book", authors: [], chapters: [{ id: "long", title: "Long chapter", paragraphs: Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}. ${"z".repeat(1500)}`) }] };
  const current = await buildAssistantContext({ kind: "chapter", bookId: book.id, chapterId: "long" }, { getBook: async () => book } as unknown as BookImportService, {} as IssueService, {} as CodexPrepService, new BookCategoryService(path.join(directory, "categories.json")));
  expect(current.document?.fullText).toBeUndefined();
  expect(current.document?.paragraphCount).toBe(20);
  const runner = vi.fn(async (input: string) => input.startsWith("ASSISTANT_RESEARCH_PLAN_V1") ? '{"reads":[]}' : "当前段解释。[P15][P1]");
  const service = new CodexPrepService(directory, auth, runner as never); await service.load();
  expect((await service.discussContext(current, "解释这一段", { currentParagraphIndex: 14 })).paragraphIndexes).toEqual([14]);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(runner.mock.calls[1]?.[0]).toContain("[S1:P15]");
  expect(runner.mock.calls[1]?.[0]).not.toContain("[S1:P1]"); service.close();
});
it("shares auth/runtime, streams the grounded answer, isolates scopes and persists completed turns", async () => {
  const directory = await root(); const prompts: string[] = [];
  const runner = vi.fn(async (input: string, _token: string, _cwd: string, _binary: unknown, options: { onDelta?: (text: string) => void }) => {
    prompts.push(input);
    if (input.startsWith("ASSISTANT_RESEARCH_PLAN_V1")) return '{"reads":[{"id":"S1","start":0,"count":2}]}';
    options.onDelta?.("依据原文"); return "依据原文，兄弟姐妹的经历可能不同。";
  });
  const service = new CodexPrepService(directory, auth, runner as never); await service.load();
  const delta = vi.fn();
  await service.discussContext(context(), "推荐一本", { onDelta: delta }); expect(delta).toHaveBeenCalledWith("依据原文");
  expect(prompts[1]).toContain("Siblings have different experiences."); expect(prompts[1]).toContain("Never claim you read complete books");
  expect(service.history(context().key, "source-a")).toHaveLength(2);
  expect(service.history("assistant:magazines", "source-a")).toEqual([]); expect(service.history(context().key, "source-b")).toEqual([]);
  service.close();
  const restarted = new CodexPrepService(directory, auth, runner as never); await restarted.load();
  expect(restarted.history(context().key, "source-a")).toHaveLength(2);
  await restarted.clearHistory(context().key, "source-a"); expect(restarted.history(context().key, "source-a")).toEqual([]); restarted.close();
});
it("rejects concurrent work and never saves cancelled or failed partial replies", async () => {
  const directory = await root(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const runner = vi.fn(async (input: string, _token: string, _cwd: string, _binary: unknown, options: { signal: AbortSignal; onDelta?: (text: string) => void }) => {
    if (input.startsWith("ASSISTANT_RESEARCH_PLAN_V1")) return '{"reads":[]}';
    options.onDelta?.("partial"); started();
    await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true })); return "partial";
  });
  const service = new CodexPrepService(directory, auth, runner as never); const controller = new AbortController();
  const pending = service.discussContext(context(), "Explain", { signal: controller.signal }); const rejected = expect(pending).rejects.toThrow(); await ready;
  await expect(service.discussContext(context(), "Again")).rejects.toThrow("进行中");
  await expect(service.clearHistory(context().key, context().fingerprint)).rejects.toThrow("等待");
  controller.abort(); await rejected; expect(service.history(context().key, context().fingerprint)).toEqual([]); service.close();
});
