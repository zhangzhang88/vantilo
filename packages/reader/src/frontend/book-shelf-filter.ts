import type { BookSummary } from "../shared/book-data-contract";
import type { BookCategoryId } from "../shared/book-category";

export interface BookShelfView { query: string; categoryId: BookCategoryId | "all"; }
export function filterBookShelf(books: BookSummary[], view: BookShelfView): BookSummary[] {
  const query = view.query.normalize("NFKC").trim().toLocaleLowerCase();
  return books.filter(book => (view.categoryId === "all" || (book.categoryId ?? "uncategorized") === view.categoryId)
    && (!query || book.title.normalize("NFKC").toLocaleLowerCase().includes(query)));
}
