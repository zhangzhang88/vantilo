import type { BookRecord } from "../shared/book-data-contract";
import type { BookLesson } from "../shared/book-lesson";
import type { ReadingEntry } from "./reading-entry";
import { bookReaderCollection, bookLessonReaderCollection } from "./reading-document-view";
export interface BookSearchDocument extends ReadingEntry {
  document: NonNullable<ReadingEntry["document"]>;
  title: string;
  sourceTitle: string;
  paragraphs: string[];
  category: "电子书" | "精选阅读";
}
export function buildBookSearchDocuments(book: BookRecord, lessons: BookLesson[]): BookSearchDocument[] {
  return [bookReaderCollection(book), bookLessonReaderCollection(book, lessons)].flatMap((collection) => collection.documents.map((item) => ({
    document: item.identity, title: item.title, sourceTitle: book.title, sourceFingerprint: book.sourceFingerprint,
    paragraphs: [item.titleZh, item.summaryZh, ...(item.lesson ? [item.lesson.explanationZh] : []), ...item.paragraphs],
    category: collection.kind === "lessons" ? "精选阅读" as const : "电子书" as const,
  })));
}
export function searchBookDocuments(documents: BookSearchDocument[], query: string, kind: "all" | "books" | "lessons" = "all") {
  const key = query.trim().toLocaleLowerCase();
  if (!key) return [];
  return documents.flatMap((item) => {
    if (kind === "books" && item.category !== "电子书" || kind === "lessons" && item.category !== "精选阅读") return [];
    const match = [item.title, item.sourceTitle, ...item.paragraphs].find((text) => text.toLocaleLowerCase().includes(key));
    if (!match) return [];
    const offset = match.toLocaleLowerCase().indexOf(key);
    return [{ ...item, snippet: match.slice(Math.max(0, offset - 50), offset + key.length + 150) }];
  });
}
