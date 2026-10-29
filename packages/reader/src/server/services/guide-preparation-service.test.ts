import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article, IssueRecord, ReaderGuide } from "../../shared/types.js";
import { JsonStorage } from "../../storage/json-storage.js";
import { GuidePreparationService } from "./guide-preparation-service.js";
import type { IssueService } from "./issue-service.js";
import type { ReaderGuideProvider } from "./reader-guide-service.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function article(id: string): Article {
  return {
    id,
    issueId: "new-yorker:2026-09-14",
    publicationId: "new-yorker",
    href: `${id}.xhtml`,
    section: "Reporting & Essays",
    kicker: null,
    title: `Article ${id}`,
    subtitle: null,
    author: null,
    publishedAt: null,
    sourceUrl: null,
    bodyText: `Body ${id}`,
    wordCount: 100,
    readerGuide: null,
    status: null,
    analysis: null,
  };
}

function guide(id: string): ReaderGuide {
  return {
    titleZh: `中文 ${id}`,
    subtitleZh: null,
    summaryZh: `摘要 ${id}。第二句。`,
    model: "test",
    provider: "easycliproxy",
    generatedAt: "2026-09-23T00:00:00.000Z",
  };
}

function issue(ids: string[]): IssueRecord {
  return {
    schemaVersion: 1,
    id: "new-yorker:2026-09-14",
    publicationId: "new-yorker",
    publicationName: "The New Yorker",
    filename: "new_yorker.2026.09.14.epub",
    sourceFingerprint: "test",
    title: "The New Yorker",
    date: "2026-09-14",
    label: "September 14, 2026",
    sections: ["Reporting & Essays"],
    sectionTranslations: { "Reporting & Essays": "报道与随笔" },
    articles: ids.map(article),
  };
}

function fakeProvider(): ReaderGuideProvider {
  return { generate: vi.fn(async () => new Map()) };
}

describe("GuidePreparationService", () => {
  it("preserves partial progress and retries only the omitted article", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-guide-prep-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const record = issue(["a", "b", "c", "d"]);
    const calls: string[][] = [];
    const service = {
      getIssue: vi.fn(async () => record),
      listIssues: vi.fn(async () => [{ id: record.id }]),
      generateSectionTranslations: vi.fn(),
      generateReaderGuidesForArticles: vi.fn(async (_issueId: string, _provider: ReaderGuideProvider, ids: string[]) => {
        calls.push([...ids]);
        const successful = ids.length > 1 ? ids.slice(0, -1) : ids;
        successful.forEach((id) => {
          const target = record.articles.find((item) => item.id === id);
          if (target && !target.readerGuide) target.readerGuide = guide(id);
        });
        const unresolvedIds = ids.filter((id) => !record.articles.find((item) => item.id === id)?.readerGuide);
        return {
          issue: record,
          generated: successful.length,
          remaining: record.articles.filter((item) => !item.readerGuide).length,
          unresolvedIds,
        };
      }),
    } as unknown as IssueService;
    const preparation = new GuidePreparationService(service, storage, fakeProvider(), null, {
      retryDelaysMs: [0, 0],
      sleep: async () => undefined,
    });

    await preparation.start(record.id);
    await vi.waitFor(async () => {
      expect((await preparation.getStatus(record.id))?.state).toBe("complete");
    });

    expect(calls[0]).toEqual(["a", "b", "c", "d"]);
    expect(calls[1]).toEqual(["d"]);
    expect(record.articles.every((item) => item.readerGuide)).toBe(true);
    const persisted = await storage.loadGuidePreparationStatuses();
    expect(persisted.issues[record.id]).toMatchObject({ state: "complete", completed: 4, remaining: 0 });
  });

  it("records a persistent single-article failure and completes after manual resume", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-guide-resume-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const record = issue(["a", "b", "stuck"]);
    let stuckCanSucceed = false;
    const service = {
      getIssue: vi.fn(async () => record),
      listIssues: vi.fn(async () => [{ id: record.id }]),
      generateSectionTranslations: vi.fn(),
      generateReaderGuidesForArticles: vi.fn(async (_issueId: string, _provider: ReaderGuideProvider, ids: string[]) => {
        const successful = ids.filter((id) => id !== "stuck" || stuckCanSucceed);
        successful.forEach((id) => {
          const target = record.articles.find((item) => item.id === id);
          if (target && !target.readerGuide) target.readerGuide = guide(id);
        });
        if (ids.length === 1 && ids[0] === "stuck" && !stuckCanSucceed) {
          throw new Error("test provider could not generate stuck article");
        }
        return {
          issue: record,
          generated: successful.length,
          remaining: record.articles.filter((item) => !item.readerGuide).length,
          unresolvedIds: ids.filter((id) => !record.articles.find((item) => item.id === id)?.readerGuide),
        };
      }),
    } as unknown as IssueService;
    const preparation = new GuidePreparationService(service, storage, fakeProvider(), null, {
      retryDelaysMs: [0, 0],
      sleep: async () => undefined,
    });

    await preparation.start(record.id);
    await vi.waitFor(async () => {
      expect((await preparation.getStatus(record.id))?.state).toBe("error");
    });
    expect(await preparation.getStatus(record.id)).toMatchObject({
      completed: 2,
      remaining: 1,
      failedArticleIds: ["stuck"],
    });

    stuckCanSucceed = true;
    await preparation.start(record.id);
    await vi.waitFor(async () => {
      expect((await preparation.getStatus(record.id))?.state).toBe("complete");
    });
    expect(record.articles.every((item) => item.readerGuide)).toBe(true);
  });

  it("resumes incomplete issues when startup recovery scans the library", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-guide-startup-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const record = issue(["a", "b"]);
    record.articles[0].readerGuide = guide("a");
    const service = {
      getIssue: vi.fn(async () => record),
      listIssues: vi.fn(async () => [{ id: record.id }]),
      generateSectionTranslations: vi.fn(),
      generateReaderGuidesForArticles: vi.fn(async (_issueId: string, _provider: ReaderGuideProvider, ids: string[]) => {
        ids.forEach((id) => {
          const target = record.articles.find((item) => item.id === id);
          if (target && !target.readerGuide) target.readerGuide = guide(id);
        });
        return {
          issue: record,
          generated: ids.length,
          remaining: record.articles.filter((item) => !item.readerGuide).length,
          unresolvedIds: [],
        };
      }),
    } as unknown as IssueService;
    const preparation = new GuidePreparationService(service, storage, fakeProvider(), null, {
      retryDelaysMs: [0, 0],
      sleep: async () => undefined,
    });

    await preparation.resumeAllIncomplete();
    await vi.waitFor(async () => {
      expect((await preparation.getStatus(record.id))?.state).toBe("complete");
    });
    expect(record.articles.every((item) => item.readerGuide)).toBe(true);
  });
});
