import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  bookChapterContentFingerprint,
  createBookChapterId,
  createBookId,
  createBookPartId,
  type BookChapter,
  type BookChapterRole,
  type BookRecord,
  type ReadingDocumentBlock,
  type ReadingDocumentTable,
  type ReadingDocumentVisual,
} from "../shared/book-data-contract.js";
import { countWords } from "./epub-core.js";
import { inspectBookEpubSpike, type BookEpubSpikeReport, type BookReadableUnitSpike } from "./book-parser-spike.js";

function normalizedSourceFingerprint(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function numberedChapterTitle(title: string): boolean {
  return /^\d+\s+\S/.test(title.trim());
}

const shortNumber = "one|two|three|four|five|six|seven|eight|nine";
const wordNumber = `(?:${shortNumber}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:${shortNumber}))?)`;
const chapterNumber = `(?:\\d+|[IVXLCDM]+|${wordNumber})`;
const chapterTitleStart = new RegExp(`^chapter\\s*${chapterNumber}(?=$|[\\s.:!?：—–-])`, "i");
const chapterTitleEnd = new RegExp(`\\bchapter\\s*${chapterNumber}[.!?：]?\\s*$`, "i");
const standaloneChapterLabel = new RegExp(`^chapter\\s*${chapterNumber}[.!?：]?\\s*$`, "i");

function nonChapterTitle(title: string): boolean {
  const normalized = title.trim().replace(/^(?:\d+|[IVXLCDM]+)[.\s-]+/i, "");
  return /^(?:title page|copyright(?: page)?|(?:table of )?contents|index|license)(?:$|[\s.:：])/i.test(normalized)
    || /^the full project gutenberg(?:™)? license$/i.test(normalized);
}

function hasChapterNumber(unit: BookReadableUnitSpike): boolean {
  if (nonChapterTitle(unit.title)) return false;
  const title = unit.title.trim();
  if (numberedChapterTitle(title) || /^第[〇零一二三四五六七八九十百千万两\d]+章/.test(title) || chapterTitleStart.test(title)) return true;
  if (chapterTitleEnd.test(title) && unit.headings.slice(0, 3).some((heading) => chapterTitleEnd.test(heading.text))) return true;
  return unit.blocks.slice(0, 5).some((block) => {
    const text = block.text.trim();
    return block.kind === "heading" ? chapterTitleStart.test(text) : standaloneChapterLabel.test(text);
  });
}

function blocksForUnit(unit: BookReadableUnitSpike): ReadingDocumentBlock[] {
  let paragraphIndex = 0;
  return unit.blocks.map((block) => {
    if (block.kind === "heading") return { ...block };
    const paragraph = { kind: "paragraph" as const, paragraphIndex, text: block.text };
    paragraphIndex += 1;
    return paragraph;
  });
}

function chapterRole(unit: BookReadableUnitSpike, orderIndex: number, firstPartIndex: number, lastPartIndex: number): BookChapterRole {
  if (hasChapterNumber(unit)) return "chapter";
  if (unit.part) return "supplement";
  if (firstPartIndex >= 0 && orderIndex < firstPartIndex) return "frontmatter";
  if (lastPartIndex >= 0 && orderIndex > lastPartIndex) return "backmatter";
  return "supplement";
}

export function bookRecordFromSpikeReport(report: BookEpubSpikeReport, sourceFingerprint: string): BookRecord {
  const bookId = createBookId(report.metadata);
  const partIdByTitle = new Map(report.parts.map((part, index) => [part.title, createBookPartId(index + 1, part.title)]));
  const partUnitIndexes = report.readableUnits
    .map((unit, index) => unit.part ? index : -1)
    .filter((index) => index >= 0);
  const firstPartIndex = partUnitIndexes.length ? Math.min(...partUnitIndexes) : -1;
  const lastPartIndex = partUnitIndexes.length ? Math.max(...partUnitIndexes) : -1;

  const chapters: BookChapter[] = report.readableUnits.map((unit, index) => {
    const blocks = blocksForUnit(unit);
    const paragraphs = blocks.flatMap((block) => block.kind === "paragraph" ? [block.text] : []);
    const headings = blocks.filter((block) => block.kind === "heading");
    const paragraphAtBlock = new Map(blocks.flatMap((block, index) => block.kind === "paragraph" ? [[index, block.paragraphIndex] as const] : []));
    const paragraphIndexes = (indexes: number[]) => indexes.flatMap(index => paragraphAtBlock.has(index) ? [paragraphAtBlock.get(index)!] : []);
    const tables: ReadingDocumentTable[] = (unit.tables ?? []).map(table => ({
      id: table.id,
      ...(table.sourceOrder !== undefined ? { sourceOrder: table.sourceOrder } : {}),
      beforeParagraphIndex: blocks.slice(0, table.startBlockIndex).filter(block => block.kind === "paragraph").length,
      captionParagraphIndexes: paragraphIndexes(table.captionBlockIndexes),
      rows: table.rows.map(row => ({ ...row, cells: row.cells.map(({ blockIndexes, ...cell }) => ({ ...cell, paragraphIndexes: paragraphIndexes(blockIndexes) })) })),
    }));
    const visuals: ReadingDocumentVisual[] = (unit.visuals ?? []).map(({ startBlockIndex, ownerBlockIndex: _owner, captionBlockIndexes, coveredBlockIndexes, ...visual }) => ({
      ...visual, beforeParagraphIndex: blocks.slice(0, startBlockIndex).filter(block => block.kind === "paragraph").length,
      captionParagraphIndexes: paragraphIndexes(captionBlockIndexes), coveredParagraphIndexes: paragraphIndexes(coveredBlockIndexes),
    }));
    return {
      id: createBookChapterId(index + 1, unit.title),
      bookId,
      partId: unit.part ? partIdByTitle.get(unit.part) ?? null : null,
      order: index + 1,
      role: chapterRole(unit, index, firstPartIndex, lastPartIndex),
      title: unit.title,
      href: unit.href,
      documentPath: unit.documentPath,
      contentFingerprint: bookChapterContentFingerprint(blocks),
      headings,
      paragraphs,
      blocks,
      ...(tables.length ? { tables } : {}),
      ...(visuals.length ? { visuals } : {}),
      wordCount: countWords(paragraphs.join("\n\n")),
    };
  });

  const parts = report.parts.map((part, index) => ({
    id: partIdByTitle.get(part.title)!,
    bookId,
    order: index + 1,
    title: part.title,
    chapterIds: chapters.filter((chapter) => chapter.partId === partIdByTitle.get(part.title)).map((chapter) => chapter.id),
  }));

  return {
    schemaVersion: 1,
    kind: "book",
    id: bookId,
    sourceFilename: report.sourceFilename,
    sourceFingerprint: normalizedSourceFingerprint(sourceFingerprint),
    title: report.metadata.title,
    authors: report.metadata.authors,
    language: report.metadata.language,
    publisher: report.metadata.publisher,
    publishedAt: report.metadata.publishedAt,
    identifiers: report.metadata.identifiers,
    epubVersion: report.metadata.epubVersion,
    navigationType: report.navigationType,
    cover: report.cover ? { entryPath: report.cover.entryPath, mediaType: report.cover.mediaType } : null,
    numberedChapterCount: chapters.filter((chapter, index) => chapter.role === "chapter" && hasChapterNumber(report.readableUnits[index])).length,
    parts,
    chapters,
  };
}

export async function inspectBookEpubRecord(filePath: string): Promise<BookRecord> {
  const source = await readFile(filePath);
  const fingerprint = createHash("sha256").update(source).digest("hex");
  const report = await inspectBookEpubSpike(filePath);
  return bookRecordFromSpikeReport(report, fingerprint);
}
