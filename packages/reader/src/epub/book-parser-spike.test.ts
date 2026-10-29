import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { bookRecordFromSpikeReport } from "./book-record-contract.js";
import { inspectBookEpubSpike } from "./book-parser-spike.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeFixture(chapterHtml?: string): Promise<string> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fixture Research Book</dc:title>
    <dc:creator>Author One</dc:creator>
    <dc:creator>Author Two</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Fixture Press</dc:publisher>
    <dc:date>2026-09-27</dc:date>
    <dc:identifier id="bookid">9780000000001</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/>
    <item id="part" href="Text/part.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="part"/><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`);
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
<navMap>
  <navPoint id="part"><navLabel><text>I Research</text></navLabel><content src="Text/part.xhtml#part"/>
    <navPoint id="ch1"><navLabel><text>1 First Chapter</text></navLabel><content src="Text/ch1.xhtml#ch1"/>
      <navPoint id="ch1s"><navLabel><text>1.1 First Section</text></navLabel><content src="Text/ch1.xhtml#s1"/></navPoint>
    </navPoint>
    <navPoint id="ch2"><navLabel><text>2 Second Chapter</text></navLabel><content src="Text/ch2.xhtml#ch2"/></navPoint>
  </navPoint>
</navMap>
</ncx>`);
  zip.file("OEBPS/Text/part.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>I Research</h1></body></html>`);
  zip.file("OEBPS/Text/ch1.xhtml", chapterHtml ?? `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>1 First Chapter</h1><p>Opening paragraph for the first chapter.</p><h2>1.1 FIRST SECTION</h2><p>Second paragraph with evidence.</p></body></html>`);
  zip.file("OEBPS/Images/blank.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=", "base64"));
  zip.file("OEBPS/Images/unsafe.svg", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  zip.file("OEBPS/Text/ch2.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>2 Second Chapter</h1><p>Only paragraph in the second chapter.</p></body></html>`);
  zip.file("OEBPS/Images/cover.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const dir = await mkdtemp(path.join(os.tmpdir(), "book-parser-spike-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "fixture.epub");
  await writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  return filePath;
}

async function writeSharedXhtmlNavFixture(chapterHtml?: string): Promise<string> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<package version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Shared Chapters</dc:title><dc:identifier>fixture-shared-chapters</dc:identifier></metadata><manifest><item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapters" href="Text/chapters.xhtml" media-type="application/xhtml+xml"/><item id="ending" href="Text/ending.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapters"/><itemref idref="ending"/></spine></package>`);
  zip.file("OEBPS/toc.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapters.xhtml#opening">Opening</a></li><li><a href="Text/chapters.xhtml#chapter-one">Chapter I.</a></li><li><a href="Text/chapters.xhtml#tip">Quick Tip</a></li><li><a href="Text/chapters.xhtml#chapter-two">Chapter II.</a></li><li><a href="Text/ending.xhtml#ending">Epilogue</a></li></ol></nav></body></html>`);
  zip.file("OEBPS/Text/chapters.xhtml", chapterHtml ?? `<html xmlns="http://www.w3.org/1999/xhtml"><body><div><h1 id="opening">Opening</h1><p>Opening paragraph.</p></div><h2><span id="chapter-one">Chapter I.</span></h2><p>First chapter paragraph.</p><h3>Inner heading</h3><p id="tip">Quick Tip.</p><p>More first chapter text.</p><a name="chapter-two"></a><h2>Chapter II.</h2><p>Second chapter paragraph.</p></body></html>`);
  zip.file("OEBPS/Text/ending.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="ending">Epilogue</h1><p>Final paragraph.</p></body></html>`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "book-parser-nav-shared-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "shared.epub");
  await writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  return filePath;
}

describe("Book EPUB Parser Spike V0.1", () => {
  it("preserves source table rows, titles, headers, blank images and anchors without changing old paragraph fingerprints", async () => {
    const body = `<h1>1 First Chapter</h1><p>Opening paragraph.</p>
      <table><tbody><tr><td colspan="2"><p class="Table-Title">Table 1 Rate these traits.</p></td></tr>
      <tr><td><p>Eye colour</p></td><td><p><img alt="" src="../Images/blank.png"/></p></td></tr>
      <tr><td><p>Spatial ability</p><p>(e.g., navigation)</p></td><td/></tr></tbody></table>
      <p>Compare the results.</p><table><caption><p>Table 2 Research results.</p></caption><thead><tr><th/><th scope="col"><p>Survey</p></th><th scope="col"><p>Research</p></th></tr></thead>
      <tbody><tr><th scope="row" rowspan="2"><p>Eye colour</p></th><td><p>77%</p></td><td><p>95%</p></td></tr>
      <tr><td colspan="2"><p>Same source row.</p></td></tr></tbody></table><p>Closing paragraph.</p>`;
    const report = await inspectBookEpubSpike(await writeFixture(`<html><body>${body}</body></html>`));
    const book = bookRecordFromSpikeReport(report, "fixture");
    const chapter = book.chapters[0];
    expect(chapter.paragraphs).toEqual(["Opening paragraph.", "Table 1 Rate these traits.", "Eye colour", "Spatial ability", "(e.g., navigation)", "Compare the results.", "Table 2 Research results.", "Survey", "Research", "Eye colour", "77%", "95%", "Same source row.", "Closing paragraph."]);
    expect(chapter.tables).toHaveLength(2);
    expect(chapter.tables![0]).toMatchObject({ beforeParagraphIndex: 1, captionParagraphIndexes: [1], rows: [
      { section: "body", cells: [{ paragraphIndexes: [2] }, { paragraphIndexes: [], images: [{ dataUrl: expect.stringMatching(/^data:image\/png;base64,/), width: 1, height: 1 }] }] },
      { section: "body", cells: [{ paragraphIndexes: [3, 4] }, { paragraphIndexes: [], images: [] }] },
    ] });
    expect(chapter.tables![1]).toMatchObject({ beforeParagraphIndex: 6, captionParagraphIndexes: [6], rows: [
      { section: "head", cells: [{ header: true }, { paragraphIndexes: [7], header: true, scope: "col" }, { paragraphIndexes: [8], header: true }] },
      { section: "body", cells: [{ paragraphIndexes: [9], rowSpan: 2, header: true, scope: "row" }, { paragraphIndexes: [10] }, { paragraphIndexes: [11] }] },
      { section: "body", cells: [{ paragraphIndexes: [12], colSpan: 2 }] },
    ] });
    const flat = `<html><body><h1>1 First Chapter</h1>${chapter.paragraphs.map(text => `<p>${text}</p>`).join("")}</body></html>`;
    const old = bookRecordFromSpikeReport(await inspectBookEpubSpike(await writeFixture(flat)), "fixture");
    expect(chapter.contentFingerprint).toBe(old.chapters[0].contentFingerprint);
    expect(chapter.blocks).toEqual(old.chapters[0].blocks);
  });

  it("keeps direct cell text and safe header semantics and rejects active or external table assets", async () => {
    const report = await inspectBookEpubSpike(await writeFixture(`<html><body><h1>1 First Chapter</h1>
      <table><caption>Direct caption</caption><tbody><tr><td class="Basic-Table _1-Table-Head">Survey</td><td>Research</td></tr></tbody></table>
      <table><tbody><tr><td>77%</td><td><img src="https://example.com/a.png"/><img src="data:image/svg+xml,bad"/><img src="../Images/unsafe.svg"/><img src="file:///private/a.png"/></td></tr></tbody></table></body></html>`));
    const chapter = bookRecordFromSpikeReport(report, "fixture").chapters[0];
    expect(chapter.paragraphs).toEqual(["Direct caption", "Survey", "Research", "77%"]);
    expect(chapter.tables![0].rows[0].cells[0].header).toBe(true);
    expect(chapter.tables).toHaveLength(1);
    expect(chapter.visuals).toMatchObject([{ kind: "original", reason: "unavailable-image", images: [], coveredParagraphIndexes: [3] }]);
  });

  it("rebases table anchors when chapters share one XHTML document", async () => {
    const html = `<html><body><h1 id="opening">Opening</h1><p>Intro.</p><h2 id="chapter-one">Chapter I.</h2><p>First.</p><table><tr><td><p id="tip">First cell.</p></td><td><p>11%</p></td></tr></table>
      <h2 id="chapter-two">Chapter II.</h2><p>Second.</p><table><tr><td><p>Second cell.</p></td><td><p>22%</p></td></tr></table></body></html>`;
    const book = bookRecordFromSpikeReport(await inspectBookEpubSpike(await writeSharedXhtmlNavFixture(html)), "fixture");
    for (const chapter of book.chapters.slice(1, 3)) {
      expect(chapter.tables).toHaveLength(1);
      expect(chapter.tables![0]).toMatchObject({ beforeParagraphIndex: 1, rows: [{ cells: [{ paragraphIndexes: [1] }, { paragraphIndexes: [2] }] }] });
    }
    expect(book.chapters[1].paragraphs[1]).toBe("First cell.");
    expect(book.chapters[2].paragraphs[1]).toBe("Second cell.");
    expect(book.chapters[0].tables).toBeUndefined();
  });

  it("preserves EPUB2 metadata, hierarchy, cover, readable chapter documents and internal headings", async () => {
    const report = await inspectBookEpubSpike(await writeFixture());

    expect(report.metadata).toEqual({
      title: "Fixture Research Book",
      authors: ["Author One", "Author Two"],
      language: "en",
      publisher: "Fixture Press",
      publishedAt: "2026-09-27",
      identifiers: ["9780000000001"],
      epubVersion: "2.0",
    });
    expect(report.navigationType).toBe("ncx");
    expect(report.navigationNodeCount).toBe(4);
    expect(report.navigationMaxDepth).toBe(3);
    expect(report.partCount).toBe(1);
    expect(report.chapterCount).toBe(2);
    expect(report.readableUnitCount).toBe(2);
    expect(report.cover).toMatchObject({ entryPath: "OEBPS/Images/cover.jpg", mediaType: "image/jpeg", byteLength: 4 });
    expect(report.parts).toEqual([{ title: "I Research", readableUnitTitles: ["1 First Chapter", "2 Second Chapter"] }]);
    expect(report.readableUnits[0]).toMatchObject({
      title: "1 First Chapter",
      part: "I Research",
      documentPath: "OEBPS/Text/ch1.xhtml",
      paragraphCount: 2,
      headings: [
        { kind: "heading", level: 1, text: "1 First Chapter" },
        { kind: "heading", level: 2, text: "1.1 FIRST SECTION" },
      ],
    });
    expect(report.readableUnits[0].blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
  });

  it("segments EPUB3 NAV chapters sharing one XHTML by their anchors without changing roles", async () => {
    const report = await inspectBookEpubSpike(await writeSharedXhtmlNavFixture());
    expect(report.navigationType).toBe("nav");
    expect(report.navigationNodeCount).toBe(5);
    expect(report.readableUnitCount).toBe(4);
    expect(report.readableUnits.map((unit) => unit.title)).toEqual(["Opening", "Chapter I.", "Chapter II.", "Epilogue"]);
    expect(report.readableUnits.slice(0, 3).map((unit) => unit.documentPath)).toEqual(Array(3).fill("OEBPS/Text/chapters.xhtml"));
    expect(report.readableUnits.map((unit) => unit.blocks)).toEqual([
      [{ kind: "heading", level: 1, text: "Opening" }, { kind: "paragraph", text: "Opening paragraph." }],
      [{ kind: "heading", level: 2, text: "Chapter I." }, { kind: "paragraph", text: "First chapter paragraph." }, { kind: "heading", level: 3, text: "Inner heading" }, { kind: "paragraph", text: "Quick Tip." }, { kind: "paragraph", text: "More first chapter text." }],
      [{ kind: "heading", level: 2, text: "Chapter II." }, { kind: "paragraph", text: "Second chapter paragraph." }],
      [{ kind: "heading", level: 1, text: "Epilogue" }, { kind: "paragraph", text: "Final paragraph." }],
    ]);

    const book = bookRecordFromSpikeReport(report, "sha256:fixture");
    expect(book.id).toBe("book:id:106690d576301059");
    expect(book.chapters.map((chapter) => chapter.role)).toEqual(["supplement", "chapter", "chapter", "supplement"]);
    expect(book.numberedChapterCount).toBe(2);
    expect(book.chapters.map((chapter) => chapter.blocks.filter((block) => block.kind === "paragraph").map((block) => block.paragraphIndex))).toEqual([[0], [0, 1, 2], [0], [0]]);
  });
});
