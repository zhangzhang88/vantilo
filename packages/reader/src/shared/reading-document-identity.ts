import { canonicalIssueId } from "./publication.js";

export interface ArticleReadingDocumentIdentity {
  kind: "article";
  documentId: string;
  issueId: string;
  articleId: string;
}

export interface BookChapterReadingDocumentIdentity {
  kind: "book-chapter";
  documentId: string;
  bookId: string;
  chapterId: string;
}

export interface BookLessonReadingDocumentIdentity {
  kind: "book-lesson";
  documentId: string;
  bookId: string;
  lessonId: string;
}

export type ReadingDocumentIdentity = ArticleReadingDocumentIdentity | BookChapterReadingDocumentIdentity | BookLessonReadingDocumentIdentity;

export function bookLessonReadingDocumentIdentity(bookId: string, lessonId: string): BookLessonReadingDocumentIdentity {
  return { kind: "book-lesson", documentId: `reading:lesson:${bookId}:${lessonId}`, bookId, lessonId };
}

export function articleReadingDocumentId(issueId: string, articleId: string): string {
  return `reading:article:${canonicalIssueId(issueId)}:${articleId}`;
}

export function bookChapterReadingDocumentId(bookId: string, chapterId: string): string {
  return `reading:book:${bookId}:${chapterId}`;
}

export function articleReadingDocumentIdentity(issueId: string, articleId: string): ArticleReadingDocumentIdentity {
  const canonical = canonicalIssueId(issueId);
  return {
    kind: "article",
    documentId: articleReadingDocumentId(canonical, articleId),
    issueId: canonical,
    articleId,
  };
}

export function bookChapterReadingDocumentIdentity(bookId: string, chapterId: string): BookChapterReadingDocumentIdentity {
  return {
    kind: "book-chapter",
    documentId: bookChapterReadingDocumentId(bookId, chapterId),
    bookId,
    chapterId,
  };
}

export function normalizeReadingDocumentIdentity(value: unknown): ReadingDocumentIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReadingDocumentIdentity> & {
    issueId?: unknown;
    articleId?: unknown;
    bookId?: unknown;
    chapterId?: unknown;
    lessonId?: unknown;
  };
  if (candidate.kind === "article" && typeof candidate.issueId === "string" && candidate.issueId && typeof candidate.articleId === "string" && candidate.articleId) {
    return articleReadingDocumentIdentity(candidate.issueId, candidate.articleId);
  }
  if (candidate.kind === "book-chapter" && typeof candidate.bookId === "string" && candidate.bookId && typeof candidate.chapterId === "string" && candidate.chapterId) {
    return bookChapterReadingDocumentIdentity(candidate.bookId, candidate.chapterId);
  }
  if (candidate.kind === "book-lesson" && typeof candidate.bookId === "string" && candidate.bookId && typeof candidate.lessonId === "string" && candidate.lessonId) {
    return bookLessonReadingDocumentIdentity(candidate.bookId, candidate.lessonId);
  }
  return null;
}

export function readingDocumentIdentityFromLegacyFields(value: unknown): ReadingDocumentIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { document?: unknown; issueId?: unknown; articleId?: unknown; bookId?: unknown; chapterId?: unknown };
  const nested = normalizeReadingDocumentIdentity(candidate.document);
  if (nested) return nested;
  if (typeof candidate.issueId === "string" && candidate.issueId && typeof candidate.articleId === "string" && candidate.articleId) {
    return articleReadingDocumentIdentity(candidate.issueId, candidate.articleId);
  }
  if (typeof candidate.bookId === "string" && candidate.bookId && typeof candidate.chapterId === "string" && candidate.chapterId) {
    return bookChapterReadingDocumentIdentity(candidate.bookId, candidate.chapterId);
  }
  return null;
}

export type ReadingDocumentIdentityInput = {
  document?: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  bookId?: string;
  chapterId?: string;
};

export function readingDocumentIdentityForInput(input: ReadingDocumentIdentityInput): ReadingDocumentIdentity {
  const identity = readingDocumentIdentityFromLegacyFields(input);
  if (!identity) throw new Error("ReadingDocument identity is required");
  return identity;
}

export function sameReadingDocument(left: ReadingDocumentIdentity, right: ReadingDocumentIdentity): boolean {
  return left.documentId === right.documentId;
}
