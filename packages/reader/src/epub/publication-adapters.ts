import path from "node:path";
import * as cheerio from "cheerio";
import type { Article, IssueFile, PublicationId } from "../shared/types.js";
import { countWords, normalizeSpace, type EpubNavItem } from "./epub-core.js";

export interface ArticleParseInput {
  html: string;
  navItem: EpubNavItem;
  resolvedHref: string;
  issueFile: IssueFile;
}

export interface PublicationAdapter {
  id: PublicationId;
  parseArticle(input: ArticleParseInput): Article | null;
}

function cleanParagraphs(values: string[]): string[] {
  return values.map(normalizeSpace).filter((text) => countWords(text) >= 5).filter((text) => !text.startsWith("This article was downloaded by"));
}

function canonicalUrl($: cheerio.CheerioAPI): string | null {
  return $("link[rel='canonical']").first().attr("href") ?? $(".origin_link").first().attr("href") ?? null;
}

function baseArticle(
  input: ArticleParseInput,
  values: {
    id: string;
    section: string;
    title: string;
    subtitle: string | null;
    author: string | null;
    kicker?: string | null;
    publishedAt?: string | null;
    sourceUrl?: string | null;
    paragraphs: string[];
  },
): Article | null {
  const bodyText = values.paragraphs.join("\n\n");
  const wordCount = countWords(bodyText);
  if (!values.title || wordCount < 30) return null;
  return {
    id: values.id,
    issueId: input.issueFile.id,
    publicationId: input.issueFile.publicationId,
    href: input.resolvedHref,
    section: values.section || input.navItem.section || "Other",
    kicker: values.kicker ?? null,
    title: values.title,
    subtitle: values.subtitle,
    author: values.author,
    publishedAt: values.publishedAt ?? null,
    sourceUrl: values.sourceUrl ?? null,
    bodyText,
    wordCount,
    status: null,
    analysis: null,
  };
}

function pathArticleId(resolvedHref: string): string {
  return resolvedHref.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "--");
}

const economistAdapter: PublicationAdapter = {
  id: "economist",
  parseArticle(input) {
    const $ = cheerio.load(input.html, { xmlMode: true });
    const title = normalizeSpace($(".te_article_title").first().text()) || normalizeSpace($("h1").first().text()) || input.navItem.title;
    const subtitle = normalizeSpace($(".te_article_rubric").first().text()) || normalizeSpace($("h3").first().text()) || null;
    const htmlSection = normalizeSpace($(".te_section_title").first().text());
    const kicker = normalizeSpace($(".te_fly_span").first().text()).replace(/^\|\s*/, "") || null;
    const author = normalizeSpace($(".te_article_author").first().text()).replace(/^By\s+/i, "") || null;
    const publishedAt = normalizeSpace($(".te_article_datePublished").first().text()) || null;
    const body = $("body").clone();
    body.find("script, style, svg, img, hr, .link_navbar").remove();
    body.find("p").has(".te_section_title, .te_fly_span").remove();
    body.find(".te_article_datePublished, .te_article_author, .te_article_rubric").remove();
    const paragraphs = cleanParagraphs(body.find("p").toArray().map((element) => $(element).text()));
    return baseArticle(input, {
      id: path.basename(input.resolvedHref, path.extname(input.resolvedHref)),
      section: htmlSection || input.navItem.section,
      title,
      subtitle,
      author,
      kicker,
      publishedAt,
      sourceUrl: canonicalUrl($),
      paragraphs,
    });
  },
};

const newYorkerAdapter: PublicationAdapter = {
  id: "new-yorker",
  parseArticle(input) {
    const $ = cheerio.load(input.html);
    const title = normalizeSpace($(".ny_article_h1_title").first().text()) || normalizeSpace($("h1").first().text()) || input.navItem.title;
    const subtitle = normalizeSpace($(".ny_article_rubric").first().text()) || null;
    const category = normalizeSpace($(".ny_article_category").first().text());
    const section = input.navItem.section || category || "Other";
    const author = normalizeSpace($(".ny_article_author").first().text()).replace(/^By\s+/i, "").replace(/,(?=\S)/g, ", ") || null;
    const publishedAt = normalizeSpace($(".ny_article_datePublished").first().text()) || null;
    const body = $(".article-body").first().length ? $(".article-body").first() : $("body");
    const paragraphs = cleanParagraphs(body.find("p").toArray().map((element) => $(element).text()));
    return baseArticle(input, {
      id: path.basename(input.resolvedHref, path.extname(input.resolvedHref)),
      section,
      title,
      subtitle,
      author,
      kicker: category && category !== section ? category : null,
      publishedAt,
      sourceUrl: canonicalUrl($),
      paragraphs,
    });
  },
};

const atlanticAdapter: PublicationAdapter = {
  id: "atlantic",
  parseArticle(input) {
    const $ = cheerio.load(input.html);
    const title = normalizeSpace($("h1").first().text()) || input.navItem.title;
    const subtitle = normalizeSpace($("h2").first().text()) || null;
    const root = $("#from-json-by-calibre").first().length ? $("#from-json-by-calibre").first() : $("body");
    const rawParagraphs = root.find("p").toArray().map((element) => normalizeSpace($(element).text()));
    const byline = rawParagraphs.find((text) => /^by\s+/i.test(text));
    const paragraphs = cleanParagraphs(rawParagraphs.filter((text) => text !== byline));
    return baseArticle(input, {
      id: pathArticleId(input.resolvedHref),
      section: input.navItem.section,
      title,
      subtitle,
      author: byline?.replace(/^by\s+/i, "") ?? null,
      sourceUrl: canonicalUrl($),
      paragraphs,
    });
  },
};

const wiredAdapter: PublicationAdapter = {
  id: "wired",
  parseArticle(input) {
    const $ = cheerio.load(input.html);
    const titleTag = normalizeSpace($("title").first().text()).replace(/\s*\|\s*WIRED\s*$/i, "");
    const title = normalizeSpace($("h1[data-testid='ContentHeaderHed']").first().text()) || normalizeSpace($("h1").first().text()) || input.navItem.title || titleTag;
    const subtitle = normalizeSpace($("[data-testid='ContentHeaderAccreditation']").first().text()) || null;
    const section = normalizeSpace($("[data-testid='ContentHeaderRubricDateBlock'] a span").first().text()) || input.navItem.section;
    const authors = $("[data-testid='BylineName']").toArray().map((element) => normalizeSpace($(element).text())).filter(Boolean);
    const author = [...new Set(authors)].join(", ") || null;
    const time = $("time[data-testid='ContentHeaderPublishDate']").first();
    const publishedAt = time.attr("datetime") ?? (normalizeSpace(time.text()) || null);
    const paragraphs = cleanParagraphs($("body p").toArray().map((element) => $(element).text()));
    return baseArticle(input, {
      id: pathArticleId(input.resolvedHref),
      section,
      title,
      subtitle,
      author,
      publishedAt,
      sourceUrl: canonicalUrl($),
      paragraphs,
    });
  },
};

const ADAPTERS: Record<PublicationId, PublicationAdapter> = {
  economist: economistAdapter,
  "new-yorker": newYorkerAdapter,
  atlantic: atlanticAdapter,
  wired: wiredAdapter,
};

export function publicationAdapter(publicationId: PublicationId): PublicationAdapter {
  return ADAPTERS[publicationId];
}
