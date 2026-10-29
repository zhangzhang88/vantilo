import { expect, it } from "vitest";
import { filterBookShelf } from "./book-shelf-filter";
import { book as source } from "../../tests/fixtures/table-book";
import type { BookSummary } from "../shared/book-data-contract";
const books: BookSummary[] = [
  { ...source, id: "book:one", title: "Blueprint", hasCover: false, partCount: 0, readableUnitCount: 1, categoryId: "psychology" },
  { ...source, id: "book:two", title: "经济学入门", hasCover: false, partCount: 0, readableUnitCount: 1, categoryId: "economics" },
  { ...source, id: "book:three", title: "A New Book", hasCover: false, partCount: 0, readableUnitCount: 1 },
];
it("finds partial titles with spaces, Chinese, case and full-width input", () => {
  expect(filterBookShelf(books, { query: "  ＢＬＵＥ  ", categoryId: "all" }).map(book => book.id)).toEqual(["book:one"]);
  expect(filterBookShelf(books, { query: "经济", categoryId: "all" }).map(book => book.id)).toEqual(["book:two"]);
});
it("intersects title and category without changing library order or input", () => {
  expect(filterBookShelf(books, { query: "Blue", categoryId: "economics" })).toEqual([]);
  expect(filterBookShelf(books, { query: "", categoryId: "psychology" })).toEqual([books[0]]);
  expect(books.map(book => book.id)).toEqual(["book:one", "book:two", "book:three"]);
});
it("treats old records as uncategorized and clears back to all books", () => {
  expect(filterBookShelf(books, { query: "", categoryId: "uncategorized" })).toEqual([books[2]]);
  expect(filterBookShelf(books, { query: " ", categoryId: "all" })).toEqual(books);
});
