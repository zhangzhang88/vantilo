import type { Article, PublicationId } from "./types.js";
import type { BookCategoryId } from "./book-category.js";

export type ReadingDocumentHeadingLevel = 1 | 2 | 3;

export interface ReadingDocumentHeadingBlock {
  kind: "heading";
  level: ReadingDocumentHeadingLevel;
  text: string;
}

export interface ReadingDocumentParagraphBlock {
  kind: "paragraph";
  paragraphIndex: number;
  text: string;
}

export type ReadingDocumentBlock = ReadingDocumentHeadingBlock | ReadingDocumentParagraphBlock;

/** Safe EPUB layout metadata. Text stays in the original paragraph anchor sequence. */
export interface ReadingTableImage {
  dataUrl: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface ReadingTableCell {
  paragraphIndexes: number[];
  colSpan: number;
  rowSpan: number;
  header: boolean;
  scope?: "row" | "col" | "rowgroup" | "colgroup";
  images: ReadingTableImage[];
}

export interface ReadingDocumentTable {
  id: string;
  sourceOrder?: number;
  beforeParagraphIndex: number;
  captionParagraphIndexes: number[];
  rows: Array<{ section: "head" | "body" | "foot"; cells: ReadingTableCell[] }>;
}

export interface BookVisualImage {
  entryPath: string;
  alt: string;
}

export interface ReadingDocumentVisual {
  id: string;
  sourceOrder?: number;
  kind: "image" | "original";
  reason?: "svg" | "formula" | "complex-layout" | "unavailable-image";
  beforeParagraphIndex: number;
  captionParagraphIndexes: number[];
  coveredParagraphIndexes: number[];
  captionText: string;
  captionPlacement?: "before" | "after";
  originalFragment: string;
  images: BookVisualImage[];
  sourceImageCount?: number;
}

export interface BookPresentationReport {
  imageCount: number;
  originalBlockCount: number;
}

export type BookChapterRole = "frontmatter" | "chapter" | "supplement" | "backmatter";

export interface BookCoverReference {
  entryPath: string;
  mediaType: string;
}

export interface BookPart {
  id: string;
  bookId: string;
  order: number;
  title: string;
  chapterIds: string[];
}

export interface BookChapter {
  id: string;
  bookId: string;
  partId: string | null;
  order: number;
  role: BookChapterRole;
  title: string;
  href: string;
  documentPath: string;
  contentFingerprint: string;
  headings: ReadingDocumentHeadingBlock[];
  paragraphs: string[];
  blocks: ReadingDocumentBlock[];
  tables?: ReadingDocumentTable[];
  visuals?: ReadingDocumentVisual[];
  wordCount: number;
}

export interface BookRecord {
  schemaVersion: 1;
  kind: "book";
  id: string;
  sourceFilename: string;
  sourceFingerprint: string;
  title: string;
  authors: string[];
  language: string | null;
  publisher: string | null;
  publishedAt: string | null;
  identifiers: string[];
  epubVersion: string;
  navigationType: "nav" | "ncx";
  cover: BookCoverReference | null;
  numberedChapterCount: number;
  parts: BookPart[];
  chapters: BookChapter[];
}

export interface BookSummary {
  categoryId?: BookCategoryId;
  id: string;
  sourceFilename: string;
  title: string;
  authors: string[];
  language: string | null;
  publisher: string | null;
  publishedAt: string | null;
  epubVersion: string;
  navigationType: "nav" | "ncx";
  hasCover: boolean;
  partCount: number;
  numberedChapterCount: number;
  readableUnitCount: number;
}

export type BookImportStatus = "ready" | "duplicate" | "conflict" | "unsupported" | "invalid" | "imported";

export interface BookImportPreview {
  categoryId?: BookCategoryId;
  filename: string;
  status: BookImportStatus;
  bookId?: string;
  title?: string;
  authors?: string[];
  language?: string | null;
  publisher?: string | null;
  publishedAt?: string | null;
  epubVersion?: string;
  navigationType?: "nav" | "ncx";
  partCount?: number;
  numberedChapterCount?: number;
  readableUnitCount?: number;
  hasCover: boolean;
  coverDataUrl?: string;
  existingFilename?: string;
  message: string;
  presentation?: BookPresentationReport;
}

export interface ArticleReadingDocumentSource {
  kind: "article";
  issueId: string;
  articleId: string;
  publicationId: PublicationId;
  section: string;
}

export interface BookReadingDocumentSource {
  kind: "book-chapter";
  bookId: string;
  chapterId: string;
  partId: string | null;
  role: BookChapterRole;
}

export type ReadingDocumentSource = ArticleReadingDocumentSource | BookReadingDocumentSource;

export interface ReadingDocument {
  schemaVersion: 1;
  id: string;
  source: ReadingDocumentSource;
  title: string;
  subtitle: string | null;
  authors: string[];
  publishedAt: string | null;
  sourceUrl: string | null;
  blocks: ReadingDocumentBlock[];
  paragraphs: string[];
  tables?: ReadingDocumentTable[];
  visuals?: ReadingDocumentVisual[];
  wordCount: number;
}

export interface BookIdentityMetadata {
  title: string;
  authors: string[];
  publisher: string | null;
  identifiers: string[];
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + Math.imul(index + 1, 0x45d9f3b);
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function validIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = value.slice(0, 12).split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

function validIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/i.test(value)) return false;
  const sum = value.toUpperCase().split("").reduce((total, digit, index) => {
    const numeric = digit === "X" ? 10 : Number(digit);
    return total + numeric * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

export function isbnFromIdentifiers(identifiers: string[]): string | null {
  for (const rawIdentifier of identifiers) {
    const normalized = normalizedText(rawIdentifier).replace(/^urn:isbn:/i, "").replace(/[\s-]/g, "").toUpperCase();
    if (validIsbn13(normalized) || validIsbn10(normalized)) return normalized;
  }
  return null;
}

export function createBookId(metadata: BookIdentityMetadata): string {
  const isbn = isbnFromIdentifiers(metadata.identifiers);
  if (isbn) return `book:isbn:${isbn}`;

  const identifier = metadata.identifiers.map(normalizedText).find(Boolean);
  if (identifier) return `book:id:${stableHash(identifier.toLocaleLowerCase("en-US"))}`;

  const canonicalMetadata = [
    normalizedText(metadata.title).toLocaleLowerCase("en-US"),
    metadata.authors.map((author) => normalizedText(author).toLocaleLowerCase("en-US")).join("\u0001"),
    normalizedText(metadata.publisher ?? "").toLocaleLowerCase("en-US"),
  ].join("\u0000");
  return `book:meta:${stableHash(canonicalMetadata)}`;
}

function identitySlug(value: string): string {
  const slug = normalizedText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug || `item-${stableHash(value).slice(0, 8)}`;
}

function orderedId(prefix: "part" | "chapter", order: number, title: string): string {
  if (!Number.isInteger(order) || order < 1) throw new Error(`${prefix} order must be a positive integer`);
  return `${prefix}:${String(order).padStart(3, "0")}:${identitySlug(title)}`;
}

export function createBookPartId(order: number, title: string): string {
  return orderedId("part", order, title);
}

export function createBookChapterId(order: number, title: string): string {
  return orderedId("chapter", order, title);
}

export function bookChapterContentFingerprint(blocks: ReadingDocumentBlock[]): string {
  const canonical = blocks.map((block) => block.kind === "heading"
    ? `h${block.level}\u0000${normalizedText(block.text)}`
    : `p\u0000${block.paragraphIndex}\u0000${normalizedText(block.text)}`).join("\u0001");
  return `content:${stableHash(canonical)}`;
}

export function readingDocumentId(source: ReadingDocumentSource): string {
  return source.kind === "article"
    ? `reading:article:${source.issueId}:${source.articleId}`
    : `reading:book:${source.bookId}:${source.chapterId}`;
}

function paragraphsFromArticle(article: Pick<Article, "bodyText">): string[] {
  return article.bodyText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function articleToReadingDocument(article: Article): ReadingDocument {
  const paragraphs = paragraphsFromArticle(article);
  const source: ArticleReadingDocumentSource = {
    kind: "article",
    issueId: article.issueId,
    articleId: article.id,
    publicationId: article.publicationId,
    section: article.section,
  };
  return {
    schemaVersion: 1,
    id: readingDocumentId(source),
    source,
    title: article.title,
    subtitle: article.subtitle ?? article.kicker,
    authors: article.author ? [article.author] : [],
    publishedAt: article.publishedAt,
    sourceUrl: article.sourceUrl,
    blocks: paragraphs.map((text, paragraphIndex) => ({ kind: "paragraph" as const, paragraphIndex, text })),
    paragraphs,
    wordCount: article.wordCount,
  };
}

export function bookChapterToReadingDocument(book: BookRecord, chapter: BookChapter): ReadingDocument {
  if (chapter.bookId !== book.id) throw new Error(`Book chapter ${chapter.id} does not belong to ${book.id}`);
  const source: BookReadingDocumentSource = {
    kind: "book-chapter",
    bookId: book.id,
    chapterId: chapter.id,
    partId: chapter.partId,
    role: chapter.role,
  };
  return {
    schemaVersion: 1,
    id: readingDocumentId(source),
    source,
    title: chapter.title,
    subtitle: null,
    authors: book.authors,
    publishedAt: book.publishedAt,
    sourceUrl: null,
    blocks: chapter.blocks,
    ...(chapter.tables?.length ? { tables: chapter.tables } : {}),
    ...(chapter.visuals?.length ? { visuals: chapter.visuals } : {}),
    paragraphs: chapter.paragraphs,
    wordCount: chapter.wordCount,
  };
}
