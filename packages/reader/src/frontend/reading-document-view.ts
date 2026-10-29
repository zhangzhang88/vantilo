import type { ReadingDocumentBlock, ReadingDocumentTable, ReadingDocumentVisual, BookRecord } from "../shared/book-data-contract.js";
import { articleReadingDocumentIdentity, bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity, type ReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import { lessonParagraphs, type BookLesson } from "../shared/book-lesson.js";
import type { ReaderArticle, ReaderIssue } from "./reader-model.js";
import { articleMinutes, flattenArticles } from "./reader-model.js";
import { bookChapterRoleLabel, buildBookTocGroups } from "./book-library.js";
import type { BookTocChineseTitles } from "../shared/book-toc-chinese.js";

export interface ReaderDocumentView {
  id: string;
  identity: ReadingDocumentIdentity;
  title: string;
  titleZh: string;
  tocTitleZh?: string;
  subtitle: string;
  subtitleZh: string;
  summaryZh: string;
  section: string;
  sectionZh: string;
  minutes: number;
  progress: number;
  paragraphs: string[];
  blocks: ReadingDocumentBlock[];
  tables?: ReadingDocumentTable[];
  visuals?: ReadingDocumentVisual[];
  wordCount: number;
  lesson?: { explanationZh: string; keywords: string[]; evidence: string[]; adaptation: string };
}

export interface ReaderDocumentGroupView {
  id: string;
  label: string;
  labelSecondary?: string;
  documents: ReaderDocumentView[];
}

export interface ReaderCollectionView {
  id: string;
  kind: "issue" | "book" | "lessons";
  displayLabel: string;
  documents: ReaderDocumentView[];
  groups: ReaderDocumentGroupView[];
}

export function bookLessonReaderCollection(book: BookRecord, lessons: BookLesson[], progress: Record<string, number> = {}): ReaderCollectionView {
  const documents: ReaderDocumentView[] = lessons.filter((lesson) => lesson.bookId === book.id && lesson.sourceFingerprint === book.sourceFingerprint).map((lesson) => {
    const identity = bookLessonReadingDocumentIdentity(book.id, lesson.id);
    const paragraphs = lessonParagraphs(lesson);
    return {
      id: lesson.id, identity, title: lesson.titleZh, titleZh: "", subtitle: lesson.adaptation, subtitleZh: "", summaryZh: lesson.teaserZh,
      section: "精选阅读", sectionZh: "精选阅读", minutes: articleMinutes(lesson.wordCount), progress: progress[identity.documentId] ?? 0,
      paragraphs, blocks: paragraphs.map((text, paragraphIndex) => ({ kind: "paragraph" as const, paragraphIndex, text })), wordCount: lesson.wordCount,
      lesson: { explanationZh: lesson.explanationZh, keywords: lesson.keywords, adaptation: lesson.adaptation,
        evidence: lesson.evidence.map((entry) => `${book.chapters.find((chapter) => chapter.id === entry.chapterId)?.title ?? entry.chapterId} · 第 ${entry.paragraphIndex + 1} 段`) },
    };
  });
  return { id: `lessons:${book.id}`, kind: "lessons", displayLabel: `${book.title} · 精选阅读`, documents,
    groups: [{ id: "lessons", label: "这本书的精选阅读", documents }] };
}

function articleBlocks(article: ReaderArticle): ReadingDocumentBlock[] {
  return article.paragraphs.map((text, paragraphIndex) => ({ kind: "paragraph", paragraphIndex, text }));
}

export function magazineReaderCollection(issue: ReaderIssue): ReaderCollectionView {
  const documents = flattenArticles(issue).map((article) => ({
    id: article.id,
    identity: articleReadingDocumentIdentity(issue.id, article.id),
    title: article.title,
    titleZh: article.titleZh,
    subtitle: article.subtitle,
    subtitleZh: article.subtitleZh,
    summaryZh: article.summaryZh,
    section: article.section,
    sectionZh: article.sectionZh,
    minutes: article.minutes,
    progress: article.progress,
    paragraphs: article.paragraphs,
    blocks: articleBlocks(article),
    wordCount: article.wordCount,
  }));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  return {
    id: issue.id,
    kind: "issue",
    displayLabel: issue.displayDate,
    documents,
    groups: issue.sections.map((section) => ({
      id: section.name,
      label: section.name,
      labelSecondary: section.nameZh,
      documents: section.articles.flatMap((article) => {
        const document = documentById.get(article.id);
        return document ? [document] : [];
      }),
    })),
  };
}

export function bookReaderCollection(book: BookRecord, progress: Record<string, number> = {}, tocTitles?: BookTocChineseTitles): ReaderCollectionView {
  const partById = new Map(book.parts.map((part) => [part.id, part]));
  const documents = [...book.chapters]
    .sort((left, right) => left.order - right.order)
    .map((chapter) => {
      const identity = bookChapterReadingDocumentIdentity(book.id, chapter.id);
      const part = chapter.partId ? partById.get(chapter.partId) : undefined;
      return {
        id: chapter.id,
        identity,
        title: chapter.title,
        titleZh: tocTitles?.chapters[chapter.id] ?? "",
        tocTitleZh: tocTitles?.chapters[chapter.id] ?? "",
        subtitle: "",
        subtitleZh: "",
        summaryZh: "",
        section: part?.title ?? bookChapterRoleLabel(chapter.role),
        sectionZh: part ? `Part ${part.order}` : bookChapterRoleLabel(chapter.role),
        minutes: articleMinutes(chapter.wordCount),
        progress: progress[identity.documentId] ?? 0,
        paragraphs: chapter.paragraphs,
        blocks: chapter.blocks,
        ...(chapter.tables?.length ? { tables: chapter.tables } : {}),
        ...(chapter.visuals?.length ? { visuals: chapter.visuals } : {}),
        wordCount: chapter.wordCount,
      };
    });
  const documentById = new Map(documents.map((document) => [document.id, document]));
  return {
    id: book.id,
    kind: "book",
    displayLabel: book.title,
    documents,
    groups: buildBookTocGroups(book).map((group) => ({
      id: group.id,
      label: group.kind === "part" && tocTitles?.parts[group.id.slice(5)]
        ? `${group.label} · ${group.title}`
        : group.label,
      labelSecondary: group.kind === "part" && tocTitles?.parts[group.id.slice(5)]
        ? tocTitles.parts[group.id.slice(5)]
        : group.title !== group.label ? group.title : undefined,
      documents: group.chapters.flatMap((chapter) => {
        const document = documentById.get(chapter.id);
        return document ? [document] : [];
      }),
    })),
  };
}
