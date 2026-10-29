import { expect, it } from "vitest";
import { loadNavigation, saveNavigation, NAVIGATION_KEY, loadReaderView, saveReaderView, loadBookDetailTab, saveBookDetailTab } from "./navigation-state";
const storage = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } } as Storage;
};
it("roundtrips pages and exact book/lesson identifiers within one session", () => {
  const backend = storage();
  const state = { ...loadNavigation(), page: "lesson-reader" as const, bookId: "book:test", lessonId: "lesson:test" };
  saveNavigation(state, backend);
  expect(loadNavigation(backend)).toEqual(state);
  expect(loadNavigation(storage()).page).toBe("library");
});
it("falls back for corrupt storage, unknown routes and missing identifiers", () => {
  const backend = storage();
  for (const raw of ["{", "null", '{"page":"evil"}']) {
    backend.setItem(NAVIGATION_KEY, raw); expect(loadNavigation(backend).page).toBe("library");
  }
  for (const [value, page] of [[{ page: "lesson-reader" }, "books"], [{ page: "book-reader", bookId: "b" }, "book"], [{ page: "reader" }, "library"]] as const) {
    backend.setItem(NAVIGATION_KEY, JSON.stringify(value)); expect(loadNavigation(backend).page).toBe(page);
  }
  expect(loadNavigation({ getItem: () => { throw new Error("blocked"); } }).page).toBe("library");
  expect(() => saveNavigation(loadNavigation(), { setItem: () => { throw new Error("blocked"); } } as unknown as Storage)).not.toThrow();
});
it("isolates reader modes and sentence indexes by document and validates corrupt values", () => {
  const backend = storage();
  saveReaderView("lesson:a", { mode: "sentence", sentenceIndex: 4 }, backend);
  expect(loadReaderView("lesson:a", backend)).toEqual({ mode: "sentence", sentenceIndex: 4 });
  expect(loadReaderView("chapter:a", backend)).toBeUndefined();
  saveReaderView("book:chinese", { mode: "article", sentenceIndex: 3, language: "chinese" }, backend);
  expect(loadReaderView("book:chinese", backend)).toEqual({ mode: "article", sentenceIndex: 3, language: "chinese" });
  backend.setItem("magazine-reader-view-v1:lesson:a", '{"mode":"sentence","sentenceIndex":-2}');
  expect(loadReaderView("lesson:a", backend)).toBeUndefined();
});

it("remembers each book's selected content tab without changing reading positions", () => {
  const backend = storage();
  saveReaderView("chapter:a", { mode: "sentence", sentenceIndex: 7 }, backend);
  saveBookDetailTab("book:a", "chapters", backend);
  saveBookDetailTab("book:b", "lessons", backend);
  expect(loadBookDetailTab("book:a", backend)).toBe("chapters");
  expect(loadBookDetailTab("book:b", backend)).toBe("lessons");
  expect(loadBookDetailTab("book:c", backend)).toBeUndefined();
  expect(loadReaderView("chapter:a", backend)).toEqual({ mode: "sentence", sentenceIndex: 7 });
  backend.setItem("magazine-reader-book-tab-v1:book:a", "invalid");
  expect(loadBookDetailTab("book:a", backend)).toBeUndefined();
  expect(loadBookDetailTab("book:a", { getItem: () => { throw new Error("blocked"); } })).toBeUndefined();
  expect(() => saveBookDetailTab("book:a", "lessons", { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
});
