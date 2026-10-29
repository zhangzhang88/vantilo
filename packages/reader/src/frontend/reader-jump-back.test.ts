import { describe, expect, it } from "vitest";
import { captureReaderJumpBackTarget, resolveReaderJumpBackTarget } from "./reader-jump-back";

describe("reader jump back", () => {
  it("captures the visible paragraph and preserves sentence mode metadata", () => {
    const target = captureReaderJumpBackTarget({
      documentId: "reading:article:economist:2026-09-19:article-1",
      paragraphs: ["zero", "one", "two"],
      metrics: [
        { paragraphIndex: 0, top: -120, bottom: 40 },
        { paragraphIndex: 1, top: 64, bottom: 220 },
        { paragraphIndex: 2, top: 248, bottom: 380 },
      ],
      anchorY: 120,
      mode: "sentence",
      sentenceIndex: 4,
    });

    expect(target).toEqual({
      documentId: "reading:article:economist:2026-09-19:article-1",
      position: {
        paragraphIndex: 1,
        paragraphText: "one",
        viewportOffset: 64,
      },
      mode: "sentence",
      sentenceIndex: 4,
    });
  });

  it("resolves a uniquely moved paragraph snapshot without changing the stored viewport offset", () => {
    const resolved = resolveReaderJumpBackTarget({
      documentId: "reading:article:economist:2026-09-19:article-1",
      position: {
        paragraphIndex: 1,
        paragraphText: "one",
        viewportOffset: -32,
      },
      mode: "article",
    }, "reading:article:economist:2026-09-19:article-1", ["intro", "new", "one"], 8);

    expect(resolved).toEqual({ paragraphIndex: 2, viewportOffset: -32, mode: "article" });
  });

  it("supports Book ReadingDocument identity without issue/article fields", () => {
    const target = captureReaderJumpBackTarget({
      documentId: "reading:book:book:test:chapter:001:one",
      paragraphs: ["Book paragraph."],
      metrics: [{ paragraphIndex: 0, top: 80, bottom: 180 }],
      anchorY: 120,
      mode: "article",
    });
    expect(resolveReaderJumpBackTarget(target, "reading:book:book:test:chapter:001:one", ["Book paragraph."], 1)).toEqual({
      paragraphIndex: 0,
      viewportOffset: 80,
      mode: "article",
    });
  });

  it("rejects stale article identity and invalid sentence targets", () => {
    const target = {
      documentId: "reading:article:economist:2026-09-19:article-1",
      position: {
        paragraphIndex: 0,
        paragraphText: "zero",
        viewportOffset: 0,
      },
      mode: "sentence" as const,
      sentenceIndex: 9,
    };

    expect(resolveReaderJumpBackTarget(target, "reading:article:economist:2026-09-19:article-2", ["zero"], 10)).toBeNull();
    expect(resolveReaderJumpBackTarget(target, "reading:article:economist:2026-09-19:article-1", ["zero"], 2)).toBeNull();
  });
});
