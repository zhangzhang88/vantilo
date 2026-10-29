import { expect, it } from "vitest";
import type { BookRecord } from "../../shared/book-data-contract.js";
import { parseResearchPlan, researchOverview, retrieveBookResearch } from "./book-research.js";
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
