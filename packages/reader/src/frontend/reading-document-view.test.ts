import { describe, expect, it } from "vitest";
import type { BookRecord } from "../shared/book-data-contract.js";
import { bookReaderCollection, bookLessonReaderCollection, magazineReaderCollection } from "./reading-document-view.js";
import type { BookLesson } from "../shared/book-lesson.js";
import { paragraphTranslationTarget } from "./paragraph-translation-state.js";
import { readingAssistantArticleSignature, readingAssistantCacheTarget } from "./reading-assistant-cache.js";
import { readerNoteBelongsToDocument } from "./notes-state.js";
import type { ReaderIssue } from "./reader-model.js";

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
  numberedChapterCount: 1,
  parts: [{ id: "part:001:first", bookId: "book:test", order: 1, title: "First", chapterIds: ["chapter:001:one"] }],
  chapters: [{
    id: "chapter:001:one",
    bookId: "book:test",
    partId: "part:001:first",
    order: 1,
    role: "chapter",
    title: "One",
    href: "one.xhtml",
    documentPath: "one.xhtml",
    contentFingerprint: "content:one",
    headings: [{ kind: "heading", level: 2, text: "1.1 Inside" }],
    paragraphs: ["Alpha beta."],
    blocks: [{ kind: "heading", level: 2, text: "1.1 Inside" }, { kind: "paragraph", paragraphIndex: 0, text: "Alpha beta." }],
    wordCount: 2,
  }],
};

describe("ReadingDocument view", () => {
  it("projects saved lessons into the existing reader with independent learning keys and provenance", () => {
    const lesson: BookLesson = { id: "chapter:001:one", bookId: book.id, bookTitle: book.title, sourceFingerprint: book.sourceFingerprint, createdAt: "2026-10-16",
      titleZh: "精选观点", teaserZh: "一个悬念", english: "Alpha beta.\n\nA second paragraph.", explanationZh: "准确解读", keywords: ["beta"], evidence: [{ chapterId: book.chapters[0].id, paragraphIndex: 0 }], wordCount: 7, adaptation: "AI 简易英文改写，非原著引文" };
    const collection = bookLessonReaderCollection(book, [lesson]);
    const document = collection.documents[0];
    const chapter = bookReaderCollection(book).documents[0];
    expect(collection.kind).toBe("lessons");
    expect(document.paragraphs).toEqual(["Alpha beta.", "A second paragraph."]);
    expect(document.lesson?.evidence).toEqual(["One · 第 1 段"]);
    expect(document.identity.documentId).not.toBe(chapter.identity.documentId);
    expect(paragraphTranslationTarget({ document: document.identity, paragraphIndex: 0, sourceText: "Alpha beta." }).key)
      .not.toBe(paragraphTranslationTarget({ document: chapter.identity, paragraphIndex: 0, sourceText: "Alpha beta." }).key);
    expect(readerNoteBelongsToDocument({ id: "note", text: "test", createdAt: "now", document: document.identity }, chapter.identity)).toBe(false);
    expect(bookLessonReaderCollection(book, [{ ...lesson, sourceFingerprint: "old" }]).documents).toEqual([]);
    expect(bookLessonReaderCollection(book, [{ ...lesson, bookId: "other-book" }]).documents).toEqual([]);
  });
  it("projects Book chapters without manufacturing issue/article identity and preserves headings", () => {
    const documentId = "reading:book:book:test:chapter:001:one";
    const collection = bookReaderCollection(book, { [documentId]: 37 });
    expect(collection.kind).toBe("book");
    expect(collection.documents[0].identity).toEqual({ kind: "book-chapter", documentId, bookId: "book:test", chapterId: "chapter:001:one" });
    expect(collection.documents[0].blocks[0]).toEqual({ kind: "heading", level: 2, text: "1.1 Inside" });
    expect(collection.documents[0].progress).toBe(37);
  });

  it("keeps progress, notes, translation and AI cache identities when only a Book role changes", () => {
    const previous: BookRecord = { ...book, chapters: book.chapters.map((chapter) => ({ ...chapter, role: "supplement" })) };
    const documentId = "reading:book:book:test:chapter:001:one";
    const earlier = bookReaderCollection(previous, { [documentId]: 37 }).documents[0];
    const updated = bookReaderCollection(book, { [documentId]: 37 }).documents[0];
    expect(updated.identity).toEqual(earlier.identity);
    expect(updated.progress).toBe(earlier.progress);
    expect(updated.paragraphs).toEqual(earlier.paragraphs);
    expect(paragraphTranslationTarget({ document: updated.identity, paragraphIndex: 0, sourceText: updated.paragraphs[0] }).key)
      .toBe(paragraphTranslationTarget({ document: earlier.identity, paragraphIndex: 0, sourceText: earlier.paragraphs[0] }).key);
    const target = (document: typeof updated) => readingAssistantCacheTarget({
      document: document.identity, presetId: "core-idea", question: "核心观点？",
      articleSignature: readingAssistantArticleSignature(document.paragraphs),
    });
    expect(target(updated)).toEqual(target(earlier));
    expect(readerNoteBelongsToDocument({ id: "note", document: earlier.identity, text: "Note", createdAt: "2026-09-27T00:00:00.000Z" }, updated.identity)).toBe(true);
  });

  it("projects Chinese TOC titles as Reader subtitles without changing chapter identity", () => {
    const collection = bookReaderCollection(book, {}, { parts: { "part:001:first": "第一部分" }, chapters: { "chapter:001:one": "第一章" } });
    expect(collection.groups[0]).toMatchObject({ label: "Part 1 · First", labelSecondary: "第一部分" });
    expect(collection.documents[0]).toMatchObject({ title: "One", titleZh: "第一章", tocTitleZh: "第一章" });
    expect(book.chapters[0].title).toBe("One");
  });

  it("preserves Magazine title and section mappings", () => {
    const issue: ReaderIssue = {
      id: "economist:2026-09-19",
      publicationId: "economist",
      publicationName: "The Economist",
      date: "2026-09-19",
      displayDate: "2026年9月19日",
      label: "September 19, 2026",
      description: "Magazine issue",
      progress: 0,
      coverKicker: "THE ECONOMIST",
      coverMark: "E",
      coverTitle: "SEP 19",
      coverSubtitle: "",
      sections: [{
        name: "Leaders",
        nameZh: "社论",
        articles: [{
          id: "article:one",
          issueId: "economist:2026-09-19",
          author: "Author",
          section: "Leaders",
          sectionZh: "社论",
          title: "English Title",
          titleZh: "中文标题",
          subtitle: "",
          subtitleZh: "",
          summaryZh: "",
          minutes: 1,
          progress: 0,
          paragraphs: ["English paragraph."],
          wordCount: 2,
          sourceUrl: null,
        }],
      }],
    };
    const collection = magazineReaderCollection(issue);

    expect(collection.documents[0]).toMatchObject({ title: "English Title", titleZh: "中文标题" });
    expect(collection.groups[0]).toMatchObject({ label: "Leaders", labelSecondary: "社论" });
  });
});
