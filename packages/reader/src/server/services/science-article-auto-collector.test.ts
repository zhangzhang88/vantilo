import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentDiscoverySnapshot, DiscoveryCandidate } from "../../shared/content-discovery.js";
import { ScienceArticleAutoCollector } from "./science-article-auto-collector.js";
import { ScienceArticleService } from "./science-article-service.js";

const paragraph = "Many animals use this simple skill every day. Scientists study it to learn more about nature and how living things respond to the world around them.";
function candidate(title: string, slug: string): DiscoveryCandidate {
  return {
    id: slug, kind: "article", sourceId: "nps-animals", sourceName: "National Park Service", title,
    author: null, publishedAt: null, sourceUrl: `https://www.nps.gov/yell/learn/kidsyouth/${slug}.htm`,
    discoveredAt: new Date().toISOString(), contentPolicy: "us-government-public-domain-credit",
  };
}

describe("science article automatic collection", () => {
  it("imports up to ten curated, readable articles each local day and records the daily cap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-science-auto-"));
    try {
      const candidates = [
        candidate("How long do Greenland sharks live?", "greenland-shark"), candidate("What do foxes eat?", "foxes"),
        candidate("How do bears prepare for winter?", "bears"), candidate("How do owls find their food?", "owls"),
        candidate("How do beavers build homes?", "beavers"), candidate("Why do birds migrate?", "birds-migrate"),
        candidate("How do bats navigate at night?", "bats"), candidate("What helps deer survive winter?", "deer"),
        candidate("How do wolves communicate?", "wolves"), candidate("Why do turtles lay eggs on land?", "turtles"),
        candidate("How do bees work together?", "bees"), candidate("How do salmon find their way?", "salmon"),
      ];
      const requests: string[] = [];
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input); requests.push(url);
        const title = candidates.find((item) => item.sourceUrl === url)!.title;
        const html = `<html><main><h1>${title}</h1>${Array.from({ length: 10 }, () => `<p>${paragraph}</p>`).join("")}</main></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }) as typeof fetch;
      const service = new ScienceArticleService(path.join(root, "science-articles.json"), fetchImpl);
      const collector = new ScienceArticleAutoCollector(path.join(root, "science-article-auto-import.json"), service);
      const snapshot: ContentDiscoverySnapshot = { version: 1, refreshedAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), candidates, sources: [] };

      expect(await collector.collect(snapshot)).toMatchObject({ importedCount: 10, rejectedCount: 0, failedCount: 0 });
      expect(await collector.collect(snapshot)).toMatchObject({ importedCount: 0, rejectedCount: 0, failedCount: 0 });
      expect((await service.list())).toHaveLength(10);
      expect(requests).toHaveLength(10);
      expect(JSON.parse(await readFile(path.join(root, "science-article-auto-import.json"), "utf8")).attemptedCandidateIds).toHaveLength(10);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rotates between animal reading, Our World in Data and Bitcoin basics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-science-diversity-"));
    try {
      const candidates: DiscoveryCandidate[] = [
        candidate("How long do Greenland sharks live?", "greenland-shark"),
        { ...candidate("Bitcoin FAQ: Answers to common questions", "bitcoin-faq"), sourceId: "bitcoin-org", sourceName: "Bitcoin.org · 比特币入门", sourceUrl: "https://bitcoin.org/en/faq", contentPolicy: "personal-local-reading" },
        { ...candidate("Animals for Kids", "animals"), sourceId: "nps-animals", sourceName: "National Park Service · Animals for Kids", sourceUrl: "https://www.nps.gov/mora/learn/kidsyouth/animals-for-kids.htm" },
        { ...candidate("How do people experience mental health conditions?", "mental-health"), sourceId: "our-world-in-data", sourceName: "Our World in Data · 全球议题", sourceUrl: "https://ourworldindata.org/mental-health", contentPolicy: "creative-commons-cc-by-4.0" },
      ];
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        const title = candidates.find((item) => item.sourceUrl === url)!.title;
        const content = Array.from({ length: 10 }, () => `<p>${paragraph}</p>`).join("");
        const html = url.includes("oceanservice")
          ? `<body class="facts"><h1>${title}</h1><div class="col-md-9">${content}</div></body>`
          : `<main><h1>${title}</h1>${content}</main>`;
        return new Response(html);
      }) as typeof fetch;
      const service = new ScienceArticleService(path.join(root, "science-articles.json"), fetchImpl);
      const collector = new ScienceArticleAutoCollector(path.join(root, "science-article-auto-import.json"), service);
      const snapshot: ContentDiscoverySnapshot = { version: 1, refreshedAt: null, lastAttemptAt: null, candidates, sources: [] };
      expect(await collector.collect(snapshot)).toMatchObject({ importedCount: 4, rejectedCount: 0, failedCount: 0 });
      expect((await service.list()).map((article) => article.sourceName).sort()).toEqual([
        "National Park Service", "Our World in Data", "Bitcoin.org", "National Park Service",
      ].sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
