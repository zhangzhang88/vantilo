import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
} = {}): Promise<Buffer> {
  const title = input.title ?? "Fixture Research Book";
  const isbn = input.isbn ?? "9780000000002";
  const author = input.author ?? "Author One";
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
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
  zip.file("OEBPS/Text/ch1.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>1 First Chapter</h1><p>Opening paragraph.</p><h2>1.1 FIRST SECTION</h2><p>Evidence paragraph.</p></body></html>`);
  zip.file("OEBPS/Text/ch2.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>2 Second Chapter</h1><p>Second chapter paragraph.</p></body></html>`);
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
});
