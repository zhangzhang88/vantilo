import { describe, expect, it } from "vitest";
import {
  clampProgress,
  emptyReaderState,
  loadReaderState,
  readingPositionKey,
  readerArticleProgress,
  READER_STATE_KEY,
  resolveArticleReadingPosition,
  saveReaderState,
} from "./reader-state";
import { buildReaderSentences, createSentenceReadingPosition } from "./sentence-reading";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("reader state", () => {
  it("persists article progress and the last reading position", () => {
    const storage = new MemoryStorage();
    const state = {
      ...emptyReaderState(),
      progress: { "economist:2026-09-19:a1": 47 },
      lastPosition: { issueId: "economist:2026-09-19", articleId: "a1" },
      positions: {
        "economist:2026-09-19:a1": {
          issueId: "economist:2026-09-19",
          articleId: "a1",
          paragraphIndex: 4,
          paragraphText: "The paragraph where reading stopped.",
          viewportOffset: 136,
        },
      },
    } as const;
    saveReaderState(storage, state);
    expect(loadReaderState(storage)).toEqual(state);
    expect(storage.getItem(READER_STATE_KEY)).toContain("a1");
  });

  it("migrates legacy Economist date-only ids", () => {
    const storage = new MemoryStorage();
    storage.setItem(READER_STATE_KEY, JSON.stringify({
      version: 1,
      progress: { "2026-09-19:a1": 47 },
      lastPosition: { issueId: "2026-09-19", articleId: "a1" },
      positions: {
        legacy: {
          issueId: "2026-09-19",
          articleId: "a1",
          paragraphIndex: 2,
          paragraphText: "Legacy paragraph.",
          viewportOffset: 120,
        },
      },
    }));
    expect(loadReaderState(storage)).toEqual({
      version: 1,
      progress: { "economist:2026-09-19:a1": 47 },
      lastPosition: { issueId: "economist:2026-09-19", articleId: "a1" },
      positions: {
        "economist:2026-09-19:a1": {
          issueId: "economist:2026-09-19",
          articleId: "a1",
          paragraphIndex: 2,
          paragraphText: "Legacy paragraph.",
          viewportOffset: 120,
        },
      },
      bookProgress: {},
      lastBookPosition: null,
      bookPositions: {},
      sentencePositions: {},
    });
  });

  it("persists Book progress separately without changing the Magazine lastPosition contract", () => {
    const storage = new MemoryStorage();
    const documentId = "reading:book:book:isbn:9780226239873:chapter:008:thinking-in-print";
    const state = {
      ...emptyReaderState(),
      progress: { "economist:2026-09-19:a1": 47 },
      lastPosition: { issueId: "economist:2026-09-19", articleId: "a1" },
      bookProgress: { [documentId]: 38 },
      lastBookPosition: { documentId, bookId: "book:isbn:9780226239873", chapterId: "chapter:008:thinking-in-print" },
      bookPositions: {
        [documentId]: {
          documentId,
          bookId: "book:isbn:9780226239873",
          chapterId: "chapter:008:thinking-in-print",
          paragraphIndex: 3,
          paragraphText: "Book paragraph.",
          viewportOffset: 128,
        },
      },
    } as const;
    saveReaderState(storage, state);
    expect(loadReaderState(storage)).toEqual(state);
  });

  it("persists validated sentence progress by document without changing v1 storage", () => {
    const storage = new MemoryStorage();
    const paragraphs = ["First sentence. The saved sentence."];
    const sentences = buildReaderSentences(paragraphs);
    const documentId = "reading:article:economist:2026-09-19:a1";
    const position = createSentenceReadingPosition(documentId, paragraphs, sentences, 1)!;
    const state = { ...emptyReaderState(), sentencePositions: { [documentId]: position } };
    saveReaderState(storage, state);
    expect(loadReaderState(storage)).toEqual(state);

    storage.setItem(READER_STATE_KEY, JSON.stringify({ ...state, sentencePositions: { invalid: { ...position, documentId: "invalid" } } }));
    expect(loadReaderState(storage).sentencePositions).toEqual({});
  });

  it("keeps old v1 state valid when precise positions do not exist", () => {
    const storage = new MemoryStorage();
    storage.setItem(READER_STATE_KEY, JSON.stringify({
      version: 1,
      progress: { "economist:2026-09-19:a1": 72 },
      lastPosition: { issueId: "economist:2026-09-19", articleId: "a1" },
    }));
    expect(loadReaderState(storage).positions).toEqual({});
  });

  it("resolves a moved paragraph only when the saved snapshot is unique", () => {
    const position = {
      issueId: "economist:2026-09-19",
      articleId: "a1",
      paragraphIndex: 1,
      paragraphText: "Saved paragraph.",
      viewportOffset: 140,
    };
    expect(resolveArticleReadingPosition(position, ["Intro", "Changed", "Saved paragraph."])).toBe(2);
    expect(resolveArticleReadingPosition(position, ["Saved paragraph.", "Changed", "Saved paragraph."])).toBeNull();
    expect(readingPositionKey("2026-09-19", "a1")).toBe("economist:2026-09-19:a1");
  });

  it("reserves 100 percent for reaching the real article end", () => {
    expect(readerArticleProgress(99.6, false)).toBe(99);
    expect(readerArticleProgress(140, false)).toBe(99);
    expect(readerArticleProgress(32.4, false)).toBe(32);
    expect(readerArticleProgress(32.4, true)).toBe(100);
  });

  it("clamps invalid progress and survives malformed storage", () => {
    expect(clampProgress(140)).toBe(100);
    expect(clampProgress(-5)).toBe(0);
    const storage = new MemoryStorage();
    storage.setItem(READER_STATE_KEY, "not-json");
    expect(loadReaderState(storage)).toEqual(emptyReaderState());
  });
});
