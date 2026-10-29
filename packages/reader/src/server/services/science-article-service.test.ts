import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { scienceArticleImages, scienceArticleMediaUrl, type ScienceArticle } from "../../shared/science-article.js";
import { chartPng } from "../../../tests/fixtures/visual-book-epub.js";
import { scienceArticleHtml, scienceArticleUrl } from "../../../tests/fixtures/science-article.js";
import { parseScienceArticle } from "./science-article-parser.js";
import { ScienceArticleService } from "./science-article-service.js";

function sourceFetch(html = scienceArticleHtml, imageResponse: () => Response = () => new Response(chartPng, { headers: { "Content-Type": "image/png" } })) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    return url.endsWith(".html") || url.includes("climatekids.nasa.gov/") ? new Response(html, { headers: { "Content-Type": "text/html" } }) : imageResponse();
  }) as typeof fetch;
  return { requests, fetchImpl };
}

async function temporary(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-science-media-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("science article original visuals", () => {
  it("imports Our World in Data text, JSON-LD author/date and explicitly CC BY chart images", async () => temporary(async (root) => {
    const url = "https://ourworldindata.org/when-do-people-experience-mental-health-conditions-for-the-first-time";
    const prose = "People experience mental health conditions at different points in life. Many conditions first appear during childhood or the teenage years. Early support can help people understand what they feel and find useful care. Researchers use surveys and health records to learn when symptoms begin. These numbers can guide better services in schools and communities. The data also shows why access to help matters. Every person has a different experience, and a chart cannot tell the whole story. People should be able to find support without shame.";
    const html = `<main><article><script type="application/ld+json">${JSON.stringify({ "@type": "Article", headline: "When do people experience mental health conditions?", datePublished: "2026-10-19", author: [{ "@type": "Person", name: "Hannah Ritchie" }] })}</script><h1>When do people experience mental health conditions?</h1><p>${prose}</p><p>${prose}</p><figure class="article-block__image"><img src="/media/mental-health.png" alt="Source: Global Burden of Disease (2019); License: CC BY (author Hannah Ritchie)"><figcaption>Share of people by age when conditions begin.</figcaption></figure><div class="hybrid-link-item"><h2>Unrelated article tile</h2></div></article></main>`;
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const requestUrl = String(input); requests.push(requestUrl);
      return requestUrl === url ? new Response(html, { headers: { "Content-Type": "text/html" } })
        : new Response(chartPng, { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;
    const service = new ScienceArticleService(path.join(root, "articles.json"), fetchImpl);
    const article = await service.importFromSource(url);
    expect(article.sourceName).toBe("Our World in Data");
    expect(article.author).toBe("Hannah Ritchie");
    expect(article.publishedAt).toBe("2026-10-19T00:00:00.000Z");
    expect(article.credit).toContain("CC BY 4.0");
    expect(article.paragraphs.join(" ")).not.toContain("Unrelated article tile");
    expect(scienceArticleImages(article.blocks!)[0]).toMatchObject({ status: "cached", mimeType: "image/png" });
    expect(requests).toEqual([url, "https://ourworldindata.org/media/mental-health.png"]);
  }));

  it("keeps Our World in Data visuals linked when the individual image has no CC BY label", () => {
    const prose = "People use evidence to understand problems. Clear explanations help readers explore data. Researchers compare results across places and years. Good context helps us interpret what a chart shows. Numbers can answer some questions and raise new ones. Communities use evidence to make thoughtful choices.";
    const html = `<main><article><h1>How data helps</h1><p>${prose}</p><p>${prose}</p><figure><img src="/media/unlicensed.png" alt="A chart about global trends"><figcaption>Source: a third-party research project.</figcaption></figure></article></main>`;
    const parsed = parseScienceArticle(html, "https://ourworldindata.org/data-helps");
    expect(scienceArticleImages(parsed.blocks)[0]).toMatchObject({ status: "link-only", reason: "图片未明确标注 CC BY，保留原图链接" });
  });

  it("saves only the Bitcoin.org FAQ as a credited private reading copy", async () => temporary(async (root) => {
    const url = "https://bitcoin.org/en/faq";
    const prose = "Bitcoin is a digital payment network. People use software called wallets to manage it. The network records payments in a shared public ledger. Computers check transactions using agreed rules. No single company controls the network. Prices can change quickly, and using digital money has risks. Readers should learn how wallets work before using them. A clear explanation can help people understand this technology without assuming that it is an investment. Learning the basics is useful even if you never use Bitcoin.";
    const html = `<main><h1>Frequently Asked Questions</h1>${Array.from({ length: 10 }, () => `<p>${prose}</p>`).join("")}</main>`;
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => { requests.push(String(input)); return new Response(html); }) as typeof fetch;
    const article = await new ScienceArticleService(path.join(root, "articles.json"), fetchImpl).importFromSource(url);
    expect(article.sourceName).toBe("Bitcoin.org");
    expect(article.credit).toContain("private local reading copy");
    expect(article.credit).toContain("not for redistribution");
    expect(article.title).toBe("Frequently Asked Questions");
    expect(requests).toEqual([url]);
  }));

  it("stores OpenLearn article text with its reuse credit and leaves unlicensed imagery as source links", async () => temporary(async (root) => {
    const url = "https://www.open.edu/openlearn/health-sports-psychology/exploring-sport-coaching-and-psychology/content-section-0";
    const prose = "Coaches help players set goals and practice new skills. A team can learn from both success and failure. Players build confidence when they understand their role. Clear feedback helps people improve. Good coaching also creates a safe place to ask questions. Teams work better when members listen to each other. Young players need time to rest and recover. Practice can support physical and mental health. People learn at different speeds. Coaches can adapt activities for every player.";
    const splitAt = prose.indexOf(" Players build confidence");
    const splitAgain = prose.indexOf(" Young players need time");
    const html = "<main><article><h1>How sport and psychology shape strong teams</h1><p>" + prose.slice(0, splitAt) + "</p><p>" + prose.slice(splitAt + 1, splitAgain) + "</p><p>" + prose.slice(splitAgain + 1) + "</p><figure><img src=\"/openlearn/image.png\" alt=\"Players working together\"><figcaption>Image: Open University media library.</figcaption></figure></article></main>";
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
    const article = await new ScienceArticleService(path.join(root, "articles.json"), fetchImpl).importFromSource(url);
    expect(article.sourceName).toBe("OpenLearn · The Open University");
    expect(article.credit).toContain("CC BY-NC-SA 4.0");
    expect(article.paragraphs.join(" ")).toBe(prose);
    expect(scienceArticleImages(article.blocks!)[0]).toMatchObject({ status: "link-only", reason: "OpenLearn 图片未注明可复用许可，保留原图链接" });
    expect(requests).toEqual([url]);
  }));

  it("recognizes the real NOAA Bootstrap root and preserves figures, captions, short text, lists and spanned tables in order", () => {
    const parsed = parseScienceArticle(scienceArticleHtml, scienceArticleUrl);
    expect(parsed.title).toBe("How ocean currents carry heat");
    expect(parsed.blocks.map((block) => block.kind)).toEqual(["figure", "paragraph", "heading", "paragraph", "list", "table", "paragraph"]);
    expect(parsed.blocks[0]).toMatchObject({ kind: "figure", captionPlacement: "before", caption: "Figure 1. Original red and blue bars. Credit: NOAA." });
    expect(parsed.paragraphs).toContain("A short sentence.");
    expect(parsed.paragraphs.join(" ")).not.toMatch(/Figure 1|Unrelated|Never execute/);
    expect(scienceArticleImages(parsed.blocks)[0]).toMatchObject({ sourceUrl: "https://oceanservice.noaa.gov/facts/chart-full.png", width: 120, height: 70 });
    const table = parsed.blocks.find((block) => block.kind === "table");
    expect(table?.rows[0]?.cells[0]).toMatchObject({ rowSpan: 2, header: true });
    expect(table?.rows[1]?.cells[0]).toMatchObject({ colSpan: 3 });
  });

  it("preserves source-set images, captions after images and tables inside figure wrappers without duplicate captions", () => {
    const html = scienceArticleHtml.replace(/<figure>[\s\S]*?<\/figure>/, '<p><img src="/small.png" srcset="/medium.png 480w, /large.png 960w" alt="Chart" /></p><p class="caption">NOAA chart caption.</p>')
      .replace('<table>', '<figure><figcaption>Shared table caption</figcaption><table>').replace('</table>', '</table></figure>');
    const parsed = parseScienceArticle(html, scienceArticleUrl);
    expect(scienceArticleImages(parsed.blocks)[0]?.sourceUrl).toBe("https://oceanservice.noaa.gov/large.png");
    expect(parsed.blocks[0]).toMatchObject({ kind: "figure", caption: "NOAA chart caption.", captionPlacement: "after" });
    expect(parsed.paragraphs).not.toContain("NOAA chart caption.");
    expect(parsed.blocks.some((block) => block.kind === "table")).toBe(true);
    expect(parsed.paragraphs).toContain("Shared table caption");
  });

  it("stores image bytes locally and serves them after the original source becomes unavailable", async () => temporary(async (root) => {
    const mock = sourceFetch();
    const service = new ScienceArticleService(path.join(root, "articles.json"), mock.fetchImpl);
    const article = await service.importFromSource(scienceArticleUrl);
    const image = scienceArticleImages(article.blocks!)[0]!;
    expect(image.status).toBe("cached");
    expect(mock.requests).toEqual([scienceArticleUrl, "https://oceanservice.noaa.gov/facts/chart-full.png"]);
    const offline = new ScienceArticleService(path.join(root, "articles.json"), (async () => { throw new Error("offline"); }) as typeof fetch);
    expect((await offline.list())[0]?.blocks).toEqual(article.blocks);
    expect((await offline.getMedia(article.id, image.mediaId!))?.data.equals(chartPng)).toBe(true);
    expect(await offline.getMedia(article.id, "../private")).toBeNull();
    expect(await offline.getMedia("a".repeat(64), image.mediaId!)).toBeNull();
    const before = mock.requests.length;
    expect((await service.importFromSource(scienceArticleUrl)).id).toBe(article.id);
    expect(mock.requests.length).toBe(before);
    await writeFile(path.join(root, "science-article-media", article.id, image.mediaId!), "incomplete cached file");
    await service.refresh(article.id);
    expect((await service.getMedia(article.id, image.mediaId!))?.data.equals(chartPng)).toBe(true);
    await service.delete(article.id);
    expect(await readdir(path.join(root, "science-article-media"))).toEqual([]);
    expect(await service.getMedia(article.id, image.mediaId!)).toBeNull();
  }));

  it("does not save an automatically collected article when its English text exceeds the reading-level guard", async () => temporary(async (root) => {
    const denseText = "Thermohaline circulation demonstrates interconnected oceanographic redistribution across geographically extensive meridional basins. ".repeat(12);
    const denseHtml = `<html><body class="facts"><h1>How long do Greenland sharks live?</h1><div class="col-md-9"><p>${denseText}</p><p>${denseText}</p></div></body></html>`;
    const mock = sourceFetch(denseHtml);
    const service = new ScienceArticleService(path.join(root, "articles.json"), mock.fetchImpl);
    expect(await service.importAutomatically(scienceArticleUrl)).toBeNull();
    expect(await service.list()).toEqual([]);
    expect(mock.requests).toEqual([scienceArticleUrl]);
  }));

  it("saves readable NASA Space Place text locally and leaves separately credited third-party images linked", async () => temporary(async (root) => {
    const url = "https://spaceplace.nasa.gov/planet-what-is/en/";
    const prose = "Planets move around stars in space. Gravity helps gather dust and gas together. Scientists study many worlds with telescopes. Some planets are rocky and some are made mostly of gas. Each discovery gives us new questions to explore.";
    const html = `<main><h1>What Is a Planet?</h1>${Array.from({ length: 10 }, () => `<p>${prose}</p>`).join("")}<figure><img src="/images/planet.jpg" alt="A distant planet"><figcaption>Credit: NASA/ESA/STScI.</figcaption></figure></main>`;
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => { requests.push(String(input)); return new Response(html); }) as typeof fetch;
    const service = new ScienceArticleService(path.join(root, "articles.json"), fetchImpl);
    const article = await service.importFromSource(url);
    expect(article.sourceName).toBe("NASA Space Place");
    expect(article.credit).toContain("personal reading copy");
    expect(scienceArticleImages(article.blocks!)[0]).toMatchObject({ status: "link-only", reason: expect.stringContaining("版权或来源") });
    expect(requests).toEqual([url]);
  }));

  it("saves NASA Climate Kids articles locally and labels them as a personal reading copy", async () => temporary(async (root) => {
    const url = "https://climatekids.nasa.gov/water-cycle/";
    const prose = "Water moves around Earth in many ways. The Sun warms rivers, lakes, and oceans. Some water turns into vapor and rises into the air. The vapor cools and forms clouds. Later, water falls as rain or snow. It flows over land and into rivers. Some water soaks into the ground. Plants and animals need water to live. NASA satellites help scientists observe this cycle from space.";
    const html = `<main><h1>What Is the Water Cycle?</h1>${Array.from({ length: 10 }, () => `<p>${prose}</p>`).join("")}</main>`;
    const mock = sourceFetch(html);
    const article = await new ScienceArticleService(path.join(root, "articles.json"), mock.fetchImpl).importFromSource(url);
    expect(article.sourceName).toBe("NASA Climate Kids");
    expect(article.credit).toContain("personal reading copy");
    expect(article.title).toBe("What Is the Water Cycle?");
    expect(mock.requests).toEqual([url]);
  }));

  it("saves NPS animal articles with first-party photos for offline reading", async () => temporary(async (root) => {
    const url = "https://www.nps.gov/mora/learn/kidsyouth/animals-for-kids.htm";
    const prose = "Many animals live in the park. Black bears can climb trees. They search for berries and insects. Young cubs stay close to their mother. Birds build nests in branches. Salamanders rest beneath damp rocks. Rivers provide water and food. In winter, some animals find shelter. Scientists watch animals from a safe distance. Healthy habitats help wildlife survive. Families use forests, lakes, and meadows.";
    const html = `<main><article><h1>Animals for Kids</h1><p>${prose}</p><p>${prose}</p><figure><img src="/media/black-bear.png" alt="A black bear"><figcaption>Photo by NPS/Jane Doe.</figcaption></figure></article></main>`;
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const requestUrl = String(input); requests.push(requestUrl);
      return requestUrl === url ? new Response(html) : new Response(chartPng, { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;
    const service = new ScienceArticleService(path.join(root, "articles.json"), fetchImpl);
    const article = await service.importFromSource(url);
    expect(article.sourceName).toBe("National Park Service");
    expect(article.credit).toContain("National Park Service");
    expect(scienceArticleImages(article.blocks!)[0]).toMatchObject({ status: "cached", mimeType: "image/png" });
    expect(requests).toEqual([url, "https://www.nps.gov/media/black-bear.png"]);
  }));

  it("retains article text and a source placeholder for restricted, external, SVG and failed images", async () => temporary(async (root) => {
    const extra = '<figure><img src="/restricted.png"/><figcaption>© Example publisher</figcaption></figure><figure><img src="https://outside.invalid/picture.png"/><figcaption>External picture</figcaption></figure><svg><text>Original diagram</text></svg>';
    const html = scienceArticleHtml.replace('<h2>', `${extra}<h2>`);
    const mock = sourceFetch(html, () => new Response("<html>not an image</html>", { headers: { "Content-Type": "text/html" } }));
    const article = await new ScienceArticleService(path.join(root, "articles.json"), mock.fetchImpl).importFromSource(scienceArticleUrl);
    const images = scienceArticleImages(article.blocks!);
    expect(images.map((image) => image.status)).toEqual(["unavailable", "link-only", "link-only"]);
    expect(images[1]?.reason).toContain("版权");
    expect(article.blocks?.some((block) => block.kind === "source-link")).toBe(true);
    expect(mock.requests).not.toContain("https://oceanservice.noaa.gov/restricted.png");
    expect(mock.requests.some((url) => url.includes("outside.invalid"))).toBe(false);
    expect(article.paragraphs.length).toBeGreaterThan(2);
    expect(() => parseScienceArticle(scienceArticleHtml.replace("A short sentence.", "Copyright Example Publishing. All rights reserved."), scienceArticleUrl)).toThrow(/版权/);
  }));

  it("blocks external redirects before fetching them and refuses oversized media streams", async () => temporary(async (root) => {
    const requests: string[] = [];
    const mock = (async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      if (url.endsWith(".html")) return new Response(scienceArticleHtml);
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    }) as typeof fetch;
    const record = await new ScienceArticleService(path.join(root, "one.json"), mock).importFromSource(scienceArticleUrl);
    expect(scienceArticleImages(record.blocks!)[0]?.status).toBe("unavailable");
    expect(requests.some((url) => url.includes("127.0.0.1"))).toBe(false);
    const large = sourceFetch(scienceArticleHtml, () => new Response("too large", { headers: { "Content-Length": "9000000" } }));
    const oversized = await new ScienceArticleService(path.join(root, "two.json"), large.fetchImpl).importFromSource(scienceArticleUrl);
    expect(scienceArticleImages(oversized.blocks!)[0]?.reason).toContain("大小限制");
  }));

  it("follows NOAA's actual official-CDN image redirect while rejecting alternate ports and credential-bearing URLs", async () => temporary(async (root) => {
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      if (url.endsWith(".html")) return new Response(scienceArticleHtml);
      if (new URL(url).hostname === "oceanservice.noaa.gov") return new Response(null, { status: 301, headers: { Location: "https://cdn.oceanservice.noaa.gov/oceanserviceprod/facts/chart.png" } });
      return new Response(chartPng);
    }) as typeof fetch;
    const service = new ScienceArticleService(path.join(root, "state.json"), fetchImpl);
    const article = await service.importFromSource(scienceArticleUrl);
    expect(scienceArticleImages(article.blocks!)[0]?.status).toBe("cached");
    expect(requests.at(-1)).toBe("https://cdn.oceanservice.noaa.gov/oceanserviceprod/facts/chart.png");
    await expect(service.importFromSource("https://oceanservice.noaa.gov:444/facts/article.html")).rejects.toThrow(/科普文章/);
    await expect(service.importFromSource("https://user:pass@oceanservice.noaa.gov/facts/article.html")).rejects.toThrow(/科普文章/);
    await expect(service.importFromSource("https://cdn.oceanservice.noaa.gov/facts/article.html")).rejects.toThrow(/科普文章/);
  }));

  it("upgrades legacy text-only articles without changing identity or saved time, and leaves the saved version intact on page failure", async () => temporary(async (root) => {
    const state = path.join(root, "articles.json");
    const mock = sourceFetch();
    const service = new ScienceArticleService(state, mock.fetchImpl);
    const first = await service.importFromSource(scienceArticleUrl);
    const { blocks: _blocks, contentVersion: _version, updatedAt: _updated, ...legacy } = first;
    await writeFile(state, JSON.stringify({ version: 1, articles: [legacy] }));
    const upgraded = await service.refresh(first.id);
    expect(upgraded.id).toBe(legacy.id);
    expect(upgraded.savedAt).toBe(legacy.savedAt);
    expect(upgraded.contentVersion).toBe(2);
    const offline = new ScienceArticleService(state, (async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(offline.refresh(first.id)).rejects.toThrow("offline");
    expect((await offline.list())[0]).toEqual(upgraded);
    const missingImage = sourceFetch(scienceArticleHtml, () => new Response(null, { status: 503 }));
    const retried = await new ScienceArticleService(state, missingImage.fetchImpl).refresh(first.id);
    const recovered = scienceArticleImages(retried.blocks!)[0]!;
    expect(recovered.status).toBe("cached");
    expect(recovered.reason).toContain("保留此前");
    expect((await service.getMedia(first.id, recovered.mediaId!))?.data.equals(chartPng)).toBe(true);
    await writeFile(state, JSON.stringify({ version: 1, articles: [{ ...legacy, id: "../outside" }] }));
    await expect(service.refresh("../outside")).rejects.toThrow(/标识无效/);
  }));

  it("exposes only cached media through a local API with image types and no arbitrary file paths", async () => temporary(async (root) => {
    const mock = sourceFetch();
    const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, scienceArticleFetchImpl: mock.fetchImpl });
    try {
      const saved = await app.inject({ method: "POST", url: "/api/science-articles/import", payload: { sourceUrl: scienceArticleUrl } });
      expect(saved.statusCode).toBe(200);
      const article = saved.json<ScienceArticle>();
      const image = scienceArticleImages(article.blocks!)[0]!;
      const media = await app.inject({ method: "GET", url: scienceArticleMediaUrl(article.id, image.mediaId!) });
      expect(media.statusCode).toBe(200);
      expect(media.headers["content-type"]).toContain("image/png");
      expect(media.headers["x-content-type-options"]).toBe("nosniff");
      expect(media.rawPayload.equals(chartPng)).toBe(true);
      expect((await app.inject({ method: "GET", url: scienceArticleMediaUrl(article.id, image.mediaId!), remoteAddress: "192.0.2.1" })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: scienceArticleMediaUrl(article.id, "f".repeat(64)) })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/science-articles/${article.id}/refresh` })).statusCode).toBe(200);
    } finally { await app.close(); }
  }));
});
