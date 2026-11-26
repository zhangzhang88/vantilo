// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookRecord } from "../shared/book-data-contract";
import { BookExportPanel } from "./book-export-controls";
import * as exportModule from "./book-translation-export";
import { chineseTranslationStorage } from "./chinese-translation-reuse";
import { chapterTranslationTargets, saveIssueTranslationEngine } from "./issue-translation";
import { saveParagraphTranslations, translationCacheMetadata } from "./paragraph-translation-state";
import { getReaderStorage } from "./reader-storage";
import { bookReaderCollection } from "./reading-document-view";

const ENGINE_ID = "custom-api:0123456789ab";

function createTwoChapterBook(): BookRecord {
  return {
    schemaVersion: 1,
    kind: "book",
    id: "book:meta:ui-export",
    sourceFilename: "ui-export.epub",
    sourceFingerprint: "fp:ui-export",
    title: "Deep Work",
    authors: ["Cal Newport"],
    language: "en",
    publisher: null,
    publishedAt: null,
    identifiers: [],
    epubVersion: "3.0",
    navigationType: "nav",
    cover: null,
    numberedChapterCount: 2,
    parts: [],
    chapters: [
      {
        id: "chapter:001:one",
        bookId: "book:meta:ui-export",
        partId: null,
        order: 1,
        role: "chapter",
        title: "Chapter 1",
        href: "ch1.xhtml",
        documentPath: "OEBPS/ch1.xhtml",
        contentFingerprint: "fp:1",
        headings: [],
        paragraphs: ["Focus is rare."],
        blocks: [{ kind: "paragraph", paragraphIndex: 0, text: "Focus is rare." }],
        wordCount: 3,
      },
      {
        id: "chapter:002:two",
        bookId: "book:meta:ui-export",
        partId: null,
        order: 2,
        role: "chapter",
        title: "Chapter 2",
        href: "ch2.xhtml",
        documentPath: "OEBPS/ch2.xhtml",
        contentFingerprint: "fp:2",
        headings: [],
        paragraphs: ["Focus is valuable."],
        blocks: [{ kind: "paragraph", paragraphIndex: 0, text: "Focus is valuable." }],
        wordCount: 3,
      },
    ],
  };
}

function seedTranslations(book: BookRecord, chaptersToTranslate: number) {
  const collection = bookReaderCollection(book);
  const records = collection.documents.slice(0, chaptersToTranslate).flatMap(document =>
    chapterTranslationTargets(document).map(target => {
      const context = {
        contextBefore: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex + 1],
      };
      return {
        ...target,
        translationZh: `中文：${target.sourceText}`,
        model: "gpt-test",
        provider: "easycliproxy" as const,
        generatedAt: "2026-11-24T00:00:00.000Z",
        ...translationCacheMetadata({
          ...context,
          model: "gpt-test",
          provider: "easycliproxy",
          targetLanguage: "zh-CN",
          promptVersion: "paragraph-translation-v1",
        }),
      };
    }),
  );
  const storage = getReaderStorage();
  saveIssueTranslationEngine(`book-batch:${book.id}`, ENGINE_ID);
  saveParagraphTranslations(chineseTranslationStorage(storage, ENGINE_ID), records);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("BookExportPanel", () => {
  it("disables export and shows remaining chapters when full-book translation is incomplete", async () => {
    const book = createTwoChapterBook();
    const collection = bookReaderCollection(book);
    seedTranslations(book, 1);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      engines: [{ id: ENGINE_ID, label: "测试模型" }],
    }), { status: 200 }));

    render(<BookExportPanel book={book} collection={collection} />);

    const status = await screen.findByText(/已完成 1\/2 章/);
    expect(status.textContent).toContain("还差 1 章");
    const button = screen.getByRole("button", { name: "导出 EPUB" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables export at 100% completion, switches mode, and triggers EPUB download even when engines API is offline", async () => {
    const book = createTwoChapterBook();
    const collection = bookReaderCollection(book);
    seedTranslations(book, 2);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const downloadSpy = vi.spyOn(exportModule, "triggerEpubDownload").mockImplementation(() => {});

    render(<BookExportPanel book={book} collection={collection} />);

    const button = await screen.findByRole("button", { name: "导出 EPUB" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("导出内容"), { target: { value: "bilingual" } });
    fireEvent.click(button);

    await waitFor(() => expect(downloadSpy).toHaveBeenCalledOnce());
    const exported = downloadSpy.mock.calls[0][0];
    expect(exported.filename).toBe("Deep Work（中英对照）.epub");
    expect(exported.bytes.byteLength).toBeGreaterThan(200);
    expect(screen.getByText(/已导出：Deep Work（中英对照）\.epub/)).toBeTruthy();
  });
});
