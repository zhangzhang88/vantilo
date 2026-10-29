import { readingEntryDocument, type ReadingEntry } from "./reading-entry";
import type { ReaderIssue } from "./reader-model";
import { findArticle } from "./reader-model";
import type { BookSummary } from "../shared/book-data-contract";
import type { ReaderStateData } from "./reader-state";
import type { LessonReaderState } from "./lesson-reader-state";
export interface ReadingEntryView {
  entry: ReadingEntry;
  key: string;
  title: string;
  titleZh?: string;
  source: string;
  category: "期刊" | "电子书" | "精选阅读";
  progress: number;
  available: boolean;
}
export function resolveReadingEntry(entry: ReadingEntry, issues: ReaderIssue[], books: BookSummary[], reader: ReaderStateData, lessons: LessonReaderState): ReadingEntryView | null {
  const document = readingEntryDocument(entry);
  if (!document) return null;
  if (document.kind === "article") {
    const found = findArticle(issues, document.articleId, document.issueId);
    return { entry, key: document.documentId, title: found?.article.title ?? entry.title ?? "原文章暂不可用", titleZh: found?.article.titleZh,
      source: found ? `${found.issue.publicationName} · ${found.issue.displayDate} · ${found.article.section}` : entry.sourceTitle ?? "来源期刊暂不可用",
      category: "期刊", progress: found?.article.progress ?? reader.progress[`${document.issueId}:${document.articleId}`] ?? 0, available: Boolean(found) };
  }
  const book = books.find((item) => item.id === document.bookId);
  return { entry, key: document.documentId, title: entry.title ?? (document.kind === "book-lesson" ? "精选阅读" : "继续原书章节"), source: book?.title ?? entry.sourceTitle ?? "来源电子书暂不可用",
    category: document.kind === "book-lesson" ? "精选阅读" : "电子书",
    progress: (document.kind === "book-lesson" ? lessons.progress : reader.bookProgress)[document.documentId] ?? 0, available: Boolean(book) };
}
