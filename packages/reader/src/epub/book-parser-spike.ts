import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeSpace } from "./epub-core.js";
import type { ReadingTableCell, ReadingTableImage } from "../shared/book-data-contract.js";
import { inspectBookVisuals, type BookVisualSpike } from "./book-visuals.js";

const posix = path.posix;

export interface BookMetadataSpike {
  title: string;
  authors: string[];
  language: string | null;
  publisher: string | null;
  publishedAt: string | null;
  identifiers: string[];
  epubVersion: string;
}

export interface BookTocNodeSpike {
  title: string;
  href: string | null;
  depth: number;
  children: BookTocNodeSpike[];
}

export interface BookContentHeadingSpike {
  kind: "heading";
  level: 1 | 2 | 3;
  text: string;
}

export interface BookContentParagraphSpike {
  kind: "paragraph";
  text: string;
}

export type BookContentBlockSpike = BookContentHeadingSpike | BookContentParagraphSpike;

export interface BookContentTableSpike {
  id: string;
  sourceOrder?: number;
  startBlockIndex: number;
  captionBlockIndexes: number[];
  rows: Array<{ section: "head" | "body" | "foot"; cells: Array<Omit<ReadingTableCell, "paragraphIndexes"> & { blockIndexes: number[] }> }>;
}

export interface BookReadableUnitSpike {
  title: string;
  part: string | null;
  href: string;
  documentPath: string;
  headings: BookContentHeadingSpike[];
  paragraphCount: number;
  blocks: BookContentBlockSpike[];
  tables?: BookContentTableSpike[];
  visuals?: BookVisualSpike[];
}

export interface BookEpubSpikeReport {
  schemaVersion: 1;
  sourceFilename: string;
  metadata: BookMetadataSpike;
  navigationType: "nav" | "ncx";
  navigationNodeCount: number;
  navigationMaxDepth: number;
  cover: {
    entryPath: string;
    mediaType: string;
    byteLength: number;
  } | null;
  partCount: number;
  chapterCount: number;
  readableUnitCount: number;
  parts: Array<{ title: string; readableUnitTitles: string[] }>;
  readableUnits: BookReadableUnitSpike[];
}

function firstMetadataText($: cheerio.CheerioAPI, suffix: string): string | null {
  const element = $("metadata").first().children().toArray().find((item) => item.tagName.toLowerCase().endsWith(suffix));
  return element ? normalizeSpace($(element).text()) || null : null;
}

function allMetadataText($: cheerio.CheerioAPI, suffix: string): string[] {
  return $("metadata").first().children().toArray()
    .filter((item) => item.tagName.toLowerCase().endsWith(suffix))
    .map((item) => normalizeSpace($(item).text()))
    .filter(Boolean);
}

function packagePathFromContainer(containerXml: string): string {
  const $ = cheerio.load(containerXml, { xmlMode: true });
  const packagePath = $("rootfile").first().attr("full-path");
  if (!packagePath) throw new Error("EPUB container does not declare a package document");
  return packagePath;
}

function resolvePackageHref(packagePath: string, href: string): string {
  return posix.normalize(posix.join(posix.dirname(packagePath), href));
}

function resolveNavigationHref(navigationPath: string, href: string): string {
  return posix.normalize(posix.join(posix.dirname(navigationPath), href.split("#")[0]));
}

function navigationManifestItem(packageXml: string, packagePath: string): { path: string; type: "nav" | "ncx" } {
  const $ = cheerio.load(packageXml, { xmlMode: true });
  const manifest = $("manifest item").toArray();
  const nav = manifest.find((item) => ($(item).attr("properties") ?? "").split(/\s+/).includes("nav"));
  if (nav) {
    const href = $(nav).attr("href");
    if (href) return { path: resolvePackageHref(packagePath, href), type: "nav" };
  }
  const ncx = manifest.find((item) => $(item).attr("media-type") === "application/x-dtbncx+xml" || $(item).attr("id") === "ncx");
  if (ncx) {
    const href = $(ncx).attr("href");
    if (href) return { path: resolvePackageHref(packagePath, href), type: "ncx" };
  }
  throw new Error("EPUB navigation not found");
}

function parseNcxNode($: cheerio.CheerioAPI, element: AnyNode, depth: number): BookTocNodeSpike {
  const node = $(element);
  return {
    title: normalizeSpace(node.children("navLabel").first().text()) || "Untitled",
    href: node.children("content").first().attr("src") ?? null,
    depth,
    children: node.children("navPoint").toArray().map((child) => parseNcxNode($, child, depth + 1)),
  };
}

function parseNcxTree(xml: string): BookTocNodeSpike[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("navMap").children("navPoint").toArray().map((element) => parseNcxNode($, element, 1));
}

function parseNavList($: cheerio.CheerioAPI, list: cheerio.Cheerio<AnyNode>, depth: number): BookTocNodeSpike[] {
  return list.children("li").toArray().map((element) => {
    const node = $(element);
    const anchor = node.children("a[href]").first();
    const label = normalizeSpace(anchor.text()) || normalizeSpace(node.children("span").first().text()) || "Untitled";
    const nested = node.children("ol").first();
    return {
      title: label,
      href: anchor.attr("href") ?? null,
      depth,
      children: nested.length ? parseNavList($, nested, depth + 1) : [],
    };
  });
}

function parseNavTree(xml: string): BookTocNodeSpike[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return parseNavList($, $("nav").first().children("ol").first(), 1);
}

function flattenTree(nodes: BookTocNodeSpike[]): BookTocNodeSpike[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function deepestDepth(nodes: BookTocNodeSpike[]): number {
  return flattenTree(nodes).reduce((max, node) => Math.max(max, node.depth), 0);
}

function looksLikePart(title: string): boolean {
  return /^(?:part\s+)?(?:[IVX]+)\b/i.test(title.trim());
}

function looksLikeNumberedChapter(title: string): boolean {
  return /^\d+\s+\S/.test(title.trim());
}

async function contentDocument(html: string, documentPath: string, zip: JSZip, fixedLayout: boolean): Promise<{ blocks: BookContentBlockSpike[]; tables: BookContentTableSpike[]; visuals: BookVisualSpike[]; boundaryForHref: (href: string) => { index: number; isHeading: boolean } | null }> {
  const $ = cheerio.load(html, { xmlMode: true });
  const blocks: BookContentBlockSpike[] = [];
  const elements = $("body").find("*").toArray();
  const positions = new Map<AnyNode, number>(elements.map((element, index) => [element, index]));
  const anchors = new Map<string, AnyNode>();
  const blockElements: AnyNode[] = [];
  for (const element of elements) {
    const tag = "tagName" in element ? element.tagName.toLowerCase() : "";
    const anchor = $(element).attr("id") ?? (tag === "a" ? $(element).attr("name") : undefined);
    if (anchor && !anchors.has(anchor)) anchors.set(anchor, element);
    const directCell = (tag === "td" || tag === "th" || tag === "caption") && !$(element).find("p, h1, h2, h3, table").length;
    if (tag !== "h1" && tag !== "h2" && tag !== "h3" && tag !== "p" && !directCell) continue;
    const text = normalizeSpace($(element).text());
    if (!text) continue;
    blockElements.push(element);
    if (tag === "p" || directCell) {
      blocks.push({ kind: "paragraph", text });
      continue;
    }
    const level = Number(tag.slice(1)) as 1 | 2 | 3;
    blocks.push({ kind: "heading", level, text });
  }
  // Keep the old paragraph stream intact: tables only reference those text anchors.
  const indexByElement = new Map(blockElements.map((element, index) => [element, index]));
  const indexesWithin = (element: AnyNode) => [element, ...$(element).find("*").toArray()]
    .flatMap(node => indexByElement.has(node) ? [indexByElement.get(node)!] : []);
  const boundedSpan = (value?: string) => Math.max(1, Math.min(100, Number.parseInt(value ?? "1", 10) || 1));
  const imageCache = new Map<string, Promise<ReadingTableImage | null>>();
  const imageFor = async (element: AnyNode): Promise<ReadingTableImage | null> => {
    const src = $(element).attr("src") ?? "";
    if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(src)) return null;
    let entryPath: string;
    try { entryPath = posix.normalize(posix.join(posix.dirname(documentPath), decodeURIComponent(src.split(/[?#]/)[0]))); } catch { return null; }
    if (entryPath.startsWith("../")) return null;
    if (!imageCache.has(entryPath)) imageCache.set(entryPath, (async () => {
      const file = zip.file(entryPath);
      // Never embed active EPUB markup (SVG/HTML), remote URLs or oversized assets.
      if (!file || !/\.(?:png|jpe?g|gif|webp)$/i.test(entryPath)) return null;
      const bytes = await file.async("nodebuffer");
      if (bytes.length > 2_000_000) return null;
      let mime = "", width: number | undefined, height: number | undefined;
      if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        mime = "image/png"; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
      } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = "image/jpeg";
      else if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) mime = "image/gif";
      else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") mime = "image/webp";
      if (!mime) return null;
      return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, alt: "", ...(width && height ? { width, height } : {}) };
    })().catch(() => null));
    const image = await imageCache.get(entryPath)!;
    return image ? { ...image, alt: $(element).attr("alt") ?? "" } : null;
  };
  const tables: BookContentTableSpike[] = [];
  const presentation = await inspectBookVisuals($, blockElements, documentPath, zip, fixedLayout);
  for (const [tableIndex, element] of $("body table").toArray().filter(node => !$(node).parents("table").length).entries()) {
    if (presentation.protectedRoots.some(root => root === element || $(element).parents().toArray().some(parent => parent === root))) continue;
    const firstText = indexesWithin(element)[0];
    const startBlockIndex = firstText ?? blockElements.findIndex(node => positions.get(node)! > positions.get(element)!);
    const rows: BookContentTableSpike["rows"] = [];
    for (const row of $(element).find("tr").toArray().filter(node => $(node).closest("table").get(0) === element)) {
      const sectionTag = $(row).parent().get(0)?.tagName.toLowerCase();
      const section = sectionTag === "thead" ? "head" : sectionTag === "tfoot" ? "foot" : "body";
      const cells: BookContentTableSpike["rows"][number]["cells"] = [];
      for (const cell of $(row).children("td, th").toArray()) {
        const scope = $(cell).attr("scope");
        cells.push({ blockIndexes: indexesWithin(cell), colSpan: boundedSpan($(cell).attr("colspan")), rowSpan: boundedSpan($(cell).attr("rowspan")),
          header: cell.tagName.toLowerCase() === "th" || section === "head" || /(?:^|[-_\s])(?:table[-_])?head(?:er)?(?:$|[-_\s])/i.test($(cell).attr("class") ?? ""),
          ...(["row", "col", "rowgroup", "colgroup"].includes(scope ?? "") ? { scope: scope as ReadingTableCell["scope"] } : {}),
          images: (await Promise.all($(cell).find("img").toArray().map(imageFor))).filter((image): image is ReadingTableImage => image !== null) });
      }
      rows.push({ section, cells });
    }
    const captionBlockIndexes = $(element).children("caption").toArray().flatMap(indexesWithin);
    // Some EPUB exporters put the explicit table title in a spanning first cell.
    const firstRow = $(element).find("tr").first();
    if (!captionBlockIndexes.length && rows[0]?.cells.length === 1 && rows[0].cells[0].colSpan > 1
      && firstRow.find("[class]").toArray().some(node => /(?:caption|table[-_]title)/i.test($(node).attr("class") ?? ""))) {
      captionBlockIndexes.push(...rows.shift()!.cells[0].blockIndexes);
    }
    tables.push({ id: `${documentPath}:table:${tableIndex}`, sourceOrder: positions.get(element), startBlockIndex: startBlockIndex < 0 ? blocks.length : startBlockIndex,
      captionBlockIndexes, rows });
  }
  return {
    blocks,
    tables,
    visuals: presentation.visuals,
    boundaryForHref(href) {
      const fragment = href.split("#")[1];
      if (!fragment) return null;
      let anchorId: string;
      try {
        anchorId = decodeURIComponent(fragment);
      } catch {
        return null;
      }
      const target = anchors.get(anchorId);
      if (!target) return null;
      const containingBlock = $(target).closest("h1, h2, h3, p, td, th, caption").get(0);
      if (containingBlock) {
        const blockIndex = blockElements.indexOf(containingBlock);
        if (blockIndex >= 0) return { index: blockIndex, isHeading: blocks[blockIndex].kind === "heading" };
      }
      const targetPosition = positions.get(target)!;
      const blockIndex = blockElements.findIndex((element) => positions.get(element)! >= targetPosition);
      return blockIndex < 0
        ? { index: blocks.length, isHeading: false }
        : { index: blockIndex, isHeading: blocks[blockIndex].kind === "heading" };
    },
  };
}

function coverManifestItem(packageXml: string, packagePath: string): { entryPath: string; mediaType: string } | null {
  const $ = cheerio.load(packageXml, { xmlMode: true });
  const manifest = $("manifest item").toArray();
  const coverId = $("metadata meta[name='cover']").first().attr("content");
  let item = coverId ? manifest.find((candidate) => $(candidate).attr("id") === coverId) : undefined;
  if (!item) item = manifest.find((candidate) => ($(candidate).attr("properties") ?? "").split(/\s+/).includes("cover-image"));
  if (!item) item = manifest.find((candidate) => {
    const href = $(candidate).attr("href") ?? "";
    const mediaType = $(candidate).attr("media-type") ?? "";
    return mediaType.startsWith("image/") && /(^|[\/_\-.])cover([\/_\-.]|$)/i.test(href);
  });
  if (!item) return null;
  const href = $(item).attr("href");
  const mediaType = $(item).attr("media-type") ?? "";
  if (!href || !mediaType.startsWith("image/")) return null;
  return { entryPath: resolvePackageHref(packagePath, href), mediaType };
}

interface ReadableSeed {
  title: string;
  part: string | null;
  href: string;
}

function readableSeeds(nodes: BookTocNodeSpike[]): ReadableSeed[] {
  const seeds: ReadableSeed[] = [];

  const add = (node: BookTocNodeSpike, part: string | null) => {
    if (!node.href) return;
    const document = node.href.split("#")[0];
    if (!document) return;
    seeds.push({ title: node.title, part, href: node.href });
  };

  for (const top of nodes) {
    if (looksLikePart(top.title) && top.children.length) {
      for (const child of top.children) add(child, top.title);
      continue;
    }
    if (top.children.length) {
      for (const child of top.children) add(child, top.title);
    } else {
      add(top, null);
    }
  }
  return seeds;
}

export async function inspectBookEpubSpike(filePath: string): Promise<BookEpubSpikeReport> {
  const source = await readFile(filePath);
  const zip = await JSZip.loadAsync(source);
  const container = zip.file("META-INF/container.xml");
  if (!container) throw new Error("EPUB container.xml not found");
  const packagePath = packagePathFromContainer(await container.async("text"));
  const packageEntry = zip.file(packagePath);
  if (!packageEntry) throw new Error(`EPUB package not found: ${packagePath}`);
  const packageXml = await packageEntry.async("text");
  const $package = cheerio.load(packageXml, { xmlMode: true });
  const navigation = navigationManifestItem(packageXml, packagePath);
  const navigationEntry = zip.file(navigation.path);
  if (!navigationEntry) throw new Error(`EPUB navigation entry not found: ${navigation.path}`);
  const navigationXml = await navigationEntry.async("text");
  const tocTree = navigation.type === "ncx" ? parseNcxTree(navigationXml) : parseNavTree(navigationXml);
  const flatToc = flattenTree(tocTree);
  const seeds = readableSeeds(tocTree);

  const seedsByDocument = new Map<string, Array<{ index: number; seed: ReadableSeed }>>();
  seeds.forEach((seed, index) => {
    const documentPath = resolveNavigationHref(navigation.path, seed.href);
    const group = seedsByDocument.get(documentPath) ?? [];
    group.push({ index, seed });
    seedsByDocument.set(documentPath, group);
  });
  const blocksBySeed = new Map<number, BookContentBlockSpike[]>();
  const tablesBySeed = new Map<number, BookContentTableSpike[]>();
  const visualsBySeed = new Map<number, BookVisualSpike[]>();
  const fixedLayout = $package("meta[property='rendition:layout']").text().trim() === "pre-paginated" || $package("meta[name='fixed-layout']").attr("content") === "true";
  for (const [documentPath, group] of seedsByDocument) {
    const entry = zip.file(documentPath);
    if (!entry) continue;
    const content = await contentDocument(await entry.async("text"), documentPath, zip, fixedLayout);
    const boundaries = group.map(({ seed }) => content.boundaryForHref(seed.href));
    const units = group.flatMap((candidate, position) => position === 0 || !boundaries[position] || boundaries[position].isHeading
      ? [{ ...candidate, start: position === 0 ? 0 : boundaries[position]?.index ?? null }]
      : []);
    units.forEach(({ index, start }, position) => {
      const end = units.slice(position + 1).find((candidate) => candidate.start !== null)?.start ?? content.blocks.length;
      blocksBySeed.set(index, start === null ? [] : content.blocks.slice(start, end));
      if (start !== null) visualsBySeed.set(index, content.visuals.filter(visual => visual.ownerBlockIndex >= start && (visual.ownerBlockIndex < end || (position === units.length - 1 && visual.ownerBlockIndex === end))).map(visual => ({
        ...visual, startBlockIndex: Math.max(0, visual.startBlockIndex - start), ownerBlockIndex: Math.max(0, visual.ownerBlockIndex - start),
        captionBlockIndexes: visual.captionBlockIndexes.filter(i => i >= start && i < end).map(i => i - start),
        coveredBlockIndexes: visual.coveredBlockIndexes.filter(i => i >= start && i < end).map(i => i - start),
      })));
      if (start !== null) tablesBySeed.set(index, content.tables.filter(table => table.startBlockIndex >= start && (table.startBlockIndex < end || (position === units.length - 1 && table.startBlockIndex === end))).map(table => ({
        ...table, startBlockIndex: table.startBlockIndex - start,
        captionBlockIndexes: table.captionBlockIndexes.filter(i => i >= start && i < end).map(i => i - start),
        rows: table.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, blockIndexes: cell.blockIndexes.filter(i => i >= start && i < end).map(i => i - start) })) })),
      })));
    });
  }

  const readableUnits: BookReadableUnitSpike[] = [];
  seeds.forEach((seed, index) => {
    const blocks = blocksBySeed.get(index);
    if (!blocks) return;
    const documentPath = resolveNavigationHref(navigation.path, seed.href);
    readableUnits.push({
      ...seed,
      documentPath,
      headings: blocks.filter((block): block is BookContentHeadingSpike => block.kind === "heading"),
      paragraphCount: blocks.filter((block) => block.kind === "paragraph").length,
      blocks,
      ...(tablesBySeed.get(index)?.length ? { tables: tablesBySeed.get(index) } : {}),
      ...(visualsBySeed.get(index)?.length ? { visuals: visualsBySeed.get(index) } : {}),
    });
  });

  const coverItem = coverManifestItem(packageXml, packagePath);
  const coverEntry = coverItem ? zip.file(coverItem.entryPath) : null;
  const coverData = coverEntry ? await coverEntry.async("nodebuffer") : null;
  const partTitles = tocTree.filter((node) => looksLikePart(node.title) && node.children.length).map((node) => node.title);

  return {
    schemaVersion: 1,
    sourceFilename: path.basename(filePath),
    metadata: {
      title: firstMetadataText($package, "title") ?? path.basename(filePath, path.extname(filePath)),
      authors: allMetadataText($package, "creator"),
      language: firstMetadataText($package, "language"),
      publisher: firstMetadataText($package, "publisher"),
      publishedAt: firstMetadataText($package, "date"),
      identifiers: allMetadataText($package, "identifier"),
      epubVersion: $package("package").first().attr("version") ?? "unknown",
    },
    navigationType: navigation.type,
    navigationNodeCount: flatToc.length,
    navigationMaxDepth: deepestDepth(tocTree),
    cover: coverItem && coverData ? { ...coverItem, byteLength: coverData.byteLength } : null,
    partCount: partTitles.length,
    chapterCount: flatToc.filter((node) => looksLikeNumberedChapter(node.title)).length,
    readableUnitCount: readableUnits.length,
    parts: partTitles.map((title) => ({
      title,
      readableUnitTitles: readableUnits.filter((unit) => unit.part === title).map((unit) => unit.title),
    })),
    readableUnits,
  };
}

export function compactBookEpubSpikeReport(report: BookEpubSpikeReport) {
  return {
    schemaVersion: report.schemaVersion,
    sourceFilename: report.sourceFilename,
    metadata: report.metadata,
    navigationType: report.navigationType,
    navigationNodeCount: report.navigationNodeCount,
    navigationMaxDepth: report.navigationMaxDepth,
    cover: report.cover,
    partCount: report.partCount,
    chapterCount: report.chapterCount,
    readableUnitCount: report.readableUnitCount,
    parts: report.parts,
    readableUnits: report.readableUnits.map((unit) => ({
      title: unit.title,
      part: unit.part,
      href: unit.href,
      documentPath: unit.documentPath,
      paragraphCount: unit.paragraphCount,
      headings: unit.headings,
    })),
  };
}
