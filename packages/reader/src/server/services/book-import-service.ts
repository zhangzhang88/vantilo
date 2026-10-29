import { access, link, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { inspectBookEpubRecord } from "../../epub/book-record-contract.js";
import type { BookImportPreview, BookRecord, BookSummary } from "../../shared/book-data-contract.js";
import { originalChapterHtml, originalResource } from "./book-original-content.js";

const MAX_PREVIEW_COVER_BYTES = 2_000_000;

interface StoredBook {
  filename: string;
  filePath: string;
  signature: string;
  summary: BookSummary;
  cover: BookRecord["cover"];
}

export class BookImportService {
  private readonly importInFlight = new Map<string, Promise<BookImportPreview>>();
  private readonly deleting = new Set<string>();

  isDeleting(bookId: string): boolean { return this.deleting.has(bookId); }

  canPrepare(bookId: string): boolean {
    return !this.deleting.has(bookId) && [...this.index.values()].some(({ summary }) => summary.id === bookId);
  }

  async deleteBook(bookId: string, beforeDelete: () => Promise<void>): Promise<"deleted" | "busy" | "missing"> {
    if (this.deleting.has(bookId) || this.isImporting(bookId)) return "busy";
    this.deleting.add(bookId);
    try {
      const stored = await this.findStoredBook(bookId);
      if (!stored) return "missing";
      // Resolve only from the scanned library; never interpret a caller-supplied path.
      await beforeDelete();
      await unlink(stored.filePath);
      this.index.delete(stored.filePath);
      this.records.delete(stored.filePath);
      this.archives.delete(stored.filePath);
      return "deleted";
    } finally {
      this.deleting.delete(bookId);
    }
  }

  private readonly index = new Map<string, StoredBook>();
  private readonly records = new Map<string, { signature: string; promise: Promise<BookRecord | null> }>();
  private readonly archives = new Map<string, { signature: string; promise: Promise<JSZip> }>();

  constructor(private readonly booksDir: string, private readonly inspectRecord = inspectBookEpubRecord) {}

  private async fileSignature(filePath: string): Promise<string> {
    const info = await stat(filePath, { bigint: true });
    return [info.size, info.mtimeNs, info.ctimeNs, info.ino].join(":");
  }

  private loadRecord(filePath: string, signature: string): Promise<BookRecord | null> {
    const cached = this.records.get(filePath);
    if (cached?.signature === signature) {
      this.records.delete(filePath);
      this.records.set(filePath, cached);
      return cached.promise;
    }
    const promise = this.inspectRecord(filePath).then(async (record) =>
      await this.fileSignature(filePath) === signature ? record : null
    ).catch(() => null);
    this.records.set(filePath, { signature, promise });
    // Keep a small full-text working set. The lightweight index survives eviction.
    while (this.records.size > 8) this.records.delete(this.records.keys().next().value!);
    return promise;
  }

  isImporting(bookId: string): boolean {
    return this.importInFlight.has(bookId);
  }

  async preview(filename: string, data: Buffer): Promise<BookImportPreview> {
    return this.inspect(filename, data, true);
  }

  async import(filename: string, data: Buffer, beforeCommit?: (bookId: string) => Promise<void>): Promise<BookImportPreview> {
    const preview = await this.inspect(filename, data, false);
    if (preview.status !== "ready" || !preview.bookId) return preview;
    if (this.isDeleting(preview.bookId)) return { ...preview, status: "conflict", message: "该书正在删除，请稍后重试。" };

    const activeImport = this.importInFlight.get(preview.bookId);
    if (activeImport) {
      await activeImport;
      const duplicate = await this.findDuplicate(preview.bookId);
      return duplicate
        ? this.duplicatePreview(preview, duplicate.filename)
        : preview;
    }

    const bookId = preview.bookId;
    const importPromise = this.commitImport(preview, bookId, data, beforeCommit)
      .finally(() => this.importInFlight.delete(bookId));
    this.importInFlight.set(bookId, importPromise);
    return importPromise;
  }

  async listBooks(): Promise<BookSummary[]> {
    const stored = await this.scanStoredBooks();
    return stored
      .map(({ summary }) => summary)
      .sort((left, right) => left.title.localeCompare(right.title, "en", { sensitivity: "base" }));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const stored = await this.findStoredBook(bookId);
    return stored ? this.loadRecord(stored.filePath, stored.signature) : null;
  }

  async getCover(bookId: string): Promise<{ data: Buffer; mediaType: string } | null> {
    const stored = await this.findStoredBook(bookId);
    if (!stored?.cover) return null;
    const archive = await JSZip.loadAsync(await readFile(stored.filePath));
    const entry = archive.file(stored.cover.entryPath);
    if (!entry) return null;
    return {
      data: await entry.async("nodebuffer"),
      mediaType: stored.cover.mediaType,
    };
  }

  private async originalArchive(bookId: string) {
    const stored = await this.findStoredBook(bookId);
    if (!stored || this.isDeleting(bookId)) return null;
    const book = await this.loadRecord(stored.filePath, stored.signature);
    if (!book) return null;
    let cached = this.archives.get(stored.filePath);
    if (cached?.signature !== stored.signature) {
      const promise = readFile(stored.filePath).then(data => JSZip.loadAsync(data));
      cached = { signature: stored.signature, promise }; this.archives.set(stored.filePath, cached);
      void promise.catch(() => { if (this.archives.get(stored.filePath)?.promise === promise) this.archives.delete(stored.filePath); });
      while (this.archives.size > 2) this.archives.delete(this.archives.keys().next().value!);
    }
    return { book, archive: await cached.promise };
  }

  async getOriginalChapter(bookId: string, chapterId: string): Promise<string | null> {
    const source = await this.originalArchive(bookId);
    return source ? originalChapterHtml(source.archive, source.book, chapterId) : null;
  }

  async getOriginalResource(bookId: string, entryPath: string) {
    const source = await this.originalArchive(bookId);
    return source ? originalResource(source.archive, source.book, entryPath) : null;
  }

  async getOriginalFile(bookId: string): Promise<{ filename: string; data: Buffer } | null> {
    const stored = await this.findStoredBook(bookId);
    return stored && !this.isDeleting(bookId) ? { filename: stored.filename, data: await readFile(stored.filePath) } : null;
  }

  private async commitImport(preview: BookImportPreview, bookId: string, data: Buffer, beforeCommit?: (bookId: string) => Promise<void>): Promise<BookImportPreview> {
    await mkdir(this.booksDir, { recursive: true });
    const duplicate = await this.findDuplicate(bookId);
    if (duplicate) return this.duplicatePreview(preview, duplicate.filename);

    const finalPath = path.join(this.booksDir, preview.filename);
    if (await this.pathExists(finalPath)) {
      return this.conflictPreview(preview, preview.filename);
    }

    const tempPath = path.join(this.booksDir, `.book-import-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, data, { flag: "wx" });
      await beforeCommit?.(bookId);
      try {
        await link(tempPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const racedDuplicate = await this.findDuplicate(bookId);
          return racedDuplicate
            ? this.duplicatePreview(preview, racedDuplicate.filename)
            : this.conflictPreview(preview, preview.filename);
        }
        throw error;
      }
      return {
        ...preview,
        status: "imported",
        coverDataUrl: undefined,
        message: "电子书导入完成。",
      };
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async inspect(filename: string, data: Buffer, includeCoverData: boolean): Promise<BookImportPreview> {
    const safeFilename = this.safeFilename(filename);
    if (!safeFilename) {
      return {
        filename: this.safeDisplayFilename(filename),
        status: "unsupported",
        hasCover: false,
        message: "请选择一个文件名安全的 .epub 电子书。",
      };
    }
    if (!data.length) {
      return { filename: safeFilename, status: "invalid", hasCover: false, message: "EPUB 文件为空。" };
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-book-import-"));
    const tempPath = path.join(tempDir, safeFilename);
    try {
      await writeFile(tempPath, data);
      const record = await this.inspectRecord(tempPath);
      const base = this.previewFromRecord(record, safeFilename);
      const duplicate = await this.findDuplicate(record.id);
      if (duplicate) return this.duplicatePreview(base, duplicate.filename);

      const finalPath = path.join(this.booksDir, safeFilename);
      if (await this.pathExists(finalPath)) return this.conflictPreview(base, safeFilename);

      if (includeCoverData && record.cover) {
        const zip = await JSZip.loadAsync(data);
        const coverEntry = zip.file(record.cover.entryPath);
        const cover = coverEntry ? await coverEntry.async("nodebuffer") : null;
        if (cover && cover.length <= MAX_PREVIEW_COVER_BYTES) {
          base.coverDataUrl = `data:${record.cover.mediaType};base64,${cover.toString("base64")}`;
        }
      }
      return base;
    } catch (error) {
      const message = error instanceof Error ? error.message : "EPUB 解析失败";
      return {
        filename: safeFilename,
        status: "invalid",
        hasCover: false,
        message: `无法解析电子书 EPUB：${message}`,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private previewFromRecord(record: BookRecord, filename: string): BookImportPreview {
    return {
      filename,
      status: "ready",
      bookId: record.id,
      title: record.title,
      authors: record.authors,
      language: record.language,
      publisher: record.publisher,
      publishedAt: record.publishedAt,
      epubVersion: record.epubVersion,
      navigationType: record.navigationType,
      partCount: record.parts.length,
      numberedChapterCount: record.numberedChapterCount,
      readableUnitCount: record.chapters.length,
      hasCover: Boolean(record.cover),
      message: "校验通过，可以导入电子书。",
      presentation: { imageCount: record.chapters.reduce((count, chapter) => count + (chapter.visuals ?? []).reduce((sum, visual) => sum + (visual.sourceImageCount ?? visual.images.length), 0), 0),
        originalBlockCount: record.chapters.reduce((count, chapter) => count + (chapter.visuals ?? []).filter(visual => visual.kind === "original").length, 0) },
    };
  }

  private summaryFromRecord(record: BookRecord): BookSummary {
    return {
      id: record.id,
      sourceFilename: record.sourceFilename,
      title: record.title,
      authors: record.authors,
      language: record.language,
      publisher: record.publisher,
      publishedAt: record.publishedAt,
      epubVersion: record.epubVersion,
      navigationType: record.navigationType,
      hasCover: Boolean(record.cover),
      partCount: record.parts.length,
      numberedChapterCount: record.numberedChapterCount,
      readableUnitCount: record.chapters.length,
    };
  }

  private duplicatePreview(preview: BookImportPreview, existingFilename: string): BookImportPreview {
    return {
      ...preview,
      status: "duplicate",
      coverDataUrl: undefined,
      existingFilename,
      message: `这本书已经存在（${existingFilename}），不会重复导入。`,
    };
  }

  private conflictPreview(preview: BookImportPreview, existingFilename: string): BookImportPreview {
    return {
      ...preview,
      status: "conflict",
      coverDataUrl: undefined,
      existingFilename,
      message: `books/ 中已经存在同名文件 ${existingFilename}，但它不是同一本书；不会覆盖原文件，本次未导入。`,
    };
  }

  private async findDuplicate(bookId: string): Promise<StoredBook | undefined> {
    return this.findStoredBook(bookId);
  }

  private async findStoredBook(bookId: string): Promise<StoredBook | undefined> {
    return (await this.scanStoredBooks()).find((book) => book.summary.id === bookId);
  }

  private async scanStoredBooks(): Promise<StoredBook[]> {
    const entries = await readdir(this.booksDir, { withFileTypes: true }).catch(() => []);
    const paths = new Set(entries.filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".epub")).map((entry) => path.join(this.booksDir, entry.name)));
    for (const filePath of this.index.keys()) if (!paths.has(filePath)) this.index.delete(filePath);
    for (const filePath of this.records.keys()) if (!paths.has(filePath)) this.records.delete(filePath);
    const books: StoredBook[] = [];
    for (const filePath of paths) {
      try {
        const signature = await this.fileSignature(filePath);
        let stored = this.index.get(filePath);
        if (stored?.signature !== signature) {
          this.index.delete(filePath);
          const record = await this.loadRecord(filePath, signature);
          if (!record) continue;
          stored = { filename: path.basename(filePath), filePath, signature, summary: this.summaryFromRecord(record), cover: record.cover };
          this.index.set(filePath, stored);
        }
        if (stored) books.push(stored);
      } catch {
        this.index.delete(filePath);
        this.records.delete(filePath);
        // Missing or invalid files cannot participate in duplicate checks.
      }
    }
    return books;
  }

  private safeFilename(filename: string): string | null {
    const candidate = filename.trim();
    if (!candidate || path.basename(candidate) !== candidate) return null;
    if (!candidate.toLocaleLowerCase("en-US").endsWith(".epub")) return null;
    return candidate;
  }

  private safeDisplayFilename(filename: string): string {
    return path.basename(filename.trim()) || "未命名 EPUB";
  }

  private async pathExists(filePath: string): Promise<boolean> {
    return access(filePath).then(() => true).catch(() => false);
  }
}
