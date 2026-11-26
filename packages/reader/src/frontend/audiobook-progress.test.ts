import { describe, expect, it } from "vitest";
import { isAudiobookSnapshot, type AudiobookSnapshot } from "../shared/audiobook-bridge";
import { buildAudiobookBookMetrics, calculateAudiobookProgress, shouldFollowAudiobookChapter } from "./audiobook-progress";

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

describe("audiobook whole-book progress", () => {
  it("weights progress by narratable character count across chapters of uneven length", () => {
    const ch1 = { id: "ch1", paragraphs: [repeat("甲", 100), repeat("乙", 100)], playable: [0, 1] };
    const ch2 = { id: "ch2", paragraphs: [repeat("丙", 400), repeat("丁", 400)], playable: [0, 1] };
    const metrics = buildAudiobookBookMetrics([ch1, ch2], [ch1, ch2]);

    // Total weight = 1000.
    expect(calculateAudiobookProgress(metrics, "ch1", 0, "playing")).toBe(0);
    expect(calculateAudiobookProgress(metrics, "ch1", 1, "playing")).toBe(10);
    // Chapter 1 complete equals Chapter 2 paragraph 0 (no jump across chapter boundary).
    expect(calculateAudiobookProgress(metrics, "ch1", 1, "complete")).toBe(20);
    expect(calculateAudiobookProgress(metrics, "ch2", 0, "loading")).toBe(20);
    expect(calculateAudiobookProgress(metrics, "ch2", 1, "playing")).toBe(60);
    // Only completing the last chapter reaches 100%.
    expect(calculateAudiobookProgress(metrics, "ch2", 1, "complete")).toBe(100);
  });

  it("caps progress at 99% while the final paragraph is still playing", () => {
    const ch1 = { id: "ch1", paragraphs: [repeat("a", 995), repeat("b", 5)], playable: [0, 1] };
    const metrics = buildAudiobookBookMetrics([ch1], [ch1]);

    expect(calculateAudiobookProgress(metrics, "ch1", 1, "playing")).toBe(99);
    expect(calculateAudiobookProgress(metrics, "ch1", 1, "paused")).toBe(99);
    expect(calculateAudiobookProgress(metrics, "ch1", 1, "complete")).toBe(100);
  });

  it("excludes frontmatter chapters from total weight and reports 0% while listening to frontmatter", () => {
    const cover = { id: "cover", paragraphs: [repeat("封", 300)], playable: [0] };
    const ch1 = { id: "ch1", paragraphs: [repeat("正", 200)], playable: [0] };
    const ch2 = { id: "ch2", paragraphs: [repeat("文", 800)], playable: [0] };
    const metrics = buildAudiobookBookMetrics([cover, ch1, ch2], [ch1, ch2]);

    expect(calculateAudiobookProgress(metrics, "cover", 0, "playing")).toBe(0);
    expect(calculateAudiobookProgress(metrics, "cover", 0, "complete")).toBe(0);
    expect(calculateAudiobookProgress(metrics, "ch1", 0, "playing")).toBe(0);
    expect(calculateAudiobookProgress(metrics, "ch2", 0, "playing")).toBe(20);
    expect(calculateAudiobookProgress(metrics, "ch2", 0, "complete")).toBe(100);
  });

  it("handles skipped non-playable paragraphs and returns undefined for empty books", () => {
    const ch1 = { id: "ch1", paragraphs: ["", repeat("a", 50), "   ", repeat("b", 50)], playable: [1, 3] };
    const metrics = buildAudiobookBookMetrics([ch1], [ch1]);

    expect(calculateAudiobookProgress(metrics, "ch1", 0, "playing")).toBe(0);
    expect(calculateAudiobookProgress(metrics, "ch1", 2, "playing")).toBe(50);
    expect(calculateAudiobookProgress(metrics, "ch1", 3, "playing")).toBe(50);

    const empty = buildAudiobookBookMetrics([], []);
    expect(calculateAudiobookProgress(empty, "", 0, "error")).toBeUndefined();
    expect(calculateAudiobookProgress(metrics, "missing", 0, "playing")).toBeUndefined();
  });
});

describe("isAudiobookSnapshot progress fields", () => {
  const base: AudiobookSnapshot = {
    sessionId: 1,
    mode: "original",
    sourceId: "book:1",
    title: "示例书",
    chapterId: "ch1",
    chapters: [{ id: "ch1", title: "第一章" }],
    phase: "playing",
    error: "",
    rate: 1,
    voice: "serena",
    paragraphIndex: 0,
    paragraphNumber: 1,
    paragraphCount: 5,
    sleepMinutes: 0,
  };

  it("accepts valid optional progressPercent and progressScope", () => {
    expect(isAudiobookSnapshot(base)).toBe(true);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 0, progressScope: "book" })).toBe(true);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 18, progressScope: "book" })).toBe(true);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 100, progressScope: "article" })).toBe(true);
  });

  it("rejects out-of-range, non-integer, or malformed progress metadata", () => {
    expect(isAudiobookSnapshot({ ...base, progressPercent: -1, progressScope: "book" })).toBe(false);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 101, progressScope: "book" })).toBe(false);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 18.5, progressScope: "book" })).toBe(false);
    expect(isAudiobookSnapshot({ ...base, progressPercent: 18, progressScope: "chapter" })).toBe(false);
    expect(isAudiobookSnapshot({ ...base, progressScope: "book" })).toBe(false);
  });

  it("auto-follows audiobook chapter transitions only when viewing the chapter that just advanced", () => {
    const previous = { sessionId: 3, bookId: "book:beyond", chapterId: "ch1" };
    // Chapter 1 finishes and audio advances to Chapter 2 while user is reading Chapter 1 -> auto-follow!
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch2", phase: "loading" },
      page: "book-reader",
      viewedBookId: "book:beyond",
      viewedChapterId: "ch1",
    })).toBe(true);

    // User manually browsed ahead to Chapter 5 while Chapter 1 was playing -> do NOT yank away.
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch2", phase: "playing" },
      page: "book-reader",
      viewedBookId: "book:beyond",
      viewedChapterId: "ch5",
    })).toBe(false);

    // User is on bookshelf or another book -> do NOT hijack navigation.
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch2", phase: "playing" },
      page: "books",
      viewedBookId: "book:beyond",
      viewedChapterId: "ch1",
    })).toBe(false);
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch2", phase: "playing" },
      page: "book-reader",
      viewedBookId: "book:other",
      viewedChapterId: "ch1",
    })).toBe(false);

    // Error state or same chapter -> do NOT transition.
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch2", phase: "error" },
      page: "book-reader",
      viewedBookId: "book:beyond",
      viewedChapterId: "ch1",
    })).toBe(false);
    expect(shouldFollowAudiobookChapter({
      previous,
      current: { sessionId: 3, bookId: "book:beyond", chapterId: "ch1", phase: "playing" },
      page: "book-reader",
      viewedBookId: "book:beyond",
      viewedChapterId: "ch1",
    })).toBe(false);
  });
});
