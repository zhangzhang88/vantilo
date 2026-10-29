import { describe, expect, it } from "vitest";
import type { IssueRecord } from "../shared/types";
import { articleKey, articleParagraphs, flattenArticles, resolveIssueContinueArticle, sectionNameZh, toReaderIssue } from "./reader-model";

const issue: IssueRecord = {
  schemaVersion: 1,
  id: "economist:2026-09-19",
  publicationId: "economist",
  publicationName: "The Economist",
  filename: "TheEconomist.2026.09.19.epub",
  sourceFingerprint: "test",
  title: "The Economist",
  date: "2026-09-19",
  label: "September 19, 2026",
  sections: ["Leaders", "Finance & economics"],
  articles: [
    {
      id: "a1",
      issueId: "economist:2026-09-19",
      publicationId: "economist",
      href: "a1.xhtml",
      section: "Finance & economics",
      kicker: null,
      title: "A real article",
      subtitle: "A subtitle",
      author: "A Writer",
      publishedAt: null,
      sourceUrl: null,
      bodyText: "First paragraph with enough words.\n\nSecond paragraph with more useful words.",
      wordCount: 440,
      readerGuide: {
        titleZh: "一篇真实文章",
        subtitleZh: "一个副标题",
        summaryZh: "这是一段帮助读者判断是否值得阅读的中文摘要。",
        model: "gpt-6-luna",
        provider: "easycliproxy",
        generatedAt: "2026-09-21T00:00:00.000Z",
      },
      status: null,
      analysis: null,
    },
  ],
};

describe("reader model", () => {
  it("turns parsed EPUB records into reader sections and paragraphs", () => {
    const progress = { [articleKey(issue.id, "a1")]: 42 };
    const reader = toReaderIssue(issue, progress);
    const article = flattenArticles(reader)[0];

    expect(reader.displayDate).toBe("2026年9月19日");
    expect(reader.publicationName).toBe("The Economist");
    expect(reader.coverKicker).toBe("THE ECONOMIST");
    expect(reader.coverMark).toBe("E");
    expect(reader.sections).toHaveLength(1);
    expect(article.title).toBe("A real article");
    expect(reader.sections[0].nameZh).toBe("金融与经济");
    expect(article.sectionZh).toBe("金融与经济");
    expect(article.titleZh).toBe("一篇真实文章");
    expect(article.summaryZh).toContain("判断是否值得阅读");
    expect(article.minutes).toBe(2);
    expect(article.progress).toBe(42);
    expect(article.paragraphs).toEqual([
      "First paragraph with enough words.",
      "Second paragraph with more useful words.",
    ]);
  });

  it("uses reader-friendly Chinese labels for editorial sections", () => {
    expect(sectionNameZh("The world this week")).toBe("本周要闻");
    expect(sectionNameZh("Briefing")).toBe("深度专题");
    expect(sectionNameZh("Obituary")).toBe("逝者纪念");
    expect(sectionNameZh("Finance & economics")).toBe("金融与经济");
    expect(sectionNameZh("Goings On", "new-yorker")).toBe("城中指南");
    expect(sectionNameZh("The Talk of the Town", "new-yorker")).toBe("城中话题");
    expect(sectionNameZh("Culture & Critics", "atlantic")).toBe("文化与评论");
    expect(sectionNameZh("Gear", "wired")).toBe("产品与装备");
    expect(sectionNameZh("Future Desk", "new-yorker", { "Future Desk": "未来栏目" })).toBe("未来栏目");
  });

  it("keeps article identity scoped to its publication issue", () => {
    expect(articleKey("atlantic:2026-09-02", "index.xhtml"))
      .not.toBe(articleKey("wired:2026-09-02", "index.xhtml"));
  });

  it("continues the exact last-read article within an issue before falling back to the first in-progress article", () => {
    const secondArticle = {
      ...issue.articles[0],
      id: "a2",
      href: "a2.xhtml",
      title: "Second article",
    };
    const reader = toReaderIssue(
      { ...issue, articles: [...issue.articles, secondArticle] },
      { [articleKey(issue.id, "a1")]: 35, [articleKey(issue.id, "a2")]: 100 },
    );

    expect(resolveIssueContinueArticle(reader, { issueId: issue.id, articleId: "a2" })?.id).toBe("a2");
    expect(resolveIssueContinueArticle(reader, { issueId: "economist:2026-09-12", articleId: "a2" })?.id).toBe("a1");
    expect(resolveIssueContinueArticle(reader, { issueId: issue.id, articleId: "missing" })?.id).toBe("a1");
  });

  it("splits the parser body text on paragraph boundaries", () => {
    expect(articleParagraphs({ bodyText: "One.\n\n\nTwo.\n\nThree." })).toEqual(["One.", "Two.", "Three."]);
  });
});
