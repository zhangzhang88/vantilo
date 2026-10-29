import { describe, expect, it } from "vitest";
import type { PublicationId } from "../shared/types";
import type { ReaderIssue } from "./reader-model";
import { buildPublicationShelf } from "./publication-library";

function readerIssue(publicationId: PublicationId, date: string, progress = 0): ReaderIssue {
  const publicationName = publicationId === "economist" ? "The Economist"
    : publicationId === "new-yorker" ? "The New Yorker"
      : publicationId === "atlantic" ? "The Atlantic"
        : "Wired";
  return {
    id: `${publicationId}:${date}`,
    publicationId,
    publicationName,
    date,
    displayDate: date,
    label: date,
    description: "test issue",
    progress,
    coverKicker: publicationName.toUpperCase(),
    coverMark: publicationName[0],
    coverTitle: date,
    coverSubtitle: "test",
    sections: [{ name: "Test", nameZh: "测试", articles: [{
      id: `${publicationId}-${date}-article`, issueId: `${publicationId}:${date}`, author: "", section: "Test", sectionZh: "测试",
      title: "Test article", titleZh: "", subtitle: "", subtitleZh: "", summaryZh: "", minutes: 1, progress,
      paragraphs: ["Test paragraph."], wordCount: 100, sourceUrl: null,
    }] }],
  };
}

describe("multi-issue publication shelf", () => {
  it("groups issues by publication while keeping newest issue first", () => {
    const shelf = buildPublicationShelf([
      readerIssue("wired", "2026-08-02"),
      readerIssue("economist", "2026-09-12", 35),
      readerIssue("economist", "2026-09-19"),
      readerIssue("wired", "2026-09-02"),
    ]);
    expect(shelf.map((item) => item.publicationId)).toEqual(["economist", "wired"]);
    expect(shelf[0].issueCount).toBe(2);
    expect(shelf[0].issues.map((issue) => issue.date)).toEqual(["2026-09-19", "2026-09-12"]);
    expect(shelf[0].latestIssue.id).toBe("economist:2026-09-19");
    expect(shelf[0].recentIssue.id).toBe("economist:2026-09-12");
    expect(shelf[0].latestArticleCount).toBe(1);
  });
});
