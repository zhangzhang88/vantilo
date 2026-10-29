import { describe, expect, it } from "vitest";
import type { Article } from "../shared/types.js";
import { MockAnalyzer } from "./mock-analyzer.js";

function article(): Article {
  return {
    id: "sample",
    issueId: "economist:2026-09-19",
    publicationId: "economist",
    href: "EPUB/sample.html",
    section: "Finance & economics",
    kicker: null,
    title: "A sample article about artificial intelligence",
    subtitle: "Investment is spreading through the wider economy.",
    author: "A Writer",
    publishedAt: "Sep 17th 2026",
    sourceUrl: null,
    bodyText: [
      "Artificial intelligence investment is reshaping corporate spending across several large industries.",
      "Companies are building data centres while governments debate how the gains should be shared.",
      "The first effects are visible in construction, power demand and semiconductor supply chains.",
      "Yet higher investment does not automatically translate into higher productivity for every worker.",
      "Economists therefore watch wages, consumption and business formation for evidence of broader gains.",
      "The outcome will depend on how quickly new tools diffuse beyond the largest technology firms.",
      "That process can take years even when headline investment grows very quickly.",
      "History suggests that infrastructure booms can create both durable capacity and wasteful excess.",
    ].join(" "),
    wordCount: 120,
    status: null,
    analysis: null,
  };
}

describe("MockAnalyzer", () => {
  it("returns the documented article-card and mining contract", () => {
    const source = article();
    const result = new MockAnalyzer().analyze(source);
    expect(result.provider).toBe("mock");
    expect(["High", "Medium", "Low"]).toContain(result.englishValue);
    expect(result.language.sentences.length).toBeGreaterThanOrEqual(3);
    expect(result.language.sentences.every((item) => source.bodyText.includes(item.text))).toBe(true);
    expect(result.idea.questions.length).toBe(5);
  });
});
