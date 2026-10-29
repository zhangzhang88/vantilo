import type { BookChapter, BookChapterRole, BookRecord } from "../shared/book-data-contract";

import type { BookLastPosition } from "./reader-state";
import { bookChapterReadingDocumentId } from "../shared/reading-document-identity";

export function resolveBookContinueChapter(book: BookRecord, last: BookLastPosition | null, progress: Record<string, number>): BookChapter | undefined {
  const exact = last?.bookId === book.id ? book.chapters.find((chapter) => chapter.id === last.chapterId) : undefined;
  return exact ?? book.chapters.find((chapter) => {
    const value = progress[bookChapterReadingDocumentId(book.id, chapter.id)] ?? 0;
    return value > 0 && value < 100;
  });
}

export interface BookTocGroup {
  id: string;
  kind: "part" | BookChapterRole;
  label: string;
  title: string;
  chapters: BookChapter[];
}

const roleLabels: Record<BookChapterRole, string> = {
  frontmatter: "前置内容",
  chapter: "章节",
  supplement: "其他内容",
  backmatter: "后置内容",
};

export function bookChapterRoleLabel(role: BookChapterRole): string {
  if (role === "chapter") return "Chapter";
  if (role === "frontmatter") return "Front matter";
  if (role === "backmatter") return "Back matter";
  return "Supplement";
}

export function buildBookTocGroups(book: BookRecord): BookTocGroup[] {
  const partById = new Map(book.parts.map((part) => [part.id, part]));
  const groups: BookTocGroup[] = [];
  let roleSegment = 0;

  [...book.chapters].sort((left, right) => left.order - right.order).forEach((chapter) => {
    if (chapter.partId) {
      const part = partById.get(chapter.partId);
      const previous = groups.at(-1);
      if (part && previous?.id === `part:${part.id}`) {
        previous.chapters.push(chapter);
        return;
      }
      groups.push({
        id: `part:${part?.id ?? chapter.partId}`,
        kind: "part",
        label: part ? `Part ${part.order}` : "Part",
        title: part?.title ?? "Part",
        chapters: [chapter],
      });
      return;
    }

    const previous = groups.at(-1);
    if (previous?.kind === chapter.role && previous.id.startsWith(`role:${chapter.role}:`)) {
      previous.chapters.push(chapter);
      return;
    }
    roleSegment += 1;
    groups.push({
      id: `role:${chapter.role}:${roleSegment}`,
      kind: chapter.role,
      label: roleLabels[chapter.role],
      title: roleLabels[chapter.role],
      chapters: [chapter],
    });
  });

  return groups;
}
