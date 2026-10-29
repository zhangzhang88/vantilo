import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { BookCategoryService } from "./services/book-category-service.js";
import { BookImportService } from "./services/book-import-service.js";
import { buildServer } from "./app.js";
import { visualBookEpub } from "../../tests/fixtures/visual-book-epub.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(os.tmpdir(), "book-category-")); roots.push(value); return value; }
it("persists independent categories, queues concurrent changes and survives a new instance", async () => {
  const directory = await root();
  const file = path.join(directory, "data", "book-categories.json");
  const service = new BookCategoryService(file);
  expect(await service.assignments()).toEqual({});
  await Promise.all([service.set("book:one", "psychology"), service.set("book:two", "economics")]);
  await service.set("book:one", "education");
  expect(await new BookCategoryService(file).assignments()).toEqual({ "book:one": "education", "book:two": "economics" });
  expect(await readdir(path.dirname(file))).toEqual(["book-categories.json"]);
});
it("does not overwrite a broken category file or accept invalid ids", async () => {
  const directory = await root();
  const file = path.join(directory, "book-categories.json");
  await writeFile(file, "broken data");
  const service = new BookCategoryService(file);
  await expect(service.set("book:one", "psychology")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("broken data");
  await expect(service.set("../escape", "psychology")).rejects.toThrow();
});
it("does not import an EPUB when category persistence fails, and leaves its original bytes alone", async () => {
  const directory = await root(); const books = path.join(directory, "books");
  const source = await visualBookEpub(); await writeFile(path.join(directory, "original.epub"), source);
  const service = new BookImportService(books);
  await expect(service.import("Fixture.epub", source, async () => { throw new Error("category write failed"); })).rejects.toThrow("category write failed");
  expect(await readdir(books)).toEqual([]);
  expect(await readFile(path.join(directory, "original.epub"))).toEqual(source);
});
it("validates import categories before copying and exposes durable classification through the API", async () => {
  const directory = await root();
  const options = { projectRoot: directory, serveFrontend: false, aiProviderEnv: {}, bookTocChineseProvider: null, readerGuideProvider: null, sectionTranslationProvider: null };
  let app = await buildServer(options);
  const source = await visualBookEpub();
  const importRequest = (category: string) => app.inject({ method: "POST", url: `/api/books/import?filename=Fixture.epub${category}`, headers: { "content-type": "application/epub+zip" }, payload: source });
  try {
    expect((await importRequest("&categoryId=unknown")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/books" })).json()).toEqual([]);
    const imported = await importRequest("&categoryId=psychology");
    expect(imported.statusCode).toBe(201);
    const bookId = imported.json().bookId;
    expect(imported.json().categoryId).toBe("psychology");
    const url = `/api/books/${encodeURIComponent(bookId)}/category`;
    expect((await app.inject({ method: "PATCH", url, payload: { categoryId: "invalid" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/books/book:missing/category", payload: { categoryId: "economics" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url, payload: { categoryId: "economics" } })).statusCode).toBe(200);
    expect((await importRequest("&categoryId=literature")).json().status).toBe("duplicate");
    await app.close(); app = await buildServer(options);
    const list = (await app.inject({ method: "GET", url: "/api/books" })).json();
    expect(list).toHaveLength(1); expect(list[0].categoryId).toBe("economics");
    expect(await readFile(path.join(directory, "books", "Fixture.epub"))).toEqual(source);
  } finally { await app.close(); }
});
it("keeps legacy imports without a category compatible and marks manually placed books uncategorized", async () => {
  const directory = await root(); await mkdir(path.join(directory, "books"));
  const source = await visualBookEpub(); await writeFile(path.join(directory, "books", "Manual.epub"), source);
  const app = await buildServer({ projectRoot: directory, serveFrontend: false, aiProviderEnv: {}, bookTocChineseProvider: null });
  try { expect((await app.inject({ method: "GET", url: "/api/books" })).json()[0].categoryId).toBe("uncategorized"); }
  finally { await app.close(); }
});
