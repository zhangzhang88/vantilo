import { describe, expect, it } from "vitest";
import { findArticleMatches } from "./article-find";

describe("article find", () => {
  it("finds literal matches across paragraphs in source order", () => {
    expect(findArticleMatches([
      "AI can change work. AI can also change markets.",
      "Some people distrust ai systems.",
    ], "ai")).toEqual([
      { index: 0, paragraphIndex: 0, startOffset: 0, endOffset: 2 },
      { index: 1, paragraphIndex: 0, startOffset: 20, endOffset: 22 },
      { index: 2, paragraphIndex: 1, startOffset: 21, endOffset: 23 },
    ]);
  });

  it("does not cross paragraph boundaries or use fuzzy matching", () => {
    expect(findArticleMatches(["market", "forces"], "market forces")).toEqual([]);
    expect(findArticleMatches(["artificial intelligence"], "artficial")).toEqual([]);
  });

  it("ignores an empty query and uses non-overlapping matches", () => {
    expect(findArticleMatches(["anything"], "   ")).toEqual([]);
    expect(findArticleMatches(["aaaa"], "aa")).toEqual([
      { index: 0, paragraphIndex: 0, startOffset: 0, endOffset: 2 },
      { index: 1, paragraphIndex: 0, startOffset: 2, endOffset: 4 },
    ]);
  });

  it("honours the bounded match limit", () => {
    expect(findArticleMatches(["AI AI AI AI"], "AI", 2)).toHaveLength(2);
  });
});
