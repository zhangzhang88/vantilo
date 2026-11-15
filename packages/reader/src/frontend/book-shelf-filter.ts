import type { BookSummary } from "../shared/book-data-contract";
import type { BookCategoryId } from "../shared/book-category";
import { classifyBookLanguage, isBookLanguage, type BookLanguage } from "../shared/book-language";

export type BookShelfLanguage = "all" | "zh" | "en";
export interface BookShelfView { query: string; categoryId: BookCategoryId | "all"; language?: BookShelfLanguage; }
export type BookLanguageOverrides = Record<string, BookLanguage>;

const languageFilterKey = "vantilo-book-shelf-language-v1";
const languageOverridesKey = "vantilo-book-language-overrides-v1";

export function loadBookShelfLanguage(storage: Pick<Storage, "getItem">): BookShelfLanguage {
  try {
    const value = storage.getItem(languageFilterKey);
    return value === "zh" || value === "en" ? value : "all";
  } catch { return "all"; }
}

export function saveBookShelfLanguage(storage: Pick<Storage, "setItem">, language: BookShelfLanguage) {
  storage.setItem(languageFilterKey, language);
}

export function loadBookLanguageOverrides(storage: Pick<Storage, "getItem">): BookLanguageOverrides {
  try {
    const stored = JSON.parse(storage.getItem(languageOverridesKey) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, BookLanguage] => isBookLanguage(entry[1])));
  } catch { return {}; }
}

export function saveBookLanguageOverrides(storage: Pick<Storage, "setItem">, overrides: BookLanguageOverrides) {
  storage.setItem(languageOverridesKey, JSON.stringify(overrides));
}

export function shelfBookLanguage(book: Pick<BookSummary, "language" | "readingLanguage">): BookLanguage {
  return book.readingLanguage ?? classifyBookLanguage(book);
}

export function filterBookShelf(books: BookSummary[], view: BookShelfView): BookSummary[] {
  const query = view.query.normalize("NFKC").trim().toLocaleLowerCase();
  return books.filter(book => (!view.language || view.language === "all" || shelfBookLanguage(book) === view.language)
    && (view.categoryId === "all" || (book.categoryId ?? "uncategorized") === view.categoryId)
    && (!query || book.title.normalize("NFKC").toLocaleLowerCase().includes(query)));
}
