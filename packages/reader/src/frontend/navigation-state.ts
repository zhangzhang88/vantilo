import type { PublicationId } from "../shared/types";

export type Page = "library" | "publication" | "issue" | "reader" | "books" | "articles" | "book" | "book-reader" | "lesson-reader" | "search" | "bookmarks" | "history" | "notes" | "vocabulary" | "review" | "settings";
export interface NavigationState {
  page: Page;
  publicationId: PublicationId;
  issueId: string;
  articleId: string;
  bookId: string;
  chapterId: string;
  lessonId: string;
}
export const NAVIGATION_KEY = "magazine-reader-navigation-v1";
const pages: Page[] = ["library", "publication", "issue", "reader", "books", "articles", "book", "book-reader", "lesson-reader", "search", "bookmarks", "history", "notes", "vocabulary", "review", "settings"];
const fallback: NavigationState = { page: "library", publicationId: "economist", issueId: "", articleId: "", bookId: "", chapterId: "", lessonId: "" };
export function loadNavigation(storage?: Pick<Storage, "getItem">): NavigationState {
  try {
    const value = JSON.parse(storage?.getItem(NAVIGATION_KEY) ?? "null");
    if (!value || !pages.includes(value.page)) return { ...fallback };
    const result = { ...fallback, page: value.page as Page };
    for (const key of ["issueId", "articleId", "bookId", "chapterId", "lessonId"] as const) {
      if (typeof value[key] === "string" && value[key].length <= 1000) result[key] = value[key];
    }
    if (["economist", "new-yorker", "atlantic", "wired"].includes(value.publicationId)) result.publicationId = value.publicationId;
    if (["book", "book-reader", "lesson-reader"].includes(result.page) && !result.bookId) result.page = "books";
    if (result.page === "book-reader" && !result.chapterId || result.page === "lesson-reader" && !result.lessonId) result.page = "book";
    if (["issue", "reader"].includes(result.page) && !result.issueId) result.page = "library";
    return result;
  } catch { return { ...fallback }; }
}
export function getNavigationStorage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
export function saveNavigation(state: NavigationState, storage = getNavigationStorage()): void {
  try { storage?.setItem(NAVIGATION_KEY, JSON.stringify(state)); } catch { /* Navigation still works if browser storage is disabled. */ }
}


export interface ReaderViewState { mode: "article" | "sentence"; sentenceIndex: number; language?: "english" | "chinese"; }
const viewKey = (documentId: string) => "magazine-reader-view-v1:" + documentId;
export function loadReaderView(documentId: string, storage = getNavigationStorage()): ReaderViewState | undefined {
  try {
    const value = JSON.parse(storage?.getItem(viewKey(documentId)) ?? "null");
    if (value && ["article", "sentence"].includes(value.mode) && Number.isInteger(value.sentenceIndex) && value.sentenceIndex >= 0) return { mode: value.mode, sentenceIndex: value.sentenceIndex, ...(["english", "chinese"].includes(value.language) ? { language: value.language } : {}) };
  } catch { /* A malformed or unavailable session must not block reading. */ }
  return undefined;
}
export function saveReaderView(documentId: string, view: ReaderViewState, storage = getNavigationStorage()): void {
  try { storage?.setItem(viewKey(documentId), JSON.stringify(view)); } catch { /* Reading still works without session storage. */ }
}

export type BookDetailTab = "lessons" | "chapters";
const bookTabKey = (bookId: string) => "magazine-reader-book-tab-v1:" + bookId;
export function loadBookDetailTab(bookId: string, storage: Pick<Storage, "getItem"> | undefined = getNavigationStorage()): BookDetailTab | undefined {
  try {
    const value = storage?.getItem(bookTabKey(bookId));
    return value === "lessons" || value === "chapters" ? value : undefined;
  } catch { return undefined; }
}
export function saveBookDetailTab(bookId: string, tab: BookDetailTab, storage: Pick<Storage, "setItem"> | undefined = getNavigationStorage()): void {
  try { storage?.setItem(bookTabKey(bookId), tab); } catch { /* The tab still works when storage is unavailable. */ }
}
