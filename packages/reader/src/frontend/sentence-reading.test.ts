import { describe, expect, it } from "vitest";
import { buildReaderSentences, readerSentenceIndexForOffset, readerSentenceProgress } from "./sentence-reading";

describe("sentence reading", () => {
  it("splits article paragraphs into ordered sentence locations", () => {
    expect(buildReaderSentences([
      "WHAT IS AI good for? That question has been asked for years.",
      "A final sentence",
    ])).toEqual([
      { key: "0:0", paragraphIndex: 0, startOffset: 0, endOffset: 20, text: "WHAT IS AI good for?" },
      { key: "0:21", paragraphIndex: 0, startOffset: 21, endOffset: 60, text: "That question has been asked for years." },
      { key: "1:0", paragraphIndex: 1, startOffset: 0, endOffset: 16, text: "A final sentence" },
    ]);
  });

  it("maps a clicked word offset to the sentence that contains it", () => {
    const sentences = buildReaderSentences([
      "WHAT IS AI good for? If polls of Americans are anything to go by, not much.",
      "A final sentence.",
    ]);

    expect(readerSentenceIndexForOffset(sentences, 0, 24)).toBe(1);
    expect(readerSentenceIndexForOffset(sentences, 1, 2)).toBe(2);
    expect(readerSentenceIndexForOffset(sentences, 2, 0)).toBe(-1);
  });

  it("reserves 100 percent for the actual final sentence", () => {
    expect(readerSentenceProgress(0, 201)).toBe(0);
    expect(readerSentenceProgress(199, 201)).toBe(99);
    expect(readerSentenceProgress(200, 201)).toBe(100);
    expect(readerSentenceProgress(0, 1)).toBe(100);
    expect(readerSentenceProgress(-1, 10)).toBe(0);
  });

  it("trims inter-sentence whitespace while preserving source offsets", () => {
    const sentences = buildReaderSentences(["  First.   Second!  "]);
    expect(sentences).toEqual([
      { key: "0:2", paragraphIndex: 0, startOffset: 2, endOffset: 8, text: "First." },
      { key: "0:11", paragraphIndex: 0, startOffset: 11, endOffset: 18, text: "Second!" },
    ]);
  });
});
