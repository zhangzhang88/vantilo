import { describe, expect, it } from "vitest";
import {
  articleToReadingDocument,
  bookChapterToReadingDocument,
  bookChapterContentFingerprint,
  createBookChapterId,
  createBookId,
  isbnFromIdentifiers,
  type BookRecord,
} from "../shared/book-data-contract.js";
import type { Article } from "../shared/types.js";
import { bookRecordFromSpikeReport } from "./book-record-contract.js";
import type { BookEpubSpikeReport } from "./book-parser-spike.js";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import { paragraphTranslationTarget } from "../frontend/paragraph-translation-state.js";
import { readerNoteBelongsToDocument, type ReaderNote } from "../frontend/notes-state.js";

function roleReport(entries: Array<{ title: string; opening?: string[]; headings?: string[] }>): BookEpubSpikeReport {
  const fixture = report();
  fixture.parts = [];
  fixture.partCount = 0;
  fixture.chapterCount = 0;
  fixture.readableUnits = entries.map(({ title, opening = [], headings = [] }, index) => {
    const blocks = [
      ...headings.map((text) => ({ kind: "heading" as const, level: 1 as const, text })),
      ...opening.map((text) => ({ kind: "paragraph" as const, text })),
      { kind: "paragraph" as const, text: `Body of unit ${index + 1}.` },
    ];
    return {
      title, part: null, href: `Text/chapters.xhtml#section-${index + 1}`,
      documentPath: "OEBPS/Text/chapters.xhtml", headings: blocks.filter((block) => block.kind === "heading"),
      paragraphCount: blocks.filter((block) => block.kind === "paragraph").length, blocks,
    };
  });
  fixture.readableUnitCount = fixture.readableUnits.length;
  return fixture;
}

function report(documentPathSuffix = "v1"): BookEpubSpikeReport {
  return {
    schemaVersion: 1,
    sourceFilename: `research-${documentPathSuffix}.epub`,
    metadata: {
      title: "The Craft of Research, Fourth Edition",
      authors: ["Booth, Wayne C.", "Colomb, Gregory G."],
      language: "en",
      publisher: "University of Chicago Press",
      publishedAt: "2016-10-07",
      identifiers: ["3877376244", "9780226239873"],
      epubVersion: "2.0",
    },
    navigationType: "ncx",
    navigationNodeCount: 10,
    navigationMaxDepth: 3,
    cover: { entryPath: "OEBPS/Images/cover.jpg", mediaType: "image/jpeg", byteLength: 1234 },
    partCount: 1,
    chapterCount: 1,
    readableUnitCount: 4,
    parts: [{ title: "I Research", readableUnitTitles: ["1 Thinking in Print", "Prologue"] }],
    readableUnits: [
      {
        title: "Preface",
        part: null,
        href: "Text/preface.xhtml#preface",
        documentPath: `OEBPS/Text/${documentPathSuffix}/preface.xhtml`,
        headings: [{ kind: "heading", level: 1, text: "Preface" }],
        paragraphCount: 1,
        blocks: [
          { kind: "heading", level: 1, text: "Preface" },
          { kind: "paragraph", text: "This preface explains the aims of the edition." },
        ],
      },
      {
        title: "1 Thinking in Print",
        part: "I Research",
        href: "Text/ch1.xhtml#ch1",
        documentPath: `OEBPS/Text/${documentPathSuffix}/ch1.xhtml`,
        headings: [
          { kind: "heading", level: 1, text: "1 Thinking in Print" },
          { kind: "heading", level: 2, text: "1.1 WHAT IS RESEARCH?" },
        ],
        paragraphCount: 2,
        blocks: [
          { kind: "heading", level: 1, text: "1 Thinking in Print" },
          { kind: "paragraph", text: "Research is a process of asking and answering questions." },
          { kind: "heading", level: 2, text: "1.1 WHAT IS RESEARCH?" },
          { kind: "paragraph", text: "Writing helps researchers test what they think they know." },
        ],
      },
      {
        title: "Prologue",
        part: "I Research",
        href: "Text/prologue.xhtml#prologue",
        documentPath: `OEBPS/Text/${documentPathSuffix}/prologue.xhtml`,
        headings: [{ kind: "heading", level: 1, text: "Prologue" }],
        paragraphCount: 1,
        blocks: [
          { kind: "heading", level: 1, text: "Prologue" },
          { kind: "paragraph", text: "A short bridge prepares the reader for the next part." },
        ],
      },
      {
        title: "Index",
        part: null,
        href: "Text/index.xhtml#index",
        documentPath: `OEBPS/Text/${documentPathSuffix}/index.xhtml`,
        headings: [{ kind: "heading", level: 1, text: "Index" }],
        paragraphCount: 1,
        blocks: [
          { kind: "heading", level: 1, text: "Index" },
          { kind: "paragraph", text: "argument, evidence, research, writing" },
        ],
      },
    ],
  };
}

function article(): Article {
  return {
    id: "article-1",
    issueId: "economist:2026-09-19",
    publicationId: "economist",
    href: "EPUB/article.xhtml",
    section: "Finance & economics",
    kicker: "AI boom",
    title: "A magazine article",
    subtitle: null,
    author: "Example Author",
    publishedAt: "2026-09-19",
    sourceUrl: "https://example.test/article",
    bodyText: "First article paragraph.\n\nSecond article paragraph.",
    wordCount: 6,
    status: null,
    analysis: null,
  };
}

describe("Book Data Contract V0.1", () => {
  it("prefers a valid ISBN for stable book identity and ignores invalid ISBN-like identifiers", () => {
    expect(isbnFromIdentifiers(["3877376244", "9780226239873"])).toBe("9780226239873");
    expect(createBookId({
      title: "The Craft of Research, Fourth Edition",
      authors: ["Booth, Wayne C."],
      publisher: "University of Chicago Press",
      identifiers: ["3877376244", "9780226239873"],
    })).toBe("book:isbn:9780226239873");
  });

  it("falls back from ISBN to EPUB identifier hash and finally metadata hash", () => {
    const identifierBook = createBookId({
      title: "A Book",
      authors: ["Author One"],
      publisher: "Press",
      identifiers: ["urn:uuid:7f618f29-13d2-4e9b-bc5a-example"],
    });
    const metadataBook = createBookId({
      title: "A Book",
      authors: ["Author One"],
      publisher: "Press",
      identifiers: [],
    });
    const sameMetadataBook = createBookId({
      title: "  A   Book ",
      authors: ["Author One"],
      publisher: "Press",
      identifiers: [],
    });

    expect(identifierBook).toMatch(/^book:id:[0-9a-f]{16}$/);
    expect(metadataBook).toMatch(/^book:meta:[0-9a-f]{16}$/);
    expect(sameMetadataBook).toBe(metadataBook);
    expect(identifierBook).not.toBe(metadataBook);
  });

  it("keeps book and chapter ids independent from EPUB filename and internal XHTML paths", () => {
    const first = bookRecordFromSpikeReport(report("layout-a"), "aaa");
    const second = bookRecordFromSpikeReport(report("layout-b"), "bbb");

    expect(first.id).toBe("book:isbn:9780226239873");
    expect(second.id).toBe(first.id);
    expect(second.sourceFilename).not.toBe(first.sourceFilename);
    expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint);
    expect(second.chapters.map((chapter) => chapter.id)).toEqual(first.chapters.map((chapter) => chapter.id));
    expect(second.chapters.map((chapter) => chapter.documentPath)).not.toEqual(first.chapters.map((chapter) => chapter.documentPath));
    expect(createBookChapterId(2, "1 Thinking in Print")).toBe("chapter:002:1-thinking-in-print");
  });

  it("maps readable units into explicit roles while preserving heading order and paragraph coordinates", () => {
    const book = bookRecordFromSpikeReport(report(), "sha256:abc");

    expect(book.numberedChapterCount).toBe(1);
    expect(book.chapters.map((chapter) => chapter.role)).toEqual(["frontmatter", "chapter", "supplement", "backmatter"]);
    expect(book.parts).toHaveLength(1);
    expect(book.parts[0].chapterIds).toEqual([book.chapters[1].id, book.chapters[2].id]);
    expect(book.chapters[1].blocks).toEqual([
      { kind: "heading", level: 1, text: "1 Thinking in Print" },
      { kind: "paragraph", paragraphIndex: 0, text: "Research is a process of asking and answering questions." },
      { kind: "heading", level: 2, text: "1.1 WHAT IS RESEARCH?" },
      { kind: "paragraph", paragraphIndex: 1, text: "Writing helps researchers test what they think they know." },
    ]);
    expect(book.chapters[1].paragraphs).toEqual([
      "Research is a process of asking and answering questions.",
      "Writing helps researchers test what they think they know.",
    ]);
    expect(book.chapters[1].contentFingerprint).toMatch(/^content:[0-9a-f]{16}$/);
  });

  it("classifies numbered top-level chapters even when a book has no Part groups", () => {
    const noPart = report();
    noPart.parts = [];
    noPart.partCount = 0;
    noPart.readableUnits = [{ ...noPart.readableUnits[1], part: null }];
    noPart.readableUnitCount = 1;
    noPart.chapterCount = 1;

    const book = bookRecordFromSpikeReport(noPart, "sha256:no-part");
    expect(book.parts).toEqual([]);
    expect(book.numberedChapterCount).toBe(1);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].role).toBe("chapter");
  });

  it("recognizes explicit Arabic, Roman, spelled-out and Chinese chapter titles without changing titles", () => {
    const titles = ["Chapter 1", "Chapter 01", "CHAPTER I", "CHAPTER XI", "CHAPTER XXVII", "Chapter One", "第十一章", "1 Introduction", "“At the door.” CHAPTERXXVIII."];
    const fixture = roleReport(titles.map((title) => ({ title, headings: [title] })));
    const book = bookRecordFromSpikeReport(fixture, "sha256:role-titles");

    expect(book.chapters.map((chapter) => chapter.role)).toEqual(titles.map(() => "chapter"));
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(titles);
    expect(book.numberedChapterCount).toBe(titles.length);
  });

  it("uses only short standalone chapter markers near the beginning of an unnumbered unit", () => {
    const fixture = roleReport([
      { title: "WHO ARE YOU?", opening: ["Opening image caption.", "CHAPTER ONE", "WHO ARE YOU?"] },
      { title: "WHAT IS CRITICAL THINKING?", opening: ["CHAPTER TWO", "WHAT IS CRITICAL THINKING?"] },
      { title: "FORMING JUDGMENTS", opening: ["CHAPTER TWENTY-TWO"] },
      { title: "Later heading", headings: ["Chapter XI: Further Inquiry"] },
      { title: "Other content", opening: ["In chapter one the author made another argument."] },
      { title: "Not at the start", opening: ["A", "B", "C", "D", "E", "CHAPTER THREE"] },
    ]);
    const book = bookRecordFromSpikeReport(fixture, "sha256:content-evidence");

    expect(book.chapters.map((chapter) => chapter.role)).toEqual(["chapter", "chapter", "chapter", "chapter", "supplement", "supplement"]);
    expect(book.numberedChapterCount).toBe(4);
  });

  it("excludes navigation and legal pages before considering apparent chapter markers", () => {
    const fixture = roleReport([
      "Title Page", "1 Copyright Page", "Contents", "Table of Contents", "Index", "License", "THE FULL PROJECT GUTENBERG™ LICENSE",
    ].map((title) => ({ title, opening: ["CHAPTER ONE"] })));
    const book = bookRecordFromSpikeReport(fixture, "sha256:non-chapters");

    expect(book.chapters.map((chapter) => chapter.role)).toEqual(Array(7).fill("supplement"));
    expect(book.numberedChapterCount).toBe(0);
  });

  it("preserves Craft's 17 chapters and recognizes all 22 Beyond and 61 Pride chapters in generated reports", () => {
    const craft = bookRecordFromSpikeReport(roleReport([
      ...Array.from({ length: 6 }, (_, index) => ({ title: `Preface ${index + 1}` })),
      ...Array.from({ length: 17 }, (_, index) => ({ title: `${index + 1} Research Topic` })),
      ...Array.from({ length: 7 }, (_, index) => ({ title: `Supplement ${index + 1}` })),
      { title: "Index" },
    ]), "sha256:craft-pattern");
    const chapterWords = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY", "TWENTY-ONE", "TWENTY-TWO"];
    const beyond = bookRecordFromSpikeReport(roleReport([
      ...["Cover", "Copyright", "Contents", "Preface"].map((title) => ({ title })),
      ...chapterWords.map((number, index) => ({ title: `TOPIC ${index + 1}?`, opening: ["Opening caption.", `CHAPTER ${number}`] })),
    ]), "sha256:beyond-pattern");
    const romanChapters = Array.from({ length: 61 }, (_, index) => {
      let remainder = index + 1;
      let numeral = "";
      for (const [value, symbol] of [[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
        while (remainder >= value) { numeral += symbol; remainder -= value; }
      }
      return { title: `CHAPTER ${numeral}.`, headings: [`CHAPTER ${numeral}.`] };
    });
    const pride = bookRecordFromSpikeReport(roleReport([
      { title: "Contents" }, ...romanChapters, { title: "THE FULL PROJECT GUTENBERG™ LICENSE" },
    ]), "sha256:pride-pattern");

    expect(craft.chapters).toHaveLength(31);
    expect(craft.numberedChapterCount).toBe(17);
    expect(beyond.chapters).toHaveLength(26);
    expect(beyond.numberedChapterCount).toBe(22);
    expect(pride.chapters).toHaveLength(63);
    expect(pride.numberedChapterCount).toBe(61);
    expect(pride.chapters[11].title).toBe("CHAPTER XI.");
    expect(pride.chapters[27].title).toBe("CHAPTER XXVII.");
    expect([craft, beyond, pride].map((book) => book.chapters.filter((chapter) => chapter.role === "supplement").length)).toEqual([14, 4, 2]);
  });

  it("keeps all Book identities and content coordinates independent of role inference", () => {
    const fixture = roleReport([{ title: "CHAPTER XI", opening: ["A paragraph.", "A second paragraph."] }, { title: "WHO ARE YOU?", opening: ["CHAPTER ONE"] }]);
    const book = bookRecordFromSpikeReport(fixture, "sha256:identity-invariant");
    expect(book.id).toBe(createBookId(fixture.metadata));

    book.chapters.forEach((chapter, index) => {
      const unit = fixture.readableUnits[index];
      const expectedBlocks = unit.blocks.map((block, blockIndex) => block.kind === "heading" ? block : {
        ...block, paragraphIndex: unit.blocks.slice(0, blockIndex).filter((previous) => previous.kind === "paragraph").length,
      });
      expect(chapter).toMatchObject({
        id: createBookChapterId(index + 1, unit.title), bookId: book.id, title: unit.title, order: index + 1,
        href: unit.href, documentPath: unit.documentPath, blocks: expectedBlocks,
        contentFingerprint: bookChapterContentFingerprint(expectedBlocks),
      });
      const identity = bookChapterReadingDocumentIdentity(book.id, chapter.id);
      expect(identity.documentId).toBe(`reading:book:${book.id}:${createBookChapterId(index + 1, unit.title)}`);
      expect(paragraphTranslationTarget({ document: identity, paragraphIndex: 0, sourceText: chapter.paragraphs[0] }).key).toBe(`${identity.documentId}:0`);
      const note: ReaderNote = { id: `note-${index}`, document: identity, text: "Note", createdAt: "2026-09-27T00:00:00.000Z" };
      expect(readerNoteBelongsToDocument(note, identity)).toBe(true);
    });
  });

  it("projects magazine articles and book chapters into one ReadingDocument contract", () => {
    const articleDocument = articleToReadingDocument(article());
    const book = bookRecordFromSpikeReport(report(), "abc");
    const chapterDocument = bookChapterToReadingDocument(book, book.chapters[1]);

    expect(articleDocument.source.kind).toBe("article");
    expect(articleDocument.id).toBe("reading:article:economist:2026-09-19:article-1");
    expect(articleDocument.blocks).toEqual([
      { kind: "paragraph", paragraphIndex: 0, text: "First article paragraph." },
      { kind: "paragraph", paragraphIndex: 1, text: "Second article paragraph." },
    ]);

    expect(chapterDocument.source.kind).toBe("book-chapter");
    expect(chapterDocument.id).toBe(`reading:book:${book.id}:${book.chapters[1].id}`);
    expect(chapterDocument.paragraphs).toEqual(book.chapters[1].paragraphs);
    expect(chapterDocument.blocks[0]).toEqual({ kind: "heading", level: 1, text: "1 Thinking in Print" });
    expect(chapterDocument.blocks[1]).toEqual({ kind: "paragraph", paragraphIndex: 0, text: book.chapters[1].paragraphs[0] });
  });
});
