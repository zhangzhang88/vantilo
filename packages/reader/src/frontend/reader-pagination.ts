import type { ReaderLayoutMode, ReaderLineHeight } from "./reader-preferences";

export function readerLineHeightValue(lineHeight: ReaderLineHeight | number): number {
  if (typeof lineHeight === "number" && Number.isFinite(lineHeight) && lineHeight > 0) {
    return Math.max(1.2, Math.min(2.6, lineHeight));
  }
  if (lineHeight === "compact") return 1.62;
  if (lineHeight === "relaxed") return 2.02;
  return 1.82;
}

export interface PaginationMetrics {
  active: boolean;
  columnsPerSpread: 1 | 2;
  columnWidth: number;
  columnGap: number;
  stride: number;
  totalPages: number;
}

export interface BookPaginationChapter {
  id: string;
  weight: number;
}

export interface BookPaginationPosition {
  currentPage: number;
  totalPages: number;
  pagesBeforeCurrent: number;
}

export interface PaginationWeightSource {
  paragraphs?: readonly string[];
  visuals?: readonly unknown[];
  tables?: readonly unknown[];
  wordCount?: number;
}

// Allow comfortable double-page spreads on standard laptop/desktop widths even when the side drawer is open.
const DOUBLE_PAGE_MIN_WIDTH = 560;
const SINGLE_COLUMN_GAP = 40;
const DOUBLE_COLUMN_GAP = 56;

export function computePaginationMetrics(
  layoutMode: ReaderLayoutMode,
  viewportWidth: number,
  contentScrollWidth: number,
): PaginationMetrics {
  if (layoutMode === "scroll" || viewportWidth <= 0) {
    return {
      active: false,
      columnsPerSpread: 1,
      columnWidth: Math.max(0, viewportWidth),
      columnGap: 0,
      stride: Math.max(1, viewportWidth),
      totalPages: 1,
    };
  }

  const columnsPerSpread: 1 | 2 = layoutMode === "double" && viewportWidth >= DOUBLE_PAGE_MIN_WIDTH ? 2 : 1;
  const columnGap = columnsPerSpread === 2 ? DOUBLE_COLUMN_GAP : SINGLE_COLUMN_GAP;
  // Floor and subtract a 2px safety margin so Chromium never drops from 2 columns to 1 due to subpixel rounding.
  const columnWidth = columnsPerSpread === 2
    ? Math.max(240, Math.floor((viewportWidth - columnGap - 2) / 2))
    : Math.max(240, Math.floor(viewportWidth));
  const stride = viewportWidth + columnGap;
  const effectiveScrollWidth = Math.max(viewportWidth, contentScrollWidth);
  const totalPages = Math.max(1, Math.ceil((effectiveScrollWidth + columnGap - 4) / stride));

  return {
    active: true,
    columnsPerSpread,
    columnWidth,
    columnGap,
    stride,
    totalPages,
  };
}

export function clampPageIndex(pageIndex: number, totalPages: number): number {
  return Math.max(0, Math.min(Math.max(1, totalPages) - 1, Math.trunc(pageIndex)));
}

export function pageIndexForOffset(relativeLeft: number, stride: number, totalPages: number): number {
  if (stride <= 0) return 0;
  return clampPageIndex(Math.floor((Math.max(0, relativeLeft) + 4) / stride), totalPages);
}

const CJK_FULLWIDTH_RE = /[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;

export function estimateDocumentPaginationWeight(source: PaginationWeightSource): number {
  let weight = 120; // Chapter header / title block overhead in em-units.
  let hasParagraphText = false;

  if (source.paragraphs?.length) {
    for (const raw of source.paragraphs) {
      const text = raw.trim();
      if (!text) continue;
      hasParagraphText = true;
      let paragraphWeight = 36; // Paragraph gap + partial last line overhead.
      for (const ch of text) {
        if (/\s/u.test(ch)) {
          paragraphWeight += 0.28;
        } else if (CJK_FULLWIDTH_RE.test(ch)) {
          paragraphWeight += 1;
        } else {
          paragraphWeight += 0.55;
        }
      }
      weight += paragraphWeight;
    }
  }

  if (!hasParagraphText && typeof source.wordCount === "number" && source.wordCount > 0) {
    weight += source.wordCount * 3.4;
  }

  if (source.visuals?.length) {
    weight += source.visuals.length * 320;
  }
  if (source.tables?.length) {
    weight += source.tables.length * 220;
  }

  return Math.max(120, Math.round(weight));
}

export function estimateSpreadWeightCapacity({
  columnWidth,
  viewportHeight,
  columnsPerSpread,
  fontSize,
  lineHeight,
  densityScale = 1,
}: {
  columnWidth: number;
  viewportHeight: number;
  columnsPerSpread: 1 | 2;
  fontSize: number;
  lineHeight: ReaderLineHeight | number;
  densityScale?: number;
}): number {
  const effectiveColumnWidth = columnWidth > 0 ? columnWidth : 640;
  const effectiveViewportHeight = viewportHeight > 0 ? viewportHeight : 680;
  const safeFontSize = Math.max(12, Math.min(36, Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 19));
  const safeLineHeight = readerLineHeightValue(lineHeight);
  const emsPerLine = Math.max(12, effectiveColumnWidth / safeFontSize);
  const linesPerColumn = Math.max(4, effectiveViewportHeight / (safeFontSize * safeLineHeight));
  const safeScale = Number.isFinite(densityScale) && densityScale > 0 ? densityScale : 1;
  return Math.max(120, emsPerLine * linesPerColumn * columnsPerSpread * safeScale);
}

export function computeWholeBookPagePosition({
  chapters,
  currentChapterId,
  currentChapterPage,
  currentChapterTotalPages,
  spreadCapacity,
  measuredPagesByChapterId,
}: {
  chapters: readonly BookPaginationChapter[];
  currentChapterId: string;
  currentChapterPage: number;
  currentChapterTotalPages: number;
  spreadCapacity: number;
  measuredPagesByChapterId?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}): BookPaginationPosition {
  const safeChapterTotal = Math.max(1, Math.round(currentChapterTotalPages));
  const clampedChapterPage = clampPageIndex(currentChapterPage, safeChapterTotal);

  if (chapters.length <= 1) {
    return {
      currentPage: clampedChapterPage + 1,
      totalPages: safeChapterTotal,
      pagesBeforeCurrent: 0,
    };
  }

  const currentIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId);
  if (currentIndex < 0) {
    return {
      currentPage: clampedChapterPage + 1,
      totalPages: safeChapterTotal,
      pagesBeforeCurrent: 0,
    };
  }

  const safeCapacity = Math.max(120, Number.isFinite(spreadCapacity) ? spreadCapacity : 700);
  const getMeasured = (id: string): number | undefined => {
    if (!measuredPagesByChapterId) return undefined;
    if (measuredPagesByChapterId instanceof Map) {
      return measuredPagesByChapterId.get(id);
    }
    return (measuredPagesByChapterId as Readonly<Record<string, number>>)[id];
  };

  let pagesBeforeCurrent = 0;
  let totalPages = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    let chapterPages: number;
    if (index === currentIndex) {
      chapterPages = safeChapterTotal;
    } else {
      const measured = getMeasured(chapter.id);
      if (typeof measured === "number" && Number.isFinite(measured) && measured >= 1) {
        chapterPages = Math.max(1, Math.round(measured));
      } else {
        chapterPages = Math.max(1, Math.ceil(Math.max(1, chapter.weight) / safeCapacity));
      }
    }
    if (index < currentIndex) {
      pagesBeforeCurrent += chapterPages;
    }
    totalPages += chapterPages;
  }

  const currentPage = pagesBeforeCurrent + clampedChapterPage + 1;
  return {
    currentPage,
    totalPages: Math.max(currentPage, totalPages),
    pagesBeforeCurrent,
  };
}
