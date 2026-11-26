import { access, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { inspectBookEpubRecord } from "../../epub/book-record-contract.js";
import type { BookImportPreview, BookRecord, BookSummary } from "../../shared/book-data-contract.js";
import { BOOK_LANGUAGE_LABELS, classifyBookLanguage, type BookLanguage } from "../../shared/book-language.js";
import { bookChapterWeights } from "../../shared/book-progress.js";
import { originalChapterHtml, originalResource } from "./book-original-content.js";

const MAX_PREVIEW_COVER_BYTES = 2_000_000;

interface StoredBook {
  filename: string;
  filePath: string;
  signature: string;
  configuredOverride?: string;
  overrideId?: string;
  summary: BookSummary;
  cover: BookRecord["cover"];
}

interface BookEditionsStore {
  version: 1;
  byFilename: Record<string, string>;
}

interface BookDeleteJournal {
  version: 1;
  token: string;
  filename: string;
  stagedFilename: string;
  editionBookId: string | null;
  phase: "staged" | "committed";
}

class BookEditionsStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BookEditionsStoreError";
  }
}

class BookDeleteRecoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BookDeleteRecoveryError";
  }
}

function filenameReservationKey(filename: string): string {
  return filename.toLocaleLowerCase("en-US");
}

const editionStoreQueues = new Map<string, Promise<unknown>>();
const deleteRecoveryQueues = new Map<string, Promise<unknown>>();

function withSerializedQueue<T>(queues: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.finally(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return next;
}

function withEditionStoreLock<T>(editionsPath: string, task: () => Promise<T>): Promise<T> {
  return withSerializedQueue(editionStoreQueues, path.resolve(editionsPath), task);
}

function withDeleteRecoveryLock<T>(booksDir: string, task: () => Promise<T>): Promise<T> {
  return withSerializedQueue(deleteRecoveryQueues, path.resolve(booksDir), task);
}

function languageQualifiedBookId(baseBookId: string, language: BookLanguage): string {
  return `${baseBookId}-lang-${language}`;
}

function withBookId(record: BookRecord, bookId: string): BookRecord {
  if (record.id === bookId) return record;
  return {
    ...record,
    id: bookId,
    parts: record.parts.map((part) => ({ ...part, bookId })),
    chapters: record.chapters.map((chapter) => ({ ...chapter, bookId })),
  };
}

export class BookImportService {
  private readonly importInFlight = new Map<string, Promise<BookImportPreview>>();
  private readonly baseBookCommitQueues = new Map<string, Promise<unknown>>();
  private readonly reservedFilenames = new Set<string>();
  private readonly activeDeleteTokens = new Set<string>();
  private readonly deleting = new Set<string>();

  isDeleting(bookId: string): boolean { return this.deleting.has(bookId); }

  canPrepare(bookId: string): boolean {
    return !this.deleting.has(bookId) && [...this.index.values()].some(({ summary }) => summary.id === bookId);
  }

  private withBaseBookCommitLock<T>(baseBookId: string, task: () => Promise<T>): Promise<T> {
    return withSerializedQueue(this.baseBookCommitQueues, baseBookId, task);
  }

  private async writeDeleteJournal(journalPath: string, journal: BookDeleteJournal): Promise<void> {
    const tempPath = `${journalPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(journal, null, 2), "utf8");
      await rename(tempPath, journalPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async restoreStagedFileSafely(stagedPath: string, originalPath: string): Promise<void> {
    try {
      await link(stagedPath, originalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        const [stagedStat, originalStat] = await Promise.all([
          lstat(stagedPath, { bigint: true }),
          lstat(originalPath, { bigint: true }),
        ]);
        if (
          !stagedStat.isFile()
          || !originalStat.isFile()
          || stagedStat.dev !== originalStat.dev
          || stagedStat.ino !== originalStat.ino
        ) {
          throw new BookDeleteRecoveryError(
            `无法恢复暂存电子书（目标文件名已存在），已同时保留两份文件：${path.basename(originalPath)} 与 ${path.basename(stagedPath)}`,
            { cause: error },
          );
        }
      } else {
        throw new BookDeleteRecoveryError(
          `恢复暂存电子书失败，已保留暂存文件：${path.basename(stagedPath)}`,
          { cause: error },
        );
      }
    }
    await unlink(stagedPath);
  }

  private async stagedFileExistsStrict(stagedPath: string): Promise<boolean> {
    try {
      await lstat(stagedPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw new BookDeleteRecoveryError(
        `检查暂存电子书状态失败，已保留删除恢复日志：${path.basename(stagedPath)}`,
        { cause: error },
      );
    }
  }

  private async readBooksDirEntries() {
    try {
      return await readdir(this.booksDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw new BookDeleteRecoveryError("书库目录读取失败，已保留当前索引与恢复日志，请检查权限或磁盘后重试。", { cause: error });
    }
  }

  private async recoverPendingDeletes(editions: Record<string, string>): Promise<void> {
    await withDeleteRecoveryLock(this.booksDir, async () => {
      const entries = await this.readBooksDirEntries();
      const journals = entries
        .filter((entry) => entry.isFile() && /^\.book-delete-.+\.journal\.json$/.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const entry of journals) {
        const journalPath = path.join(this.booksDir, entry.name);
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(journalPath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
          throw new BookDeleteRecoveryError(`删除恢复日志损坏，已停止清理并保留现场：${entry.name}`, { cause: error });
        }
        const raw = parsed as Partial<BookDeleteJournal> | null;
        const hasValidEditionBookId = Boolean(raw)
          && Object.hasOwn(raw as object, "editionBookId")
          && (raw?.editionBookId === null || (typeof raw?.editionBookId === "string" && raw.editionBookId.trim().length > 0));
        if (
          !raw
          || typeof raw !== "object"
          || Array.isArray(raw)
          || raw.version !== 1
          || typeof raw.token !== "string"
          || !/^[A-Za-z0-9_-]{8,128}$/.test(raw.token)
          || typeof raw.filename !== "string"
          || typeof raw.stagedFilename !== "string"
          || !hasValidEditionBookId
          || (raw.phase !== "staged" && raw.phase !== "committed")
        ) {
          throw new BookDeleteRecoveryError(`删除恢复日志内容无效，已停止清理并保留现场：${entry.name}`);
        }
        const journal: BookDeleteJournal = {
          version: 1,
          token: raw.token,
          filename: raw.filename,
          stagedFilename: raw.stagedFilename,
          editionBookId: raw.editionBookId === null ? null : raw.editionBookId!.trim(),
          phase: raw.phase,
        };
        if (
          entry.name !== `.book-delete-${journal.token}.journal.json`
          || journal.stagedFilename !== `.book-delete-${journal.token}.tmp`
        ) {
          throw new BookDeleteRecoveryError(`删除恢复日志标识不匹配，已停止清理并保留现场：${entry.name}`);
        }
        if (this.activeDeleteTokens.has(journal.token)) continue;
        const safeFilename = this.safeFilename(journal.filename);
        if (!safeFilename) {
          throw new BookDeleteRecoveryError(`删除恢复日志包含非法文件名，已停止清理并保留现场：${entry.name}`);
        }
        const filenameKey = filenameReservationKey(safeFilename);
        if (this.reservedFilenames.has(filenameKey)) continue;
        this.reservedFilenames.add(filenameKey);
        try {
          const originalPath = path.join(this.booksDir, safeFilename);
          const stagedPath = path.join(this.booksDir, journal.stagedFilename);
          const alreadyCommitted = journal.phase === "committed"
            || (journal.editionBookId !== null
              && (!Object.hasOwn(editions, safeFilename) || editions[safeFilename] !== journal.editionBookId));
          if (alreadyCommitted) {
            try {
              await unlink(stagedPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
            }
            await unlink(journalPath);
          } else {
            if (await this.stagedFileExistsStrict(stagedPath)) {
              await this.restoreStagedFileSafely(stagedPath, originalPath);
            }
            await unlink(journalPath);
          }
        } finally {
          this.reservedFilenames.delete(filenameKey);
        }
      }
    });
  }

  async deleteBook(bookId: string, beforeDelete: () => Promise<void>): Promise<"deleted" | "busy" | "missing"> {
    if (this.deleting.has(bookId) || this.isImporting(bookId)) return "busy";
    this.deleting.add(bookId);
    let filenameKey: string | undefined;
    let deleteToken: string | undefined;
    try {
      const stored = await this.findStoredBook(bookId);
      if (!stored) return "missing";
      const candidateKey = filenameReservationKey(stored.filename);
      if (this.reservedFilenames.has(candidateKey)) return "busy";
      this.reservedFilenames.add(candidateKey);
      filenameKey = candidateKey;

      // Resolve only from the scanned library; never interpret a caller-supplied path.
      await beforeDelete();

      deleteToken = randomUUID();
      this.activeDeleteTokens.add(deleteToken);
      const stagedFilename = `.book-delete-${deleteToken}.tmp`;
      const stagedPath = path.join(this.booksDir, stagedFilename);
      const journalPath = path.join(this.booksDir, `.book-delete-${deleteToken}.journal.json`);
      const journal: BookDeleteJournal = {
        version: 1,
        token: deleteToken,
        filename: stored.filename,
        stagedFilename,
        editionBookId: stored.configuredOverride ?? null,
        phase: "staged",
      };
      await this.writeDeleteJournal(journalPath, journal);
      try {
        await rename(stored.filePath, stagedPath);
      } catch (error) {
        await unlink(journalPath).catch(() => undefined);
        throw error;
      }

      try {
        await this.removeEditionId(stored.filename);
      } catch (error) {
        await this.restoreStagedFileSafely(stagedPath, stored.filePath);
        await unlink(journalPath);
        throw error;
      }

      await this.writeDeleteJournal(journalPath, { ...journal, phase: "committed" });
      await unlink(stagedPath);
      await unlink(journalPath);
      this.index.delete(stored.filePath);
      this.records.delete(stored.filePath);
      this.archives.delete(stored.filePath);
      return "deleted";
    } finally {
      if (deleteToken) this.activeDeleteTokens.delete(deleteToken);
      if (filenameKey) this.reservedFilenames.delete(filenameKey);
      this.deleting.delete(bookId);
    }
  }

  private readonly index = new Map<string, StoredBook>();
  private readonly records = new Map<string, { signature: string; overrideId?: string; promise: Promise<BookRecord | null> }>();
  private readonly archives = new Map<string, { signature: string; promise: Promise<JSZip> }>();

  constructor(
    private readonly booksDir: string,
    private readonly inspectRecord = inspectBookEpubRecord,
    private readonly editionsPath = path.join(path.dirname(booksDir), ".book-editions.json"),
  ) {}

  private async fileSignature(filePath: string): Promise<string> {
    const info = await stat(filePath, { bigint: true });
    return [info.size, info.mtimeNs, info.ctimeNs, info.ino].join(":");
  }

  private async loadEditionIds(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.editionsPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return Object.create(null);
      throw new BookEditionsStoreError("书籍语言版本映射读取失败，已保留原文件并停止写入，请检查权限或磁盘后重试。", { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new BookEditionsStoreError("书籍语言版本映射文件损坏，已保留原文件并停止写入，请先修复后再试。", { cause: error });
    }
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || !("byFilename" in parsed)
      || !parsed.byFilename
      || typeof parsed.byFilename !== "object"
      || Array.isArray(parsed.byFilename)
    ) {
      throw new BookEditionsStoreError("书籍语言版本映射文件内容无效，已保留原文件并停止写入。");
    }
    const result: Record<string, string> = Object.create(null);
    for (const [filename, id] of Object.entries(parsed.byFilename as Record<string, unknown>)) {
      if (typeof id !== "string" || !id.trim()) {
        throw new BookEditionsStoreError("书籍语言版本映射文件包含无效条目，已保留原文件并停止写入。");
      }
      result[filename] = id.trim();
    }
    return result;
  }

  private async writeEditionIds(byFilename: Record<string, string>): Promise<void> {
    await mkdir(path.dirname(this.editionsPath), { recursive: true });
    const tempPath = `${this.editionsPath}.${randomUUID()}.tmp`;
    const payload: BookEditionsStore = { version: 1, byFilename };
    try {
      await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
      await rename(tempPath, this.editionsPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private saveEditionId(filename: string, bookId: string): Promise<void> {
    return withEditionStoreLock(this.editionsPath, async () => {
      const current = await this.loadEditionIds();
      if (Object.hasOwn(current, filename) && current[filename] === bookId) return;
      current[filename] = bookId;
      await this.writeEditionIds(current);
    });
  }

  private removeEditionId(filename: string): Promise<void> {
    return withEditionStoreLock(this.editionsPath, async () => {
      const current = await this.loadEditionIds();
      if (!Object.hasOwn(current, filename)) return;
      delete current[filename];
      await this.writeEditionIds(current);
    });
  }

  private loadRecord(filePath: string, signature: string, overrideId?: string): Promise<BookRecord | null> {
    const cached = this.records.get(filePath);
    if (cached?.signature === signature && cached.overrideId === overrideId) {
      this.records.delete(filePath);
      this.records.set(filePath, cached);
      return cached.promise;
    }
    const promise = this.inspectRecord(filePath).then(async (record) => {
      if (await this.fileSignature(filePath) !== signature) return null;
      return overrideId ? withBookId(record, overrideId) : record;
    }).catch(() => null);
    this.records.set(filePath, { signature, overrideId, promise });
    // Keep a small full-text working set. The lightweight index survives eviction.
    while (this.records.size > 8) this.records.delete(this.records.keys().next().value!);
    return promise;
  }

  isImporting(bookId: string): boolean {
    return this.importInFlight.has(bookId);
  }

  async preview(filename: string, data: Buffer): Promise<BookImportPreview> {
    return (await this.inspect(filename, data, true)).preview;
  }

  async import(filename: string, data: Buffer, beforeCommit?: (bookId: string) => Promise<void>): Promise<BookImportPreview> {
    const inspected = await this.inspect(filename, data, false);
    if (inspected.preview.status !== "ready" || !inspected.rawBookId || !inspected.incomingLanguage) {
      return inspected.preview;
    }
    const { rawBookId, incomingLanguage } = inspected;
    return this.withBaseBookCommitLock(rawBookId, async () => {
      const resolved = await this.resolveImportBookId(rawBookId, incomingLanguage);
      const resolvedPreview: BookImportPreview = {
        ...inspected.preview,
        bookId: resolved.bookId,
      };
      if (resolved.duplicate) {
        return this.duplicatePreview(resolvedPreview, resolved.duplicate.filename);
      }
      if (resolved.siblingFilename) {
        resolvedPreview.message = `检测到书库中已有同书的其他语言版本（${resolved.siblingFilename}），将作为独立的${BOOK_LANGUAGE_LABELS[incomingLanguage]}版导入。`;
      }
      if (this.isDeleting(resolved.bookId) || this.isDeleting(rawBookId)) {
        return { ...resolvedPreview, status: "conflict", message: "该书正在删除，请稍后重试。" };
      }
      const filenameKey = filenameReservationKey(resolvedPreview.filename);
      if (this.reservedFilenames.has(filenameKey)) {
        return {
          ...resolvedPreview,
          status: "conflict",
          coverDataUrl: undefined,
          existingFilename: resolvedPreview.filename,
          message: `同名文件 ${resolvedPreview.filename} 正在导入或删除，请稍后重试。`,
        };
      }
      this.reservedFilenames.add(filenameKey);
      const trackedIds = [...new Set([rawBookId, resolved.bookId])];
      const importPromise = this.commitImport(resolvedPreview, resolved.bookId, data, resolved.persistEditionId, beforeCommit);
      for (const id of trackedIds) this.importInFlight.set(id, importPromise);
      try {
        return await importPromise;
      } finally {
        for (const id of trackedIds) {
          if (this.importInFlight.get(id) === importPromise) this.importInFlight.delete(id);
        }
        this.reservedFilenames.delete(filenameKey);
      }
    });
  }

  async listBooks(): Promise<BookSummary[]> {
    const stored = await this.scanStoredBooks();
    return stored
      .map(({ summary }) => summary)
      .sort((left, right) => left.title.localeCompare(right.title, "en", { sensitivity: "base" }));
  }

  /** Return only metadata already discovered by the normal Reader library load.
   * Backup enumerates EPUB names only to ensure the index is complete; it never
   * opens, parses, copies, compresses or hashes an original EPUB here. */
  async snapshotBackupIndex(): Promise<Array<Record<string, unknown>>> {
    const books: Array<Record<string, unknown>> = [];
    const entries = await readdir(this.booksDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const sourceNames = entries.filter(entry => entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".epub")).map(entry => entry.name);
    for (const stored of this.index.values()) {
      const cached = this.records.get(stored.filePath);
      let record: BookRecord | null = null;
      if (cached?.signature === stored.signature && cached.overrideId === stored.overrideId) record = await cached.promise;
      books.push({
        ...stored.summary,
        ...(record ? {
          parts: record.parts.map(({ id, title, order, chapterIds }) => ({ id, title, order, chapterIds })),
          chapters: record.chapters.map(({ id, partId, order, role, title, wordCount }) => ({ id, partId, order, role, title, wordCount })),
          indexAvailable: true,
        } : { parts: [], chapters: [], indexAvailable: false }),
      });
    }
    const indexedNames = new Set(books.map(book => String(book.sourceFilename || "").toLocaleLowerCase("en-US")));
    const missingIndexes = sourceNames.filter(name => !indexedNames.has(name.toLocaleLowerCase("en-US")));
    if (missingIndexes.length) throw new Error(`Reader 书库索引尚未就绪（${missingIndexes.length} 个文件未出现在已加载索引中），已停止备份以免丢失书籍关联。请等待书架加载完成后重试。`);
    return books.sort((left, right) => String(left.title).localeCompare(String(right.title), "en", { sensitivity: "base" }));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const stored = await this.findStoredBook(bookId);
    return stored ? this.loadRecord(stored.filePath, stored.signature, stored.overrideId) : null;
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
    const book = await this.loadRecord(stored.filePath, stored.signature, stored.overrideId);
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

  private async commitImport(
    preview: BookImportPreview,
    bookId: string,
    data: Buffer,
    persistEditionId: boolean,
    beforeCommit?: (bookId: string) => Promise<void>,
  ): Promise<BookImportPreview> {
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
      if (persistEditionId) {
        try {
          await this.saveEditionId(preview.filename, bookId);
        } catch (error) {
          await unlink(finalPath).catch(() => undefined);
          this.index.delete(finalPath);
          this.records.delete(finalPath);
          throw error;
        }
        this.index.delete(finalPath);
        this.records.delete(finalPath);
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

  private async resolveImportBookId(baseBookId: string, incomingLanguage: BookLanguage): Promise<{
    bookId: string;
    duplicate?: StoredBook;
    persistEditionId: boolean;
    siblingFilename?: string;
  }> {
    const qualifiedId = languageQualifiedBookId(baseBookId, incomingLanguage);
    const existingQualified = await this.findDuplicate(qualifiedId);
    if (existingQualified) {
      return { bookId: qualifiedId, duplicate: existingQualified, persistEditionId: false };
    }
    const existingBase = await this.findDuplicate(baseBookId);
    if (!existingBase) {
      return { bookId: baseBookId, persistEditionId: false };
    }
    const existingLanguage = existingBase.summary.readingLanguage;
    if (!existingLanguage || existingLanguage === incomingLanguage) {
      return { bookId: baseBookId, duplicate: existingBase, persistEditionId: false };
    }
    return {
      bookId: qualifiedId,
      persistEditionId: true,
      siblingFilename: existingBase.filename,
    };
  }

  private async inspect(
    filename: string,
    data: Buffer,
    includeCoverData: boolean,
  ): Promise<{
    preview: BookImportPreview;
    persistEditionId: boolean;
    rawBookId?: string;
    incomingLanguage?: BookLanguage;
  }> {
    const safeFilename = this.safeFilename(filename);
    if (!safeFilename) {
      return {
        preview: {
          filename: this.safeDisplayFilename(filename),
          status: "unsupported",
          hasCover: false,
          message: "请选择一个文件名安全的 .epub 电子书。",
        },
        persistEditionId: false,
      };
    }
    if (!data.length) {
      return {
        preview: { filename: safeFilename, status: "invalid", hasCover: false, message: "EPUB 文件为空。" },
        persistEditionId: false,
      };
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-book-import-"));
    const tempPath = path.join(tempDir, safeFilename);
    try {
      await writeFile(tempPath, data);
      const rawRecord = await this.inspectRecord(tempPath);
      const incomingLanguage = classifyBookLanguage(rawRecord);
      const resolved = await this.resolveImportBookId(rawRecord.id, incomingLanguage);
      const record = withBookId(rawRecord, resolved.bookId);
      const base = this.previewFromRecord(record, safeFilename);
      if (resolved.duplicate) {
        return { preview: this.duplicatePreview(base, resolved.duplicate.filename), persistEditionId: false };
      }
      if (resolved.siblingFilename) {
        base.message = `检测到书库中已有同书的其他语言版本（${resolved.siblingFilename}），将作为独立的${BOOK_LANGUAGE_LABELS[incomingLanguage]}版导入。`;
      }

      const finalPath = path.join(this.booksDir, safeFilename);
      if (this.reservedFilenames.has(filenameReservationKey(safeFilename))) {
        return {
          preview: {
            ...base,
            status: "conflict",
            coverDataUrl: undefined,
            existingFilename: safeFilename,
            message: `同名文件 ${safeFilename} 正在导入或删除，请稍后重试。`,
          },
          persistEditionId: false,
        };
      }
      if (await this.pathExists(finalPath)) {
        return { preview: this.conflictPreview(base, safeFilename), persistEditionId: false };
      }

      if (includeCoverData && record.cover) {
        const zip = await JSZip.loadAsync(data);
        const coverEntry = zip.file(record.cover.entryPath);
        const cover = coverEntry ? await coverEntry.async("nodebuffer") : null;
        if (cover && cover.length <= MAX_PREVIEW_COVER_BYTES) {
          base.coverDataUrl = `data:${record.cover.mediaType};base64,${cover.toString("base64")}`;
        }
      }
      return {
        preview: base,
        persistEditionId: resolved.persistEditionId,
        rawBookId: rawRecord.id,
        incomingLanguage,
      };
    } catch (error) {
      if (error instanceof BookEditionsStoreError || error instanceof BookDeleteRecoveryError) throw error;
      const message = error instanceof Error ? error.message : "EPUB 解析失败";
      return {
        preview: {
          filename: safeFilename,
          status: "invalid",
          hasCover: false,
          message: `无法解析电子书 EPUB：${message}`,
        },
        persistEditionId: false,
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
      readingLanguage: classifyBookLanguage(record),
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
      readingLanguage: classifyBookLanguage(record),
      publisher: record.publisher,
      publishedAt: record.publishedAt,
      epubVersion: record.epubVersion,
      navigationType: record.navigationType,
      hasCover: Boolean(record.cover),
      partCount: record.parts.length,
      numberedChapterCount: record.numberedChapterCount,
      readableUnitCount: record.chapters.length,
      chapterWeights: bookChapterWeights(record.chapters),
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
    const editions = await this.loadEditionIds();
    await this.recoverPendingDeletes(editions);

    const entries = await this.readBooksDirEntries();
    const sortedPaths = entries
      .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".epub"))
      .map((entry) => path.join(this.booksDir, entry.name))
      .sort((left, right) => path.basename(left).localeCompare(path.basename(right), "en", { sensitivity: "base" }));
    const paths = new Set(sortedPaths);
    for (const filePath of this.index.keys()) if (!paths.has(filePath)) this.index.delete(filePath);
    for (const filePath of this.records.keys()) if (!paths.has(filePath)) this.records.delete(filePath);

    const seenIds = new Set<string>();
    const books: StoredBook[] = [];
    for (const filePath of sortedPaths) {
      try {
        const signature = await this.fileSignature(filePath);
        const filename = path.basename(filePath);
        const configuredOverride = editions[filename];
        let stored = this.index.get(filePath);
        if (stored?.signature !== signature || stored.configuredOverride !== configuredOverride) {
          this.index.delete(filePath);
          const record = await this.loadRecord(filePath, signature, configuredOverride);
          if (!record) continue;
          stored = {
            filename,
            filePath,
            signature,
            configuredOverride,
            overrideId: configuredOverride,
            summary: this.summaryFromRecord(record),
            cover: record.cover,
          };
          this.index.set(filePath, stored);
        }
        if (stored) {
          if (seenIds.has(stored.summary.id) && stored.summary.readingLanguage && !configuredOverride) {
            const disambiguatedId = languageQualifiedBookId(stored.summary.id, stored.summary.readingLanguage);
            if (!seenIds.has(disambiguatedId)) {
              stored = {
                ...stored,
                overrideId: disambiguatedId,
                summary: { ...stored.summary, id: disambiguatedId },
              };
              this.index.set(filePath, stored);
            }
          }
          seenIds.add(stored.summary.id);
          books.push(stored);
        }
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
