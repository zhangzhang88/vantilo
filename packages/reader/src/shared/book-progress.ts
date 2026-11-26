import type { BookChapter } from "./book-data-contract.js";

export function bookChapterContentWeight(chapter: Pick<BookChapter, "paragraphs" | "wordCount">): number {
  let chars = 0;
  for (const paragraph of chapter.paragraphs) {
    chars += paragraph.replace(/\s+/gu, "").length;
  }
  if (chars > 0) return chars;
  return Number.isFinite(chapter.wordCount) && chapter.wordCount > 0 ? Math.round(chapter.wordCount) : 0;
}

export function bookChapterWeights(
  chapters: readonly (Pick<BookChapter, "id" | "paragraphs" | "wordCount"> & { order?: number })[],
): Record<string, number> {
  const ordered = chapters.every(chapter => typeof chapter.order === "number")
    ? [...chapters].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    : chapters;
  const weights: Record<string, number> = Object.create(null);
  for (const chapter of ordered) {
    weights[chapter.id] = bookChapterContentWeight(chapter);
  }
  return weights;
}
