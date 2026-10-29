import { describe, expect, it } from "vitest";
import type { ReaderArticle, ReaderIssue } from "./reader-model";
import { searchMagazineLibrary } from "./full-text-search";

function article(overrides: Partial<ReaderArticle> = {}): ReaderArticle {
  return {
    id: "a1",
    issueId: "economist:2026-09-19",
    author: "",
    section: "Science & technology",
    sectionZh: "科学与技术",
    title: "The trickle-down economics of the AI boom",
    titleZh: "AI 热潮的涓滴经济学",
    subtitle: "How investment may spread through the wider economy",
    subtitleZh: "投资如何扩散到更广泛的经济领域",
    summaryZh: "文章讨论人工智能投资如何影响更广泛的经济活动。",
    minutes: 5,
    progress: 0,
    paragraphs: ["Artificial intelligence investment is spreading beyond the largest technology firms.", "Other industries are starting to respond."],
    wordCount: 200,
    sourceUrl: null,
    ...overrides,
  };
}

function issue(overrides: Partial<ReaderIssue> = {}): ReaderIssue {
  const item = article();
  return {
    id: "economist:2026-09-19",
    publicationId: "economist",
    publicationName: "The Economist",
    date: "2026-09-19",
    displayDate: "2026年9月19日",
    label: "September 19, 2026",
    description: "",
    progress: 0,
    coverKicker: "THE ECONOMIST",
    coverMark: "E",
    coverTitle: "SEP 19",
    coverSubtitle: "",
    sections: [{ name: item.section, nameZh: item.sectionZh, articles: [item] }],
    ...overrides,
  };
}

describe("full-text magazine search", () => {
  it("searches English body text and returns a context snippet", () => {
    const results = searchMagazineLibrary([issue()], "technology firms");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ issueId: "economist:2026-09-19", articleId: "a1", matchField: "body" });
    expect(results[0].snippet).toContain("technology firms");
  });

  it("searches cached Chinese title and summary without AI", () => {
    expect(searchMagazineLibrary([issue()], "涓滴经济学")[0]?.matchField).toBe("titleZh");
    expect(searchMagazineLibrary([issue()], "人工智能投资")[0]?.matchField).toBe("summaryZh");
  });

  it("filters results by publication and ranks title matches above body-only matches", () => {
    const economist = issue();
    const wiredArticle = article({
      id: "w1",
      issueId: "wired:2026-09-02",
      title: "A different story",
      titleZh: "另一篇文章",
      paragraphs: ["This body briefly mentions the AI boom."],
    });
    const wired: ReaderIssue = {
      ...issue(),
      id: "wired:2026-09-02",
      publicationId: "wired",
      publicationName: "Wired",
      date: "2026-09-02",
      displayDate: "2026年9月2日",
      sections: [{ name: wiredArticle.section, nameZh: wiredArticle.sectionZh, articles: [wiredArticle] }],
    };

    const all = searchMagazineLibrary([wired, economist], "AI boom");
    expect(all.map((result) => result.publicationId)).toEqual(["economist", "wired"]);
    expect(searchMagazineLibrary([wired, economist], "AI boom", "wired")).toHaveLength(1);
    expect(searchMagazineLibrary([wired, economist], "AI boom", "economist")).toHaveLength(1);
  });

  it("returns no results for an empty query", () => {
    expect(searchMagazineLibrary([issue()], "   ")).toEqual([]);
  });
});
