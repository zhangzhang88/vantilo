import { expect, it } from "vitest";
import { articleReadingDocumentIdentity, bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import { emptyReadingHistoryState, recordDocumentHistory, loadReadingHistoryState, saveReadingHistoryState, clearReadingHistory } from "./reading-history-state";
import { emptyReadLaterState, toggleDocumentReadLater, isDocumentReadLater, saveReadLaterState, loadReadLaterState } from "./read-later-state";
import { resolveReadingEntry } from "./global-reading";
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
