import path from "node:path";
import * as cheerio from "cheerio";
import type JSZip from "jszip";
import type { BookRecord } from "../../shared/book-data-contract.js";
import { bookResourceUrl, bookSourceUrl } from "../../shared/book-source-links.js";
import { rasterMediaType, zipReference } from "../../epub/book-visuals.js";

export const ORIGINAL_CONTENT_CSP = "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-same-origin";

function xmlCompatibleEntities(markup: string): string {
  const cache = new Map<string, string>();
  return markup.replace(/&[a-z][a-z\d]{1,40};/gi, entity => {
    if (["&amp;", "&quot;", "&apos;", "&lt;", "&gt;"].includes(entity)) return entity;
    if (!cache.has(entity)) {
      const decoded = cheerio.load(`<span>${entity}</span>`)("span").text();
      cache.set(entity, decoded === entity ? entity : [...decoded].map(character => `&#${character.codePointAt(0)};`).join(""));
    }
    return cache.get(entity)!;
  });
}

export function safeArchivePath(value: string): boolean {
  return Boolean(value) && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && !value.split("/").includes("..") && path.posix.normalize(value) === value;
}

function assetUrl(bookId: string, base: string, reference: string): string {
  if (reference.startsWith("#")) return reference;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(reference)) return reference;
  const entryPath = zipReference(base, reference);
  const fragment = reference.includes("#") ? reference.slice(reference.indexOf("#")) : "";
  return entryPath ? `${bookResourceUrl(bookId, entryPath)}${fragment}` : "";
}

export function rewriteOriginalCss(css: string, bookId: string, base: string): string {
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_, double, single, bare) => `url("${assetUrl(bookId, base, (double ?? single ?? bare ?? "").trim()).replaceAll('"', '%22')}")`)
    .replace(/@import\s+["']([^"']+)["']/gi, (_, reference) => {
      const resolved = assetUrl(bookId, base, reference);
      return resolved ? `@import url("${resolved}")` : "@import url(\"\")";
    });
}

function sanitizeOriginal($: cheerio.CheerioAPI, base: string, book: Pick<BookRecord, "id" | "chapters">) {
  if (!$("body").attr("id")) $("body").attr("id", "reader-original-body");
  // Assign the same stable source anchors as the import inspection before removing active nodes.
  $("body").find("*").each((index, node) => { if (!$(node).attr("id")) $(node).attr("id", `reader-original-node-${index}`); });
  $("script, iframe, frame, frameset, base, meta[http-equiv], link[rel='preload'], link[rel='modulepreload']").remove();
  $("object, embed, canvas").each((_, node) => { $(node).replaceWith($(node).contents()); });
  $("*").each((_, node) => {
    if (!("attribs" in node) || !("tagName" in node)) return;
    for (const [name, value] of Object.entries(node.attribs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on") || ["srcdoc", "ping", "nonce", "integrity", "crossorigin", "action", "formaction", "target", "srcset"].includes(lower)) { $(node).removeAttr(name); continue; }
      if (lower === "style") { $(node).attr(name, rewriteOriginalCss(value, book.id, base)); continue; }
      if (!["src", "href", "xlink:href", "poster", "background"].includes(lower)) continue;
      if (node.tagName.toLowerCase() === "a" && lower === "href") {
        if (value.startsWith("#")) continue;
        const target = zipReference(base, value);
        const chapter = book.chapters.find(chapter => chapter.documentPath === target);
        if (chapter) {
          let fragment = value.split("#")[1] ?? "";
          try { fragment = decodeURIComponent(fragment); } catch { fragment = ""; }
          $(node).attr(name, bookSourceUrl(book.id, chapter.id, fragment));
        } else $(node).removeAttr(name);
      } else {
        const resolved = assetUrl(book.id, base, value);
        if (resolved) $(node).attr(name, resolved); else $(node).removeAttr(name);
      }
    }
  });
  $("style").each((_, node) => { $(node).text(rewriteOriginalCss($(node).text(), book.id, base)); });
}

export async function originalChapterHtml(archive: JSZip, book: BookRecord, chapterId: string): Promise<string | null> {
  const chapter = book.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter || !safeArchivePath(chapter.documentPath)) return null;
  const entry = archive.file(chapter.documentPath);
  if (!entry) return null;
  const html = await entry.async("text");
  if (html.length > 10_000_000) return null;
  const $ = cheerio.load(xmlCompatibleEntities(html), { xmlMode: true });
  sanitizeOriginal($, chapter.documentPath, book);
  return `<!doctype html>\n${$.xml()}`;
}

export async function originalResource(archive: JSZip, book: BookRecord, entryPath: string): Promise<{ data: Buffer; mediaType: string } | null> {
  if (!safeArchivePath(entryPath)) return null;
  const extension = path.posix.extname(entryPath).toLowerCase();
  const types: Record<string, string> = { ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf" };
  if (!types[extension] && !/\.(?:png|jpe?g|gif|webp)$/.test(extension)) return null;
  const entry = archive.file(entryPath);
  if (!entry) return null;
  let data = await entry.async("nodebuffer");
  if (data.length > 20_000_000) return null;
  let mediaType = types[extension];
  if (!mediaType) { const raster = rasterMediaType(data); if (!raster) return null; mediaType = raster; }
  if (extension === ".css") data = Buffer.from(rewriteOriginalCss(data.toString("utf8"), book.id, entryPath));
  if (extension === ".svg") {
    const $ = cheerio.load(xmlCompatibleEntities(data.toString("utf8")), { xmlMode: true });
    sanitizeOriginal($, entryPath, book);
    data = Buffer.from($.xml());
  }
  return { data, mediaType };
}
