import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookImportService } from "./book-import-service.js";
import { inspectBookEpubRecord } from "../../epub/book-record-contract.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bookFixture(input: {
  title?: string;
  isbn?: string;
  author?: string;
  language?: string;
  bodyParagraph?: string;
} = {}): Promise<Buffer> {
  const title = input.title ?? "Fixture Research Book";
  const isbn = input.isbn ?? "9780000000002";
  const author = input.author ?? "Author One";
  const language = input.language ?? "en";
  const bodyParagraph = input.bodyParagraph ?? "Opening paragraph.";
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${language}</dc:language>
    <dc:publisher>Fixture Press</dc:publisher>
    <dc:date>2026-09-27</dc:date>
    <dc:identifier id="bookid">${isbn}</dc:identifier>
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
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="part"><navLabel><text>I Research</text></navLabel><content src="Text/part.xhtml#part"/>
    <navPoint id="ch1"><navLabel><text>1 First Chapter</text></navLabel><content src="Text/ch1.xhtml#ch1"/>
      <navPoint id="s1"><navLabel><text>1.1 First Section</text></navLabel><content src="Text/ch1.xhtml#s1"/></navPoint>
    </navPoint>
    <navPoint id="ch2"><navLabel><text>2 Second Chapter</text></navLabel><content src="Text/ch2.xhtml#ch2"/></navPoint>
  </navPoint>
</navMap></ncx>`);
  zip.file("OEBPS/Text/part.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>I Research</h1></body></html>`);
  zip.file("OEBPS/Text/ch1.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>1 First Chapter</h1><p>${bodyParagraph}</p><h2>1.1 FIRST SECTION</h2><p>Evidence paragraph.</p></body></html>`);
  zip.file("OEBPS/Text/ch2.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>2 Second Chapter</h1><p>${bodyParagraph}</p></body></html>`);
  zip.file("OEBPS/Images/cover.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return zip.generateAsync({ type: "nodebuffer" });
}

async function serviceRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const booksDir = path.join(root, "books");
  await mkdir(booksDir);
  return { root, booksDir, service: new BookImportService(booksDir) };
}

describe("Book Import Service V0.1", () => {
  it("deletes only the resolved library copy, rejects concurrent deletion, and releases locks on failure", async () => {
    const { root, booksDir, service } = await serviceRoot("book-delete-");
    const source = await bookFixture();
    await writeFile(path.join(root, "original.epub"), source);
    await service.import("First.epub", source);
    await service.import("Other.epub", await bookFixture({ title: "Other", isbn: "9780000000019" }));
    const id = "book:isbn:9780000000002";
    await expect(service.deleteBook(id, async () => { throw new Error("cache write failed"); })).rejects.toThrow("cache write failed");
    expect(service.isDeleting(id)).toBe(false);
    expect(await service.getBook(id)).not.toBeNull();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const deleting = service.deleteBook(id, () => wait);
    expect(service.isDeleting(id)).toBe(true);
    expect(service.canPrepare(id)).toBe(false);
    expect(await service.deleteBook(id, async () => {})).toBe("busy");
    release();
    expect(await deleting).toBe("deleted");
    expect(service.isDeleting(id)).toBe(false);
    expect(service.canPrepare(id)).toBe(false);
    expect(await service.getBook(id)).toBeNull();
    expect(await service.getCover(id)).toBeNull();
    expect(await readdir(booksDir)).toEqual(["Other.epub"]);
    expect(await readFile(path.join(root, "original.epub"))).toEqual(source);
    expect(await service.deleteBook("../../original.epub", async () => {})).toBe("missing");
  });
  it("reuses parsed books for lists, details and covers, coalesces concurrent reads and invalidates changed/deleted files", async () => {
    const { booksDir } = await serviceRoot("magazine-reader-book-cache-");
    const first = path.join(booksDir, "First.epub");
    const second = path.join(booksDir, "Second.epub");
    await writeFile(first, await bookFixture());
    await writeFile(second, await bookFixture({ title: "Second", isbn: "9780000000019" }));
    const inspect = vi.fn(inspectBookEpubRecord);
    const service = new BookImportService(booksDir, inspect);
    await Promise.all([service.listBooks(), service.listBooks()]);
    expect(inspect).toHaveBeenCalledTimes(2);
    await service.getBook("book:isbn:9780000000002");
    await service.getCover("book:isbn:9780000000002");
    await service.listBooks();
    expect(inspect).toHaveBeenCalledTimes(2);
    await writeFile(first, await bookFixture({ title: "Revised first book" }));
    expect((await service.getBook("book:isbn:9780000000002"))?.title).toBe("Revised first book");
    expect(inspect).toHaveBeenCalledTimes(3);
    await rm(second);
    expect(await service.getBook("book:isbn:9780000000019")).toBeNull();
    expect(await service.listBooks()).toHaveLength(1);
    await writeFile(first, "invalid replacement");
    expect(await service.getBook("book:isbn:9780000000002")).toBeNull();
    expect(await service.listBooks()).toHaveLength(0);
  });

  it("keeps the lightweight index when full-text entries are evicted", async () => {
    const { booksDir } = await serviceRoot("magazine-reader-book-cache-lru-");
    for (let i = 0; i < 10; i++) await writeFile(path.join(booksDir, `${i}.epub`), await bookFixture({ title: `Book ${i}`, isbn: `urn:fixture:${i}` }));
    const inspect = vi.fn(inspectBookEpubRecord);
    const service = new BookImportService(booksDir, inspect);
    const summaries = await service.listBooks();
    expect(inspect).toHaveBeenCalledTimes(10);
    await service.listBooks();
    expect(inspect).toHaveBeenCalledTimes(10);
    const record = await service.getBook(summaries[0].id);
    expect(record?.id).toBe(summaries[0].id);
    expect(inspect.mock.calls.filter(([file]) => file === path.join(booksDir, "0.epub"))).toHaveLength(2);
    expect(inspect).toHaveBeenCalledTimes(11);
  });

  it("previews metadata and cover, copies into books/, and detects the same book after filename changes", async () => {
    const { booksDir, service } = await serviceRoot("magazine-reader-book-import-");
    const source = await bookFixture();

    const preview = await service.preview("Fixture Research Book.epub", source);
    expect(preview).toMatchObject({
      status: "ready",
      bookId: "book:isbn:9780000000002",
      title: "Fixture Research Book",
      authors: ["Author One"],
      language: "en",
      publisher: "Fixture Press",
      epubVersion: "2.0",
      navigationType: "ncx",
      partCount: 1,
      numberedChapterCount: 2,
      readableUnitCount: 2,
      hasCover: true,
    });
    expect(preview.coverDataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const imported = await service.import("Fixture Research Book.epub", source);
    expect(imported.status).toBe("imported");
    expect(imported.coverDataUrl).toBeUndefined();
    expect(await readdir(booksDir)).toEqual(["Fixture Research Book.epub"]);
    expect(await readFile(path.join(booksDir, "Fixture Research Book.epub"))).toEqual(source);

    await expect(service.listBooks()).resolves.toEqual([
      expect.objectContaining({
        id: "book:isbn:9780000000002",
        title: "Fixture Research Book",
        authors: ["Author One"],
        hasCover: true,
        partCount: 1,
        numberedChapterCount: 2,
        readableUnitCount: 2,
      }),
    ]);
    await expect(service.getBook("book:isbn:9780000000002")).resolves.toMatchObject({
      id: "book:isbn:9780000000002",
      chapters: expect.arrayContaining([expect.objectContaining({ title: "1 First Chapter" })]),
    });
    await expect(service.getBook("book:isbn:missing")).resolves.toBeNull();
    const cover = await service.getCover("book:isbn:9780000000002");
    expect(cover?.mediaType).toBe("image/jpeg");
    expect(cover?.data).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const duplicate = await service.preview("Renamed Copy.epub", source);
    expect(duplicate).toMatchObject({
      status: "duplicate",
      bookId: "book:isbn:9780000000002",
      existingFilename: "Fixture Research Book.epub",
    });
    expect(duplicate.message).toContain("不会重复导入");
  });

  it("serializes concurrent imports of the same Book ID even when filenames differ", async () => {
    const { booksDir, service } = await serviceRoot("magazine-reader-book-import-concurrent-");
    const source = await bookFixture();

    const results = await Promise.all([
      service.import("Book A.epub", source),
      service.import("Book B.epub", source),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "imported"]);
    expect(await readdir(booksDir)).toHaveLength(1);
  });

  it("returns conflict instead of overwriting when the same filename belongs to a different Book ID", async () => {
    const { booksDir, service } = await serviceRoot("magazine-reader-book-import-conflict-");
    const first = await bookFixture({ title: "First Book", isbn: "9780000000002" });
    const second = await bookFixture({ title: "Second Book", isbn: "9780000000019" });

    await expect(service.import("Shared Name.epub", first)).resolves.toMatchObject({ status: "imported" });
    const conflict = await service.preview("Shared Name.epub", second);
    expect(conflict).toMatchObject({
      status: "conflict",
      bookId: "book:isbn:9780000000019",
      existingFilename: "Shared Name.epub",
    });
    expect(conflict.message).toContain("不会覆盖");
    expect(await readFile(path.join(booksDir, "Shared Name.epub"))).toEqual(first);
  });

  it("rejects unsafe filenames and broken EPUBs without leaving files behind", async () => {
    const { booksDir, service } = await serviceRoot("magazine-reader-book-import-invalid-");

    const unsafe = await service.preview("../escape.epub", await bookFixture());
    expect(unsafe.status).toBe("unsupported");

    const broken = await service.import("Broken Book.epub", Buffer.from("not an epub"));
    expect(broken.status).toBe("invalid");
    expect(await readdir(booksDir)).toEqual([]);

    const emptyPath = path.join(booksDir, "manual-invalid.epub");
    await writeFile(emptyPath, "invalid local file");
    const valid = await service.preview("Another Book.epub", await bookFixture());
    expect(valid.status).toBe("ready");
  });

  it("allows importing a translated Chinese edition that shares the same OPF identifier as an existing English book", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-multilang-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const sharedIdentifier = "a354a138-f96b-47d3-9743-c8cb76d5a41e";

    const englishEpub = await bookFixture({
      title: "Messy Jobs",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "繁杂工作（中文版）",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本在外部翻译好的中文电子书正文段落，包含足够多的汉字以便系统准确识别为中文版本，并与英文原版同时保留在书库中。",
    });

    const firstImport = await service.import("Messy Jobs.epub", englishEpub);
    expect(firstImport.status).toBe("imported");
    const englishBookId = firstImport.bookId!;
    expect(englishBookId).toMatch(/^book:id:/);

    const zhPreview = await service.preview("Messy Jobs (中文版).epub", chineseEpub);
    expect(zhPreview).toMatchObject({
      status: "ready",
      bookId: `${englishBookId}-lang-zh`,
      readingLanguage: "zh",
    });
    expect(zhPreview.message).toContain("其他语言版本");

    const zhImport = await service.import("Messy Jobs (中文版).epub", chineseEpub);
    expect(zhImport).toMatchObject({
      status: "imported",
      bookId: `${englishBookId}-lang-zh`,
    });

    // Both editions coexist cleanly in listBooks and getBook with matching chapter bookIds.
    const listed = await service.listBooks();
    expect(listed.map((book) => ({ id: book.id, lang: book.readingLanguage, file: book.sourceFilename }))).toEqual(
      expect.arrayContaining([
        { id: englishBookId, lang: "en", file: "Messy Jobs.epub" },
        { id: `${englishBookId}-lang-zh`, lang: "zh", file: "Messy Jobs (中文版).epub" },
      ]),
    );
    const zhRecord = await service.getBook(`${englishBookId}-lang-zh`);
    expect(zhRecord?.id).toBe(`${englishBookId}-lang-zh`);
    expect(zhRecord?.chapters.every((chapter) => chapter.bookId === `${englishBookId}-lang-zh`)).toBe(true);

    // Re-importing the Chinese edition is still blocked as duplicate.
    const zhDup = await service.preview("Messy Jobs 中文副本.epub", chineseEpub);
    expect(zhDup).toMatchObject({
      status: "duplicate",
      bookId: `${englishBookId}-lang-zh`,
      existingFilename: "Messy Jobs (中文版).epub",
    });

    // Restarting BookImportService preserves both bookIds identically.
    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    expect((await restarted.listBooks()).map((book) => book.id).sort()).toEqual([englishBookId, `${englishBookId}-lang-zh`].sort());

    // Deleting the English edition keeps the Chinese edition's bookId stable and still blocks duplicate Chinese imports.
    expect(await restarted.deleteBook(englishBookId, async () => {})).toBe("deleted");
    const afterDelete = new BookImportService(booksDir, undefined, editionsPath);
    expect((await afterDelete.listBooks()).map((book) => book.id)).toEqual([`${englishBookId}-lang-zh`]);
    expect((await afterDelete.preview("Another ZH Copy.epub", chineseEpub)).status).toBe("duplicate");
  });

  it("rolls back the linked EPUB when persisting the language-edition mapping fails and allows clean retry", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-edition-rollback-");
    const editionsDir = path.join(root, "editions-dir");
    await mkdir(editionsDir, { recursive: true });
    const editionsPath = path.join(editionsDir, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);

    const sharedIdentifier = "urn:uuid:11112222-3333-4444-5555-666677778888";
    const englishEpub = await bookFixture({
      title: "Clear Thinking",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "清晰思考（中文版）",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本在外部翻译好的中文电子书正文段落，包含足够多的汉字以便系统准确识别为中文版本，并与英文原版同时保留在书库中。",
    });

    const firstImport = await service.import("Clear Thinking.epub", englishEpub);
    expect(firstImport.status).toBe("imported");
    const englishBookId = firstImport.bookId!;

    await chmod(editionsDir, 0o500);
    try {
      // Directory is read-only so reading non-existent file returns ENOENT, while writing temp file fails with EACCES.
      await expect(service.import("Clear Thinking (中文版).epub", chineseEpub)).rejects.toThrow();

      // The failed import must NOT leave an orphaned EPUB file in booksDir.
      expect(await readdir(booksDir)).toEqual(["Clear Thinking.epub"]);
    } finally {
      await chmod(editionsDir, 0o700);
    }

    // Once the mapping directory is writable again, retrying the exact same filename succeeds cleanly.
    const retried = await service.import("Clear Thinking (中文版).epub", chineseEpub);
    expect(retried).toMatchObject({
      status: "imported",
      bookId: `${englishBookId}-lang-zh`,
    });
    expect((await readdir(booksDir)).sort()).toEqual(["Clear Thinking (中文版).epub", "Clear Thinking.epub"]);
  });

  it("preserves existing edition mapping file and refuses to overwrite on JSON corruption, invalid schema, or read error", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-edition-corrupt-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const sharedIdentifier = "urn:uuid:99998888-7777-6666-5555-444433332222";
    const englishEpub = await bookFixture({
      title: "Signal",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "信号（中文版）",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本在外部翻译好的中文电子书正文段落，包含足够多的汉字以便系统准确识别为中文版本，并与英文原版同时保留在书库中。",
    });
    const frenchEpub = await bookFixture({
      title: "Signal (FR)",
      isbn: sharedIdentifier,
      language: "fr",
      bodyParagraph: "Ceci est un chapitre en français suffisamment long pour être importé comme édition supplémentaire lors du test.",
    });

    await service.import("Signal.epub", englishEpub);
    await service.import("Signal (中文版).epub", chineseEpub);

    // 1. Corrupt JSON must fail closed and preserve the exact file contents without adding orphaned EPUBs.
    const corruptedRaw = "{corrupted-json";
    await writeFile(editionsPath, corruptedRaw, "utf8");
    await expect(service.import("Signal (FR).epub", frenchEpub)).rejects.toThrow(/损坏|无效|读取失败/);
    expect(await readFile(editionsPath, "utf8")).toBe(corruptedRaw);
    expect((await readdir(booksDir)).sort()).toEqual(["Signal (中文版).epub", "Signal.epub"]);

    // 2. Invalid schema must fail closed and preserve the exact file contents.
    const invalidSchemaRaw = JSON.stringify({ version: 1, byFilename: "not-a-map" });
    await writeFile(editionsPath, invalidSchemaRaw, "utf8");
    await expect(service.import("Signal (FR).epub", frenchEpub)).rejects.toThrow(/无效/);
    expect(await readFile(editionsPath, "utf8")).toBe(invalidSchemaRaw);
    expect((await readdir(booksDir)).sort()).toEqual(["Signal (中文版).epub", "Signal.epub"]);

    // 3. Non-ENOENT read error (editionsPath is a directory -> EISDIR) must fail closed.
    const dirEditionsPath = path.join(root, "editions-is-a-directory");
    await mkdir(dirEditionsPath, { recursive: true });
    const dirService = new BookImportService(booksDir, undefined, dirEditionsPath);
    await expect(dirService.import("Signal (FR).epub", frenchEpub)).rejects.toThrow(/读取失败/);
    expect((await readdir(booksDir)).sort()).toEqual(["Signal (中文版).epub", "Signal.epub"]);
  });

  it("serializes edition mapping writes across concurrent language-edition imports so no mapping is lost", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-edition-concurrent-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);

    const pairs = await Promise.all([1, 2, 3, 4].map(async (index) => {
      const isbn = `urn:uuid:00000000-0000-4000-8000-00000000000${index}`;
      const englishEpub = await bookFixture({
        title: `Concurrent Book ${index}`,
        isbn,
        language: "en",
        bodyParagraph: `This is English book number ${index} with plenty of English words for language classification in concurrent import tests.`,
      });
      const chineseEpub = await bookFixture({
        title: `并发测试书籍 ${index}`,
        isbn,
        language: "zh-CN",
        bodyParagraph: `这是第 ${index} 本中文译本电子书的正文内容，包含足够多的汉字以准确识别为中文语言版本并在并发写入时完整保留映射。`,
      });
      const importedEn = await service.import(`Book ${index}.epub`, englishEpub);
      expect(importedEn.status).toBe("imported");
      return {
        index,
        englishBookId: importedEn.bookId!,
        zhFilename: `Book ${index} (中文版).epub`,
        chineseEpub,
      };
    }));

    // Launch all 4 distinct language-edition imports concurrently against the same editionsPath.
    const results = await Promise.all(
      pairs.map((pair) => service.import(pair.zhFilename, pair.chineseEpub)),
    );
    for (const [i, result] of results.entries()) {
      expect(result).toMatchObject({
        status: "imported",
        bookId: `${pairs[i].englishBookId}-lang-zh`,
      });
    }

    // Verify the persisted mapping file and a freshly restarted BookImportService retain every single edition ID.
    const persisted = JSON.parse(await readFile(editionsPath, "utf8")) as { version: number; byFilename: Record<string, string> };
    expect(persisted.version).toBe(1);
    for (const pair of pairs) {
      expect(persisted.byFilename[pair.zhFilename]).toBe(`${pair.englishBookId}-lang-zh`);
    }

    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    const listedIds = new Set((await restarted.listBooks()).map((book) => book.id));
    for (const pair of pairs) {
      expect(listedIds.has(pair.englishBookId)).toBe(true);
      expect(listedIds.has(`${pair.englishBookId}-lang-zh`)).toBe(true);
    }
  });

  it("restores the EPUB if updating the edition mapping fails during deleteBook and allows clean retry after permissions recover", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-rollback-");
    const editionsDir = path.join(root, "editions-dir");
    await mkdir(editionsDir, { recursive: true });
    const editionsPath = path.join(editionsDir, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const sharedIdentifier = "urn:uuid:77776666-5555-4444-3333-222211110000";

    const englishEpub = await bookFixture({
      title: "Delete Rollback Book",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "删除回滚测试书（中文版）",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本用于验证删除时映射写盘失败能自动恢复原电子书并在恢复权限后继续完成删除的中文测试书籍。",
    });

    await service.import("Delete Rollback Book.epub", englishEpub);
    const zhImport = await service.import("Delete Rollback Book (中文版).epub", chineseEpub);
    expect(zhImport.status).toBe("imported");
    const zhBookId = zhImport.bookId!;

    // Make editionsDir read-only while booksDir remains writable: removeEditionId must fail,
    // and deleteBook must restore the EPUB so the book stays readable and retryable.
    await chmod(editionsDir, 0o500);
    try {
      await expect(service.deleteBook(zhBookId, async () => {})).rejects.toThrow();
      expect((await readdir(booksDir)).sort()).toEqual([
        "Delete Rollback Book (中文版).epub",
        "Delete Rollback Book.epub",
      ]);
      const stillReadable = await service.getBook(zhBookId);
      expect(stillReadable?.id).toBe(zhBookId);
    } finally {
      await chmod(editionsDir, 0o700);
    }

    // Once permissions recover, retrying deleteBook succeeds and removes both EPUB and mapping entry.
    expect(await service.deleteBook(zhBookId, async () => {})).toBe("deleted");
    expect(await readdir(booksDir)).toEqual(["Delete Rollback Book.epub"]);
    const persisted = JSON.parse(await readFile(editionsPath, "utf8")) as { byFilename: Record<string, string> };
    expect(persisted.byFilename["Delete Rollback Book (中文版).epub"]).toBeUndefined();
  });

  it("imports both English and Chinese editions of the same book concurrently into an empty library even when first finishes before second leaves inspect()", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-same-empty-concurrent-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const sharedIdentifier = "urn:uuid:12345678-1234-4123-8123-123456789abc";

    const englishEpub = await bookFixture({
      title: "Dual Launch",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "双语同时入库测试书",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本与英文原版共享同一标识符、并在空书库状态下同时发起导入的中文译本测试电子书正文内容。",
    });

    // Deterministically pause the Chinese import AFTER its initial resolveImportBookId()
    // ran on the empty library (obtaining the base bookId) and BEFORE it returns from inspect()
    // or enters the commit lock.
    let zhPastInitialResolve!: () => void;
    const zhPausedAfterResolve = new Promise<void>((resolve) => {
      zhPastInitialResolve = resolve;
    });
    let releaseZhInspect!: () => void;
    const zhInspectGate = new Promise<void>((resolve) => {
      releaseZhInspect = resolve;
    });
    const originalPathExists = (service as unknown as { pathExists: (target: string) => Promise<boolean> }).pathExists.bind(service);
    vi.spyOn(service as unknown as { pathExists: (target: string) => Promise<boolean> }, "pathExists")
      .mockImplementation(async (target: string) => {
        if (path.basename(target) === "Dual Launch (中文版).epub") {
          zhPastInitialResolve();
          await zhInspectGate;
        }
        return originalPathExists(target);
      });

    const zhPromise = service.import("Dual Launch (中文版).epub", chineseEpub);
    await zhPausedAfterResolve;

    // While ZH is paused after resolving the base ID on an empty library, EN finishes
    // its ENTIRE import and clears importInFlight completely.
    const enResult = await service.import("Dual Launch.epub", englishEpub);
    expect(enResult.status).toBe("imported");
    expect(enResult.bookId).toBeTruthy();
    expect(service.isImporting(enResult.bookId!)).toBe(false);

    // Release ZH: it must re-resolve inside the raw-bookId commit lock and import as -lang-zh.
    releaseZhInspect();
    const zhResult = await zhPromise;
    expect(zhResult.status).toBe("imported");
    expect(zhResult.bookId).toBe(`${enResult.bookId}-lang-zh`);

    // Restarting BookImportService must still expose both editions cleanly.
    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    const restartedBooks = await restarted.listBooks();
    expect(restartedBooks.map((book) => ({ id: book.id, lang: book.readingLanguage })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: enResult.bookId!, lang: "en" },
      { id: `${enResult.bookId}-lang-zh`, lang: "zh" },
    ].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("reserves the filename during deleteBook so concurrent same-name imports cannot collide, and never overwrites an existing target on rollback", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-filename-lock-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);

    const originalEpub = await bookFixture({
      title: "Original Book",
      isbn: "urn:uuid:aaaa1111-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This is the original English book stored under Shared Name.epub before deletion begins.",
    });
    const otherBookEpub = await bookFixture({
      title: "Brand New Different Book",
      isbn: "urn:uuid:bbbb1111-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This is a completely different book trying to reuse the exact same filename while deletion is in flight.",
    });

    const first = await service.import("Shared Name.epub", originalEpub);
    expect(first.status).toBe("imported");

    // 1. Live concurrency: while deleteBook holds Shared Name.epub, a concurrent same-filename import gets conflict.
    let deleteEntered!: () => void;
    const deleteReady = new Promise<void>((resolve) => { deleteEntered = resolve; });
    let allowDeleteFinish!: () => void;
    const deleteGate = new Promise<void>((resolve) => { allowDeleteFinish = resolve; });

    const deletePromise = service.deleteBook(first.bookId!, async () => {
      deleteEntered();
      await deleteGate;
    });
    await deleteReady;

    const racedImport = await service.import("Shared Name.epub", otherBookEpub);
    expect(racedImport.status).toBe("conflict");

    allowDeleteFinish();
    expect(await deletePromise).toBe("deleted");

    // 2. Non-overwriting rollback: if a staged delete file exists AND a new file now occupies Shared Name.epub,
    // recovery must preserve BOTH files and throw rather than overwriting the new EPUB.
    const stagedName = ".book-delete-conflict-token.tmp";
    const journalName = ".book-delete-conflict-token.journal.json";
    await writeFile(path.join(booksDir, "Shared Name.epub"), otherBookEpub);
    await writeFile(path.join(booksDir, stagedName), originalEpub);
    await writeFile(path.join(booksDir, journalName), JSON.stringify({
      version: 1,
      token: "conflict-token",
      filename: "Shared Name.epub",
      stagedFilename: stagedName,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    await expect(restarted.listBooks()).rejects.toThrow(/已同时保留两份文件/);
    expect(Buffer.compare(await readFile(path.join(booksDir, "Shared Name.epub")), otherBookEpub)).toBe(0);
    expect(Buffer.compare(await readFile(path.join(booksDir, stagedName)), originalEpub)).toBe(0);
  });

  it("recovers interrupted delete journals on restart by restoring staged deletes and finishing committed deletes", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-crash-recovery-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const sharedIdentifier = "urn:uuid:cccc1111-2222-4333-8444-555566667777";

    const englishEpub = await bookFixture({
      title: "Recovery Test",
      isbn: sharedIdentifier,
      language: "en",
      bodyParagraph: "This is an English book chapter with enough words to classify clearly as English reading material for testing.",
    });
    const chineseEpub = await bookFixture({
      title: "中断恢复测试书",
      isbn: sharedIdentifier,
      language: "zh-CN",
      bodyParagraph: "这是一本用于验证删除中断后重启自动恢复或完成清理机制的中文测试电子书正文内容。",
    });

    await service.import("Recovery Test.epub", englishEpub);
    const zh = await service.import("Recovery Test (中文版).epub", chineseEpub);
    expect(zh.status).toBe("imported");
    const zhId = zh.bookId!;

    // Scenario A: Crash in phase "staged" after moving EPUB to .tmp and before removing edition mapping.
    const stagedNameA = ".book-delete-crash-staged.tmp";
    const journalNameA = ".book-delete-crash-staged.journal.json";
    await writeFile(path.join(booksDir, stagedNameA), await readFile(path.join(booksDir, "Recovery Test (中文版).epub")));
    await rm(path.join(booksDir, "Recovery Test (中文版).epub"));
    await writeFile(path.join(booksDir, journalNameA), JSON.stringify({
      version: 1,
      token: "crash-staged",
      filename: "Recovery Test (中文版).epub",
      stagedFilename: stagedNameA,
      editionBookId: zhId,
      phase: "staged",
    }), "utf8");

    const restartedA = new BookImportService(booksDir, undefined, editionsPath);
    const recoveredBooks = await restartedA.listBooks();
    expect(recoveredBooks.map((book) => book.id)).toContain(zhId);
    expect((await readdir(booksDir)).sort()).toEqual([
      "Recovery Test (中文版).epub",
      "Recovery Test.epub",
    ]);

    // Scenario B: Crash in phase "committed" after edition mapping was removed, before .tmp was unlinked.
    const stagedNameB = ".book-delete-crash-committed.tmp";
    const journalNameB = ".book-delete-crash-committed.journal.json";
    await writeFile(path.join(booksDir, stagedNameB), chineseEpub);
    await rm(path.join(booksDir, "Recovery Test (中文版).epub"));
    await writeFile(editionsPath, JSON.stringify({ version: 1, byFilename: {} }), "utf8");
    await writeFile(path.join(booksDir, journalNameB), JSON.stringify({
      version: 1,
      token: "crash-committed",
      filename: "Recovery Test (中文版).epub",
      stagedFilename: stagedNameB,
      editionBookId: zhId,
      phase: "committed",
    }), "utf8");

    const restartedB = new BookImportService(booksDir, undefined, editionsPath);
    const afterCommittedRecovery = await restartedB.listBooks();
    expect(afterCommittedRecovery.map((book) => book.sourceFilename)).toEqual(["Recovery Test.epub"]);
    expect(await readdir(booksDir)).toEqual(["Recovery Test.epub"]);
  });

  it("refuses to clean up staged EPUB when delete journal omits editionBookId or has mismatched token/filename", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-journal-invalid-");
    const editionsPath = path.join(root, "book-editions.json");
    const bookEpub = await bookFixture({
      title: "Protected Book",
      isbn: "urn:uuid:dddd1111-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This is the sole remaining copy of the EPUB that must never be unlinked when a delete journal is missing editionBookId.",
    });

    // 1. Missing editionBookId in staged journal must NOT treat undefined !== null as committed.
    const stagedA = ".book-delete-missing-field-token.tmp";
    const journalA = ".book-delete-missing-field-token.journal.json";
    await writeFile(path.join(booksDir, stagedA), bookEpub);
    await writeFile(path.join(booksDir, journalA), JSON.stringify({
      version: 1,
      token: "missing-field-token",
      filename: "Protected Book.epub",
      stagedFilename: stagedA,
      phase: "staged",
    }), "utf8");

    const serviceA = new BookImportService(booksDir, undefined, editionsPath);
    await expect(serviceA.listBooks()).rejects.toThrow(/内容无效/);
    expect(Buffer.compare(await readFile(path.join(booksDir, stagedA)), bookEpub)).toBe(0);
    expect((await readdir(booksDir)).sort()).toEqual([journalA, stagedA]);

    // 2. Mismatched token vs journal filename / stagedFilename must also stop and preserve both files.
    await rm(path.join(booksDir, journalA));
    const journalB = ".book-delete-other-token-name.journal.json";
    await writeFile(path.join(booksDir, journalB), JSON.stringify({
      version: 1,
      token: "missing-field-token",
      filename: "Protected Book.epub",
      stagedFilename: stagedA,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    const serviceB = new BookImportService(booksDir, undefined, editionsPath);
    await expect(serviceB.listBooks()).rejects.toThrow(/标识不匹配/);
    expect(Buffer.compare(await readFile(path.join(booksDir, stagedA)), bookEpub)).toBe(0);
    expect((await readdir(booksDir)).sort()).toEqual([journalB, stagedA].sort());
  });

  it("finishes rollback cleanup on restart when staged and original paths are hardlinked to the same file", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-hardlink-recovery-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);
    const bookEpub = await bookFixture({
      title: "Hardlink Recovery Book",
      isbn: "urn:uuid:eeee1111-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This EPUB tests crash recovery right after link(stagedPath, originalPath) succeeded and before unlink(stagedPath) ran.",
    });

    const imported = await service.import("Hardlink Recovery.epub", bookEpub);
    expect(imported.status).toBe("imported");

    // Simulate crash after link() succeeded and before unlink(stagedPath): both paths share the same inode.
    const stagedName = ".book-delete-hardlink-token.tmp";
    const journalName = ".book-delete-hardlink-token.journal.json";
    await link(path.join(booksDir, "Hardlink Recovery.epub"), path.join(booksDir, stagedName));
    await writeFile(path.join(booksDir, journalName), JSON.stringify({
      version: 1,
      token: "hardlink-token",
      filename: "Hardlink Recovery.epub",
      stagedFilename: stagedName,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    const books = await restarted.listBooks();
    expect(books.map((book) => book.id)).toEqual([imported.bookId!]);
    expect(await readdir(booksDir)).toEqual(["Hardlink Recovery.epub"]);
  });

  it("never treats a symlink to the staged EPUB as a hardlink and preserves both on recovery", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-symlink-recovery-");
    const editionsPath = path.join(root, "book-editions.json");
    const bookEpub = await bookFixture({
      title: "Symlink Protected Book",
      isbn: "urn:uuid:eeee2222-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This is the sole remaining EPUB referenced by a symlink at the original path and must never be unlinked.",
    });

    const stagedName = ".book-delete-symlink-token.tmp";
    const journalName = ".book-delete-symlink-token.journal.json";
    const stagedPath = path.join(booksDir, stagedName);
    const originalPath = path.join(booksDir, "Symlink Protected.epub");
    await writeFile(stagedPath, bookEpub);
    await symlink(stagedPath, originalPath);
    await writeFile(path.join(booksDir, journalName), JSON.stringify({
      version: 1,
      token: "symlink-token",
      filename: "Symlink Protected.epub",
      stagedFilename: stagedName,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    await expect(restarted.listBooks()).rejects.toThrow(/已同时保留两份文件/);
    expect(Buffer.compare(await readFile(stagedPath), bookEpub)).toBe(0);
    expect((await readdir(booksDir)).sort()).toEqual([journalName, stagedName, "Symlink Protected.epub"].sort());
  });

  it("retains the delete recovery journal and staged EPUB when checking the staged file fails with a non-ENOENT error", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-eio-recovery-");
    const editionsPath = path.join(root, "book-editions.json");
    const bookEpub = await bookFixture({
      title: "EIO Protected Book",
      isbn: "urn:uuid:eeee3333-2222-4333-8444-555566667777",
      language: "en",
      bodyParagraph: "This EPUB stays staged while a transient EIO occurs during recovery check; the journal must remain intact.",
    });

    const stagedName = ".book-delete-eio-token.tmp";
    const journalName = ".book-delete-eio-token.journal.json";
    await writeFile(path.join(booksDir, stagedName), bookEpub);
    await writeFile(path.join(booksDir, journalName), JSON.stringify({
      version: 1,
      token: "eio-token",
      filename: "EIO Protected.epub",
      stagedFilename: stagedName,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    const restarted = new BookImportService(booksDir, undefined, editionsPath);
    // Verify stagedFileExistsStrict itself rejects real non-ENOENT OS errors (ENOTDIR) instead of returning false.
    const notADir = path.join(root, "regular-file");
    await writeFile(notADir, "not-a-directory", "utf8");
    await expect(
      (restarted as unknown as { stagedFileExistsStrict: (p: string) => Promise<boolean> })
        .stagedFileExistsStrict(path.join(notADir, "staged.tmp")),
    ).rejects.toThrow(/检查暂存电子书状态失败/);

    const eio = Object.assign(new Error("simulated I/O error"), { code: "EIO" });
    vi.spyOn(restarted as unknown as { stagedFileExistsStrict: (p: string) => Promise<boolean> }, "stagedFileExistsStrict")
      .mockRejectedValueOnce(eio);

    await expect(restarted.listBooks()).rejects.toThrow(/simulated I\/O error/);
    // Both the journal and staged EPUB MUST still exist on disk so a subsequent restart can recover cleanly.
    expect((await readdir(booksDir)).sort()).toEqual([journalName, stagedName].sort());

    const recovered = await restarted.listBooks();
    expect(recovered.map((book) => book.sourceFilename)).toEqual(["EIO Protected.epub"]);
    expect(await readdir(booksDir)).toEqual(["EIO Protected.epub"]);
  });

  it("keeps the active filename reservation intact after the original EPUB has been moved when a second deleteBook returns busy", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-delete-busy-reservation-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);

    const bookA = await bookFixture({
      title: "Book A",
      isbn: "urn:uuid:ffff1111-2222-4333-8444-555566667771",
      language: "en",
      bodyParagraph: "First English book stored under Book.epub whose delete holds the normalized filename reservation.",
    });
    const bookC = await bookFixture({
      title: "Book C",
      isbn: "urn:uuid:ffff1111-2222-4333-8444-555566667773",
      language: "en",
      bodyParagraph: "Third English book trying to import as Book.epub after a second delete returned busy.",
    });

    const importedA = await service.import("Book.epub", bookA);
    expect(importedA.status).toBe("imported");
    const bookIdA = importedA.bookId!;

    // Pause Book A's delete inside removeEditionId — AFTER Book.epub has already been moved
    // out to its staged .tmp path, while Book A still holds the filename reservation.
    let removeEditionEntered!: () => void;
    const removeEditionReady = new Promise<void>((resolve) => { removeEditionEntered = resolve; });
    let allowRemoveEditionFinish!: () => void;
    const removeEditionGate = new Promise<void>((resolve) => { allowRemoveEditionFinish = resolve; });
    const origRemoveEditionId = (service as unknown as { removeEditionId: (name: string) => Promise<void> }).removeEditionId.bind(service);
    vi.spyOn(service as unknown as { removeEditionId: (name: string) => Promise<void> }, "removeEditionId")
      .mockImplementation(async (name: string) => {
        removeEditionEntered();
        await removeEditionGate;
        return origRemoveEditionId(name);
      });

    const deleteAPromise = service.deleteBook(bookIdA, async () => {});
    await removeEditionReady;

    // Confirm the original Book.epub path is genuinely absent on disk right now.
    expect((await readdir(booksDir)).includes("Book.epub")).toBe(false);

    // Simulate a case-sensitive volume where a second book ("book.epub", different bookId)
    // shares the same normalized reservation key and hits the busy path in deleteBook.
    const origFindStored = (service as unknown as { findStoredBook: (id: string) => Promise<unknown> }).findStoredBook.bind(service);
    vi.spyOn(service as unknown as { findStoredBook: (id: string) => Promise<unknown> }, "findStoredBook")
      .mockImplementation(async (id: string) => {
        if (id === "book:id:case-variant-b") {
          return {
            filename: "book.epub",
            filePath: path.join(booksDir, "book.epub"),
            signature: "synthetic",
            summary: { id },
            cover: null,
          };
        }
        return origFindStored(id);
      });

    expect(await service.deleteBook("book:id:case-variant-b", async () => {})).toBe("busy");
    expect((await readdir(booksDir)).includes("Book.epub")).toBe(false);

    // Returning busy MUST NOT have cleared Book A's reservation: even though Book.epub does NOT
    // exist on disk right now, a third same-filename import must still be rejected as conflict.
    const thirdImport = await service.import("Book.epub", bookC);
    expect(thirdImport.status).toBe("conflict");
    expect(thirdImport.message).toContain("正在导入或删除");
    expect((await readdir(booksDir)).includes("Book.epub")).toBe(false);

    allowRemoveEditionFinish();
    expect(await deleteAPromise).toBe("deleted");
  });

  it("throws and preserves in-memory index and pending delete journals when enumerating booksDir fails with a non-ENOENT error", async () => {
    const { root, booksDir } = await serviceRoot("magazine-reader-book-dir-read-failure-");
    const editionsPath = path.join(root, "book-editions.json");
    const service = new BookImportService(booksDir, undefined, editionsPath);

    const bookA = await bookFixture({
      title: "Indexed Book A",
      isbn: "urn:uuid:aaaa9999-2222-4333-8444-555566667771",
      language: "en",
      bodyParagraph: "First book already indexed in memory before booksDir temporarily becomes unreadable.",
    });
    const bookB = await bookFixture({
      title: "Staged Recovery Book B",
      isbn: "urn:uuid:bbbb9999-2222-4333-8444-555566667772",
      language: "en",
      bodyParagraph: "Second book sitting in a staged delete journal that must still be recovered once booksDir is readable again.",
    });

    const importedA = await service.import("Indexed A.epub", bookA);
    expect(importedA.status).toBe("imported");
    const bookIdA = importedA.bookId!;
    expect((await service.listBooks()).map((book) => book.id)).toEqual([bookIdA]);
    expect(service.canPrepare(bookIdA)).toBe(true);

    // Stage a pending delete journal for Book B in booksDir.
    const stagedName = ".book-delete-dir-error-token.tmp";
    const journalName = ".book-delete-dir-error-token.journal.json";
    await writeFile(path.join(booksDir, stagedName), bookB);
    await writeFile(path.join(booksDir, journalName), JSON.stringify({
      version: 1,
      token: "dir-error-token",
      filename: "Recovered B.epub",
      stagedFilename: stagedName,
      editionBookId: null,
      phase: "staged",
    }), "utf8");

    // 1. Real OS EACCES on booksDir: listBooks() must reject (not return []), and in-memory index must stay intact.
    await chmod(booksDir, 0o000);
    try {
      await expect(service.listBooks()).rejects.toThrow(/书库目录读取失败/);
      expect(service.canPrepare(bookIdA)).toBe(true);
    } finally {
      await chmod(booksDir, 0o700);
    }

    // 2. Once booksDir is readable again, listBooks() processes the preserved journal and recovers Book B alongside Book A.
    const recovered = await service.listBooks();
    expect(recovered.map((book) => book.sourceFilename).sort()).toEqual(["Indexed A.epub", "Recovered B.epub"]);
    expect((await readdir(booksDir)).sort()).toEqual(["Indexed A.epub", "Recovered B.epub"]);
  });
});
