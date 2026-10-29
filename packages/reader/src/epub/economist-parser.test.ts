import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePublicationEpub, scanIssueFiles } from "./publication-parser.js";
import { readEpubCover } from "./epub-core.js";
import { extractArticleImages } from "./article-images.js";

const root = path.resolve(process.cwd());
const corpusDir = process.env.VANTILO_READER_CORPUS_DIR ? path.resolve(process.env.VANTILO_READER_CORPUS_DIR) : "";
const corpusFiles = ["TheEconomist.2026.09.19.epub", "TheEconomist.2026.09.12.epub", "TheNewYorker.2026.09.21.epub", "TheNewYorker.2026.09.14.epub", "TheAtlantic.2026.09.02.epub", "Wired.2026.09.02.epub"];
const corpusReady = Boolean(corpusDir && corpusFiles.every((filename) => existsSync(path.join(corpusDir, filename))));
const issuesDir = corpusDir || path.join(root, "issues");

const contractIssueIds = {
  economist: "economist:2026-09-19",
  "new-yorker": "new-yorker:2026-09-21",
  atlantic: "atlantic:2026-09-02",
  wired: "wired:2026-09-02",
} as const;

async function issue(publicationId: keyof typeof contractIssueIds) {
  const files = await scanIssueFiles(issuesDir);
  const source = files.find((file) => file.id === contractIssueIds[publicationId]);
  expect(source).toBeDefined();
  return parsePublicationEpub(source!);
}

describe.skipIf(!corpusReady)("multi-publication EPUB parser (requires external real-magazine corpus)", () => {
  it("discovers four publications with publication-aware unique issue ids", async () => {
    const files = await scanIssueFiles(issuesDir);
    expect(files.map((file) => file.id)).toEqual(expect.arrayContaining([
      "economist:2026-09-19",
      "new-yorker:2026-09-21",
      "atlantic:2026-09-02",
      "wired:2026-09-02",
    ]));
    expect(new Set(files.map((file) => file.id)).size).toBe(files.length);
  });

  it("extracts a real embedded cover image from every sample EPUB", async () => {
    const files = await scanIssueFiles(issuesDir);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const cover = await readEpubCover(file);
      expect(cover, file.filename).not.toBeNull();
      expect(cover?.mediaType, file.filename).toMatch(/^image\//);
      expect(cover?.entryPath, file.filename).toMatch(/cover/i);
      expect(cover?.data.byteLength ?? 0, file.filename).toBeGreaterThan(1_000);
    }
  });

  it("extracts meaningful article images across all four publications", async () => {
    const files = await scanIssueFiles(issuesDir);

    const economistSource = files.find((file) => file.id === "economist:2026-09-19")!;
    const economist = await parsePublicationEpub(economistSource);
    const economistArticle = economist.articles.find((item) => item.title === "The trickle-down economics of the AI boom")!;
    const economistImages = await extractArticleImages(economistSource, economistArticle);
    expect(economistImages).toHaveLength(3);
    expect(economistImages.map((image) => image.role)).toEqual(["lead", "inline", "inline"]);
    expect(economistImages[0].afterParagraphIndex).toBe(-1);
    expect(economistImages.slice(1).every((image) => image.afterParagraphIndex >= 0)).toBe(true);

    const newYorkerSource = files.find((file) => file.id === "new-yorker:2026-09-21")!;
    const newYorker = await parsePublicationEpub(newYorkerSource);
    const newYorkerArticle = newYorker.articles.find((item) => item.title === "The Sartorial Riches of the Silent-Film Era")!;
    const newYorkerImages = await extractArticleImages(newYorkerSource, newYorkerArticle);
    expect(newYorkerImages).toHaveLength(4);
    expect(newYorkerImages[0].role).toBe("lead");
    expect(newYorkerImages.some((image) => /aba9e974|161bfa62|5d3c1413/i.test(image.entryPath))).toBe(false);

    const atlanticSource = files.find((file) => file.id === "atlantic:2026-09-02")!;
    const atlantic = await parsePublicationEpub(atlanticSource);
    const atlanticArticle = atlantic.articles.find((item) => item.title === "What Happened to al-Qaeda?")!;
    const atlanticImages = await extractArticleImages(atlanticSource, atlanticArticle);
    expect(atlanticImages).toHaveLength(10);
    expect(atlanticImages[0].role).toBe("lead");
    expect(atlanticImages.filter((image) => image.caption).length).toBeGreaterThanOrEqual(8);
    expect(atlanticImages.some((image) => image.caption?.includes("Universal History Archive"))).toBe(true);

    const wiredSource = files.find((file) => file.id === "wired:2026-09-02")!;
    const wired = await parsePublicationEpub(wiredSource);
    const wiredArticle = wired.articles.find((item) => item.title.includes("Trackflation"))!;
    const wiredImages = await extractArticleImages(wiredSource, wiredArticle);
    expect(wiredImages).toHaveLength(1);
    expect(wiredImages[0].role).toBe("lead");
    expect(wiredImages[0].alt).toContain("Trackflation");
    expect(wiredImages.some((image) => /Advertisement/i.test(image.alt))).toBe(false);

    const olderEconomistSource = files.find((file) => file.id === "economist:2026-09-12")!;
    const olderEconomist = await parsePublicationEpub(olderEconomistSource);
    const nestedEconomistArticle = olderEconomist.articles.find((item) => item.title === "How 9/11 empowers Donald Trump’s imperial presidency")!;
    const nestedEconomistImages = await extractArticleImages(olderEconomistSource, nestedEconomistArticle);
    expect(nestedEconomistImages).toHaveLength(3);
    expect(nestedEconomistImages.map((image) => image.role)).toEqual(["lead", "inline", "inline"]);
    expect(nestedEconomistImages.every((image) => image.entryPath.startsWith("EPUB/static_images/"))).toBe(true);

    const olderNewYorkerSource = files.find((file) => file.id === "new-yorker:2026-09-14")!;
    const olderNewYorker = await parsePublicationEpub(olderNewYorkerSource);
    const nestedNewYorkerArticle = olderNewYorker.articles.find((item) => item.title === "The America That 9/11 Made")!;
    const nestedNewYorkerImages = await extractArticleImages(olderNewYorkerSource, nestedNewYorkerArticle);
    expect(nestedNewYorkerImages.some((image) => image.entryPath === "EPUB/images/8b5f073002eea8860db8d9d65e241ae4.jpg")).toBe(true);

    const wiredPoliticsArticle = wired.articles.find((item) => item.title === "The 22 Very Online Upstarts Changing the Face of Politics")!;
    const wiredPoliticsImages = await extractArticleImages(wiredSource, wiredPoliticsArticle);
    expect(wiredPoliticsImages).toHaveLength(36);
    expect(new Set(wiredPoliticsImages.map((image) => image.entryPath)).size).toBe(wiredPoliticsImages.length);

    const wiredDogeArticle = wired.articles.find((item) => item.title === "The Story of DOGE, as Told by Federal Workers")!;
    const wiredDogeImages = await extractArticleImages(wiredSource, wiredDogeArticle);
    expect(wiredDogeImages).toHaveLength(6);
    expect(new Set(wiredDogeImages.map((image) => image.entryPath)).size).toBe(wiredDogeImages.length);
  });

  it("preserves the established Economist parse contract", async () => {
    const parsed = await issue("economist");
    expect(parsed.publicationName).toBe("The Economist");
    expect(parsed.articles).toHaveLength(75);
    expect(parsed.sections).toContain("Finance & economics");
    const article = parsed.articles.find((item) => item.title === "The trickle-down economics of the AI boom");
    expect(article).toBeDefined();
    expect(article?.issueId).toBe("economist:2026-09-19");
    expect(article?.publicationId).toBe("economist");
    expect(article?.subtitle).toContain("AI investments");
    expect(article?.bodyText).toContain("WHAT IS AI good for?");
    expect(article?.wordCount).toBeGreaterThan(700);
  });

  it("parses The New Yorker with its original top-level sections and metadata", async () => {
    const parsed = await issue("new-yorker");
    expect(parsed.publicationName).toBe("The New Yorker");
    expect(parsed.articles).toHaveLength(19);
    expect(parsed.sections).toContain("The Talk of the Town");
    expect(parsed.sections).toContain("The Critics");
    const article = parsed.articles.find((item) => item.title === "The Sartorial Riches of the Silent-Film Era");
    expect(article).toMatchObject({
      section: "Goings On",
      publicationId: "new-yorker",
      author: expect.stringContaining("Rachel Syme"),
    });
    expect(article?.subtitle).toContain("neo-soul of Erykah Badu");
    expect(article?.wordCount).toBeGreaterThan(1_000);
  });

  it("parses The Atlantic from NCX sections", async () => {
    const parsed = await issue("atlantic");
    expect(parsed.publicationName).toBe("The Atlantic");
    expect(parsed.articles).toHaveLength(15);
    expect(parsed.sections).toEqual(["Features", "Dispatches", "Culture & Critics", "Departments", "Poetry"]);
    const article = parsed.articles.find((item) => item.title === "What Happened to al-Qaeda?");
    expect(article).toMatchObject({ section: "Features", author: "Graeme Wood", publicationId: "atlantic" });
    expect(article?.subtitle).toContain("Twenty-five years after 9/11");
    expect(article?.wordCount).toBeGreaterThan(5_000);
  });

  it("parses Wired from a flat NCX and derives article metadata from the HTML header", async () => {
    const parsed = await issue("wired");
    expect(parsed.publicationName).toBe("Wired");
    expect(parsed.articles.length).toBeGreaterThanOrEqual(55);
    expect(parsed.sections).toContain("The Big Story");
    const article = parsed.articles.find((item) => item.title.includes("Trackflation"));
    expect(article).toMatchObject({ section: "The Big Story", author: "Brendan I. Koerner", publicationId: "wired" });
    expect(article?.subtitle).toContain("Four-minute miles");
    expect(article?.publishedAt).toContain("2026-07-20");
    expect(article?.wordCount).toBeGreaterThan(3_000);
  });
});
