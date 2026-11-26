import { describe, expect, it } from "vitest";
import {
  clampPageIndex,
  computePaginationMetrics,
  computeWholeBookPagePosition,
  estimateDocumentPaginationWeight,
  estimateSpreadWeightCapacity,
  pageIndexForOffset,
} from "./reader-pagination";

describe("reader pagination math", () => {
  it("disables pagination in scroll mode", () => {
    const metrics = computePaginationMetrics("scroll", 1000, 3000);
    expect(metrics.active).toBe(false);
    expect(metrics.totalPages).toBe(1);
  });

  it("computes single-page columns and exact spread count", () => {
    const metrics = computePaginationMetrics("single", 680, 680 * 3 + 40 * 2);
    expect(metrics.active).toBe(true);
    expect(metrics.columnsPerSpread).toBe(1);
    expect(metrics.columnWidth).toBe(680);
    expect(metrics.stride).toBe(720);
    expect(metrics.totalPages).toBe(3);
  });

  it("uses 2 columns per spread in double mode on desktop widths and falls back to 1 column when very narrow", () => {
    const wide = computePaginationMetrics("double", 900, 900 * 2 + 56);
    expect(wide.active).toBe(true);
    expect(wide.columnsPerSpread).toBe(2);
    expect(wide.columnGap).toBe(56);
    expect(wide.columnWidth).toBe(Math.floor((900 - 56 - 2) / 2));
    expect(wide.stride).toBe(956);
    expect(wide.totalPages).toBe(2);

    const narrow = computePaginationMetrics("double", 500, 1400);
    expect(narrow.active).toBe(true);
    expect(narrow.columnsPerSpread).toBe(1);
  });

  it("maps horizontal offsets to clamped page indices", () => {
    expect(pageIndexForOffset(0, 956, 4)).toBe(0);
    expect(pageIndexForOffset(956, 956, 4)).toBe(1);
    expect(pageIndexForOffset(1950, 956, 4)).toBe(2);
    expect(pageIndexForOffset(9999, 956, 4)).toBe(3);
    expect(clampPageIndex(-2, 4)).toBe(0);
    expect(clampPageIndex(10, 4)).toBe(3);
  });

  it("estimates document layout weight for Chinese, English, visuals, and wordCount fallback", () => {
    const zhWeight = estimateDocumentPaginationWeight({
      paragraphs: ["人工智能不会取代繁杂劳动。".repeat(20)],
    });
    const enWeight = estimateDocumentPaginationWeight({
      paragraphs: ["Artificial intelligence reshapes work. ".repeat(20)],
    });
    const visualWeight = estimateDocumentPaginationWeight({
      paragraphs: ["短段落"],
      visuals: [{ id: "img-1" }],
      tables: [{ id: "tbl-1" }],
    });
    const fallbackWeight = estimateDocumentPaginationWeight({ wordCount: 500 });

    expect(zhWeight).toBeGreaterThan(300);
    expect(enWeight).toBeGreaterThan(300);
    expect(visualWeight).toBeGreaterThan(600);
    expect(fallbackWeight).toBeGreaterThan(1500);
  });

  it("computes spread capacity from typography and spread columns", () => {
    const singleStandard = estimateSpreadWeightCapacity({
      columnWidth: 680,
      viewportHeight: 680,
      columnsPerSpread: 1,
      fontSize: 19,
      lineHeight: "standard",
    });
    const singleRelaxed = estimateSpreadWeightCapacity({
      columnWidth: 680,
      viewportHeight: 680,
      columnsPerSpread: 1,
      fontSize: 19,
      lineHeight: "relaxed",
    });
    const doubleStandard = estimateSpreadWeightCapacity({
      columnWidth: 420,
      viewportHeight: 680,
      columnsPerSpread: 2,
      fontSize: 19,
      lineHeight: "standard",
    });

    expect(singleStandard).toBeGreaterThan(singleRelaxed);
    expect(doubleStandard).toBeGreaterThan(singleStandard);
  });

  it("computes whole-book continuous page numbers using exact current/measured chapters and estimated unread chapters", () => {
    const chapters = [
      { id: "preface", weight: 700 },
      { id: "ch1", weight: 9800 },
      { id: "ch2", weight: 7000 },
    ];
    // Spread capacity = 700 => preface est 1 page, ch1 actual 14 pages, ch2 est 10 pages => total 25 pages
    const page1 = computeWholeBookPagePosition({
      chapters,
      currentChapterId: "ch1",
      currentChapterPage: 0,
      currentChapterTotalPages: 14,
      spreadCapacity: 700,
    });
    const page4 = computeWholeBookPagePosition({
      chapters,
      currentChapterId: "ch1",
      currentChapterPage: 3,
      currentChapterTotalPages: 14,
      spreadCapacity: 700,
    });
    expect(page1).toEqual({ currentPage: 2, totalPages: 25, pagesBeforeCurrent: 1 });
    expect(page4).toEqual({ currentPage: 5, totalPages: 25, pagesBeforeCurrent: 1 });

    // When moving into ch2 with cached exact measurement for preface (2 pages) and ch1 (14 pages)
    const ch2First = computeWholeBookPagePosition({
      chapters,
      currentChapterId: "ch2",
      currentChapterPage: 0,
      currentChapterTotalPages: 11,
      spreadCapacity: 700,
      measuredPagesByChapterId: new Map([["preface", 2], ["ch1", 14]]),
    });
    expect(ch2First).toEqual({ currentPage: 17, totalPages: 27, pagesBeforeCurrent: 16 });

    // Single-chapter article falls back directly to chapter-local pagination
    expect(computeWholeBookPagePosition({
      chapters: [{ id: "only", weight: 2000 }],
      currentChapterId: "only",
      currentChapterPage: 2,
      currentChapterTotalPages: 6,
      spreadCapacity: 700,
    })).toEqual({ currentPage: 3, totalPages: 6, pagesBeforeCurrent: 0 });
  });
});
