import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import JSZip from "jszip";
import { buildServer } from "./app.js";
import { BookImportService } from "./services/book-import-service.js";
import { originalChapterHtml, rewriteOriginalCss, safeArchivePath } from "./services/book-original-content.js";
import { visualBookEpub, chartPng } from "../../tests/fixtures/visual-book-epub.js";
import { inspectBookEpubRecord } from "../epub/book-record-contract.js";
import { bookResourceUrl, bookSourceUrl } from "../shared/book-source-links.js";

describe("original book content", () => {
  it("reports visuals during import and serves original styles, SVG, MathML and the unmodified EPUB", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-original-"));
    const books = path.join(root, "books");
    const data = await visualBookEpub();
    const importer = new BookImportService(books);
    let app: Awaited<ReturnType<typeof buildServer>> | undefined;
    try {
      const preview = await importer.preview("Visual.epub", data);
      expect(preview.presentation).toEqual({ imageCount: 1, originalBlockCount: 5 });
      expect((await importer.import("Visual.epub", data)).status).toBe("imported");
      app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, bookTocChineseProvider: null });
      const book = (await app.inject({ method: "GET", url: `/api/books/${encodeURIComponent(preview.bookId!)}` })).json();
      const chapter = book.chapters[0];
      const source = await app.inject({ method: "GET", url: bookSourceUrl(book.id, chapter.id) });
      expect(source.statusCode).toBe(200);
      expect(source.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(source.headers["content-security-policy"]).toContain("sandbox allow-same-origin");
      expect(source.headers["cache-control"]).toBe("no-store");
      const $ = cheerio.load(source.body);
      expect($("script, [onload], [onerror]").length).toBe(0);
      expect($("svg rect").attr("fill")).toBe("#bd3546");
      expect($("math msup").text()).toBe("c2");
      expect($("link[rel='stylesheet']").attr("href")).toBe(bookResourceUrl(book.id, "OEBPS/Styles/book.css"));
      expect($("a[href^='https:']").length).toBe(0);
      expect(source.body.match(/href="#chapter"/g)).toHaveLength(1);
      const css = await app.inject({ method: "GET", url: bookResourceUrl(book.id, "OEBPS/Styles/book.css") });
      expect(css.statusCode).toBe(200);
      expect(css.headers["content-type"]).toContain("text/css");
      expect(css.body).toContain("position: absolute");
      expect(css.body).toContain(bookResourceUrl(book.id, "OEBPS/Images/chart.png"));
      const image = await app.inject({ method: "GET", url: bookResourceUrl(book.id, "OEBPS/Images/chart.png") });
      expect(image.rawPayload.equals(chartPng)).toBe(true);
      expect(image.headers["content-type"]).toContain("image/png");
      const svg = await app.inject({ method: "GET", url: bookResourceUrl(book.id, "OEBPS/Images/vector.svg") });
      expect(svg.statusCode).toBe(200);
      expect(svg.body).toContain('fill="teal"');
      expect(svg.body).not.toMatch(/onload|<script/i);
      for (const entry of ["../private", "/etc/passwd", "OEBPS/content.opf", "OEBPS/Text/one.xhtml", "OEBPS/Images/missing.png"]) {
        expect((await app.inject({ method: "GET", url: bookResourceUrl(book.id, entry) })).statusCode).toBe(404);
      }
      expect((await app.inject({ method: "GET", url: bookSourceUrl(book.id, "unknown") })).statusCode).toBe(404);
      const download = await app.inject({ method: "GET", url: `/api/books/${encodeURIComponent(book.id)}/original-file` });
      expect(download.headers["content-disposition"]).toContain("attachment");
      expect(download.rawPayload.equals(data)).toBe(true);
    } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("recreates original anchors even when source images have no id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-original-anchor-"));
    try {
      const data = await visualBookEpub({ body: '<h1 id="chapter">1 Figures and evidence</h1><p>First.</p><div class="image"><img src="../Images/chart.png"/></div>' });
      await mkdir(path.join(root, "books")); const file = path.join(root, "books", "Visual.epub"); await writeFile(file, data);
      const book = await inspectBookEpubRecord(file);
      const source = await originalChapterHtml(await JSZip.loadAsync(data), book, book.chapters[0].id);
      const $ = cheerio.load(source!);
      const fragment = book.chapters[0].visuals![0].originalFragment;
      expect($(`[id='${fragment}']`).find("img").length).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rewrites archive CSS assets while refusing external URLs and non-canonical resource paths", () => {
    const css = rewriteOriginalCss('@import "other.css"; @import "https://outside.invalid/font.css"; .x { background: url(https://outside.invalid/tracker); mask: url(#clip); }', "book:one", "OEBPS/Styles/base.css");
    expect(css).toContain(bookResourceUrl("book:one", "OEBPS/Styles/other.css"));
    expect(css).not.toContain("outside.invalid");
    expect(css).toContain('url("#clip")');
    for (const value of ["/etc/passwd", "../private", "a/../b", "a\\b", "x\0y"]) expect(safeArchivePath(value)).toBe(false);
    expect(safeArchivePath("OEBPS/Images/a b.png")).toBe(true);
  });
  it("shows EPUB HTML entities as their original characters without changing escaped literal text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-original-entities-"));
    try {
      const data = await visualBookEpub({ body: '<h1 id="chapter">1 Figures and evidence</h1><p>A&nbsp;B &mdash; C &amp;nbsp;</p>' });
      const file = path.join(root, "Visual.epub"); await writeFile(file, data);
      const book = await inspectBookEpubRecord(file);
      const html = await originalChapterHtml(await JSZip.loadAsync(data), book, book.chapters[0].id);
      expect(cheerio.load(html!)("p").text()).toBe("A\u00a0B — C &nbsp;");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
