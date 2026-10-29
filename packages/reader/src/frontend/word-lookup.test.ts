import { describe, expect, it } from "vitest";
import { clickableWordSegments, isDictionaryWord } from "./word-lookup";

describe("word lookup segmentation", () => {
  it("finds clickable English words and preserves exact paragraph offsets", () => {
    const segments = clickableWordSegments("Mary's bank is well-run.", 10).filter((item) => item.isWord);
    expect(segments.map((item) => [item.text, item.startOffset])).toEqual([
      ["Mary's", 10],
      ["bank", 17],
      ["is", 22],
      ["well-run", 25],
    ]);
  });

  it("recognises one dictionary word but not a multi-word phrase", () => {
    expect(isDictionaryWord("husband")).toBe(true);
    expect(isDictionaryWord("well-known")).toBe(true);
    expect(isDictionaryWord("riding a wave")).toBe(false);
  });
});
