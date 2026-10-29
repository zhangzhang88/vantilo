import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { visualBookEpub } from "../../tests/fixtures/visual-book-epub.js";
import { inspectBookEpubRecord } from "./book-record-contract.js";
import { zipReference } from "./book-visuals.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function inspect(options?: Parameters<typeof visualBookEpub>[0]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-visuals-")); roots.push(root);
  const file = path.join(root, "visual.epub"); await writeFile(file, await visualBookEpub(options));
  return inspectBookEpubRecord(file);
}

describe("book presentation inspection", () => {
  it("preserves image position and caption anchors and detects SVG, MathML, complex CSS and unavailable resources", async () => {
    const chapter = (await inspect()).chapters[0];
    expect(chapter.paragraphs).toEqual(["Opening source paragraph.", "Figure 1. Red and blue bars.", "Middle source paragraph.", "Formula: E=mc2 in its original context.", "Vector table label", "Missing asset caption.", "Closing source paragraph."]);
    expect(chapter.visuals).toHaveLength(6);
    expect(chapter.visuals![0]).toMatchObject({ kind: "image", beforeParagraphIndex: 1, captionParagraphIndexes: [1], coveredParagraphIndexes: [1], originalFragment: "photo", images: [{ entryPath: "OEBPS/Images/chart.png", alt: "Red and blue bars" }] });
    expect(chapter.visuals!.slice(1).map(visual => visual.reason)).toEqual(["svg", "formula", "complex-layout", "svg", "unavailable-image"]);
    expect(chapter.visuals![2]).toMatchObject({ coveredParagraphIndexes: [3], originalFragment: "equation" });
    expect(chapter.visuals![4]).toMatchObject({ coveredParagraphIndexes: [4], originalFragment: "vector-table" });
    expect(chapter.tables).toBeUndefined();
    expect(chapter.visuals!.map(visual => visual.sourceOrder)).toEqual([...chapter.visuals!.map(visual => visual.sourceOrder)].sort((a, b) => a! - b!));
  });
  it("keeps standalone image-only chapters and explicit captions without manufacturing paragraphs", async () => {
    const chapter = (await inspect({ body: '<h1 id="chapter">1 Figures and evidence</h1><div class="image"><img src="../Images/chart.png"/></div><p class="Figure-Caption">A source caption.</p><img src="../Images/chart.png"/>' })).chapters[0];
    expect(chapter.paragraphs).toEqual(["A source caption."]);
    expect(chapter.visuals).toMatchObject([{ kind: "image", beforeParagraphIndex: 0, captionParagraphIndexes: [0] }, { kind: "image", beforeParagraphIndex: 1 }]);
    const imageOnly = (await inspect({ body: '<h1 id="chapter">1 Figures and evidence</h1><img src="../Images/chart.png"/>' })).chapters[0];
    expect(imageOnly.paragraphs).toEqual([]);
    expect(imageOnly.visuals).toMatchObject([{ kind: "image", beforeParagraphIndex: 0 }]);
  });
  it("preserves an entire fixed layout page as one original area", async () => {
    const chapter = (await inspect({ fixedLayout: true })).chapters[0];
    expect(chapter.visuals).toHaveLength(1);
    expect(chapter.visuals![0]).toMatchObject({ kind: "original", reason: "complex-layout", originalFragment: "reader-original-body", coveredParagraphIndexes: [0,1,2,3,4,5,6] });
    expect(chapter.tables).toBeUndefined();
  });
  it("keeps a multi-panel image group intact through the original view", async () => {
    const chapter = (await inspect({ body: '<h1 id="chapter">1 Figures and evidence</h1><figure id="panels"><img src="../Images/chart.png"/><img src="../Images/chart.png"/><figcaption><p>Two original panels.</p></figcaption></figure>' })).chapters[0];
    expect(chapter.visuals).toMatchObject([{ kind: "original", reason: "complex-layout", originalFragment: "panels", sourceImageCount: 2, coveredParagraphIndexes: [0], images: [] }]);
  });
  it("preserves publisher caption paragraphs and captions placed above an image", async () => {
    const chapter = (await inspect({ body: '<h1 id="chapter">1 Figures and evidence</h1><div class="image"><img src="../Images/chart.png"/><p class="PublisherNumber">Figure 3</p><p class="PublisherDescription">Source description.</p></div><figure><figcaption><p>Caption above the image.</p></figcaption><img src="../Images/chart.png"/></figure>' })).chapters[0];
    expect(chapter.visuals).toMatchObject([{ kind: "image", captionParagraphIndexes: [0,1], captionPlacement: "after" }, { kind: "image", captionParagraphIndexes: [2], captionPlacement: "before" }]);
  });
  it("keeps text mixed with inline imagery in one original context", async () => {
    const chapter = (await inspect({ body: '<h1 id="chapter">1 Figures and evidence</h1><p>Before <img src="../Images/chart.png"/> after.</p>' })).chapters[0];
    expect(chapter.visuals).toMatchObject([{ kind: "original", reason: "complex-layout", coveredParagraphIndexes: [0] }]);
  });
  it("flags missing source styles without failing the import or pretending the layout was preserved", async () => {
    const chapter = (await inspect({ body: '<link rel="stylesheet" href="missing.css"/><h1 id="chapter">1 Figures and evidence</h1><p>Original text remains available.</p>' })).chapters[0];
    expect(chapter.paragraphs).toEqual(["Original text remains available."]);
    expect(chapter.visuals).toMatchObject([{ kind: "original", reason: "complex-layout", originalFragment: "reader-original-body", coveredParagraphIndexes: [0] }]);
  });
  it("keeps images before the next chapter heading and rebases trailing images to the correct shared-XHTML chapter", async () => {
    const book = await inspect({ secondChapter: true, body: '<h1 id="chapter">1 Figures and evidence</h1><p>First chapter.</p><img src="../Images/chart.png"/><h2 id="two">2 More figures</h2><p>Second chapter.</p><img src="../Images/chart.png"/>' });
    expect(book.chapters).toHaveLength(2);
    for (const chapter of book.chapters) expect(chapter.visuals).toMatchObject([{ kind: "image", beforeParagraphIndex: 1 }]);
    expect(book.chapters.map(chapter => chapter.paragraphs)).toEqual([["First chapter."], ["Second chapter."]]);
  });
  it("resolves archive assets without allowing filesystem or remote references", () => {
    expect(zipReference("OEBPS/Text/one.xhtml", "../Images/a%20b.png")).toBe("OEBPS/Images/a b.png");
    for (const value of ["https://outside.invalid/a.png", "file:///etc/passwd", "/etc/passwd", "../../../etc/passwd", "..\\private", "%00x", "%2Fetc/passwd"]) expect(zipReference("OEBPS/one.xhtml", value)).toBeNull();
  });
});
