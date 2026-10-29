import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingDocumentTable } from "../shared/book-data-contract";
import { BookTable, renderBookLayout } from "./book-table";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity";

const table: ReadingDocumentTable = { id: "table", beforeParagraphIndex: 1, captionParagraphIndexes: [1], rows: [
  { section: "body", cells: [{ paragraphIndexes: [2], header: true, scope: "row", colSpan: 1, rowSpan: 2, images: [] }, { paragraphIndexes: [3], header: false, colSpan: 1, rowSpan: 1, images: [] }] },
  { section: "body", cells: [{ paragraphIndexes: [4], header: false, colSpan: 2, rowSpan: 1, images: [] }] },
] };
const renderParagraph = (index: number) => createElement("p", { "data-index": index }, `Paragraph ${index}`);

describe("source table layout", () => {
  it("keeps an original caption above its image and renders caption text only once", () => {
    const html = renderToStaticMarkup(createElement("main", null, renderBookLayout({ paragraphs: ["Caption before the image.", "Body after the figure."], identity: bookChapterReadingDocumentIdentity("book:one", "chapter:one"), visuals: [{ id: "image", kind: "image", beforeParagraphIndex: 0, captionParagraphIndexes: [0], coveredParagraphIndexes: [0], captionText: "", captionPlacement: "before", originalFragment: "figure", images: [{ entryPath: "Images/a.png", alt: "Original image" }] }] }, index => createElement("p", null, index === 0 ? "Caption before the image." : "Body after the figure."))));
    expect(html.match(/Caption before the image\./g)).toHaveLength(1);
    expect(html.indexOf("Caption before the image.")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("Body after the figure.")).toBeGreaterThan(html.indexOf("</figure>"));
  });
  it("keeps spanned rows in the same row group so rowspan works", () => {
    const html = renderToStaticMarkup(createElement(BookTable, { table, renderParagraph }));
    expect(html.match(/<tbody>/g)).toHaveLength(1);
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html).toContain('rowSpan="2" scope="row"');
    expect(html).toContain('colSpan="2"');
    expect(html).toContain('<caption><p data-index="1">Paragraph 1</p></caption>');
  });
  it("renders every paragraph once and keeps preceding headings outside tables", () => {
    const html = renderToStaticMarkup(createElement("main", null, renderBookLayout({ paragraphs: Array(6).fill("p"), tables: [table] }, renderParagraph,
      index => index === 1 ? createElement("h2", null, "Before table") : null)));
    for (let index = 0; index < 6; index++) expect(html.match(new RegExp(`data-index="${index}"`, "g"))).toHaveLength(1);
    expect(html.indexOf("Before table")).toBeLessThan(html.indexOf("<table"));
    expect(html.indexOf('data-index="5"')).toBeGreaterThan(html.indexOf("</table>"));
  });
  it("supports trailing image-only tables and rejects active image URLs at the rendering boundary", () => {
    const imageOnly: ReadingDocumentTable = { id: "empty", beforeParagraphIndex: 1, captionParagraphIndexes: [], rows: [{ section: "body", cells: [{ paragraphIndexes: [], colSpan: 1, rowSpan: 1, header: false, images: [{ dataUrl: "javascript:alert(1)", alt: "" }, { dataUrl: "data:image/svg+xml,bad", alt: "" }] }] }] };
    const html = renderToStaticMarkup(createElement("main", null, renderBookLayout({ paragraphs: ["p"], tables: [imageOnly] }, renderParagraph)));
    expect(html).toContain('data-book-table="empty"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });
});
