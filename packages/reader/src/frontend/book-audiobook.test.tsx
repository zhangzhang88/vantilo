// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReaderAudiobookTranscript, type AudiobookTranscript } from "./book-audiobook";
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from "./reader-preferences";

afterEach(cleanup);

function makeTranscript(): AudiobookTranscript {
  return {
    sessionId: 1,
    sourceTitle: "Messy Jobs",
    error: "",
    paragraphIndex: 0,
    chunkIndex: 0,
    chunkText: "有两件事会让一份工作变得棘手。这可能是因为部分产出难以核验。",
    chunkSeconds: 3.5,
    chunkDuration: 6,
    paragraphs: {
      0: "有两件事会让一份工作变得棘手。这可能是因为部分产出难以核验。",
      1: "第二段内容继续展开。",
    },
    article: {
      id: "ch1",
      identity: { kind: "book-chapter", bookId: "book:1", chapterId: "ch1", documentId: "reading:book:book:1:ch1" },
      title: "Chapter 1",
      titleZh: "第一章",
      section: "Chapter",
      sectionZh: "章节",
      paragraphs: ["Paragraph one.", "Paragraph two."],
      blocks: [
        { kind: "paragraph", paragraphIndex: 0, text: "Paragraph one." },
        { kind: "paragraph", paragraphIndex: 1, text: "Paragraph two." },
      ],
      wordCount: 4,
      minutes: 1,
      progress: 0,
      status: "unread",
      hasGuide: false,
    },
  };
}

describe("ReaderAudiobookTranscript settings, pagination, and karaoke highlight", () => {
  it("supports live appearance drawer, double-page pagination, and sentence + character highlighting", () => {
    const onPreferencesChange = vi.fn();
    const prefs: ReaderPreferences = {
      ...DEFAULT_READER_PREFERENCES,
      layoutMode: "double",
      paperTint: "butter",
    };

    const { container } = render(
      <ReaderAudiobookTranscript
        transcript={makeTranscript()}
        scrollSequence={1}
        active
        following
        preferences={prefs}
        onPreferencesChange={onPreferencesChange}
        progressPercent={18}
        onBack={vi.fn()}
        onPlayFrom={vi.fn()}
      />,
    );

    // Topbar shows book title, whole-book percentage, and Aa settings trigger.
    expect(screen.getByText("18%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "阅读器设置" }));
    expect(screen.getByTestId("reader-appearance-drawer")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "单页模式" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ layoutMode: "single" });

    // Paginated viewport and controls are active in the translation view.
    expect(screen.getByTestId("reading-paginated-viewport")).toBeTruthy();
    const paginationBar = screen.getByTestId("reading-pagination-bar");
    expect(paginationBar).toBeTruthy();
    expect(paginationBar.querySelector(".reading-pagination-status")?.textContent?.trim()).toBe("1 / 1");
    expect(paginationBar.textContent).not.toContain("单页");
    expect(paginationBar.textContent).not.toContain("双页");

    // Per-paragraph "从本段听" buttons are removed from the translation view.
    expect(container.querySelector(".paragraph-listen-button")).toBeNull();
    expect(screen.queryByText(/从本段听/)).toBeNull();

    // Both sentence highlight and active character highlight render inside the spoken paragraph.
    const sentenceMark = container.querySelector(".audiobook-active-sentence");
    const charHighlight = container.querySelector(".audiobook-active-char");
    expect(sentenceMark?.textContent).toBe("这可能是因为部分产出难以核验。");
    expect(charHighlight?.textContent?.length).toBe(1);
  });

  it("opens the ReadifyAI-style selection popover and plays from the exact selected position", () => {
    const onPlayFrom = vi.fn();
    const { container } = render(
      <ReaderAudiobookTranscript
        transcript={makeTranscript()}
        scrollSequence={1}
        active={false}
        following={false}
        preferences={DEFAULT_READER_PREFERENCES}
        onBack={vi.fn()}
        onPlayFrom={onPlayFrom}
      />,
    );

    const firstParagraph = container.querySelector('[data-transcript-paragraph="0"] p')!;
    const textNode = firstParagraph.firstChild!;
    const fullText = firstParagraph.textContent ?? "";
    const start = fullText.indexOf("部分产出");
    const end = start + "部分产出".length;

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseUp(container.querySelector(".chinese-reading")!);

    const menu = screen.getByTestId("transcript-selection-menu");
    expect(menu).toBeTruthy();
    const listenHere = screen.getByRole("menuitem", { name: "听此处" });
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeTruthy();

    fireEvent.click(listenHere);
    expect(onPlayFrom).toHaveBeenCalledTimes(1);
    expect(onPlayFrom).toHaveBeenCalledWith(0, {
      chunkIndex: 0,
      chunkText: "部分产出难以核验。",
      speechOffset: start,
    });
    expect(screen.queryByTestId("transcript-selection-menu")).toBeNull();
  });

  it("dismisses the selection popover on Escape", () => {
    const { container } = render(
      <ReaderAudiobookTranscript
        transcript={makeTranscript()}
        scrollSequence={1}
        active={false}
        following={false}
        preferences={DEFAULT_READER_PREFERENCES}
        onBack={vi.fn()}
        onPlayFrom={vi.fn()}
      />,
    );

    const secondParagraph = container.querySelector('[data-transcript-paragraph="1"] p')!;
    const range = document.createRange();
    range.setStart(secondParagraph.firstChild!, 0);
    range.setEnd(secondParagraph.firstChild!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseUp(container.querySelector(".chinese-reading")!);
    expect(screen.getByTestId("transcript-selection-menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("transcript-selection-menu")).toBeNull();
  });

  it("enables hoverable click-to-play sentences only while playing, and disables them when paused or stopped", () => {
    const onPlayFrom = vi.fn();
    const playingTranscript: AudiobookTranscript = {
      ...makeTranscript(),
      phase: "playing",
    };

    const { container, rerender } = render(
      <ReaderAudiobookTranscript
        transcript={playingTranscript}
        scrollSequence={1}
        active
        following
        preferences={DEFAULT_READER_PREFERENCES}
        onBack={vi.fn()}
        onPlayFrom={onPlayFrom}
      />,
    );

    expect(container.querySelector(".audiobook-transcript-page.is-playing")).toBeTruthy();
    const hoverable = [...container.querySelectorAll(".audiobook-hoverable-sentence")];
    expect(hoverable.length).toBeGreaterThanOrEqual(2);
    const secondParagraphSentence = container.querySelector('[data-transcript-paragraph="1"] .audiobook-hoverable-sentence')!;
    expect(secondParagraphSentence.textContent).toBe("第二段内容继续展开。");

    // Clicking a hovered sentence while playing immediately starts playback from that sentence.
    window.getSelection()?.removeAllRanges();
    fireEvent.click(secondParagraphSentence);
    expect(onPlayFrom).toHaveBeenCalledWith(1, {
      chunkIndex: 0,
      chunkText: "第二段内容继续展开。",
      speechOffset: 0,
    });

    // When paused/stopped, sentences are NOT hoverable and do not highlight on hover.
    onPlayFrom.mockClear();
    rerender(
      <ReaderAudiobookTranscript
        transcript={{ ...playingTranscript, phase: "paused" }}
        scrollSequence={1}
        active
        following={false}
        preferences={DEFAULT_READER_PREFERENCES}
        onBack={vi.fn()}
        onPlayFrom={onPlayFrom}
      />,
    );
    expect(container.querySelector(".audiobook-transcript-page.is-playing")).toBeNull();
    expect(container.querySelectorAll(".audiobook-hoverable-sentence")).toHaveLength(0);
  });

  it("toggles the ReadifyAI-style left TOC sidebar from the topbar and switches chapters", () => {
    const onSelectChapter = vi.fn();
    render(
      <ReaderAudiobookTranscript
        transcript={makeTranscript()}
        scrollSequence={1}
        active
        following
        chapters={[
          { id: "ch1", title: "Chapter 1", titleZh: "序言" },
          { id: "ch2", title: "Cheap Cognition", titleZh: "廉价认知" },
        ]}
        onSelectChapter={onSelectChapter}
        preferences={DEFAULT_READER_PREFERENCES}
        onBack={vi.fn()}
        onPlayFrom={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("reader-toc-sidebar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目录" }));

    const sidebar = screen.getByTestId("reader-toc-sidebar");
    expect(sidebar).toBeTruthy();
    const firstChapter = screen.getByRole("button", { name: "序言" });
    const secondChapter = screen.getByRole("button", { name: "廉价认知" });
    expect(firstChapter.getAttribute("aria-current")).toBe("location");
    expect(secondChapter.getAttribute("aria-current")).toBeNull();

    fireEvent.click(secondChapter);
    expect(onSelectChapter).toHaveBeenCalledWith("ch2");
  });
});
