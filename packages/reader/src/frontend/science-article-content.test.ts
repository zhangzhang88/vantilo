import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScienceArticleContent } from "./science-article-content";
import type { ScienceArticle } from "../shared/science-article";

const article: ScienceArticle = {
  id: "a".repeat(64), title: "Charts in source order", author: "NOAA", publishedAt: null,
  sourceName: "NOAA Ocean Facts", sourceUrl: "https://oceanservice.noaa.gov/facts/charts.html", credit: "NOAA", savedAt: "2026-10-19T00:00:00.000Z", paragraphs: ["Legacy paragraph."], contentVersion: 2,
  blocks: [
    { kind: "paragraph", text: "Before the chart." },
    { kind: "figure", captionPlacement: "before", caption: "Figure 1. The original chart caption.", images: [{ id: "image-1", sourceUrl: "https://oceanservice.noaa.gov/chart.png", alt: "Original scientific chart", width: 120, height: 70, status: "cached", mediaId: "b".repeat(64), mimeType: "image/png" }] },
    { kind: "table", caption: "Original table", rows: [
      { section: "body", cells: [{ header: true, rowSpan: 2, colSpan: 1, blocks: [{ kind: "paragraph", text: "Region" }] }, { header: false, rowSpan: 1, colSpan: 3, blocks: [{ kind: "paragraph", text: "Original three-column span" }] }] },
      { section: "body", cells: [{ header: false, rowSpan: 1, colSpan: 3, blocks: [{ kind: "paragraph", text: "Below the first row" }] }] },
    ] },
    { kind: "paragraph", text: "After the chart." },
  ],
};

describe("science article content rendering", () => {
  it("uses local media only, preserves image proportions, caption position and table spans", () => {
    const html = renderToStaticMarkup(createElement(ScienceArticleContent, { article }));
    expect(html.indexOf("Before the chart.")).toBeLessThan(html.indexOf("<figure"));
    expect(html.indexOf("Figure 1.")).toBeLessThan(html.indexOf("<img"));
    expect(html.match(/The original chart caption/g)).toHaveLength(1);
    expect(html).toContain(`/api/science-articles/${article.id}/media/${"b".repeat(64)}`);
    expect(html).toContain('width="120" height="70"');
    expect(html).not.toContain('src="https:');
    expect(html).toContain('rowSpan="2"');
    expect(html).toContain('colSpan="3"');
    expect(html.match(/<tbody>/g)).toHaveLength(1);
    expect(html.indexOf("After the chart.")).toBeGreaterThan(html.indexOf("</table>"));
    expect(html).toContain('aria-label="查看原图"');
  });
  it("retains unavailable image descriptions and captions instead of leaving a broken image, and escapes source markup", () => {
    const copy: ScienceArticle = { ...article, blocks: [{ kind: "figure", caption: "Caption with <script>literal</script>", captionPlacement: "after", images: [{ id: "one", status: "unavailable", sourceUrl: "javascript:alert(1)", alt: "Original image description", reason: "Image download failed" }] }] };
    const html = renderToStaticMarkup(createElement(ScienceArticleContent, { article: copy }));
    expect(html).toContain("Original image description");
    expect(html).toContain("Image download failed");
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });
  it("continues to render legacy text-only records without a data migration", () => {
    const legacy = { ...article, blocks: undefined, contentVersion: undefined };
    expect(renderToStaticMarkup(createElement(ScienceArticleContent, { article: legacy }))).toContain("Legacy paragraph.");
  });
});
