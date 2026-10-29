import { describe, expect, it } from "vitest";
import type { ReaderArticle, ReaderIssue } from "./reader-model";
import { addToReadLater, emptyReadLaterState } from "./read-later-state";
import { filterIssueSections, issueReadingFilterCounts, matchesIssueReadingFilter, matchesIssueTocQuery } from "./issue-reading-filter";

function article(id: string, progress: number): ReaderArticle {
  return {
    id,
    issueId: "economist:2026-09-19",
    author: "",
    section: "Leaders",
    sectionZh: "社论",
    title: id,
    titleZh: "",
    subtitle: "",
    subtitleZh: "",
    summaryZh: "",
    minutes: 1,
    progress,
    paragraphs: [id],
    wordCount: 1,
    sourceUrl: null,
  };
}

const unread = article("unread", 0);
const reading = article("reading", 42);
const read = article("read", 100);
const issue: ReaderIssue = {
  id: "economist:2026-09-19",
  publicationId: "economist",
  publicationName: "The Economist",
  date: "2026-09-19",
  displayDate: "2026年9月19日",
  label: "September 19, 2026",
  description: "",
  progress: 47,
  coverKicker: "",
  coverMark: "",
  coverTitle: "",
  coverSubtitle: "",
  sections: [
    { name: "Leaders", nameZh: "社论", articles: [unread, reading] },
    { name: "Finance", nameZh: "财经", articles: [read] },
  ],
};

const readLaterState = addToReadLater(emptyReadLaterState(), issue.id, read.id, "2026-09-23T00:00:00.000Z");

describe("issue reading filters", () => {
  it("classifies progress states while keeping read later independent", () => {
    expect(matchesIssueReadingFilter(unread, issue.id, readLaterState, "unread")).toBe(true);
    expect(matchesIssueReadingFilter(reading, issue.id, readLaterState, "reading")).toBe(true);
    expect(matchesIssueReadingFilter(read, issue.id, readLaterState, "read")).toBe(true);
    expect(matchesIssueReadingFilter(read, issue.id, readLaterState, "read-later")).toBe(true);
  });

  it("reports counts for all five filters", () => {
    expect(issueReadingFilterCounts(issue, readLaterState)).toEqual({
      all: 3,
      unread: 1,
      reading: 1,
      "read-later": 1,
      read: 1,
    });
  });

  it("matches only TOC metadata case-insensitively in English and Chinese", () => {
    const searchable = {
      ...reading,
      title: "The AI boom reaches factories",
      titleZh: "人工智能进入工厂",
      subtitle: "A new industrial cycle",
      subtitleZh: "新的工业周期",
      summaryZh: "企业正在重新规划投资。",
      paragraphs: ["tariffs appear only in the full article body"],
    };
    expect(matchesIssueTocQuery(searchable, "AI BOOM")).toBe(true);
    expect(matchesIssueTocQuery(searchable, "工业周期")).toBe(true);
    expect(matchesIssueTocQuery(searchable, "重新规划")).toBe(true);
    expect(matchesIssueTocQuery(searchable, "tariffs")).toBe(false);
    expect(matchesIssueTocQuery(searchable, "   ")).toBe(true);
  });

  it("combines the TOC query with status filters and query-scoped counts", () => {
    const searchableIssue: ReaderIssue = {
      ...issue,
      sections: [
        { ...issue.sections[0], articles: [{ ...unread, title: "AI outlook" }, { ...reading, title: "AI investment" }] },
        { ...issue.sections[1], articles: [{ ...read, title: "Trade outlook" }] },
      ],
    };
    expect(issueReadingFilterCounts(searchableIssue, readLaterState, "AI")).toEqual({
      all: 2,
      unread: 1,
      reading: 1,
      "read-later": 0,
      read: 0,
    });
    expect(filterIssueSections(searchableIssue, readLaterState, "reading", "ai")).toEqual([
      {
        name: "Leaders",
        nameZh: "社论",
        articles: [{ article: { ...reading, title: "AI investment" }, originalIndex: 1 }],
      },
    ]);
  });

  it("preserves section order, EPUB order and original indexes", () => {
    expect(filterIssueSections(issue, readLaterState, "reading")).toEqual([
      {
        name: "Leaders",
        nameZh: "社论",
        articles: [{ article: reading, originalIndex: 1 }],
      },
    ]);
  });
});
