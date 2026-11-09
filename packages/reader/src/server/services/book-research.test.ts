import { expect, it } from "vitest";
import type { BookRecord } from "../../shared/book-data-contract.js";
import { BOOK_AI_INPUT_LIMIT, boundedBookResearch, parseResearchPlan, researchOverview, retrieveBookResearch } from "./book-research.js";
const chapters = Array.from({ length: 16 }, (_, i) => ({ id: "c" + i, title: "Chapter " + i, order: i, role: "chapter", paragraphs: Array.from({ length: 180 }, (_, j) => i === 15 && j === 160 ? "A rare discovery about nocturnal adaptation." : "Ordinary material " + i + " " + j) }));
const book = { title: "Whole book", chapters } as BookRecord;
it("searches chapters beyond the former first 12 and paragraphs beyond the former first 110 with surrounding evidence", () => {
  const { report, evidenceContext } = retrieveBookResearch(book, { queries: ["nocturnal adaptation"], reads: [] });
  expect(report.indexedChapters).toBe(16);
  expect(report.indexedParagraphs).toBe(2880);
  expect(report.read).toContainEqual({ chapterId: "c15", title: "Chapter 15", paragraphs: [158, 159, 160, 161, 162] });
  expect(evidenceContext).toContain("[c15:P161] A rare discovery");
  expect(researchOverview(book)).toContain("c15 | Chapter 15");
});
it("respects chapter scope even when a plan asks to read elsewhere, and never invents fallback evidence on search misses", () => {
  const { report } = retrieveBookResearch(book, { queries: ["nocturnal"], reads: [{ chapterId: "c15", start: 160, count: 4 }] }, "c0");
  expect(report.read).toEqual([]);
  expect(retrieveBookResearch(book, { queries: ["not-found-phrase"], reads: [] }).report.read).toEqual([]);
});
it("only includes complete paragraphs within the budget and validates bounded read requests", () => {
  const plan = parseResearchPlan(JSON.stringify({ queries: ["nocturnal"], reads: [{ chapterId: "c15", start: 160, count: 100 }, { chapterId: "c0", start: -1, count: 2 }] }), book);
  expect(plan.reads).toEqual([{ chapterId: "c15", start: 160, count: 12 }]);
  const result = retrieveBookResearch(book, plan, undefined, 10);
  expect(result.report.truncated).toBe(true);
  expect(result.report.read).toEqual([]);
  expect(result.evidenceContext).toBe("");
  expect(() => parseResearchPlan("plain answer", book)).toThrow();
});

const longBook = {
  title: "A Synthetic 31-Chapter Research Book",
  chapters: Array.from({ length: 31 }, (_, chapter) => ({
    id: "chapter-" + chapter, title: "Research Methodology and Surprising Ideas " + chapter,
    order: chapter, role: "chapter",
    paragraphs: Array.from({ length: 100 }, (_, paragraph) =>
      `Common research material from chapter ${chapter}, paragraph ${paragraph}. ` +
      "A full paragraph about inquiry and evidence. ".repeat(8) +
      (chapter === 30 && paragraph === 72 ? " Rare late-book discovery about confirmation bias." : "")),
  })),
} as BookRecord;

it("keeps a 31-chapter overview bounded without omitting the later chapter directory", () => {
  const overview = researchOverview(longBook, undefined, 11_000);
  expect(overview.length).toBeLessThanOrEqual(11_000);
  expect(overview).toContain("chapter-0 | Research Methodology");
  expect(overview).toContain("chapter-30 | Research Methodology");
  expect(overview).not.toContain("A full paragraph about inquiry and evidence. A full para");
});

it("searches later chapters for broad full-book questions while preserving complete evidence markers", () => {
  const plan = { queries: ["Common research material"], reads: [{ chapterId: "chapter-30", start: 72, count: 2 }] };
  const result = boundedBookResearch(longBook, plan, undefined, 5_500);
  expect(result.context.length + 5_500).toBeLessThanOrEqual(BOOK_AI_INPUT_LIMIT);
  expect(result.report.indexedChapters).toBe(31);
  expect(result.report.read.some(chapter => chapter.chapterId === "chapter-30")).toBe(true);
  for (const entry of result.report.read) for (const index of entry.paragraphs) {
    const paragraph = longBook.chapters.find(chapter => chapter.id === entry.chapterId)!.paragraphs[index];
    expect(result.evidenceContext).toContain(`[${entry.chapterId}:P${index + 1}] ${paragraph}\n`);
  }
  expect(result.report.truncated).toBe(true);
});

it("does not misrepresent a partial source paragraph as verified evidence", () => {
  const unfit = {
    ...longBook,
    chapters: [{ ...longBook.chapters[30], paragraphs: ["A unique giant source " + "Z".repeat(28_000)] }],
  } as BookRecord;
  expect(() => boundedBookResearch(unfit, { queries: ["unique giant source"], reads: [] }, undefined, 1_000))
    .toThrow(/原文段落过长/);
  expect(() => boundedBookResearch(longBook, { queries: [], reads: [] }, undefined, 16_500))
    .toThrow(/历史|已有主题/);
});
