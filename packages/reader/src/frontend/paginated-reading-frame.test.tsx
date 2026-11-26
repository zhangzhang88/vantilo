// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReaderPage } from "./App";
import { DEFAULT_READER_PREFERENCES, type ReaderLayoutMode, type ReaderPreferences } from "./reader-preferences";
import type { ReadingPositionAnchor } from "./global-reading";
import type { ReaderCollectionView, ReaderDocumentView } from "./reading-document-view";

function makeFixtureCollection(): { collection: ReaderCollectionView; chapter: ReaderDocumentView } {
  const paragraphs = [
    "Opening paragraph that the reader has already scrolled past in this long chapter.",
    "Middle paragraph that is currently visible on screen when the user switches layout modes.",
    "Closing paragraph located on the final page of the synthetic test chapter.",
  ];
  const chapter: ReaderDocumentView = {
    id: "chapter-1",
    identity: {
      kind: "book-chapter",
      bookId: "book:layout-switch-test",
      chapterId: "chapter-1",
      documentId: "book:book:layout-switch-test:chapter:chapter-1",
    },
    title: "Chapter 1",
    section: "Part 1",
    wordCount: 40,
    estimatedMinutes: 1,
    progress: 0,
    paragraphs,
    blocks: paragraphs.map((text, paragraphIndex) => ({
      kind: "paragraph" as const,
      paragraphIndex,
      text,
    })),
    headings: [],
    references: [],
    visuals: [],
    tables: [],
  };
  const collection: ReaderCollectionView = {
    id: "book:layout-switch-test",
    kind: "book",
    title: "Layout Switch Test Book",
    documents: [chapter],
  };
  return { collection, chapter };
}

async function flushFrames(count = 4): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }
}

describe("ReaderPage automatic reading position preservation across layout switches", () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const originalScrollTo = window.scrollTo;

  let activeMode: ReaderLayoutMode = "scroll";
  let scrollModeParagraphTops = [-320, 110, 290];
  const scrollToSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    activeMode = "scroll";
    scrollModeParagraphTops = [-320, 110, 290];
    scrollToSpy.mockReset();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: scrollToSpy });
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });

    const pageMetrics = () => activeMode === "double"
      ? { pageWidth: 900, gap: 56, stride: 956, totalPages: 3 }
      : { pageWidth: 680, gap: 40, stride: 720, totalPages: 3 };

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this.classList?.contains("reading-paginated-viewport")) return pageMetrics().pageWidth;
        return originalClientWidth?.get ? originalClientWidth.get.call(this) : 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList?.contains("reading-paginated-viewport")) return 600;
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 600;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        if (this.classList?.contains("reading-paginated-columns")) {
          const { stride, totalPages, gap } = pageMetrics();
          return totalPages * stride - gap;
        }
        return originalScrollWidth?.get ? originalScrollWidth.get.call(this) : 800;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList?.contains("reading-paginated-viewport")) {
        const { pageWidth } = pageMetrics();
        return { x: 0, y: 0, left: 0, top: 0, right: pageWidth, bottom: 600, width: pageWidth, height: 600, toJSON: () => ({}) } as DOMRect;
      }
      if (this.classList?.contains("reading-paragraph-block") && this.dataset?.paragraphIndex !== undefined) {
        const idx = Number(this.dataset.paragraphIndex);
        const viewport = this.closest(".reading-paginated-viewport") as HTMLElement | null;
        if (viewport) {
          const { stride } = pageMetrics();
          const left = idx * stride + 20 - viewport.scrollLeft;
          return { x: left, y: 40, left, top: 40, right: left + 240, bottom: 140, width: 240, height: 100, toJSON: () => ({}) } as DOMRect;
        }
        const top = scrollModeParagraphTops[idx] ?? 0;
        return { x: 0, y: top, left: 0, top, right: 680, bottom: top + 140, width: 680, height: 140, toJSON: () => ({}) } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    if (originalScrollWidth) Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScrollWidth);
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: originalScrollTo });
  });

  it("automatically captures and restores the visible mid-chapter paragraph when switching scroll -> single -> double -> scroll via reader settings", async () => {
    const { collection, chapter } = makeFixtureCollection();
    const capturedPositions: ReadingPositionAnchor[] = [];

    function StatefulReaderHarness() {
      const [preferences, setPreferences] = useState<ReaderPreferences>({
        ...DEFAULT_READER_PREFERENCES,
        layoutMode: "scroll",
      });
      const [readingPosition, setReadingPosition] = useState<ReadingPositionAnchor | undefined>(undefined);

      return (
        <ReaderPage
          issue={collection}
          article={chapter}
          readLaterState={{ items: [] }}
          notes={[]}
          preferences={preferences}
          onBack={() => {}}
          onOpenArticle={() => {}}
          onToggleReadLater={() => {}}
          onNotesChange={() => {}}
          onEditNote={() => {}}
          onDeleteNote={() => {}}
          onProgressChange={() => {}}
          readingPosition={readingPosition}
          onReadingPositionChange={(position) => {
            capturedPositions.push(position);
            setReadingPosition(position);
          }}
          sentencePosition={undefined}
          onSentencePositionChange={() => {}}
          vocabularyJump={null}
          onConsumeVocabularyJump={() => {}}
          noteJump={null}
          onConsumeNoteJump={() => {}}
          readerReturnTarget={null}
          onReturnToSource={() => {}}
          focusMode={false}
          onFocusModeChange={() => {}}
          globalNavigation={null}
          onReaderPreferencesChange={(patch) => {
            setPreferences((current) => {
              const next = { ...current, ...patch };
              activeMode = next.layoutMode;
              return next;
            });
          }}
        />
      );
    }

    const { container } = render(<StatefulReaderHarness />);
    // Wait for initial scroll restore to finish so the document is already marked restored in scroll mode.
    await flushFrames(4);
    expect(container.querySelector(".reading-paginated-viewport")).toBeNull();

    // Open the real appearance settings drawer while paragraph 1 (index 1) is the first visible paragraph.
    fireEvent.click(screen.getByRole("button", { name: "阅读器设置" }));

    // 1. Switch scroll -> single-page via the real radio button (no manual revealElement calls!).
    fireEvent.click(screen.getByRole("radio", { name: "单页模式" }));
    await flushFrames(5);

    const singleViewport = container.querySelector<HTMLElement>(".reading-paginated-viewport");
    expect(singleViewport).not.toBeNull();
    expect(capturedPositions.at(-1)?.paragraphIndex).toBe(1);
    expect(singleViewport?.scrollLeft).toBe(720);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    // 2. Switch single-page -> double-page within the same chapter via the real radio button.
    fireEvent.click(screen.getByRole("radio", { name: "双页模式" }));
    await flushFrames(5);

    const doubleViewport = container.querySelector<HTMLElement>(".reading-paginated-viewport");
    expect(doubleViewport).not.toBeNull();
    expect(capturedPositions.at(-1)?.paragraphIndex).toBe(1);
    expect(doubleViewport?.scrollLeft).toBe(956);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    // 3. Switch double-page -> scroll within the same chapter via the real radio button.
    scrollToSpy.mockClear();
    scrollModeParagraphTops = [120, 520, 920];
    fireEvent.click(screen.getByRole("radio", { name: "滚动模式" }));
    await flushFrames(5);

    expect(container.querySelector(".reading-paginated-viewport")).toBeNull();
    expect(capturedPositions.at(-1)?.paragraphIndex).toBe(1);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 424, behavior: "auto" });
  });
});
