import path from "node:path";
import type JSZip from "jszip";
import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { ReadingDocumentVisual } from "../shared/book-data-contract.js";
import { normalizeSpace } from "./epub-core.js";

export type BookVisualSpike = Omit<ReadingDocumentVisual, "beforeParagraphIndex" | "captionParagraphIndexes" | "coveredParagraphIndexes"> & {
  startBlockIndex: number;
  ownerBlockIndex: number;
  captionBlockIndexes: number[];
  coveredBlockIndexes: number[];
};

export function zipReference(base: string, reference: string): string | null {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(reference) || reference.startsWith("#")) return null;
  try {
    const decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.startsWith("/")) return null;
    const result = path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
    return result.startsWith("../") || result === ".." ? null : result;
  } catch { return null; }
}

export function rasterMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function inspectBookVisuals($: cheerio.CheerioAPI, blockElements: AnyNode[], documentPath: string, zip: JSZip, fixedLayout: boolean) {
  const elements = $("body").find("*").toArray();
  const positions = new Map<AnyNode, number>(elements.map((node, index) => [node, index]));
  const body = $("body").get(0);
  if (body) positions.set(body, -1);
  const blockIndexes = new Map(blockElements.map((node, index) => [node, index]));
  const indexesWithin = (root: AnyNode) => [root, ...$(root).find("*").toArray()].flatMap(node => blockIndexes.has(node) ? [blockIndexes.get(node)!] : []);
  const contains = (root: AnyNode, node: AnyNode) => root === node || $(node).parents().toArray().some(parent => parent === root);
  const anchor = (root: AnyNode) => $(root).attr("id") || (root === body ? "reader-original-body" : `reader-original-node-${positions.get(root)}`);
  const start = (root: AnyNode) => {
    const own = indexesWithin(root)[0];
    if (own !== undefined) return own;
    const containing = $(root).parents().toArray().find(node => blockIndexes.has(node));
    if (containing) return blockIndexes.get(containing)! + 1;
    const next = blockElements.findIndex(node => positions.get(node)! > positions.get(root)!);
    return next < 0 ? blockElements.length : next;
  };
  const protectedNodes = new Map<AnyNode, ReadingDocumentVisual["reason"]>();
  const protect = (node: AnyNode, reason: ReadingDocumentVisual["reason"]) => {
    const root = $(node).closest("table, figure").get(0) ?? $(node).closest("p").get(0) ?? node;
    if (!protectedNodes.has(root)) protectedNodes.set(root, reason);
  };
  $("body svg, body math, body object, body embed, body canvas").each((_, node) => {
    const tag = node.tagName.toLowerCase();
    protect(node, tag === "svg" ? "svg" : tag === "math" ? "formula" : "complex-layout");
  });
  $("body table table").each((_, node) => { const outer = $(node).parents("table").last().get(0); if (outer) protect(outer, "complex-layout"); });
  const complexDeclaration = /position\s*:\s*(?:absolute|fixed)|display\s*:\s*(?:grid|flex)|(?:column-count|columns)\s*:\s*[2-9]|writing-mode\s*:\s*vertical/i;
  const protectLayoutNode = (node: AnyNode) => {
    const parent = $(node).parent().get(0);
    protect(node === body ? node : parent && parent.tagName.toLowerCase() !== "html" ? parent : node, "complex-layout");
  };
  $("body [style]").each((_, node) => { if (complexDeclaration.test($(node).attr("style") ?? "")) protectLayoutNode(node); });
  const styles = $("style").toArray().map(node => $(node).text());
  for (const link of $("link[rel='stylesheet']").toArray()) {
    const entryPath = zipReference(documentPath, $(link).attr("href") ?? "");
    const entry = entryPath ? zip.file(entryPath) : null;
    if (entry) {
      try {
        const css = await entry.async("text");
        if (css.length <= 1_000_000) styles.push(css); else if (body) protect(body, "complex-layout");
      } catch { if (body) protect(body, "complex-layout"); }
    } else if (body) protect(body, "complex-layout");
  }
  for (const css of styles) for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!complexDeclaration.test(match[2]) || match[1].includes("@")) continue;
    try { $(match[1].trim()).each((_, node) => { if (positions.has(node)) protectLayoutNode(node); }); } catch { /* Unsupported CSS selectors still remain in the original view. */ }
  }
  if (fixedLayout && body) protect(body, "complex-layout");
  const images = $("body img").toArray();
  const imageGroup = (node: AnyNode) => $(node).closest("figure, div.image, div.illustration, div[class*='Figure'], div[class*='figure']").get(0);
  const validImages = new Map<AnyNode, string>();
  for (const node of images) {
    const src = $(node).attr("src") ?? "";
    const entryPath = zipReference(documentPath, src);
    if (/\.svg(?:[?#]|$)/i.test(src)) { protect(node, entryPath && zip.file(entryPath) ? "svg" : "unavailable-image"); continue; }
    const file = entryPath ? zip.file(entryPath) : null;
    let valid = false;
    if (file && entryPath && /\.(?:png|jpe?g|gif|webp)$/i.test(entryPath)) {
      try { const bytes = await file.async("nodebuffer"); valid = bytes.length <= ($(node).parents("table").length ? 2_000_000 : 20_000_000) && Boolean(rasterMediaType(bytes)); } catch { /* A damaged asset must not discard the chapter. */ }
    }
    if (valid) validImages.set(node, entryPath!); else protect(node, "unavailable-image");
  }
  // Preserve multi-panel composition as one source area instead of inventing a new image layout.
  for (const node of images) {
    const group = imageGroup(node);
    if (group && $(group).find("img").length > 1) protect(group, "complex-layout");
    const paragraph = $(node).closest("p").get(0);
    if (!group && paragraph && normalizeSpace($(paragraph).text())) protect(paragraph, "complex-layout");
    if (group) {
      const textBlocks = $(group).find("p, figcaption").toArray();
      const imagePosition = positions.get(node)!;
      if (textBlocks.some(block => positions.get(block)! < imagePosition) && textBlocks.some(block => positions.get(block)! > imagePosition)) protect(group, "complex-layout");
    }
  }
  const protectedRoots = [...protectedNodes.keys()].filter(node => ![...protectedNodes.keys()].some(parent => parent !== node && contains(parent, node)));
  const roots = new Map<AnyNode, "image" | "original">(protectedRoots.map(node => [node, "original"]));
  for (const node of images) {
    if (!validImages.has(node) || $(node).parents("table").length || protectedRoots.some(root => contains(root, node))) continue;
    const root = imageGroup(node) ?? ($(node).parent().is("picture") ? $(node).parent().get(0)! : node);
    roots.set(root, "image");
  }
  const visuals: BookVisualSpike[] = [...roots].sort(([left], [right]) => positions.get(left)! - positions.get(right)!).map(([root, kind], index) => {
    const explicitImageContainer = $(root).is("figure, div.image, div.illustration, div[class*='Figure'], div[class*='figure']");
    const captions = root === body ? [] : $(root).find(explicitImageContainer ? "figcaption, p, [class*='Caption'], [class*='caption']" : "figcaption, [class*='Caption'], [class*='caption']").toArray();
    const next = $(root).next().get(0);
    if (!captions.length && next && (next.tagName.toLowerCase() === "figcaption" || /caption/i.test($(next).attr("class") ?? ""))) captions.push(next);
    const captionBlockIndexes = [...new Set(captions.flatMap(indexesWithin))].sort((left, right) => left - right);
    const coveredBlockIndexes = kind === "original" ? [...new Set([...indexesWithin(root), ...captionBlockIndexes])].sort((left, right) => left - right) : captionBlockIndexes;
    const ownImages = [root, ...$(root).find("img").toArray()].filter(node => validImages.has(node));
    const startBlockIndex = start(root);
    const firstOwn = indexesWithin(root)[0];
    const nextIsHeading = blockElements[startBlockIndex] && /^h[123]$/i.test($(blockElements[startBlockIndex]).prop("tagName") ?? "");
    const ownerBlockIndex = firstOwn ?? Math.max(0, nextIsHeading || startBlockIndex === blockElements.length ? startBlockIndex - 1 : startBlockIndex);
    return { id: `${documentPath}:visual:${index}`, kind, ...(kind === "original" ? { reason: protectedNodes.get(root) } : {}), ownerBlockIndex, sourceOrder: positions.get(root),
      startBlockIndex: start(root), captionBlockIndexes, coveredBlockIndexes, captionText: captionBlockIndexes.length ? "" : captions.map(node => normalizeSpace($(node).text())).join(" "),
      captionPlacement: kind === "image" && captions.length && ownImages.length && positions.get(captions[0])! < positions.get(ownImages[0])! ? "before" : "after",
      originalFragment: anchor(root), sourceImageCount: ownImages.filter(node => !$(node).parents("table").length).length,
      images: kind === "image" ? ownImages.map(node => ({ entryPath: validImages.get(node)!, alt: $(node).attr("alt") ?? "" })) : [] };
  });
  return { visuals, protectedRoots };
}
