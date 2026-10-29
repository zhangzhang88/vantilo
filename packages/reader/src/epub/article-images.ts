import path from "node:path";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Article, ArticleImage, IssueFile } from "../shared/types.js";
import { normalizeSpace, openEpub, type OpenedEpub } from "./epub-core.js";

const posix = path.posix;

export interface EpubArticleImage extends ArticleImage {
  entryPath: string;
  mediaType: string;
}

export interface EpubArticleImageAsset {
  data: Buffer;
  mediaType: string;
}

function articleParagraphs(article: Article): string[] {
  return article.bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function imageMediaType(entryPath: string): string | null {
  const extension = posix.extname(entryPath).toLocaleLowerCase("en-US");
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  return null;
}

function resolveArticleImageEntryPath(opened: OpenedEpub, articleHref: string, sourcePath: string): string | null {
  const articleRelative = posix.normalize(posix.join(posix.dirname(articleHref), sourcePath));
  if (opened.zip.file(articleRelative)) return articleRelative;

  const packageRelative = posix.normalize(posix.join(posix.dirname(opened.packagePath), sourcePath));
  if (packageRelative !== articleRelative && opened.zip.file(packageRelative)) return packageRelative;
  return null;
}

function excludedImage($: cheerio.CheerioAPI, element: AnyNode, src: string, alt: string): boolean {
  const image = $(element);
  if (image.closest(".callout-feature-small").length) return true;
  const classes = [
    image.attr("class") ?? "",
    image.parent().attr("class") ?? "",
    image.parent().parent().attr("class") ?? "",
  ].join(" ");
  const descriptor = `${src} ${alt} ${classes}`;
  return /advertisement|\bad(?:[_-]|\b)|masthead|logo|cover|ereader|tracking|pixel|avatar|icon/i.test(descriptor);
}

function captionForImage($: cheerio.CheerioAPI, element: AnyNode): string | null {
  const image = $(element);
  const figure = image.closest("figure");
  const figureCaption = normalizeSpace(figure.find("figcaption").first().text());
  if (figureCaption) return figureCaption;

  let wrapper = image.parent();
  for (let depth = 0; depth < 2 && wrapper.length; depth += 1) {
    const tagName = wrapper.get(0)?.tagName?.toLocaleLowerCase("en-US") ?? "";
    const wrapperClass = wrapper.attr("class") ?? "";
    if (tagName === "body" || tagName === "article" || /article-body|\barticle\b/.test(wrapperClass)) break;
    const clone = wrapper.clone();
    clone.find("img, picture, source").remove();
    const text = normalizeSpace(clone.text());
    if (text && text.length <= 500) return text;
    wrapper = wrapper.parent();
  }

  const nextCaption = image.parent().next("figcaption, .caption, .image-caption, [class*='caption']").first();
  const nextText = normalizeSpace(nextCaption.text());
  return nextText && nextText.length <= 500 ? nextText : null;
}

function publicImage(image: EpubArticleImage): ArticleImage {
  return {
    id: image.id,
    role: image.role,
    afterParagraphIndex: image.afterParagraphIndex,
    alt: image.alt,
    caption: image.caption,
  };
}

export function articleImageMetadata(images: EpubArticleImage[]): ArticleImage[] {
  return images.map(publicImage);
}

export async function extractArticleImagesFromOpenedEpub(opened: OpenedEpub, article: Article): Promise<EpubArticleImage[]> {
  const entry = opened.zip.file(article.href);
  if (!entry) return [];
  const html = await entry.async("text");
  const $ = cheerio.load(html, { xmlMode: article.href.toLocaleLowerCase("en-US").endsWith(".xhtml") });
  const root = article.publicationId === "atlantic" && $("#from-json-by-calibre").first().length
    ? $("#from-json-by-calibre").first()
    : $("body").first();
  if (!root.length) return [];

  const expectedParagraphs = articleParagraphs(article);
  let nextParagraphIndex = 0;
  let lastParagraphIndex = -1;
  const images: EpubArticleImage[] = [];
  const seenEntryPaths = new Set<string>();

  root.find("p, img").each((_, element) => {
    const tagName = element.tagName?.toLocaleLowerCase("en-US");
    if (tagName === "p") {
      const text = normalizeSpace($(element).text());
      if (text && text === expectedParagraphs[nextParagraphIndex]) {
        lastParagraphIndex = nextParagraphIndex;
        nextParagraphIndex += 1;
      }
      return;
    }
    if (tagName !== "img") return;

    const image = $(element);
    const rawSrc = (image.attr("src") ?? "").trim();
    if (!rawSrc || rawSrc.startsWith("data:")) return;
    const sourcePath = rawSrc.split(/[?#]/)[0];
    const entryPath = resolveArticleImageEntryPath(opened, article.href, sourcePath);
    if (!entryPath) return;
    const mediaType = imageMediaType(entryPath);
    if (!mediaType) return;
    const alt = normalizeSpace(image.attr("alt") ?? "");
    if (excludedImage($, element, sourcePath, alt)) return;
    if (seenEntryPaths.has(entryPath)) return;
    seenEntryPaths.add(entryPath);

    const lead = /(^|\s)te_head_image(\s|$)/.test(image.attr("class") ?? "") || lastParagraphIndex < 0;
    images.push({
      id: `image-${String(images.length + 1).padStart(2, "0")}`,
      role: lead ? "lead" : "inline",
      afterParagraphIndex: lead ? -1 : lastParagraphIndex,
      alt,
      caption: captionForImage($, element),
      entryPath,
      mediaType,
    });
  });

  return images;
}

export async function extractArticleImages(issueFile: IssueFile, article: Article): Promise<EpubArticleImage[]> {
  return extractArticleImagesFromOpenedEpub(await openEpub(issueFile), article);
}

export async function readArticleImageAsset(opened: OpenedEpub, image: EpubArticleImage): Promise<EpubArticleImageAsset | null> {
  const entry = opened.zip.file(image.entryPath);
  if (!entry) return null;
  return {
    data: await entry.async("nodebuffer"),
    mediaType: image.mediaType,
  };
}
