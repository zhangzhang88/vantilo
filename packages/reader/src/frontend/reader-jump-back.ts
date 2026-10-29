import { resolveArticleReadingPosition, type ReadingPositionAnchor } from "./reader-state";

export type ReaderJumpBackMode = "article" | "sentence";

export interface ReaderJumpBackParagraphMetric {
  paragraphIndex: number;
  top: number;
  bottom: number;
}

export interface ReaderJumpBackTarget {
  documentId: string;
  position: ReadingPositionAnchor;
  mode: ReaderJumpBackMode;
  sentenceIndex?: number;
}

export interface ResolvedReaderJumpBackTarget {
  paragraphIndex: number;
  viewportOffset: number;
  mode: ReaderJumpBackMode;
  sentenceIndex?: number;
}

export function captureReaderJumpBackTarget({
  documentId,
  paragraphs,
  metrics,
  anchorY,
  mode,
  sentenceIndex,
}: {
  documentId: string;
  paragraphs: string[];
  metrics: ReaderJumpBackParagraphMetric[];
  anchorY: number;
  mode: ReaderJumpBackMode;
  sentenceIndex?: number;
}): ReaderJumpBackTarget | null {
  if (!Number.isFinite(anchorY)) return null;
  const valid = metrics.filter((metric) =>
    Number.isInteger(metric.paragraphIndex)
    && metric.paragraphIndex >= 0
    && Number.isFinite(metric.top)
    && Number.isFinite(metric.bottom)
    && metric.bottom >= metric.top,
  );
  if (!valid.length) return null;
  const metric = valid.find((candidate) => candidate.bottom >= anchorY) ?? valid[valid.length - 1];
  const paragraphText = paragraphs[metric.paragraphIndex] ?? "";
  if (!paragraphText) return null;
  return {
    documentId,
    position: {
      paragraphIndex: metric.paragraphIndex,
      paragraphText,
      viewportOffset: Math.round(metric.top / 8) * 8,
    },
    mode,
    sentenceIndex: mode === "sentence" && Number.isInteger(sentenceIndex) && (sentenceIndex ?? -1) >= 0
      ? sentenceIndex
      : undefined,
  };
}

export function resolveReaderJumpBackTarget(
  target: ReaderJumpBackTarget | null,
  documentId: string,
  paragraphs: string[],
  sentenceCount: number,
): ResolvedReaderJumpBackTarget | null {
  if (!target || target.documentId !== documentId) return null;
  const paragraphIndex = resolveArticleReadingPosition(target.position, paragraphs);
  if (paragraphIndex === null) return null;
  if (target.mode === "sentence") {
    if (!Number.isInteger(target.sentenceIndex) || (target.sentenceIndex ?? -1) < 0 || (target.sentenceIndex ?? 0) >= sentenceCount) return null;
    return {
      paragraphIndex,
      viewportOffset: target.position.viewportOffset,
      mode: "sentence",
      sentenceIndex: target.sentenceIndex,
    };
  }
  return {
    paragraphIndex,
    viewportOffset: target.position.viewportOffset,
    mode: "article",
  };
}
