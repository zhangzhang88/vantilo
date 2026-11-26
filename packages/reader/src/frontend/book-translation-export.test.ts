import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inspectBookEpubRecord } from "../epub/book-record-contract";
import type { BookRecord } from "../shared/book-data-contract";
import {
  buildTranslatedBookEpub,
  resolveBookTranslationsForExport,
  sanitizeExportFilename,
  type BookExportAssets,
} from "./book-translation-export";
import { chapterTranslationTargets } from "./issue-translation";
import { translationCacheMetadata, type ParagraphTranslationRecord } from "./paragraph-translation-state";
import { bookReaderCollection } from "./reading-document-view";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_BYTES = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

function createSampleBook(): BookRecord {
  return {
    schemaVersion: 1,
    kind: "book",
    id: "book:meta:sample-export",
    sourceFilename: "sample.epub",
    sourceFingerprint: "fp:sample",
    title: "The Art & Science of <Reading>",
    authors: ["Jane Doe", "John Smith"],
    language: "en",
    publisher: "Sample Press",
    publishedAt: "2026-01-15",
    identifiers: ["urn:uuid:sample-export"],
    epubVersion: "3.0",
    navigationType: "nav",
    cover: { entryPath: "images/cover.png", mediaType: "image/png" },
    numberedChapterCount: 2,
    parts: [
      { id: "part:001:foundations", bookId: "book:meta:sample-export", order: 1, title: "Part I: Foundations", chapterIds: ["chapter:001:opening", "chapter:002:tables"] },
    ],
    chapters: [
      {
        id: "chapter:001:opening",
        bookId: "book:meta:sample-export",
        partId: "part:001:foundations",
        order: 1,
        role: "chapter",
        title: "Chapter 1: Opening",
        href: "ch1.xhtml",
        documentPath: "OEBPS/ch1.xhtml",
        contentFingerprint: "content:ch1",
        headings: [
          { kind: "heading", level: 1, text: "Chapter 1: Opening" },
          { kind: "heading", level: 2, text: "First Principles" },
        ],
        paragraphs: [
          "Reading deeply builds clarity\u0007 and calm.",
          "Figure 1: Reading diagram",
          "Practice turns understanding into skill.",
        ],
        blocks: [
          { kind: "heading", level: 1, text: "Chapter 1: Opening" },
          { kind: "paragraph", paragraphIndex: 0, text: "Reading deeply builds clarity\u0007 and calm." },
          { kind: "paragraph", paragraphIndex: 1, text: "Figure 1: Reading diagram" },
          { kind: "heading", level: 2, text: "First Principles" },
          { kind: "paragraph", paragraphIndex: 2, text: "Practice turns understanding into skill." },
        ],
        visuals: [
          {
            id: "vis-1",
            sourceOrder: 1,
            kind: "image",
            beforeParagraphIndex: 1,
            captionParagraphIndexes: [1],
            coveredParagraphIndexes: [],
            captionText: "",
            captionPlacement: "after",
            originalFragment: "",
            images: [{ entryPath: "images/diagram.png", alt: "Reading diagram" }],
          },
        ],
        wordCount: 15,
      },
      {
        id: "chapter:002:tables",
        bookId: "book:meta:sample-export",
        partId: "part:001:foundations",
        order: 2,
        role: "chapter",
        title: "Chapter 2: Summary",
        href: "ch2.xhtml",
        documentPath: "OEBPS/ch2.xhtml",
        contentFingerprint: "content:ch2",
        headings: [],
        paragraphs: [
          "Key Metrics",
          "Metric",
          "Value",
          "***",
          "Consistency matters most.",
        ],
        blocks: [
          { kind: "paragraph", paragraphIndex: 0, text: "Key Metrics" },
          { kind: "paragraph", paragraphIndex: 1, text: "Metric" },
          { kind: "paragraph", paragraphIndex: 2, text: "Value" },
          { kind: "paragraph", paragraphIndex: 3, text: "***" },
          { kind: "paragraph", paragraphIndex: 4, text: "Consistency matters most." },
        ],
        tables: [
          {
            id: "tbl-1",
            sourceOrder: 1,
            beforeParagraphIndex: 0,
            captionParagraphIndexes: [0],
            rows: [
              {
                section: "head",
                cells: [
                  { paragraphIndexes: [1], colSpan: 1, rowSpan: 1, header: true, scope: "col", images: [] },
                  { paragraphIndexes: [2], colSpan: 1, rowSpan: 1, header: true, scope: "col", images: [] },
                ],
              },
              {
                section: "body",
                cells: [
                  { paragraphIndexes: [3], colSpan: 2, rowSpan: 1, header: false, images: [{ dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`, alt: "spark" }] },
                ],
              },
            ],
          },
        ],
        wordCount: 9,
      },
    ],
  };
}

function buildFullRecords(book: BookRecord, overrides: Record<string, string> = {}): ParagraphTranslationRecord[] {
  const collection = bookReaderCollection(book);
  const records: ParagraphTranslationRecord[] = [];
  for (const document of collection.documents) {
    for (const target of chapterTranslationTargets(document)) {
      const context = {
        contextBefore: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex + 1],
      };
      const translationZh = overrides[target.sourceText] ?? `译文：${target.sourceText}`;
      records.push({
        ...target,
        translationZh,
        model: "gpt-test",
        provider: "easycliproxy",
        generatedAt: "2026-11-24T00:00:00.000Z",
        ...translationCacheMetadata({
          ...context,
          model: "gpt-test",
          provider: "easycliproxy",
          targetLanguage: "zh-CN",
          promptVersion: "paragraph-translation-v1",
        }),
      });
    }
  }
  return records;
}

describe("book translation EPUB export", () => {
  it("sanitizes filenames cleanly for both Chinese and bilingual exports", () => {
    expect(sanitizeExportFilename('The Art: "Reading" / 2026?', "zh")).toBe("The Art Reading 2026（中文译本）.epub");
    expect(sanitizeExportFilename("Sapiens", "bilingual")).toBe("Sapiens（中英对照）.epub");
  });

  it("enforces strict 100% completeness before allowing EPUB export", async () => {
    const book = createSampleBook();
    const collection = bookReaderCollection(book);
    const fullRecords = buildFullRecords(book);
    const partialRecords = fullRecords.slice(0, fullRecords.length - 1);

    const partial = resolveBookTranslationsForExport(book, collection, partialRecords);
    expect(partial.readiness.ready).toBe(false);
    expect(partial.readiness.remainingChapters).toBe(1);
    expect(partial.readiness.translatedTargets).toBe(fullRecords.length - 1);

    await expect(buildTranslatedBookEpub(book, partial, { mode: "zh" })).rejects.toThrow("100%");
  });

  it("builds a valid EPUB 3 + NCX package in pure Chinese mode that round-trips through Vantilo's EPUB parser", async () => {
    const book = createSampleBook();
    const collection = bookReaderCollection(book);
    const records = buildFullRecords(book, {
      "Chapter 1: Opening": "第一章：开篇",
      "First Principles": "第一性原理",
      "Reading deeply builds clarity\u0007 and calm.": "深度阅读带来清晰与平静。",
      "Practice turns understanding into skill.": "练习把理解转化为能力。",
      "Chapter 2: Summary": "第二章：总结",
      "Key Metrics": "核心指标",
      "Metric": "指标",
      "Value": "数值",
      "Consistency matters most.": "持续积累最为重要。",
    });
    const tocTitles = {
      parts: { "part:001:foundations": "第一部分：基础" },
      chapters: { "chapter:001:opening": "第一章：开篇" },
    };
    const resolved = resolveBookTranslationsForExport(book, collection, records, tocTitles);
    expect(resolved.readiness.ready).toBe(true);

    const assets: BookExportAssets = {
      cover: { mediaType: "image/png", bytes: TINY_PNG_BYTES },
      resources: new Map([["images/diagram.png", { mediaType: "image/png", bytes: TINY_PNG_BYTES }]]),
    };

    const epub = await buildTranslatedBookEpub(book, resolved, {
      mode: "zh",
      tocTitles,
      engineLabel: "测试模型",
      modifiedAt: new Date("2026-11-24T04:00:00.000Z"),
    }, assets);

    expect(epub.chapterCount).toBe(2);
    expect(epub.hasCover).toBe(true);
    expect(epub.imageCount).toBe(3); // cover + visual diagram + table inline image

    // Verify ZIP local file header starts with uncompressed "mimetype" = "application/epub+zip".
    const headerAscii = Buffer.from(epub.bytes.slice(0, 64)).toString("latin1");
    expect(headerAscii.slice(0, 4)).toBe("PK\x03\x04");
    expect(epub.bytes[8]).toBe(0); // compression method low byte = STORE (0)
    expect(epub.bytes[9]).toBe(0); // compression method high byte = STORE (0)
    expect(headerAscii).toContain("mimetypeapplication/epub+zip");

    const zip = await JSZip.loadAsync(epub.bytes);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    const ncx = await zip.file("OEBPS/toc.ncx")!.async("string");
    const ch1 = await zip.file("OEBPS/ch-001.xhtml")!.async("string");
    const ch2 = await zip.file("OEBPS/ch-002.xhtml")!.async("string");

    expect(opf).toContain("<dc:title>The Art &amp; Science of &lt;Reading&gt;（中文译本）</dc:title>");
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-24T04:00:00Z</meta>');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');

    expect(nav).toContain("第一部分：基础");
    expect(nav).toContain("第一章：开篇");
    expect(ncx).toContain("第二章：总结");

    // Pure Chinese mode renders translations without English source paragraphs and strips invalid XML chars.
    expect(ch1).toContain("<h1>第一章：开篇</h1>");
    expect(ch1).toContain("<h3>第一性原理</h3>");
    expect(ch1).toContain("<p>深度阅读带来清晰与平静。</p>");
    expect(ch1).not.toContain("Reading deeply builds");
    expect(ch1).not.toContain("\u0007");
    expect(ch1).toContain('<img src="images/img-001.png" alt="Reading diagram"/>');
    // Chapter title should not be duplicated as a second heading.
    expect(ch1.match(/第一章：开篇/g)?.length).toBe(2); // <title> + <h1>

    // Table with extracted image and preserved non-translatable cell ("***").
    expect(ch2).toContain("<table");
    expect(ch2).toContain("<p>核心指标</p>");
    expect(ch2).toContain("<p>***</p>");
    expect(ch2).toContain('<img src="images/tbl-002.png" alt="spark"/>');
    expect(ch2).toContain("<p>持续积累最为重要。</p>");

    // Round-trip through Vantilo's real EPUB parser to confirm reader compatibility!
    const dir = await mkdtemp(path.join(os.tmpdir(), "vantilo-epub-export-"));
    try {
      const filePath = path.join(dir, epub.filename);
      await writeFile(filePath, epub.bytes);
      const parsed = await inspectBookEpubRecord(filePath);
      expect(parsed.title).toBe("The Art & Science of <Reading>（中文译本）");
      expect(parsed.authors).toEqual(["Jane Doe", "John Smith"]);
      expect(parsed.cover).not.toBeNull();
      expect(parsed.chapters.length).toBeGreaterThanOrEqual(2);
      const allText = parsed.chapters.flatMap(chapter => chapter.paragraphs).join("\n");
      expect(allText).toContain("深度阅读带来清晰与平静。");
      expect(allText).toContain("持续积累最为重要。");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes both English source and Chinese translation in bilingual mode", async () => {
    const book = createSampleBook();
    const collection = bookReaderCollection(book);
    const records = buildFullRecords(book, {
      "Chapter 1: Opening": "第一章：开篇",
      "First Principles": "第一性原理",
      "Reading deeply builds clarity\u0007 and calm.": "深度阅读带来清晰与平静。",
    });
    const resolved = resolveBookTranslationsForExport(book, collection, records);

    const epub = await buildTranslatedBookEpub(book, resolved, { mode: "bilingual" });
    const zip = await JSZip.loadAsync(epub.bytes);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    const ch1 = await zip.file("OEBPS/ch-001.xhtml")!.async("string");

    expect(opf).toContain("<dc:language>zh-CN</dc:language>");
    expect(opf).toContain("<dc:language>en</dc:language>");
    expect(nav).toContain("第一章：开篇 · Chapter 1: Opening");
    expect(ch1).toContain('class="bilingual-heading-source"');
    expect(ch1).toContain("Chapter 1: Opening");
    expect(ch1).toContain('class="bilingual-source"');
    expect(ch1).toContain("Reading deeply builds clarity and calm.");
    expect(ch1).toContain('class="bilingual-translation"');
    expect(ch1).toContain("深度阅读带来清晰与平静。");
  });

  it("avoids duplicating the chapter title when the opening paragraph repeats it", async () => {
    const book = createSampleBook();
    book.chapters = [{
      ...book.chapters[0],
      title: "Preface",
      headings: [],
      visuals: [],
      paragraphs: ["Preface", "Opening body paragraph."],
      blocks: [
        { kind: "paragraph", paragraphIndex: 0, text: "Preface" },
        { kind: "paragraph", paragraphIndex: 1, text: "Opening body paragraph." },
      ],
    }];
    const collection = bookReaderCollection(book);
    const records = buildFullRecords(book, {
      Preface: "序言",
      "Opening body paragraph.": "这是正文第一段。",
    });
    const resolved = resolveBookTranslationsForExport(book, collection, records);
    const epub = await buildTranslatedBookEpub(book, resolved, { mode: "zh" });
    const zip = await JSZip.loadAsync(epub.bytes);
    const ch1 = await zip.file("OEBPS/ch-001.xhtml")!.async("string");

    expect(ch1).toContain("<h1>序言</h1>");
    expect(ch1).not.toContain("<p>序言</p>");
    expect(ch1).toContain("<p>这是正文第一段。</p>");
  });
});
