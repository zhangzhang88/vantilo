import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookRecord } from "../../shared/book-data-contract.js";
import type { ActiveAiProviderProfile } from "./ai-provider-settings-service.js";
import { BookTocChineseService, EasyCLIProxyBookTocChineseProvider, bookTocTitleRequests, parseBookTocChineseResponse } from "./book-toc-chinese-service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const profile: ActiveAiProviderProfile = {
  id: "first", name: "First", description: "", model: "model-one", apiKey: "fixture-key", responsesUrl: "http://127.0.0.1:8317/v1/responses",
};

function book(): BookRecord {
  const chapters = ["Title Page", "Copyright", "Contents", "1 Opening", "2 Methods", "Index", "Prologue", "Preface", "Appendix A", "Supplement: Notes"].map((title, order) => ({
    id: `chapter:${order}`, bookId: "book:test", partId: "part:1", order,
    role: (order === 7 ? "frontmatter" : order >= 8 ? "supplement" : order === 5 ? "backmatter" : "chapter") as BookRecord["chapters"][number]["role"], title, href: `${order}.xhtml`, documentPath: `${order}.xhtml`,
    contentFingerprint: `fingerprint:${order}`, headings: [], paragraphs: [title],
    blocks: [{ kind: "paragraph" as const, paragraphIndex: 0, text: title }], wordCount: 1,
  }));
  return {
    schemaVersion: 1, kind: "book", id: "book:test", sourceFilename: "fixture.epub", sourceFingerprint: "sha256:first",
    title: "Fixture Book", authors: [], language: "en", publisher: null, publishedAt: null, identifiers: [],
    epubVersion: "2.0", navigationType: "ncx", cover: null, numberedChapterCount: 2,
    parts: [{ id: "part:1", bookId: "book:test", order: 1, title: "I Research", chapterIds: chapters.map((chapter) => chapter.id) }],
    chapters,
  };
}

describe("Book TOC Chinese layer", () => {
  it("rechecks deletion eligibility after async status lookup and never recreates removed cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "book-toc-delete-"));
    roots.push(root);
    const record = book();
    let available = true;
    const generate = vi.fn(async () => new Map(bookTocTitleRequests(record).map(({ id }) => [id, "中文标题"])));
    const service = new BookTocChineseService(root, () => profile, { generate }, () => available);
    const lateStart = service.start(record);
    available = false;
    await expect(lateStart).rejects.toThrow("正在删除");
    expect(generate).not.toHaveBeenCalled();
    available = true;
    await service.start(record);
    await vi.waitFor(async () => expect((await service.status(record)).state).toBe("ready"));
    available = false;
    await service.remove(record.id);
    expect(JSON.parse(await readFile(path.join(root, "book-toc-chinese.json"), "utf8")).books).toEqual({});
    await expect(service.start(record)).rejects.toThrow("正在删除");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("selects only valuable Part and Chapter titles without mutating EPUB titles", () => {
    const record = book();
    const before = JSON.stringify(record);
    expect(bookTocTitleRequests(record).map(({ title }) => title)).toEqual([
      "I Research", "1 Opening", "2 Methods", "Prologue", "Preface", "Appendix A", "Supplement: Notes",
    ]);
    expect(JSON.stringify(record)).toBe(before);
    expect(() => parseBookTocChineseResponse('[{"id":"part:1","titleZh":"研究"}]', bookTocTitleRequests(record))).toThrow();
    expect(() => parseBookTocChineseResponse('[{"id":"part:1","titleZh":"Research"}]', [bookTocTitleRequests(record)[0]])).toThrow();
  });

  it("sends only selected nodes to the active model and validates its structured response", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("model-one");
      expect(body.input).toContain('"title":"1 Opening"');
      expect(body.input).not.toContain("Copyright");
      return new Response(JSON.stringify({ output_text: '[{"id":"chapter:3","titleZh":"第一章 开篇"}]' }), { status: 200 });
    });
    const generated = await new EasyCLIProxyBookTocChineseProvider(fetchImpl as typeof fetch)
      .generate(book(), [{ id: "chapter:3", kind: "chapter", title: "1 Opening" }], profile);
    expect(generated.get("chapter:3")).toBe("第一章 开篇");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("automatically completes valuable titles missing from an older cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "book-toc-chinese-"));
    roots.push(root);
    const record = book();
    await writeFile(path.join(root, "book-toc-chinese.json"), JSON.stringify({
      version: 1,
      books: {
        [record.id]: {
          sourceFingerprint: record.sourceFingerprint,
          profileId: "legacy-profile",
          model: "legacy-model",
          titles: { parts: {}, chapters: { "chapter:3": "旧版开篇" } },
        },
      },
    }));
    const generate = vi.fn(async (_book: BookRecord, requests: ReturnType<typeof bookTocTitleRequests>, selected: ActiveAiProviderProfile) =>
      new Map(requests.map(({ id }) => [id, `${selected.model} 中文`])));
    const service = new BookTocChineseService(root, () => profile, { generate });

    const partial = await service.status(record);
    expect(partial.state).toBe("idle");
    expect(partial.titles.chapters["chapter:3"]).toBe("旧版开篇");
    await service.start(record);
    await vi.waitFor(async () => expect((await service.status(record)).state).toBe("ready"));

    const complete = await service.status(record);
    expect(complete.titles.parts["part:1"]).toBe("model-one 中文");
    expect(complete.titles.chapters["chapter:6"]).toBe("model-one 中文");
    expect(complete.titles.chapters["chapter:3"]).toBe("model-one 中文");
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[1].map(({ id }) => id)).toEqual(bookTocTitleRequests(record).map(({ id }) => id));
  });

  it("persists a separate overlay, reuses it, then regenerates with the switched model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "book-toc-chinese-"));
    roots.push(root);
    const record = book();
    let active = profile;
    const generate = vi.fn(async (_book: BookRecord, requests: ReturnType<typeof bookTocTitleRequests>, selected: ActiveAiProviderProfile) =>
      new Map(requests.map(({ id }) => [id, `${selected.model} 中文`])));
    const service = new BookTocChineseService(root, () => active, { generate });
    expect((await service.start(record)).state).toBe("running");
    await vi.waitFor(async () => expect((await service.status(record)).state).toBe("ready"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.start(record)).titles.chapters["chapter:3"]).toBe("model-one 中文");
    expect(generate).toHaveBeenCalledTimes(1);
    active = { ...profile, id: "second", model: "model-two" };
    const reopened = new BookTocChineseService(root, () => active, { generate });
    expect((await reopened.status(record)).model).toBe("model-one");
    expect((await reopened.start(record)).state).toBe("ready");
    expect((await reopened.start(record, true)).state).toBe("running");
    await vi.waitFor(async () => expect((await reopened.status(record)).model).toBe("model-two"));
    expect((await reopened.status(record)).titles.parts["part:1"]).toBe("model-two 中文");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(path.join(root, "book-toc-chinese.json"), "utf8")).books[record.id].profileId).toBe("second");
    expect(record.parts[0].title).toBe("I Research");
    expect((await reopened.status({ ...record, sourceFingerprint: "sha256:changed" })).state).toBe("idle");
  });

  it("retains the previous cache when regeneration fails and exposes an actionable error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "book-toc-chinese-"));
    roots.push(root);
    const record = book();
    const generate = vi.fn().mockResolvedValueOnce(new Map(bookTocTitleRequests(record).map(({ id }) => [id, "旧标题"])))
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const service = new BookTocChineseService(root, () => profile, { generate });
    await service.start(record);
    await vi.waitFor(async () => expect((await service.status(record)).state).toBe("ready"));
    await service.start(record, true);
    await vi.waitFor(async () => expect((await service.status(record)).state).toBe("error"));
    const status = await service.status(record);
    expect(status.error).toBe("provider unavailable");
    expect(status.titles.chapters["chapter:3"]).toBe("旧标题");
  });
});
