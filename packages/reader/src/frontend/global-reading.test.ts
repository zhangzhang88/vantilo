import { expect, it } from "vitest";
import { articleReadingDocumentIdentity, bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import { emptyReadingHistoryState, recordDocumentHistory, loadReadingHistoryState, saveReadingHistoryState, clearReadingHistory } from "./reading-history-state";
import { emptyReadLaterState, toggleDocumentReadLater, isDocumentReadLater, saveReadLaterState, loadReadLaterState } from "./read-later-state";
import { bookCardProgressPercent, resolveReadingEntry, wholeBookReadingProgress } from "./global-reading";
import { bookChapterWeights } from "../shared/book-progress";
import { loadReaderState } from "./reader-state";
import { loadLessonReaderState } from "./lesson-reader-state";
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const entries = [
  { document: articleReadingDocumentIdentity("2026-09-19", "same"), title: "Article" },
  { document: bookChapterReadingDocumentIdentity("book", "same"), title: "Chapter", sourceTitle: "Book", sourceFingerprint: "v1" },
  { document: bookLessonReadingDocumentIdentity("book", "same"), title: "Lesson", sourceTitle: "Book", sourceFingerprint: "v1" },
];
it("orders three content types by actual opening, deduplicates exact documents and persists last read independently of history clearing", () => {
  let state = emptyReadingHistoryState();
  entries.forEach((entry, index) => { state = recordDocumentHistory(state, entry, `2026-10-16T0${index}:00:00Z`); });
  expect(state.items.map((item) => item.title)).toEqual(["Lesson", "Chapter", "Article"]);
  state = recordDocumentHistory(state, entries[1], "2026-10-16T04:00:00Z");
  expect(state.items).toHaveLength(3);
  expect(state.lastRead?.title).toBe("Chapter");
  const backend = storage(); saveReadingHistoryState(backend, state);
  expect(loadReadingHistoryState(backend)).toEqual(state);
  const cleared = clearReadingHistory(state);
  saveReadingHistoryState(backend, cleared);
  expect(loadReadingHistoryState(backend).items).toEqual([]);
  expect(loadReadingHistoryState(backend).lastRead?.title).toBe("Chapter");
});
it("shares read later without merging same-id articles, chapters and lessons", () => {
  let state = emptyReadLaterState();
  entries.forEach((entry) => { state = toggleDocumentReadLater(state, entry); });
  expect(state.items).toHaveLength(3);
  expect(entries.every((entry) => isDocumentReadLater(state, entry))).toBe(true);
  state = toggleDocumentReadLater(state, entries[1]);
  expect(isDocumentReadLater(state, entries[1])).toBe(false);
  expect(isDocumentReadLater(state, entries[2])).toBe(true);
  const backend = storage(); saveReadLaterState(backend, state);
  expect(loadReadLaterState(backend)).toEqual(state);
});
it("keeps missing sources visible with their own identity and preserves separate progress maps", () => {
  const backend = storage();
  const reader = loadReaderState(backend);
  reader.bookProgress[entries[1].document.documentId] = 24;
  const lessons = loadLessonReaderState(backend);
  lessons.progress[entries[2].document.documentId] = 63;
  expect(resolveReadingEntry(entries[1], [], [], reader, lessons)).toMatchObject({ title: "Chapter", available: false, progress: 24 });
  expect(resolveReadingEntry(entries[2], [], [], reader, lessons)).toMatchObject({ title: "Lesson", available: false, progress: 63 });
});

it("weights whole-book reading progress by chapter content length instead of equal unit count", () => {
  const chapters = [
    { id: "ch:cover", paragraphs: [], wordCount: 0 },
    { id: "ch:title", paragraphs: ["Designing Your Life"], wordCount: 3 },
    { id: "ch:copyright", paragraphs: ["Copyright 2016 All rights reserved."], wordCount: 5 },
    { id: "ch:dedication", paragraphs: ["To our families."], wordCount: 3 },
    { id: "ch:01", paragraphs: ["a".repeat(25_000)], wordCount: 4_000 },
    { id: "ch:02", paragraphs: ["b".repeat(25_000)], wordCount: 4_000 },
    { id: "ch:03", paragraphs: ["c".repeat(25_000)], wordCount: 4_000 },
    { id: "ch:04", paragraphs: ["d".repeat(25_000)], wordCount: 4_000 },
  ];
  const book = {
    id: "book:designing",
    readableUnitCount: chapters.length,
    chapterWeights: bookChapterWeights(chapters),
  };

  // Finishing 4 tiny frontmatter units out of 8 total units should not report 50% (or 20%);
  // actual content read is < 0.1%, so it reports 0%.
  expect(wholeBookReadingProgress(book, {
    "reading:book:book:designing:ch:cover": 100,
    "reading:book:book:designing:ch:title": 100,
    "reading:book:book:designing:ch:copyright": 100,
    "reading:book:book:designing:ch:dedication": 100,
  })).toBe(0);

  // Finishing Chapter 1 (25,000 / ~100,061 chars) reports 25%.
  expect(wholeBookReadingProgress(book, {
    "reading:book:book:designing:ch:dedication": 100,
    "reading:book:book:designing:ch:01": 100,
  })).toBe(25);

  // Never rounds up to 100% while a chapter still has unread content.
  expect(wholeBookReadingProgress(book, {
    "reading:book:book:designing:ch:title": 100,
    "reading:book:book:designing:ch:copyright": 100,
    "reading:book:book:designing:ch:dedication": 100,
    "reading:book:book:designing:ch:01": 100,
    "reading:book:book:designing:ch:02": 100,
    "reading:book:book:designing:ch:03": 100,
    "reading:book:book:designing:ch:04": 99,
  })).toBe(99);

  // Reports 100% once all positive-weight chapters reach 100% (even if an empty cover wasn't opened).
  expect(wholeBookReadingProgress(book, {
    "reading:book:book:designing:ch:title": 100,
    "reading:book:book:designing:ch:copyright": 100,
    "reading:book:book:designing:ch:dedication": 100,
    "reading:book:book:designing:ch:01": 100,
    "reading:book:book:designing:ch:02": 100,
    "reading:book:book:designing:ch:03": 100,
    "reading:book:book:designing:ch:04": 100,
  })).toBe(100);
});

it("computes character weights accurately for Chinese books where Latin wordCount is zero", () => {
  const chapters = [
    { id: "ch:preface", paragraphs: ["序言简短介绍。"], wordCount: 0 },
    { id: "ch:01", paragraphs: ["字".repeat(10_000)], wordCount: 0 },
    { id: "ch:02", paragraphs: ["词".repeat(10_000)], wordCount: 0 },
  ];
  const book = {
    id: "book:zh",
    readableUnitCount: chapters.length,
    chapterWeights: bookChapterWeights(chapters),
  };
  expect(wholeBookReadingProgress(book, { "reading:book:book:zh:ch:preface": 100 })).toBe(0);
  expect(wholeBookReadingProgress(book, {
    "reading:book:book:zh:ch:preface": 100,
    "reading:book:book:zh:ch:01": 100,
  })).toBe(50);
});

it("computes position-based whole-book progress from the active chapter even if later chapters were peeked earlier", () => {
  const chapters = [
    { id: "ch:intro", order: 1, paragraphs: ["导论".repeat(300)], wordCount: 0 },
    { id: "ch:01", order: 2, paragraphs: ["一".repeat(4_000)], wordCount: 0 },
    { id: "ch:02", order: 3, paragraphs: ["二".repeat(5_000)], wordCount: 0 },
    { id: "ch:03", order: 4, paragraphs: ["三".repeat(4_000)], wordCount: 0 },
    { id: "ch:04", order: 5, paragraphs: ["四".repeat(86_400)], wordCount: 0 },
  ];
  const book = {
    id: "book:beyond-zh",
    readableUnitCount: chapters.length,
    chapterWeights: bookChapterWeights(chapters),
  };
  const pollutedProgress = {
    "reading:book:book:beyond-zh:ch:intro": 100,
    "reading:book:book:beyond-zh:ch:01": 100,
    "reading:book:book:beyond-zh:ch:02": 100,
    "reading:book:book:beyond-zh:ch:03": 25,
    // Suppose a later chapter was previously opened/peeking at 100%.
    "reading:book:book:beyond-zh:ch:04": 100,
  };
  // At 25% into Chapter 3: (600 + 4000 + 5000 + 1000) / 100000 = 10.6% -> 11% (never inflated by ch:04!).
  expect(wholeBookReadingProgress(book, pollutedProgress, { chapterId: "ch:03", progress: 25 })).toBe(11);
  // On the last chapter at 100%: 100%.
  expect(wholeBookReadingProgress(book, pollutedProgress, { chapterId: "ch:04", progress: 100 })).toBe(100);
  // On the last chapter at 99%: capped at 99%.
  expect(wholeBookReadingProgress(book, pollutedProgress, { chapterId: "ch:04", progress: 99 })).toBe(99);
});

it("resolves bookshelf card progress from live audiobook, most recent listening, or reading position", () => {
  const chapters = [
    { id: "ch:01", order: 1, paragraphs: ["一".repeat(1_000)], wordCount: 0 },
    { id: "ch:02", order: 2, paragraphs: ["二".repeat(9_000)], wordCount: 0 },
  ];
  const book = {
    id: "book:card-progress",
    readableUnitCount: chapters.length,
    chapterWeights: bookChapterWeights(chapters),
  };
  // Active audiobook live percent takes precedence.
  expect(bookCardProgressPercent({
    book,
    chapterProgress: {},
    reading: { chapterId: "ch:01", progress: 50, updatedAt: 200 },
    listening: { chapterId: "ch:01", completed: false, updatedAt: 100 },
    activeAudiobookProgress: 9,
  })).toBe(9);
  // Newer listening position wins over older reading position.
  expect(bookCardProgressPercent({
    book,
    chapterProgress: { "reading:book:book:card-progress:ch:01": 100 },
    reading: { chapterId: "ch:01", progress: 100, updatedAt: 100 },
    listening: { chapterId: "ch:02", completed: false, updatedAt: 200 },
  })).toBe(10);
  // Newer reading position wins over older listening position.
  expect(bookCardProgressPercent({
    book,
    chapterProgress: { "reading:book:book:card-progress:ch:02": 50 },
    reading: { chapterId: "ch:02", progress: 50, updatedAt: 300 },
    listening: { chapterId: "ch:01", completed: false, updatedAt: 200 },
  })).toBe(55);
  // Unopened book reports 0%.
  expect(bookCardProgressPercent({ book, chapterProgress: {} })).toBe(0);
});
