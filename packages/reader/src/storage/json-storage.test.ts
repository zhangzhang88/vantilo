import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IssueRecord } from "../shared/types.js";
import { JsonStorage } from "./json-storage.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonStorage", () => {
  it("round-trips an issue record", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const issue: IssueRecord = {
      schemaVersion: 1,
      id: "economist:2026-09-19",
      publicationId: "economist",
      publicationName: "The Economist",
      filename: "sample.epub",
      sourceFingerprint: "1:1",
      title: "The Economist",
      date: "2026-09-19",
      label: "September 19, 2026",
      sections: [],
      articles: [],
    };
    await storage.saveIssue(issue);
    await expect(storage.loadIssue(issue.id)).resolves.toEqual(issue);
    await storage.deleteIssue(issue.id);
    await expect(storage.loadIssue(issue.id)).resolves.toBeNull();
  });

  it("persists publication-scoped AI section translations for reuse", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-section-translations-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const cache = {
      version: 1 as const,
      publications: {
        "new-yorker": { "Future Desk": "未来栏目" },
      },
    };
    await storage.saveSectionTranslations(cache);
    await expect(storage.loadSectionTranslations()).resolves.toEqual(cache);
  });

  it("persists resumable Chinese-guide preparation status", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "magazine-guide-status-"));
    dirs.push(dir);
    const storage = new JsonStorage(dir);
    const cache = {
      version: 1 as const,
      issues: {
        "new-yorker:2026-09-14": {
          issueId: "new-yorker:2026-09-14",
          state: "error" as const,
          total: 24,
          completed: 9,
          remaining: 15,
          sectionTotal: 8,
          sectionCompleted: 8,
          sectionRemaining: 0,
          attemptCount: 4,
          failedArticleIds: ["stuck"],
          lastAttemptAt: "2026-09-23T00:00:00.000Z",
          lastCompletedAt: null,
          lastError: "模型返回不完整",
          updatedAt: "2026-09-23T00:00:00.000Z",
        },
      },
    };
    await storage.saveGuidePreparationStatuses(cache);
    await expect(storage.loadGuidePreparationStatuses()).resolves.toEqual(cache);
  });
});
