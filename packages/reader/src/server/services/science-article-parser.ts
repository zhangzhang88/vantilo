import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { scienceArticleImages, type ScienceArticleBlock, type ScienceArticleImage } from "../../shared/science-article.js";

const RESTRICTED_RIGHTS = /©|\bcopyright\b|all rights reserved|(?:reprinted|used|reproduced) (?:with|by) permission/i;
const text = (value: string) => value.replace(/\s+/g, " ").trim();

export function safeScienceSourceUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return url.toString();
  } catch { return null; }
}

/** Only first-party NOAA/NPS media and same-host media with verified reuse terms are fetched. */
export function isLocalScienceMediaSource(raw: string, articleUrl?: string): boolean {
  const safe = safeScienceSourceUrl(raw);
  if (!safe) return false;
  const host = new URL(safe).hostname;
  const noaaHosts = ["oceanservice.noaa.gov", "cdn.oceanservice.noaa.gov"];
  if (!articleUrl) return noaaHosts.includes(host);
  const articleHost = new URL(articleUrl).hostname;
  if (["oceanservice.noaa.gov", "cdn.oceanservice.noaa.gov"].includes(articleHost)) return noaaHosts.includes(host);
  return host === articleHost && (articleHost === "spaceplace.nasa.gov" || articleHost === "climatekids.nasa.gov" || articleHost === "www.nps.gov" || articleHost === "www.open.edu" || articleHost === "ourworldindata.org" || articleHost === "www.ourworldindata.org");
}

function jsonLdArticleMetadata($: ReturnType<typeof load>): { author: string; publishedAt: string | null } {
  const values: unknown[] = [];
  $("script[type='application/ld+json']").each((_index, element) => {
    try { values.push(JSON.parse($(element).html() ?? "")); } catch { /* Ignore unrelated or malformed structured data. */ }
  });
  const visit = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value)) { for (const item of value) { const found = visit(item); if (found) return found; } return null; }
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const type = item["@type"];
    if ((Array.isArray(type) ? type : [type]).some((name) => typeof name === "string" && /Article|BlogPosting/i.test(name))) return item;
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage"]) { const found = visit(item[key]); if (found) return found; }
    return null;
  };
  const article = values.map(visit).find(Boolean);
  const authorValue = article?.author;
  const authors = (Array.isArray(authorValue) ? authorValue : [authorValue]).map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return String((entry as Record<string, unknown>).name ?? "");
    return "";
  }).filter(Boolean);
  const rawDate = typeof article?.datePublished === "string" ? article.datePublished : "";
  const timestamp = rawDate ? Date.parse(rawDate) : Number.NaN;
  return { author: authors.join(", "), publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null };
}

export function parseScienceArticle(html: string, sourceUrl: string): {
  title: string; author: string; publishedAt: string | null; paragraphs: string[]; blocks: ScienceArticleBlock[];
} {
  const $ = load(html);
  // NOAA uses a Bootstrap column; other supported sources use semantic page mains.
  const selectors = ["body.facts .col-md-9", "main article", "#nps-main", "#main-content", "article", "main", "[role='main']", ".main-content"];
  const root = selectors.map((selector) => $(selector).first()).find((candidate) => candidate.length > 0);
  if (!root) throw new Error("未能识别文章正文结构，已跳过收录");
  const host = new URL(sourceUrl).hostname;
  const sourceCredit = host === "www.nps.gov" ? "National Park Service (NPS)" : host === "spaceplace.nasa.gov" ? "NASA Space Place" : host === "climatekids.nasa.gov" ? "NASA Climate Kids" : host === "www.open.edu" ? "The Open University / OpenLearn" : host.endsWith("ourworldindata.org") ? "Our World in Data" : "NOAA";
  const title = text($("h1").first().text()) || text($("meta[property='og:title']").attr("content") ?? "") || text($("title").text());
  const structured = jsonLdArticleMetadata($);
  // A separately restricted figure must not cause otherwise permitted article text to vanish.
  const rightsCheck = root.clone();
  rightsCheck.find("figure, figcaption, .figure-caption, .caption, script, style").remove();
  if (RESTRICTED_RIGHTS.test(rightsCheck.text())) throw new Error("文章正文标有版权或转载限制，未收录；请打开来源原站阅读");
  root.find("script, style, nav, footer, aside, form, noscript, template, .breadcrumb, .social-share, .related-content, .hybrid-link-item, .article-footer, #social").remove();
  let imageIndex = 0;
  let nodeCount = 0;
  const consumed = new WeakSet<AnyNode>();

  function image(element: Element, caption: string): ScienceArticleImage {
    const img = $(element);
    const candidates = (img.attr("srcset") ?? img.closest("picture").find("source").first().attr("srcset") ?? "")
      .split(",").map((part) => part.trim().split(/\s+/)).filter(([url]) => Boolean(url))
      .sort((a, b) => (Number.parseFloat(b[1] ?? "0") || 0) - (Number.parseFloat(a[1] ?? "0") || 0));
    const raw = img.attr("data-src") || img.attr("data-original") || candidates[0]?.[0] || img.attr("src") || "";
    const href = img.closest("a").attr("href");
    const fullImage = href && /\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(href) ? href : raw;
    const source = fullImage ? safeScienceSourceUrl(fullImage, sourceUrl) : null;
    const credit = /(?:credit|courtesy|photo(?:graph)? by|image by)\s*[:：]/i.test(caption);
    const permittedCredit = /\bNOAA\b|National Oceanic|\bNPS\b|National Park Service|\bNASA\b|\bJPL\b/i.test(caption)
      || (host === "www.open.edu" && /OpenLearn|Open University/i.test(caption));
    const nasaThirdPartyCredit = ["spaceplace.nasa.gov", "climatekids.nasa.gov"].includes(new URL(sourceUrl).hostname)
      && credit && (!/\bNASA\b|\bJPL\b/i.test(caption) || /\bESA\b|STScI|AURA|university|artist(?:'s)? concept/i.test(caption));
    const openLearnUnverifiedImage = host === "www.open.edu" && !/CC\s*BY-NC-SA\s*4\.0|Creative Commons Attribution-NonCommercial-ShareAlike 4\.0/i.test(caption);
    const ourWorldInDataUnverifiedImage = host.endsWith("ourworldindata.org") && !/\bCC\s*BY(?:\s*4\.0)?(?![-\w])|Creative Commons Attribution(?: 4\.0)?/i.test(`${caption} ${img.attr("alt") ?? ""}`);
    const restricted = RESTRICTED_RIGHTS.test(caption) || (credit && !permittedCredit) || nasaThirdPartyCredit || openLearnUnverifiedImage || ourWorldInDataUnverifiedImage;
    const dimension = (name: string) => {
      const value = Number(img.attr(name));
      return Number.isFinite(value) && value > 0 && value <= 100_000 ? value : undefined;
    };
    return {
      id: `image-${++imageIndex}`, sourceUrl: source, alt: text(img.attr("alt") ?? ""),
      width: dimension("width"), height: dimension("height"), status: "link-only",
      reason: restricted ? (openLearnUnverifiedImage ? "OpenLearn 图片未注明可复用许可，保留原图链接" : ourWorldInDataUnverifiedImage ? "图片未明确标注 CC BY，保留原图链接" : "此图有单独的版权或来源标注，请在原站查看") : !source ? "原图地址不可用，请查看原文" : !isLocalScienceMediaSource(source, sourceUrl) ? "此图来自其他站点，请查看原图" : undefined,
    };
  }

  function children(nodes: AnyNode[], depth = 0): ScienceArticleBlock[] {
    if (depth > 30) throw new Error("文章结构过深，未收录");
    const blocks: ScienceArticleBlock[] = [];
    let inline = "";
    const flush = () => { const value = text(inline); if (value) blocks.push({ kind: "paragraph", text: value }); inline = ""; };
    for (const node of nodes) {
      if (consumed.has(node)) continue;
      if (++nodeCount > 10_000) throw new Error("文章结构超过本机收录上限");
      if (node.type === "text") { inline += node.data; continue; }
      if (node.type !== "tag") continue;
      const element = node as Element;
      const tag = element.name.toLowerCase();
      const item = $(element);
      if (tag === "br") { inline += " "; continue; }
      const hasVisual = item.find("img, picture, figure, table, svg, iframe, video, canvas").length > 0;
      if (["a", "span", "strong", "em", "b", "i", "small", "sup", "sub", "code"].includes(tag) && !hasVisual) { inline += item.text(); continue; }
      flush();
      const nextCaption = item.next();
      if (tag !== "figure" && item.find("img").length && !text(item.text()) && nextCaption.is(".caption, .figure-caption, figcaption")) {
        const caption = text(nextCaption.text());
        blocks.push({ kind: "figure", images: item.find("img").toArray().map((element) => image(element, caption)), caption, captionPlacement: "after" });
        if (nextCaption.get(0)) consumed.add(nextCaption.get(0)!);
      } else if (tag === "figure") {
        const caption = text(item.find("figcaption, .figure-caption, .caption").first().text());
        if (item.find("table").length) {
          for (const part of item.contents().toArray()) {
            if (part.type === "tag" && $(part).is("figcaption, .figure-caption, .caption")) {
              const value = text($(part).text());
              if (value) blocks.push({ kind: "paragraph", text: value });
            } else blocks.push(...children([part], depth + 1));
          }
          continue;
        }
        const images = item.find("img").toArray().map((element) => image(element, caption));
        const contents = item.find("figcaption, .figure-caption, .caption, img").toArray();
        const captionPlacement = contents[0]?.name !== "img" ? "before" : "after";
        if (images.length) blocks.push({ kind: "figure", images, caption, captionPlacement });
        if (item.find("svg, iframe, video, canvas").length) blocks.push({ kind: "source-link", label: "原文含交互图表、矢量图或视频，请打开原文查看" });
      } else if (tag === "img") {
        const next = item.next();
        const caption = next.is(".caption, .figure-caption, figcaption") ? text(next.text()) : "";
        blocks.push({ kind: "figure", images: [image(element, caption)], caption, captionPlacement: "after" });
        if (caption && next.get(0)) consumed.add(next.get(0)!);
      } else if (tag === "table") {
        const rows = item.find("tr").toArray().filter((row) => $(row).closest("table").get(0) === element).map((row) => {
          const parent = $(row).parent().get(0);
          const section = parent && "name" in parent && parent.name === "thead" ? "head" as const : parent && "name" in parent && parent.name === "tfoot" ? "foot" as const : "body" as const;
          const span = (value?: string) => Math.max(1, Math.min(100, Number.parseInt(value ?? "1", 10) || 1));
          const cells = $(row).children("th,td").toArray().map((cell) => ({ header: cell.name === "th", rowSpan: span($(cell).attr("rowspan")), colSpan: span($(cell).attr("colspan")), blocks: children($(cell).contents().toArray(), depth + 1) }));
          return { section, cells };
        });
        blocks.push({ kind: "table", caption: text(item.children("caption").text()), rows });
      } else if (tag === "ul" || tag === "ol") {
        blocks.push({ kind: "list", ordered: tag === "ol", items: item.children("li").toArray().map((li) => children($(li).contents().toArray(), depth + 1)) });
      } else if (/^h[2-6]$/.test(tag)) {
        const value = text(item.text());
        if (value) blocks.push({ kind: "heading", level: Math.min(4, Number(tag[1])) as 2 | 3 | 4, text: value });
      } else if (["svg", "iframe", "video", "canvas", "object", "embed"].includes(tag)) {
        blocks.push({ kind: "source-link", label: "原文含交互图表、矢量图或视频，请打开原文查看" });
      } else if (!["h1", "figcaption", "caption"].includes(tag)) {
        if (tag === "p" && !hasVisual) { const value = text(item.text()); if (value) blocks.push({ kind: "paragraph", text: value }); }
        else blocks.push(...children(item.contents().toArray(), depth + 1));
      }
    }
    flush();
    return blocks;
  }

  const blocks = children(root.contents().toArray());
  const paragraphs: string[] = [];
  const collectText = (items: ScienceArticleBlock[]) => { for (const block of items) {
    if (block.kind === "paragraph") paragraphs.push(block.text);
    else if (block.kind === "list") block.items.forEach(collectText);
    else if (block.kind === "table") block.rows.forEach((row) => row.cells.forEach((cell) => collectText(cell.blocks)));
  } };
  collectText(blocks);
  if (!title || paragraphs.length < 2 || paragraphs.join("").length < 250) throw new Error("正文内容不足，未收录；可以在原站阅读");
  if (paragraphs.join("").length > 100_000 || scienceArticleImages(blocks).length > 100) throw new Error("文章正文或图片数量超过本机收录上限");
  const rawDate = $("time[datetime]").first().attr("datetime") || $("meta[property='article:published_time']").attr("content");
  const date = rawDate ? Date.parse(rawDate) : Number.NaN;
  const author = text($("meta[name='author']").attr("content") ?? "") || structured.author || sourceCredit;
  return { title: title.slice(0, 500), author, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : structured.publishedAt, paragraphs, blocks };
}
