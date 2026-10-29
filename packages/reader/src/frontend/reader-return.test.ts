import { describe, expect, it } from "vitest";
import { createReaderReturnTarget } from "./reader-return";

describe("reader return target", () => {
  it("maps every supported source to its reader return label", () => {
    expect(createReaderReturnTarget("search")).toEqual({ page: "search", label: "搜索" });
    expect(createReaderReturnTarget("bookmarks")).toEqual({ page: "bookmarks", label: "稍后阅读" });
    expect(createReaderReturnTarget("history")).toEqual({ page: "history", label: "阅读历史" });
    expect(createReaderReturnTarget("notes")).toEqual({ page: "notes", label: "笔记" });
    expect(createReaderReturnTarget("vocabulary")).toEqual({ page: "vocabulary", label: "词汇" });
  });

  it("keeps a trimmed detail only when it contains visible text", () => {
    expect(createReaderReturnTarget("vocabulary", "  good  ")).toEqual({ page: "vocabulary", label: "词汇", detail: "good" });
    expect(createReaderReturnTarget("search", "   ")).toEqual({ page: "search", label: "搜索" });
  });
});
