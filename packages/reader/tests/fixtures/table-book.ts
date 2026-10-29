import type { BookRecord } from "../../src/shared/book-data-contract.js";

/** Synthetic, original record used only by automated Reader tests. */
export const tableBook: BookRecord = {
  schemaVersion: 1, kind: "book", id: "book:test-fixture", sourceFilename: "synthetic-table-book.epub",
  sourceFingerprint: "sha256:synthetic-test-fixture", title: "Synthetic Table Book", authors: ["Test Author"],
  language: "en", publisher: null, publishedAt: null, identifiers: [], epubVersion: "3.0", navigationType: "nav",
  cover: null, numberedChapterCount: 1, parts: [], chapters: [{
    id: "chapter:test-fixture", bookId: "book:test-fixture", partId: null, order: 0, role: "chapter",
    title: "1 Synthetic Chapter", href: "Text/chapter.xhtml", documentPath: "OEBPS/Text/chapter.xhtml",
    contentFingerprint: "sha256:synthetic-chapter", headings: [{ kind: "heading", level: 1, text: "1 Synthetic Chapter" }],
    paragraphs: ["Synthetic text for a table rendering test."],
    blocks: [{ kind: "heading", level: 1, text: "1 Synthetic Chapter" }, { kind: "paragraph", paragraphIndex: 0, text: "Synthetic text for a table rendering test." }],
    wordCount: 7,
  }],
};
export default tableBook;
