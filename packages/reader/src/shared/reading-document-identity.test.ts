import { describe, expect, it } from "vitest";
import {
  articleReadingDocumentIdentity,
  bookChapterReadingDocumentIdentity,
  bookLessonReadingDocumentIdentity,
  readingDocumentIdentityFromLegacyFields,
  sameReadingDocument,
} from "./reading-document-identity.js";

describe("ReadingDocument identity", () => {
  it("keeps lessons separate from both original chapters and legacy articles", () => {
    const lesson = bookLessonReadingDocumentIdentity("book:test", "same-id");
    expect(lesson.documentId).toBe("reading:lesson:book:test:same-id");
    expect(readingDocumentIdentityFromLegacyFields({ document: lesson })).toEqual(lesson);
    expect(sameReadingDocument(lesson, bookChapterReadingDocumentIdentity("book:test", "same-id"))).toBe(false);
    expect(readingDocumentIdentityFromLegacyFields({ document: { kind: "book-lesson", bookId: "book:test", lessonId: "" } })).toBeNull();
  });
  it("keeps canonical Magazine identity compatible with legacy issue/article fields", () => {
    const identity = articleReadingDocumentIdentity("2026-09-19", "article-1");
    expect(identity).toEqual({
      kind: "article",
      documentId: "reading:article:economist:2026-09-19:article-1",
      issueId: "economist:2026-09-19",
      articleId: "article-1",
    });
    expect(readingDocumentIdentityFromLegacyFields({ issueId: "2026-09-19", articleId: "article-1" })).toEqual(identity);
  });

  it("gives Book chapters a first-class identity without issueId/articleId", () => {
    const identity = bookChapterReadingDocumentIdentity("book:isbn:9780226239873", "chapter:008:thinking-in-print");
    expect(identity.documentId).toBe("reading:book:book:isbn:9780226239873:chapter:008:thinking-in-print");
    expect("issueId" in identity).toBe(false);
    expect("articleId" in identity).toBe(false);
    expect(readingDocumentIdentityFromLegacyFields({ document: identity })).toEqual(identity);
    expect(sameReadingDocument(identity, { ...identity })).toBe(true);
  });
});
