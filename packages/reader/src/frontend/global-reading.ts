import { readingEntryDocument, type ReadingEntry } from "./reading-entry";
import { bookChapterReadingDocumentId } from "../shared/reading-document-identity";
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

export interface WholeBookProgressLocation {
  chapterId: string;
  progress?: number;
}

export function wholeBookReadingProgress(
  book: Pick<BookSummary, "id" | "readableUnitCount" | "chapterWeights">,
  chapterProgress: Record<string, number>,
  currentLocation?: WholeBookProgressLocation,
): number {
  const weights = book.chapterWeights;
  if (weights) {
    const entries = Object.entries(weights).map(([chapterId, rawWeight]) => ({
      chapterId,
      weight: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0,
    }));
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight > 0) {
      if (currentLocation?.chapterId) {
        const currentIndex = entries.findIndex(entry => entry.chapterId === currentLocation.chapterId);
        if (currentIndex >= 0) {
          const currentDocId = bookChapterReadingDocumentId(book.id, currentLocation.chapterId);
          const rawCurrent = currentLocation.progress ?? chapterProgress[currentDocId];
          const currentProgress = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(100, rawCurrent!)) : 0;
          let completedWeight = 0;
          let hasPositiveAfter = false;
          for (let index = 0; index < entries.length; index++) {
            const { weight } = entries[index];
            if (weight <= 0) continue;
            if (index < currentIndex) completedWeight += weight;
            else if (index === currentIndex) completedWeight += weight * (currentProgress / 100);
            else hasPositiveAfter = true;
          }
          if (!hasPositiveAfter && currentProgress >= 100) return 100;
          return Math.max(0, Math.min(99, Math.round((completedWeight / totalWeight) * 100)));
        }
      }

      let completedWeight = 0;
      let allFinished = true;
      for (const { chapterId, weight } of entries) {
        if (weight <= 0) continue;
        const documentId = bookChapterReadingDocumentId(book.id, chapterId);
        const rawProgress = chapterProgress[documentId];
        const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
        completedWeight += weight * (progress / 100);
        if (progress < 100) allFinished = false;
      }
      if (allFinished) return 100;
      return Math.max(0, Math.min(99, Math.round((completedWeight / totalWeight) * 100)));
    }
  }
  const prefix = `reading:book:${book.id}:`;
  const total = Object.entries(chapterProgress)
    .filter(([documentId]) => documentId.startsWith(prefix))
    .reduce((sum, [, value]) => sum + (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0), 0);
  return Math.min(100, Math.round(total / Math.max(1, book.readableUnitCount)));
}

export function bookCardProgressPercent({
  book,
  chapterProgress,
  reading,
  listening,
  activeAudiobookProgress,
}: {
  book: Pick<BookSummary, "id" | "readableUnitCount" | "chapterWeights">;
  chapterProgress: Record<string, number>;
  reading?: { chapterId?: string; progress?: number; updatedAt?: number };
  listening?: { chapterId?: string; completed?: boolean; updatedAt?: number };
  activeAudiobookProgress?: number;
}): number {
  if (typeof activeAudiobookProgress === "number" && Number.isFinite(activeAudiobookProgress)) {
    return Math.max(0, Math.min(100, Math.round(activeAudiobookProgress)));
  }
  const hasListening = Boolean(listening?.chapterId);
  const hasReading = Boolean(reading?.chapterId);
  const useListening = hasListening && (!hasReading || (listening!.updatedAt ?? 0) >= (reading!.updatedAt ?? 0));
  if (useListening && listening?.chapterId) {
    const docId = bookChapterReadingDocumentId(book.id, listening.chapterId);
    const progress = listening.completed ? 100 : (chapterProgress[docId] ?? 0);
    return wholeBookReadingProgress(book, chapterProgress, { chapterId: listening.chapterId, progress });
  }
  if (hasReading && reading?.chapterId) {
    return wholeBookReadingProgress(book, chapterProgress, { chapterId: reading.chapterId, progress: reading.progress });
  }
  return wholeBookReadingProgress(book, chapterProgress);
}
