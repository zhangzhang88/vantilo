import { canonicalIssueId } from "../shared/publication";

export interface ReadingPosition {
  issueId: string;
  articleId: string;
}

export interface ReadingPositionAnchor {
  paragraphIndex: number;
  paragraphText: string;
  viewportOffset: number;
}

export interface ArticleReadingPosition extends ReadingPosition, ReadingPositionAnchor {}

export interface BookReadingPosition extends ReadingPositionAnchor {
  documentId: string;
  bookId: string;
  chapterId: string;
}

export interface BookLastPosition {
  documentId: string;
  bookId: string;
  chapterId: string;
}

export interface ReaderStateData {
  version: 1;
  progress: Record<string, number>;
  lastPosition: ReadingPosition | null;
  positions: Record<string, ArticleReadingPosition>;
  bookProgress: Record<string, number>;
  lastBookPosition: BookLastPosition | null;
  bookPositions: Record<string, BookReadingPosition>;
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const READER_STATE_KEY = "economist-reader-state-v1";

export function emptyReaderState(): ReaderStateData {
  return { version: 1, progress: {}, lastPosition: null, positions: {}, bookProgress: {}, lastBookPosition: null, bookPositions: {} };
}

export function readingPositionKey(issueId: string, articleId: string): string {
  return `${canonicalIssueId(issueId)}:${articleId}`;
}

export function bookReadingPositionKey(documentId: string): string {
  return documentId;
}

export function resolveArticleReadingPosition(
  position: ReadingPositionAnchor | undefined,
  paragraphs: string[],
): number | null {
  if (!position) return null;
  const direct = paragraphs[position.paragraphIndex];
  if (direct === position.paragraphText) return position.paragraphIndex;
  const matches = paragraphs.reduce<number[]>((indexes, paragraph, index) => {
    if (paragraph === position.paragraphText) indexes.push(index);
    return indexes;
  }, []);
  return matches.length === 1 ? matches[0] : null;
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function readerArticleProgress(rawProgress: number, reachedArticleEnd: boolean): number {
  if (reachedArticleEnd) return 100;
  return Math.min(99, clampProgress(rawProgress));
}

export function loadReaderState(storage: ReadStorage): ReaderStateData {
  const raw = storage.getItem(READER_STATE_KEY);
  if (!raw) return emptyReaderState();
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderStateData>;
    if (parsed.version !== 1 || typeof parsed.progress !== "object" || parsed.progress === null) {
      return emptyReaderState();
    }
    const progress = Object.fromEntries(
      Object.entries(parsed.progress)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => {
          const legacy = key.match(/^(\d{4}-\d{2}-\d{2}):(.*)$/);
          const canonicalKey = legacy ? `${canonicalIssueId(legacy[1])}:${legacy[2]}` : key;
          return [canonicalKey, clampProgress(value as number)];
        }),
    );
    const lastPosition = parsed.lastPosition
      && typeof parsed.lastPosition.issueId === "string"
      && typeof parsed.lastPosition.articleId === "string"
      ? { ...parsed.lastPosition, issueId: canonicalIssueId(parsed.lastPosition.issueId) }
      : null;
    const positions = Object.fromEntries(
      Object.values((parsed as Partial<ReaderStateData>).positions ?? {})
        .filter((value): value is ArticleReadingPosition => Boolean(
          value
          && typeof value.issueId === "string"
          && typeof value.articleId === "string"
          && Number.isInteger(value.paragraphIndex)
          && value.paragraphIndex >= 0
          && typeof value.paragraphText === "string"
          && value.paragraphText.length > 0
          && typeof value.viewportOffset === "number"
          && Number.isFinite(value.viewportOffset),
        ))
        .map((value) => {
          const position = { ...value, issueId: canonicalIssueId(value.issueId) };
          return [readingPositionKey(position.issueId, position.articleId), position];
        }),
    );
    const bookProgress = Object.fromEntries(
      Object.entries((parsed as Partial<ReaderStateData>).bookProgress ?? {})
        .filter(([key, value]) => key.startsWith("reading:book:") && typeof value === "number")
        .map(([key, value]) => [key, clampProgress(value as number)]),
    );
    const rawBookLast = (parsed as Partial<ReaderStateData>).lastBookPosition;
    const lastBookPosition = rawBookLast
      && typeof rawBookLast.documentId === "string"
      && rawBookLast.documentId.startsWith("reading:book:")
      && typeof rawBookLast.bookId === "string"
      && rawBookLast.bookId
      && typeof rawBookLast.chapterId === "string"
      && rawBookLast.chapterId
      ? { documentId: rawBookLast.documentId, bookId: rawBookLast.bookId, chapterId: rawBookLast.chapterId }
      : null;
    const bookPositions = Object.fromEntries(
      Object.values((parsed as Partial<ReaderStateData>).bookPositions ?? {})
        .filter((value): value is BookReadingPosition => Boolean(
          value
          && typeof value.documentId === "string"
          && value.documentId.startsWith("reading:book:")
          && typeof value.bookId === "string"
          && value.bookId
          && typeof value.chapterId === "string"
          && value.chapterId
          && Number.isInteger(value.paragraphIndex)
          && value.paragraphIndex >= 0
          && typeof value.paragraphText === "string"
          && value.paragraphText.length > 0
          && typeof value.viewportOffset === "number"
          && Number.isFinite(value.viewportOffset),
        ))
        .map((position) => [bookReadingPositionKey(position.documentId), position]),
    );
    return { version: 1, progress, lastPosition, positions, bookProgress, lastBookPosition, bookPositions };
  } catch {
    return emptyReaderState();
  }
}

export function saveReaderState(storage: WriteStorage, state: ReaderStateData): void {
  storage.setItem(READER_STATE_KEY, JSON.stringify(state));
}
