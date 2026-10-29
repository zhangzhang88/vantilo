import { describe, expect, it } from "vitest";
import type { IssueRecord, IssueSummary } from "../shared/types";
import { mergeSearchRefreshedIssues, searchRefreshIssueIds } from "./library-search-refresh";

function issue(id: string, guided = true): IssueRecord {
  const [publicationId, date] = id.split(":") as [IssueRecord["publicationId"], string];
  return {
    schemaVersion: 1,
    id,
    publicationId,
    publicationName: publicationId,
    filename: `${id}.epub`,
    sourceFingerprint: id,
    title: id,
    date,
    label: date,
    sections: ["Test"],
    articles: [{
      id: `${id}:article`,
      issueId: id,
      publicationId,
      href: "article.xhtml",
      section: "Test",
      kicker: null,
      title: "Article",
      subtitle: null,
      author: null,
      publishedAt: null,
      sourceUrl: null,
      bodyText: "Body",
      wordCount: 1,
      readerGuide: guided ? {
        titleZh: "文章",
        subtitleZh: null,
        summaryZh: "摘要",
        model: "test",
        provider: "easycliproxy",
        generatedAt: "2026-09-25T00:00:00.000Z",
      } : null,
      status: null,
      analysis: null,
    }],
  };
}

function summary(record: IssueRecord): IssueSummary {
  return {
    id: record.id,
    publicationId: record.publicationId,
    publicationName: record.publicationName,
    filename: record.filename,
    title: record.title,
    date: record.date,
    label: record.label,
    articleCount: record.articles.length,
    sections: record.sections,
    markedCount: 0,
    statusCounts: { save: 0, process: 0, skip: 0 },
  };
}

describe("incremental search issue refresh", () => {
  it("refreshes only new or guide-incomplete issues", () => {
    const complete = issue("economist:2026-09-19");
    const incomplete = issue("wired:2026-09-02", false);
    const added = issue("atlantic:2026-10-02");
    expect(searchRefreshIssueIds([summary(complete), summary(incomplete), summary(added)], [complete, incomplete])).toEqual([
      incomplete.id,
      added.id,
    ]);
  });

  it("merges refreshed records in server summary order and drops removed issues", () => {
    const oldComplete = issue("economist:2026-09-19");
    const removed = issue("wired:2026-08-02");
    const added = issue("atlantic:2026-10-02");
    const refreshedComplete = { ...oldComplete, title: "Refreshed" };
    const merged = mergeSearchRefreshedIssues(
      [summary(added), summary(oldComplete)],
      [oldComplete, removed],
      [added, refreshedComplete],
    );
    expect(merged.map((item) => item.id)).toEqual([added.id, oldComplete.id]);
    expect(merged[1].title).toBe("Refreshed");
  });
});
