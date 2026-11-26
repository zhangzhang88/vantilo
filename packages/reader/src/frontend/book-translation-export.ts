import JSZip from "jszip";
import type {
  BookChapter,
  BookRecord,
  ReadingDocumentHeadingBlock,
  ReadingDocumentTable,
  ReadingDocumentVisual,
} from "../shared/book-data-contract";
import { bookResourceUrl } from "../shared/book-source-links";
import type { BookTocChineseTitles } from "../shared/book-toc-chinese";
import { bookCoverUrl } from "./api";
import { tableParagraphIndexes } from "./book-table";
import {
  findListeningTranslation,
  isListeningTranslationEngine,
  loadListeningTranslationEngine,
  loadListeningTranslations,
} from "./chinese-translation-reuse";
import { chapterTranslationTargets, savedBookTranslationEngine } from "./issue-translation";
import { listCachedTranslationEngines, loadBookTranslations } from "./issue-translation-cache";
import {
  PARAGRAPH_TRANSLATIONS_KEY,
  paragraphTranslationTarget,
  type ParagraphTranslationRecord,
} from "./paragraph-translation-state";
import type { ReaderStorageBackend } from "./reader-storage";
import type { ReaderCollectionView, ReaderDocumentView } from "./reading-document-view";

export type BookExportMode = "zh" | "bilingual";

export interface BookExportEngineChoice {
  id: string;
  label: string;
}

export interface BookExportReadiness {
  totalTargets: number;
  translatedTargets: number;
  totalChapters: number;
  completedChapters: number;
  remainingChapters: number;
  ready: boolean;
}

export interface BookExportEngineReadiness extends BookExportReadiness {
  engineId: string;
  label: string;
}

export interface ResolvedChapterTranslation {
  chapter: BookChapter;
  titleZh?: string;
  headings: ReadonlyMap<number, string>;
  paragraphs: ReadonlyMap<number, string>;
}

export interface ResolvedBookExport {
  readiness: BookExportReadiness;
  chapters: ResolvedChapterTranslation[];
}

export interface BookExportAsset {
  mediaType: string;
  bytes: Uint8Array;
}

export interface BookExportAssets {
  cover?: BookExportAsset;
  resources: ReadonlyMap<string, BookExportAsset>;
}

export interface BuildBookEpubOptions {
  mode: BookExportMode;
  tocTitles?: BookTocChineseTitles;
  engineLabel?: string;
  modifiedAt?: Date;
}

export interface BuiltBookEpub {
  filename: string;
  bytes: Uint8Array;
  chapterCount: number;
  imageCount: number;
  hasCover: boolean;
}

const SUPPORTED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sanitizeExportFilename(title: string, mode: BookExportMode): string {
  const cleaned = title
    .replace(INVALID_XML_CHARS, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  const base = cleaned || "vantilo-book";
  const suffix = mode === "bilingual" ? "（中英对照）" : "（中文译本）";
  return `${base}${suffix}.epub`;
}

function normalizeImageMediaType(raw: string | null | undefined, fallbackPath?: string): string | undefined {
  const cleaned = raw?.split(";")[0]?.trim().toLowerCase();
  if (cleaned === "image/jpg") return "image/jpeg";
  if (cleaned && Object.hasOwn(SUPPORTED_IMAGE_EXTENSIONS, cleaned)) return cleaned;
  const ext = fallbackPath?.split("?")[0]?.split("#")[0]?.split(".").pop()?.toLowerCase();
  if (ext && Object.hasOwn(EXTENSION_MEDIA_TYPES, ext)) return EXTENSION_MEDIA_TYPES[ext];
  return undefined;
}

function extensionForMediaType(mediaType: string): string {
  return SUPPORTED_IMAGE_EXTENSIONS[mediaType] ?? "bin";
}

function formatUtcModified(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function indexRecords(records: readonly ParagraphTranslationRecord[]): Map<string, ParagraphTranslationRecord[]> {
  const index = new Map<string, ParagraphTranslationRecord[]>();
  for (const record of records) {
    const bucket = index.get(record.key);
    if (bucket) bucket.push(record);
    else index.set(record.key, [record]);
  }
  return index;
}

export function resolveBookTranslationsForExport(
  book: BookRecord,
  collection: ReaderCollectionView,
  records: readonly ParagraphTranslationRecord[],
  tocTitles?: BookTocChineseTitles,
): ResolvedBookExport {
  const cached = indexRecords(records);
  const documentsById = new Map<string, ReaderDocumentView>(
    collection.documents.map(document => [document.id, document]),
  );
  const sortedChapters = [...book.chapters].sort((left, right) => left.order - right.order);

  let totalTargets = 0;
  let translatedTargets = 0;
  let completedChapters = 0;
  const chapters: ResolvedChapterTranslation[] = [];

  for (const chapter of sortedChapters) {
    const document = documentsById.get(chapter.id);
    if (!document) continue;

    const targets = chapterTranslationTargets(document);
    let chapterTranslated = 0;
    let titleZh: string | undefined = document.titleZh ?? undefined;
    const headings = new Map<number, string>();
    const paragraphs = new Map<number, string>();

    for (const target of targets) {
      const context = {
        contextBefore: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : document.paragraphs[target.paragraphIndex + 1],
      };
      const record = findListeningTranslation(cached.get(target.key) ?? [], target, context, true);
      if (!record) continue;
      chapterTranslated += 1;
      if (target.targetKind === "title") {
        titleZh = record.translationZh;
      } else if (target.targetKind === "heading" && target.headingIndex !== undefined) {
        headings.set(target.headingIndex, record.translationZh);
      } else if (target.targetKind === undefined) {
        paragraphs.set(target.paragraphIndex, record.translationZh);
      }
    }

    // Opportunistically attach cached translations for visual caption paragraphs when present.
    for (const visual of document.visuals ?? []) {
      for (const paragraphIndex of visual.captionParagraphIndexes) {
        if (paragraphs.has(paragraphIndex)) continue;
        const sourceText = document.paragraphs[paragraphIndex];
        if (!sourceText) continue;
        const target = paragraphTranslationTarget({ document: document.identity, paragraphIndex, sourceText });
        const context = {
          contextBefore: document.paragraphs[paragraphIndex - 1],
          contextAfter: document.paragraphs[paragraphIndex + 1],
        };
        const record = findListeningTranslation(cached.get(target.key) ?? [], target, context, true);
        if (record) paragraphs.set(paragraphIndex, record.translationZh);
      }
    }

    if (!titleZh) {
      const tocTitle = tocTitles?.chapters[chapter.id];
      if (tocTitle?.trim()) titleZh = tocTitle.trim();
    }

    totalTargets += targets.length;
    translatedTargets += chapterTranslated;
    if (chapterTranslated === targets.length) completedChapters += 1;

    chapters.push({ chapter, titleZh, headings, paragraphs });
  }

  const totalChapters = chapters.length;
  const remainingChapters = totalChapters - completedChapters;
  return {
    readiness: {
      totalTargets,
      translatedTargets,
      totalChapters,
      completedChapters,
      remainingChapters,
      ready: totalTargets > 0 && translatedTargets === totalTargets && remainingChapters === 0,
    },
    chapters,
  };
}

function listBrowserStorageEngines(): string[] {
  const engines: string[] = [];
  if (typeof localStorage === "undefined") return engines;
  const translationPrefix = `${PARAGRAPH_TRANSLATIONS_KEY}:vantilo-v2:`;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(translationPrefix)) continue;
      const engineId = key.slice(translationPrefix.length);
      if (isListeningTranslationEngine(engineId)) engines.push(engineId);
    }
  } catch {
    return engines;
  }
  return engines;
}

function fallbackEngineLabel(engineId: string): string {
  if (engineId.startsWith("custom-api:")) return `已缓存译文（AI 模型 · ${engineId.slice("custom-api:".length)}）`;
  if (engineId.startsWith("codex:")) return `已缓存译文（${engineId.slice("codex:".length)}）`;
  return `已缓存译文（${engineId}）`;
}

export async function inspectBookExportEngines(
  book: BookRecord,
  collection: ReaderCollectionView,
  storage: Pick<ReaderStorageBackend, "getItem" | "setItem">,
  availableEngines: readonly BookExportEngineChoice[],
  tocTitles?: BookTocChineseTitles,
): Promise<BookExportEngineReadiness[]> {
  const labels = new Map(availableEngines.map(engine => [engine.id, engine.label]));
  const orderedIds: string[] = [];
  const addId = (id: string | undefined) => {
    if (id && isListeningTranslationEngine(id) && !orderedIds.includes(id)) orderedIds.push(id);
  };

  addId(savedBookTranslationEngine(book.id));
  addId(loadListeningTranslationEngine(storage));
  for (const engine of availableEngines) addId(engine.id);
  const cachedIds = await listCachedTranslationEngines().catch(() => []);
  for (const id of cachedIds) addId(id);
  for (const id of listBrowserStorageEngines()) addId(id);

  const documentIds = collection.documents.map(document => document.identity.documentId);
  const results: BookExportEngineReadiness[] = [];

  for (const engineId of orderedIds) {
    const persisted = await loadBookTranslations(engineId, documentIds).catch(() => []);
    const local = loadListeningTranslations(storage, engineId);
    const records = [...persisted, ...local];
    // Skip unconfigured historical engines that have no records for this book at all.
    if (!labels.has(engineId) && !records.some(record => documentIds.includes(record.document.documentId))) continue;
    const { readiness } = resolveBookTranslationsForExport(book, collection, records, tocTitles);
    results.push({
      engineId,
      label: labels.get(engineId) ?? fallbackEngineLabel(engineId),
      ...readiness,
    });
  }

  // Keep ready engines first (preserving saved/active priority), then highest progress.
  return results.sort((left, right) => {
    if (left.ready !== right.ready) return left.ready ? -1 : 1;
    const leftRatio = left.totalTargets ? left.translatedTargets / left.totalTargets : 0;
    const rightRatio = right.totalTargets ? right.translatedTargets / right.totalTargets : 0;
    return rightRatio - leftRatio;
  });
}

export async function loadBookTranslationRecordsForEngine(
  collection: ReaderCollectionView,
  engineId: string,
  storage: Pick<ReaderStorageBackend, "getItem" | "setItem">,
): Promise<ParagraphTranslationRecord[]> {
  const documentIds = collection.documents.map(document => document.identity.documentId);
  const persisted = await loadBookTranslations(engineId, documentIds).catch(() => []);
  const local = loadListeningTranslations(storage, engineId);
  return [...persisted, ...local];
}

export async function loadBookExportAssets(
  book: BookRecord,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<BookExportAssets> {
  let cover: BookExportAsset | undefined;
  if (book.cover) {
    try {
      const response = await fetcher(bookCoverUrl(book.id), { signal });
      if (response.ok) {
        const mediaType = normalizeImageMediaType(
          response.headers.get("Content-Type") || book.cover.mediaType,
          book.cover.entryPath,
        );
        if (mediaType) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > 0) cover = { mediaType, bytes };
        }
      }
    } catch {
      if (signal?.aborted) throw signal.reason;
    }
  }

  const entryPaths = new Set<string>();
  for (const chapter of book.chapters) {
    for (const visual of chapter.visuals ?? []) {
      for (const image of visual.images) {
        if (image.entryPath) entryPaths.add(image.entryPath);
      }
    }
  }

  const resources = new Map<string, BookExportAsset>();
  for (const entryPath of entryPaths) {
    if (signal?.aborted) throw signal.reason;
    try {
      const response = await fetcher(bookResourceUrl(book.id, entryPath), { signal });
      if (!response.ok) continue;
      const mediaType = normalizeImageMediaType(response.headers.get("Content-Type"), entryPath);
      if (!mediaType) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 0) resources.set(entryPath, { mediaType, bytes });
    } catch {
      if (signal?.aborted) throw signal.reason;
    }
  }

  return { cover, resources };
}

function decodeBase64(data: string): Uint8Array | undefined {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

interface PackagedImage {
  id: string;
  href: string;
  mediaType: string;
  bytes: Uint8Array;
}

class ImageRegistry {
  private readonly byKey = new Map<string, PackagedImage>();
  readonly items: PackagedImage[] = [];

  registerResource(entryPath: string, asset: BookExportAsset | undefined): PackagedImage | undefined {
    if (!asset) return undefined;
    const key = `res:${entryPath}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const ordinal = String(this.items.length + 1).padStart(3, "0");
    const ext = extensionForMediaType(asset.mediaType);
    const item: PackagedImage = {
      id: `img-${ordinal}`,
      href: `images/img-${ordinal}.${ext}`,
      mediaType: asset.mediaType,
      bytes: asset.bytes,
    };
    this.byKey.set(key, item);
    this.items.push(item);
    return item;
  }

  registerDataUrl(dataUrl: string): PackagedImage | undefined {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl);
    if (!match) return undefined;
    const key = `data:${dataUrl}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const bytes = decodeBase64(match[2].replace(/\s+/g, ""));
    if (!bytes || !bytes.byteLength) return undefined;
    const mediaType = match[1];
    const ordinal = String(this.items.length + 1).padStart(3, "0");
    const ext = extensionForMediaType(mediaType);
    const item: PackagedImage = {
      id: `tbl-img-${ordinal}`,
      href: `images/tbl-${ordinal}.${ext}`,
      mediaType,
      bytes,
    };
    this.byKey.set(key, item);
    this.items.push(item);
    return item;
  }
}

function renderParagraphXml(
  source: string,
  translated: string | undefined,
  mode: BookExportMode,
): string {
  const cleanTranslated = translated?.trim();
  const cleanSource = source.trim();
  if (!cleanTranslated) {
    return `<p>${escapeXml(source)}</p>`;
  }
  if (mode === "zh") {
    return `<p>${escapeXml(cleanTranslated)}</p>`;
  }
  if (cleanTranslated === cleanSource) {
    return `<p>${escapeXml(cleanTranslated)}</p>`;
  }
  return `<div class="bilingual-block"><p class="bilingual-source" lang="en" xml:lang="en">${escapeXml(source)}</p><p class="bilingual-translation" lang="zh-CN" xml:lang="zh-CN">${escapeXml(cleanTranslated)}</p></div>`;
}

function renderHeadingXml(
  tag: "h1" | "h2" | "h3" | "h4",
  source: string,
  translated: string | undefined,
  mode: BookExportMode,
): string {
  const cleanTranslated = translated?.trim();
  const cleanSource = source.trim();
  if (!cleanTranslated || cleanTranslated === cleanSource) {
    return `<${tag}>${escapeXml(cleanTranslated || source)}</${tag}>`;
  }
  if (mode === "zh") {
    return `<${tag}>${escapeXml(cleanTranslated)}</${tag}>`;
  }
  return `<${tag}>${escapeXml(cleanTranslated)}<span class="bilingual-heading-source" lang="en" xml:lang="en">${escapeXml(source)}</span></${tag}>`;
}

function renderTableXml(
  table: ReadingDocumentTable,
  chapter: ResolvedChapterTranslation,
  mode: BookExportMode,
  images: ImageRegistry,
): string {
  const parts: string[] = ['<table class="book-table">'];
  if (table.captionParagraphIndexes.length > 0) {
    const captionBody = table.captionParagraphIndexes
      .map(index => renderParagraphXml(chapter.chapter.paragraphs[index] ?? "", chapter.paragraphs.get(index), mode))
      .join("");
    parts.push(`<caption>${captionBody}</caption>`);
  }

  const groups: Array<{ section: "head" | "body" | "foot"; rows: ReadingDocumentTable["rows"] }> = [];
  for (const row of table.rows) {
    if (groups.at(-1)?.section === row.section) groups.at(-1)!.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }

  for (const group of groups) {
    const groupTag = group.section === "head" ? "thead" : group.section === "foot" ? "tfoot" : "tbody";
    parts.push(`<${groupTag}>`);
    for (const row of group.rows) {
      parts.push("<tr>");
      for (const cell of row.cells) {
        const tag = cell.header ? "th" : "td";
        const attrs: string[] = [];
        if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`);
        if (cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
        if (cell.header && cell.scope) attrs.push(`scope="${escapeXml(cell.scope)}"`);
        const openTag = attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
        const cellContent = [
          ...cell.paragraphIndexes.map(index =>
            renderParagraphXml(chapter.chapter.paragraphs[index] ?? "", chapter.paragraphs.get(index), mode),
          ),
          ...cell.images.flatMap(image => {
            const packaged = images.registerDataUrl(image.dataUrl);
            if (!packaged) return [];
            const imgAttrs = [`src="${escapeXml(packaged.href)}"`, `alt="${escapeXml(image.alt)}"`];
            if (image.width && image.width > 0) imgAttrs.push(`width="${Math.round(image.width)}"`);
            if (image.height && image.height > 0) imgAttrs.push(`height="${Math.round(image.height)}"`);
            return [`<img ${imgAttrs.join(" ")}/>`];
          }),
        ].join("");
        parts.push(`${openTag}${cellContent}</${tag}>`);
      }
      parts.push("</tr>");
    }
    parts.push(`</${groupTag}>`);
  }

  parts.push("</table>");
  return parts.join("");
}

function renderVisualXml(
  visual: ReadingDocumentVisual,
  chapter: ResolvedChapterTranslation,
  mode: BookExportMode,
  assets: BookExportAssets,
  images: ImageRegistry,
): string {
  const renderedImages = visual.images.flatMap(image => {
    const packaged = images.registerResource(image.entryPath, assets.resources.get(image.entryPath));
    if (!packaged) return [];
    return [`<img src="${escapeXml(packaged.href)}" alt="${escapeXml(image.alt)}"/>`];
  });

  const captionParts: string[] = [];
  for (const index of visual.captionParagraphIndexes) {
    const source = chapter.chapter.paragraphs[index];
    if (source !== undefined) captionParts.push(renderParagraphXml(source, chapter.paragraphs.get(index), mode));
  }
  if (visual.captionText.trim()) {
    captionParts.push(`<p>${escapeXml(visual.captionText.trim())}</p>`);
  }
  const captionXml = captionParts.length ? `<figcaption>${captionParts.join("")}</figcaption>` : "";

  if (!renderedImages.length && !captionXml) return "";
  const body = visual.captionPlacement === "before"
    ? `${captionXml}${renderedImages.join("")}`
    : `${renderedImages.join("")}${captionXml}`;
  return `<figure class="book-figure">${body}</figure>`;
}

function renderChapterXhtml(
  resolved: ResolvedChapterTranslation,
  mode: BookExportMode,
  assets: BookExportAssets,
  images: ImageRegistry,
): string {
  const { chapter } = resolved;
  const pageTitle = resolved.titleZh ?? chapter.title;
  const headingsBefore = new Map<number, Array<ReadingDocumentHeadingBlock & { headingIndex: number }>>();
  let pendingHeadings: Array<ReadingDocumentHeadingBlock & { headingIndex: number }> = [];
  let headingIndex = 0;

  for (const block of chapter.blocks) {
    if (block.kind === "heading") {
      pendingHeadings.push({ ...block, headingIndex });
      headingIndex += 1;
    } else if (pendingHeadings.length) {
      headingsBefore.set(block.paragraphIndex, [...(headingsBefore.get(block.paragraphIndex) ?? []), ...pendingHeadings]);
      pendingHeadings = [];
    }
  }
  if (pendingHeadings.length) {
    headingsBefore.set(chapter.paragraphs.length, pendingHeadings);
  }

  let skippedInitialTitleHeading = false;
  const renderHeadingsFor = (paragraphIndex: number): string => {
    const list = headingsBefore.get(paragraphIndex);
    if (!list?.length) return "";
    return list.flatMap(heading => {
      const sameAsChapterTitle = heading.text.trim() === chapter.title.trim();
      if (!skippedInitialTitleHeading && paragraphIndex === 0 && sameAsChapterTitle) {
        skippedInitialTitleHeading = true;
        return [];
      }
      const tag = heading.level === 1 ? "h2" : heading.level === 2 ? "h3" : "h4";
      const translated = sameAsChapterTitle ? resolved.titleZh : resolved.headings.get(heading.headingIndex);
      return [renderHeadingXml(tag, heading.text, translated, mode)];
    }).join("\n    ");
  };

  const tables = chapter.tables ?? [];
  const visuals = chapter.visuals ?? [];
  const covered = new Set<number>([
    ...tables.flatMap(tableParagraphIndexes),
    ...visuals.flatMap(visual => [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes]),
  ]);

  type Placement = { kind: "table"; item: ReadingDocumentTable } | { kind: "visual"; item: ReadingDocumentVisual };
  const placementsByParagraph = new Map<number, Placement[]>();
  const placements: Placement[] = [
    ...tables.map(item => ({ kind: "table" as const, item })),
    ...visuals.map(item => ({ kind: "visual" as const, item })),
  ];
  placements.sort((left, right) => (left.item.sourceOrder ?? 0) - (right.item.sourceOrder ?? 0));
  for (const placement of placements) {
    const anchor = Math.max(0, Math.min(chapter.paragraphs.length, placement.item.beforeParagraphIndex));
    placementsByParagraph.set(anchor, [...(placementsByParagraph.get(anchor) ?? []), placement]);
  }

  const emittedHeadings = new Set<number>();
  const takeHeadings = (index: number): string => {
    if (emittedHeadings.has(index)) return "";
    emittedHeadings.add(index);
    return renderHeadingsFor(index);
  };

  const bodyChunks: string[] = [
    renderHeadingXml("h1", chapter.title, resolved.titleZh, mode),
  ];

  const normalizedChapterTitle = chapter.title.trim();
  const normalizedChapterTitleZh = resolved.titleZh?.trim();

  for (let index = 0; index <= chapter.paragraphs.length; index++) {
    for (const placement of placementsByParagraph.get(index) ?? []) {
      if (placement.kind === "visual") {
        const first = placement.item.coveredParagraphIndexes[0] ?? placement.item.captionParagraphIndexes[0];
        if (first !== undefined) {
          const headingXml = takeHeadings(first);
          if (headingXml) bodyChunks.push(headingXml);
        }
        const visualXml = renderVisualXml(placement.item, resolved, mode, assets, images);
        if (visualXml) bodyChunks.push(visualXml);
      } else {
        const first = tableParagraphIndexes(placement.item)[0];
        if (first !== undefined) {
          const headingXml = takeHeadings(first);
          if (headingXml) bodyChunks.push(headingXml);
        }
        bodyChunks.push(renderTableXml(placement.item, resolved, mode, images));
      }
    }

    if (index < chapter.paragraphs.length && !covered.has(index)) {
      const headingXml = takeHeadings(index);
      if (headingXml) bodyChunks.push(headingXml);
      const sourceText = chapter.paragraphs[index];
      const translatedText = resolved.paragraphs.get(index);
      const isDuplicateOpeningTitle = index === 0
        && bodyChunks.length === 1
        && (sourceText.trim() === normalizedChapterTitle
          || (Boolean(normalizedChapterTitleZh) && translatedText?.trim() === normalizedChapterTitleZh));
      if (!isDuplicateOpeningTitle) {
        bodyChunks.push(renderParagraphXml(sourceText, translatedText, mode));
      }
    } else if (index === chapter.paragraphs.length) {
      const trailingHeadings = takeHeadings(index);
      if (trailingHeadings) bodyChunks.push(trailingHeadings);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(pageTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body>
  <section epub:type="chapter">
    ${bodyChunks.join("\n    ")}
  </section>
</body>
</html>
`;
}

const EPUB_STYLESHEET = `body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  line-height: 1.72;
  margin: 0;
  padding: 0 0.5em;
}
h1 {
  font-size: 1.45em;
  line-height: 1.35;
  margin: 1.2em 0 0.9em;
}
h2 {
  font-size: 1.22em;
  line-height: 1.4;
  margin: 1.3em 0 0.6em;
}
h3, h4 {
  font-size: 1.08em;
  line-height: 1.45;
  margin: 1.1em 0 0.5em;
}
p {
  margin: 0.72em 0;
}
.bilingual-heading-source {
  display: block;
  margin-top: 0.22em;
  font-size: 0.74em;
  font-weight: normal;
  opacity: 0.72;
}
.bilingual-block {
  margin: 0.95em 0;
}
.bilingual-source {
  margin: 0 0 0.3em;
  font-size: 0.93em;
  line-height: 1.55;
  opacity: 0.74;
}
.bilingual-translation {
  margin: 0;
}
.book-figure {
  margin: 1.1em 0;
  text-align: center;
}
.book-figure img {
  max-width: 100%;
  height: auto;
}
.book-figure figcaption {
  margin-top: 0.45em;
  font-size: 0.88em;
  opacity: 0.78;
}
.book-table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 0.92em;
}
.book-table th, .book-table td {
  border: 1px solid rgba(128, 128, 128, 0.35);
  padding: 0.4em 0.55em;
  vertical-align: top;
}
.book-table th {
  font-weight: 600;
}
.cover-page {
  margin: 0;
  padding: 0;
  text-align: center;
}
.cover-page img {
  max-width: 100%;
  max-height: 96vh;
  height: auto;
}
`;

interface TocNode {
  label: string;
  href: string;
  children?: TocNode[];
}

function formatTocLabel(original: string, translated: string | undefined, mode: BookExportMode): string {
  const cleanZh = translated?.trim();
  const cleanOrig = original.trim();
  if (!cleanZh || cleanZh === cleanOrig) return cleanZh || cleanOrig;
  return mode === "bilingual" ? `${cleanZh} · ${cleanOrig}` : cleanZh;
}

function buildTocTree(
  book: BookRecord,
  chapterItems: ReadonlyArray<{ id: string; href: string; resolved: ResolvedChapterTranslation }>,
  mode: BookExportMode,
  tocTitles?: BookTocChineseTitles,
): TocNode[] {
  const partById = new Map(book.parts.map(part => [part.id, part]));
  const nodes: TocNode[] = [];
  let activePartId: string | null = null;
  let activePartNode: TocNode | null = null;

  for (const item of chapterItems) {
    const chapter = item.resolved.chapter;
    const chapterNode: TocNode = {
      label: formatTocLabel(chapter.title, item.resolved.titleZh, mode),
      href: item.href,
    };

    const part = chapter.partId ? partById.get(chapter.partId) : undefined;
    if (part) {
      if (activePartId !== part.id || !activePartNode) {
        activePartId = part.id;
        activePartNode = {
          label: formatTocLabel(part.title, tocTitles?.parts[part.id], mode),
          href: item.href,
          children: [],
        };
        nodes.push(activePartNode);
      }
      activePartNode.children!.push(chapterNode);
    } else {
      activePartId = null;
      activePartNode = null;
      nodes.push(chapterNode);
    }
  }

  return nodes;
}

function renderNavList(nodes: readonly TocNode[], indent = "      "): string {
  const items = nodes.map(node => {
    const link = `<a href="${escapeXml(node.href)}">${escapeXml(node.label)}</a>`;
    if (!node.children?.length) return `${indent}<li>${link}</li>`;
    return `${indent}<li>${link}\n${indent}  <ol>\n${renderNavList(node.children, `${indent}    `)}\n${indent}  </ol>\n${indent}</li>`;
  });
  return items.join("\n");
}

function renderNcxNavPoints(nodes: readonly TocNode[], counter: { value: number }, indent = "    "): string {
  const items = nodes.map(node => {
    const order = ++counter.value;
    const children = node.children?.length ? `\n${renderNcxNavPoints(node.children, counter, `${indent}  `)}` : "";
    return `${indent}<navPoint id="navPoint-${order}" playOrder="${order}">
${indent}  <navLabel><text>${escapeXml(node.label)}</text></navLabel>
${indent}  <content src="${escapeXml(node.href)}"/>${children}
${indent}</navPoint>`;
  });
  return items.join("\n");
}

function renderCoverXhtml(bookTitle: string, coverHref: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body class="cover-page">
  <img src="${escapeXml(coverHref)}" alt="${escapeXml(bookTitle)}"/>
</body>
</html>
`;
}

export async function buildTranslatedBookEpub(
  book: BookRecord,
  resolved: ResolvedBookExport,
  options: BuildBookEpubOptions,
  assets: BookExportAssets = { resources: new Map() },
): Promise<BuiltBookEpub> {
  if (!resolved.readiness.ready) {
    throw new Error("全书译文尚未 100% 完成，暂不能导出 EPUB。");
  }
  if (!resolved.chapters.length) {
    throw new Error("当前电子书没有可导出的章节。");
  }

  const { mode, tocTitles, engineLabel, modifiedAt = new Date() } = options;
  const suffix = mode === "bilingual" ? "（中英对照）" : "（中文译本）";
  const exportTitle = `${book.title}${suffix}`;
  const identifier = `urn:vantilo:export:${encodeURIComponent(book.id)}:${mode}`;
  const modified = formatUtcModified(modifiedAt);
  const images = new ImageRegistry();

  const chapterItems = resolved.chapters.map((chapter, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    const id = `ch-${ordinal}`;
    const href = `${id}.xhtml`;
    const xhtml = renderChapterXhtml(chapter, mode, assets, images);
    return { id, href, xhtml, resolved: chapter };
  });

  const coverExt = assets.cover ? extensionForMediaType(assets.cover.mediaType) : undefined;
  const coverHref = coverExt ? `images/cover.${coverExt}` : undefined;
  const tocNodes = buildTocTree(book, chapterItems, mode, tocTitles);
  const tocDepth = tocNodes.some(node => node.children?.length) ? 2 : 1;

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${renderNavList(tocNodes)}
    </ol>
  </nav>
</body>
</html>
`;

  const ncxCounter = { value: 0 };
  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="${tocDepth}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(exportTitle)}</text></docTitle>
  <navMap>
${renderNcxNavPoints(tocNodes, ncxCounter)}
  </navMap>
</ncx>
`;

  const descriptionParts = [
    mode === "bilingual" ? "中英双语对照译本，由 Vantilo 导出。" : "中文全文译本，由 Vantilo 导出。",
    ...(engineLabel ? [`翻译模型：${engineLabel}。`] : []),
  ];

  const metadataLines = [
    `    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(exportTitle)}</dc:title>`,
    `    <dc:language>zh-CN</dc:language>`,
    ...(mode === "bilingual" ? [`    <dc:language>en</dc:language>`] : []),
    ...book.authors.map(author => `    <dc:creator>${escapeXml(author)}</dc:creator>`),
    ...(book.publisher ? [`    <dc:publisher>${escapeXml(book.publisher)}</dc:publisher>`] : []),
    ...(book.publishedAt ? [`    <dc:date>${escapeXml(book.publishedAt)}</dc:date>`] : []),
    `    <dc:description>${escapeXml(descriptionParts.join(" "))}</dc:description>`,
    `    <meta property="dcterms:modified">${modified}</meta>`,
    ...(assets.cover ? [`    <meta name="cover" content="cover-image"/>`] : []),
  ];

  const manifestLines = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="style" href="styles/book.css" media-type="text/css"/>`,
    ...(assets.cover && coverHref
      ? [
          `    <item id="cover-image" href="${escapeXml(coverHref)}" media-type="${escapeXml(assets.cover.mediaType)}" properties="cover-image"/>`,
          `    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
    ...images.items.map(
      image => `    <item id="${escapeXml(image.id)}" href="${escapeXml(image.href)}" media-type="${escapeXml(image.mediaType)}"/>`,
    ),
    ...chapterItems.map(
      item => `    <item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="application/xhtml+xml"/>`,
    ),
  ];

  const spineLines = [
    ...(assets.cover ? [`    <itemref idref="cover-page"/>`] : []),
    ...chapterItems.map(item => `    <itemref idref="${escapeXml(item.id)}"/>`),
  ];

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadataLines.join("\n")}
  </metadata>
  <manifest>
${manifestLines.join("\n")}
  </manifest>
  <spine toc="ncx">
${spineLines.join("\n")}
  </spine>
</package>
`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", containerXml);
  zip.file("OEBPS/content.opf", contentOpf);
  zip.file("OEBPS/nav.xhtml", navXhtml);
  zip.file("OEBPS/toc.ncx", tocNcx);
  zip.file("OEBPS/styles/book.css", EPUB_STYLESHEET);

  if (assets.cover && coverHref) {
    zip.file(`OEBPS/${coverHref}`, assets.cover.bytes, { compression: "STORE" });
    zip.file("OEBPS/cover.xhtml", renderCoverXhtml(exportTitle, coverHref));
  }
  for (const image of images.items) {
    zip.file(`OEBPS/${image.href}`, image.bytes, { compression: "STORE" });
  }
  for (const item of chapterItems) {
    zip.file(`OEBPS/${item.href}`, item.xhtml);
  }

  const bytes = await zip.generateAsync({
    type: "uint8array",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    filename: sanitizeExportFilename(book.title, mode),
    bytes,
    chapterCount: chapterItems.length,
    imageCount: images.items.length + (assets.cover ? 1 : 0),
    hasCover: Boolean(assets.cover),
  };
}

export function triggerEpubDownload(epub: Pick<BuiltBookEpub, "filename" | "bytes">): void {
  const copy = new Uint8Array(epub.bytes.byteLength);
  copy.set(epub.bytes);
  const blob = new Blob([copy], { type: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = epub.filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
