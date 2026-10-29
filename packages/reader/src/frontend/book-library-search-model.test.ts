import { expect, it } from "vitest";
import { searchBookDocuments, type BookSearchDocument } from "./book-library-search-model";
import { bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
const documents: BookSearchDocument[] = [
  { document: bookChapterReadingDocumentIdentity("b", "c"), title: "Original chapter", sourceTitle: "Book", paragraphs: ["A unique research finding."], category: "电子书" },
  { document: bookLessonReadingDocumentIdentity("b", "l"), title: "精选题目", sourceTitle: "Book", paragraphs: ["中文解释。", "A simple research lesson."], category: "精选阅读" },
];
it("searches original chapters and adapted lessons with separate source identities", () => {
  expect(searchBookDocuments(documents, "RESEARCH")).toHaveLength(2);
  expect(searchBookDocuments(documents, "research", "books")[0].document.kind).toBe("book-chapter");
  expect(searchBookDocuments(documents, "research", "lessons")[0].document.kind).toBe("book-lesson");
  expect(searchBookDocuments(documents, "中文")[0].category).toBe("精选阅读");
  expect(searchBookDocuments(documents, "   ")).toEqual([]);
});
