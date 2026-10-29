import { describe, expect, it } from "vitest";
import type { BookRecord } from "../shared/book-data-contract.js";
import { buildBookTocGroups, resolveBookContinueChapter } from "./book-library.js";

function chapter(id: string, order: number, role: BookRecord["chapters"][number]["role"], title: string, partId: string | null) {
  return {
    id,
    bookId: "book:test",
    partId,
    order,
    role,
    title,
    href: `${id}.xhtml`,
    documentPath: `${id}.xhtml`,
    contentFingerprint: `content:${id}`,
    headings: [],
    paragraphs: [`${title} paragraph`],
    blocks: [{ kind: "paragraph" as const, paragraphIndex: 0, text: `${title} paragraph` }],
    wordCount: 2,
  };
}

describe("Book Library TOC", () => {
  it("preserves reading order across front matter, Parts, supplements and back matter", () => {
    const book: BookRecord = {
      schemaVersion: 1,
      kind: "book",
      id: "book:test",
      sourceFilename: "book.epub",
      sourceFingerprint: "sha256:test",
      title: "Test Book",
      authors: ["Author"],
      language: "en",
      publisher: "Press",
      publishedAt: null,
      identifiers: [],
      epubVersion: "2.0",
      navigationType: "ncx",
      cover: null,
      numberedChapterCount: 2,
      parts: [{ id: "part:001:one", bookId: "book:test", order: 1, title: "I One", chapterIds: ["c2", "c3"] }],
      chapters: [
        chapter("c1", 1, "frontmatter", "Preface", null),
        chapter("c2", 2, "chapter", "1 First", "part:001:one"),
        chapter("c3", 3, "supplement", "Interlude", "part:001:one"),
        chapter("c4", 4, "backmatter", "Index", null),
      ],
    };

    const groups = buildBookTocGroups(book);
    expect(resolveBookContinueChapter(book, { bookId: book.id, chapterId: "c3", documentId: "reading:book:book:test:c3" }, { "reading:book:book:test:c2": 30 })?.id).toBe("c3");
    expect(resolveBookContinueChapter(book, { bookId: "other", chapterId: "c3", documentId: "reading:book:other:c3" }, { "reading:book:book:test:c2": 30 })?.id).toBe("c2");
    expect(resolveBookContinueChapter(book, null, {})).toBeUndefined();

    expect(groups.map((group) => [group.kind, group.title])).toEqual([
      ["frontmatter", "前置内容"],
      ["part", "I One"],
      ["backmatter", "后置内容"],
    ]);
    expect(groups.flatMap((group) => group.chapters.map((item) => item.id))).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("groups a book with no Parts under the chapter role without changing order", () => {
    const book = {
      schemaVersion: 1,
      kind: "book",
      id: "book:no-parts",
      sourceFilename: "book.epub",
      sourceFingerprint: "sha256:test",
      title: "No Parts",
      authors: [],
      language: "en",
      publisher: null,
      publishedAt: null,
      identifiers: [],
      epubVersion: "3.0",
      navigationType: "nav",
      cover: null,
      numberedChapterCount: 2,
      parts: [],
      chapters: [
        chapter("c1", 1, "chapter", "1 First", null),
        chapter("c2", 2, "chapter", "2 Second", null),
      ],
    } satisfies BookRecord;

    const groups = buildBookTocGroups(book);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("章节");
    expect(groups[0].chapters.map((item) => item.title)).toEqual(["1 First", "2 Second"]);
  });
});
