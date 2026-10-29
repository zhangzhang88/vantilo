import { describe, expect, it } from "vitest";
import { isChapterNumberParagraph, isTranslatableText } from "./translation-text.js";

describe("chapter number translation boundary", () => {
  it("recognizes a leading number only with a matching Book title and next paragraph", () => {
    expect(isChapterNumberParagraph("7", 0, "7 Why children differ", "Why children differ")).toBe(true);
    expect(isChapterNumberParagraph("11", 0, "11 Gene-hunting", "\u00adGene-\u00adhunting")).toBe(true);
    expect(isChapterNumberParagraph("7", 0, "Chapter 7: Why children differ", "Why children differ")).toBe(true);
  });
  it("keeps ordinary numeric paragraphs, Magazine numbers, and short sentences translatable", () => {
    expect(isChapterNumberParagraph("7", 1, "7 Why children differ", "Why children differ")).toBe(false);
    expect(isChapterNumberParagraph("7", 0, undefined, "Why children differ")).toBe(false);
    expect(isChapterNumberParagraph("7", 0, "8 Why children differ", "Why children differ")).toBe(false);
    expect(isChapterNumberParagraph("7", 0, "7 Why children differ", "There were seven children.")).toBe(false);
    expect(isChapterNumberParagraph("7 children", 0, "7 Why children differ", "Why children differ")).toBe(false);
    expect(isTranslatableText("7")).toBe(true);
  });
});

describe("isTranslatableText", () => {
  it.each(["", "　\n", "—", "–", ". . .", "***", "• ◆ ⁂", "\u200b"])("rejects decorations: %j", (text) => {
    expect(isTranslatableText(text)).toBe(false);
  });
  it.each(["I", "A", "1", "Chapter 1", "你好", "é", "α", "一", "— Hello —"])("preserves meaningful short and Unicode text: %j", (text) => {
    expect(isTranslatableText(text)).toBe(true);
  });
});
