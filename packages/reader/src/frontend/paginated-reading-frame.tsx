import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  clampPageIndex,
  computePaginationMetrics,
  computeWholeBookPagePosition,
  estimateSpreadWeightCapacity,
  pageIndexForOffset,
  type BookPaginationChapter,
} from "./reader-pagination";
import type { ReaderLayoutMode, ReaderLineHeight } from "./reader-preferences";

export interface BookPaginationConfig {
  chapters: readonly BookPaginationChapter[];
  currentChapterId: string;
  fontSize: number;
  lineHeight: ReaderLineHeight | number;
  densityScale?: number;
}

export interface PaginatedReadingHandle {
  flipPage: (delta: -1 | 1) => boolean;
  revealElement: (element: HTMLElement | null) => boolean;
  goToProgress: (progressPercent: number) => boolean;
  findFirstVisibleElement: (elements: Iterable<HTMLElement>) => HTMLElement | null;
}

export function PaginatedReadingFrame({
  active,
  layoutMode,
  resetKey,
  measureDeps,
  previousLabel,
  nextLabel,
  canGoPreviousUnit,
  canGoNextUnit,
  onPreviousUnit,
  onNextUnit,
  onPageChange,
  bookPagination,
  enableKeyboard = false,
  controlsRef,
  children,
}: {
  active: boolean;
  layoutMode: ReaderLayoutMode;
  resetKey: string;
  measureDeps: readonly unknown[];
  previousLabel: string;
  nextLabel: string;
  canGoPreviousUnit?: boolean;
  canGoNextUnit?: boolean;
  onPreviousUnit?: () => void;
  onNextUnit?: () => void;
  onPageChange?: (pageIndex: number, totalPages: number) => void;
  bookPagination?: BookPaginationConfig;
  enableKeyboard?: boolean;
  controlsRef?: Ref<PaginatedReadingHandle>;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const measuredCacheRef = useRef<{ signature: string; pages: Map<string, number> }>({
    signature: "",
    pages: new Map(),
  });
  const [page, setPage] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [metrics, setMetrics] = useState(() => computePaginationMetrics("scroll", 0, 0));

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const measure = useCallback(() => {
    if (!active) {
      setMetrics(current => current.active ? computePaginationMetrics("scroll", 0, 0) : current);
      return;
    }
    const viewport = viewportRef.current;
    const columns = columnsRef.current;
    if (!viewport || !columns) return;
    const next = computePaginationMetrics(layoutMode, viewport.clientWidth, columns.scrollWidth);
    const nextHeight = viewport.clientHeight;
    setViewportHeight(current => current === nextHeight ? current : nextHeight);
    setMetrics(current =>
      current.active === next.active
      && current.columnsPerSpread === next.columnsPerSpread
      && current.columnWidth === next.columnWidth
      && current.columnGap === next.columnGap
      && current.totalPages === next.totalPages
        ? current
        : next,
    );
    setPage(current => clampPageIndex(current, next.totalPages));
  }, [active, layoutMode]);

  useLayoutEffect(() => {
    measure();
    if (!active) return;
    // Measure again on next animation frame after column layout settles.
    const frame = window.requestAnimationFrame(measure);
    const viewport = viewportRef.current;
    const columns = columnsRef.current;
    if (!viewport || !columns || typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    observer.observe(columns);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, active, resetKey, ...measureDeps]);

  useLayoutEffect(() => {
    if (!active || !metrics.active) return;
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [active, metrics.active, metrics.columnWidth, metrics.columnGap, measure]);

  useLayoutEffect(() => {
    if (!active || !metrics.active) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const clamped = clampPageIndex(page, metrics.totalPages);
    viewport.scrollLeft = clamped * metrics.stride;
  }, [active, page, metrics]);

  const revealElement = useCallback((element: HTMLElement | null) => {
    if (!active || !metrics.active || !element) return false;
    const viewport = viewportRef.current;
    if (!viewport) return false;
    const relativeLeft = element.getBoundingClientRect().left - viewport.getBoundingClientRect().left + viewport.scrollLeft;
    const targetPage = pageIndexForOffset(relativeLeft, metrics.stride, metrics.totalPages);
    setPage(targetPage);
    return true;
  }, [active, metrics]);

  const goToProgress = useCallback((progressPercent: number) => {
    if (!active || !metrics.active || metrics.totalPages <= 1) return false;
    const clamped = Math.max(0, Math.min(100, progressPercent));
    const targetPage = clampPageIndex(Math.round((clamped / 100) * metrics.totalPages) - 1, metrics.totalPages);
    setPage(targetPage);
    return true;
  }, [active, metrics.active, metrics.totalPages]);

  const findFirstVisibleElement = useCallback((elements: Iterable<HTMLElement>): HTMLElement | null => {
    if (!active || !metrics.active) return null;
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const vpRect = viewport.getBoundingClientRect();
    let fallback: HTMLElement | null = null;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > vpRect.left + 2 && rect.left < vpRect.right - 2) {
        if (rect.left >= vpRect.left - 8) return element;
        fallback ??= element;
      }
    }
    return fallback;
  }, [active, metrics.active]);

  const flipPage = useCallback((delta: -1 | 1) => {
    if (!active) return false;
    if (delta < 0) {
      if (page > 0) {
        const nextPage = page - 1;
        setPage(nextPage);
        onPageChange?.(nextPage, metrics.totalPages);
        return true;
      }
      if (canGoPreviousUnit && onPreviousUnit) {
        onPreviousUnit();
        return true;
      }
      return false;
    }
    if (page < metrics.totalPages - 1) {
      const nextPage = page + 1;
      setPage(nextPage);
      onPageChange?.(nextPage, metrics.totalPages);
      return true;
    }
    if (canGoNextUnit && onNextUnit) {
      onNextUnit();
      return true;
    }
    return false;
  }, [active, page, metrics.totalPages, canGoPreviousUnit, canGoNextUnit, onPreviousUnit, onNextUnit, onPageChange]);

  useImperativeHandle(
    controlsRef,
    () => ({ flipPage, revealElement, goToProgress, findFirstVisibleElement }),
    [flipPage, revealElement, goToProgress, findFirstVisibleElement],
  );

  useEffect(() => {
    if (!active || !enableKeyboard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (flipPage(-1)) event.preventDefault();
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        if (flipPage(1)) event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, enableKeyboard, flipPage]);

  const layoutSignature = bookPagination
    ? `${metrics.columnsPerSpread}:${Math.round(metrics.columnWidth / 16)}:${Math.round(viewportHeight / 16)}:${bookPagination.fontSize}:${bookPagination.lineHeight}:${bookPagination.densityScale ?? 1}`
    : "";

  const displayPosition = useMemo(() => {
    if (!bookPagination || bookPagination.chapters.length <= 1) {
      return {
        currentPage: page + 1,
        totalPages: metrics.totalPages,
        pagesBeforeCurrent: 0,
      };
    }

    if (measuredCacheRef.current.signature !== layoutSignature) {
      measuredCacheRef.current = { signature: layoutSignature, pages: new Map() };
    }
    if (active && metrics.active && viewportHeight > 0 && metrics.columnWidth > 0 && bookPagination.currentChapterId) {
      measuredCacheRef.current.pages.set(bookPagination.currentChapterId, metrics.totalPages);
    }

    const spreadCapacity = estimateSpreadWeightCapacity({
      columnWidth: metrics.columnWidth,
      viewportHeight,
      columnsPerSpread: metrics.columnsPerSpread,
      fontSize: bookPagination.fontSize,
      lineHeight: bookPagination.lineHeight,
      densityScale: bookPagination.densityScale,
    });

    return computeWholeBookPagePosition({
      chapters: bookPagination.chapters,
      currentChapterId: bookPagination.currentChapterId,
      currentChapterPage: page,
      currentChapterTotalPages: metrics.totalPages,
      spreadCapacity,
      measuredPagesByChapterId: measuredCacheRef.current.pages,
    });
  }, [
    active,
    bookPagination,
    layoutSignature,
    metrics.active,
    metrics.columnWidth,
    metrics.columnsPerSpread,
    metrics.totalPages,
    page,
    viewportHeight,
  ]);

  if (!active) return <>{children}</>;

  return (
    <div className="reading-paginated-frame">
      <div
        ref={viewportRef}
        className={`reading-paginated-viewport ${metrics.columnsPerSpread === 2 ? "is-double-spread" : ""}`}
        data-testid="reading-paginated-viewport"
        data-columns={metrics.columnsPerSpread}
      >
        <div
          ref={columnsRef}
          className="reading-paginated-columns"
          style={metrics.active ? {
            columnCount: metrics.columnsPerSpread === 2 ? undefined : undefined,
            columnWidth: `${metrics.columnWidth}px`,
            columnGap: `${metrics.columnGap}px`,
          } : undefined}
        >
          {children}
        </div>
      </div>
      <nav className="reading-pagination-bar" aria-label="分页翻页导航" data-testid="reading-pagination-bar">
        <button
          type="button"
          className="reading-pagination-btn"
          disabled={page <= 0 && !canGoPreviousUnit}
          onClick={() => flipPage(-1)}
        >
          <span className="reading-pagination-arrow" aria-hidden="true">‹</span>
          <span>{page > 0 ? "上一页" : previousLabel}</span>
        </button>
        <span
          className="reading-pagination-status"
          aria-label={bookPagination && bookPagination.chapters.length > 1
            ? `全书第 ${displayPosition.currentPage} 页，共 ${displayPosition.totalPages} 页`
            : `第 ${displayPosition.currentPage} 页，共 ${displayPosition.totalPages} 页`}
        >
          {displayPosition.currentPage} / {displayPosition.totalPages}
        </span>
        <button
          type="button"
          className="reading-pagination-btn"
          disabled={page >= metrics.totalPages - 1 && !canGoNextUnit}
          onClick={() => flipPage(1)}
        >
          <span>{page < metrics.totalPages - 1 ? "下一页" : nextLabel}</span>
          <span className="reading-pagination-arrow" aria-hidden="true">›</span>
        </button>
      </nav>
    </div>
  );
}
