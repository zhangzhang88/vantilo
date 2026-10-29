import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscoveryCandidate } from "../../shared/content-discovery.js";
import { ContentDiscoveryService } from "./content-discovery-service.js";

describe("additional science content discovery", () => {
  it("keeps a candidate's first-discovered date stable across refreshes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-first-seen-"));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("ourworldindata.org/atom.xml")) return new Response('<feed><entry><title>Technology change</title><link href="https://ourworldindata.org/technology-long-run"/><published>2026-10-19T12:00:00Z</published></entry></feed>');
        if (url.includes("ourworldindata.org/")) return new Response("<main><h1>Economic Growth</h1></main>");
        if (url.includes("nps.gov")) return new Response("<main><h1>Wildlife</h1></main>");
        if (url.includes("bitcoin.org")) return new Response("<main><h1>Frequently Asked Questions</h1></main>");
        return new Response("<rss><channel/></rss>");
      }) as typeof fetch;
      const statePath = path.join(root, "content-discovery.json");
      const service = new ContentDiscoveryService(statePath, fetchImpl);
      const first = await service.refresh({ force: true });
      const technology = first.candidates.find((candidate) => candidate.sourceUrl.endsWith("/technology-long-run"));
      expect(technology).toBeDefined();

      const cached = JSON.parse(await readFile(statePath, "utf8")) as { candidates: DiscoveryCandidate[] };
      const firstSeen = "2026-01-14T09:30:00.000Z";
      cached.candidates.find((candidate) => candidate.id === technology!.id)!.discoveredAt = firstSeen;
      await writeFile(statePath, JSON.stringify(cached));

      const refreshed = await service.refresh({ force: true });
      expect(refreshed.candidates.find((candidate) => candidate.id === technology!.id)?.discoveredAt).toBe(firstSeen);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("retires stale OpenLearn discovery records on refresh", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-retire-openlearn-"));
    try {
      const statePath = path.join(root, "content-discovery.json");
      await writeFile(statePath, JSON.stringify({
        version: 1, refreshedAt: null, lastAttemptAt: null,
        candidates: [
          { id: "article:legacy-openlearn", kind: "article", sourceId: "openlearn", sourceName: "OpenLearn", title: "Old candidate", author: null, publishedAt: null, sourceUrl: "https://www.open.edu/openlearn/example", discoveredAt: "2026-10-18T00:00:00.000Z", contentPolicy: "open-education-cc-by-nc-sa-4.0" },
          { id: "article:legacy-space", kind: "article", sourceId: "nasa-space-place", sourceName: "NASA Space Place", title: "Old planet", author: null, publishedAt: null, sourceUrl: "https://spaceplace.nasa.gov/planet-what-is/en/", discoveredAt: "2026-10-18T00:00:00.000Z", contentPolicy: "personal-local-reading" },
          { id: "article:legacy-ocean", kind: "article", sourceId: "noaa-ocean-facts", sourceName: "NOAA Ocean Facts", title: "Old ocean", author: null, publishedAt: null, sourceUrl: "https://oceanservice.noaa.gov/facts/example.html", discoveredAt: "2026-10-18T00:00:00.000Z", contentPolicy: "us-government-public-domain-credit" },
          { id: "article:legacy-climate", kind: "article", sourceId: "nasa-climate-kids", sourceName: "NASA Climate Kids", title: "Old climate", author: null, publishedAt: null, sourceUrl: "https://climatekids.nasa.gov/water-cycle/", discoveredAt: "2026-10-18T00:00:00.000Z", contentPolicy: "personal-local-reading" },
        ],
        sources: [
          { sourceId: "openlearn", sourceName: "OpenLearn", status: "error", checkedAt: "2026-10-18T00:00:00.000Z", candidateCount: 1, error: "HTTP 403" },
          { sourceId: "nasa-space-place", sourceName: "NASA Space Place", status: "error", checkedAt: "2026-10-18T00:00:00.000Z", candidateCount: 1, error: "HTTP 503" },
          { sourceId: "noaa-ocean-facts", sourceName: "NOAA Ocean Facts", status: "error", checkedAt: "2026-10-18T00:00:00.000Z", candidateCount: 1, error: "timeout" },
          { sourceId: "nasa-climate-kids", sourceName: "NASA Climate Kids", status: "error", checkedAt: "2026-10-18T00:00:00.000Z", candidateCount: 1, error: "HTTP 503" },
        ],
      }));
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("nps.gov")) return new Response("<main><h1>Wildlife</h1></main>");
        if (url.includes("ourworldindata.org")) return url.includes("atom.xml") ? new Response("<feed/>") : new Response("<main><h1>Economic Growth</h1></main>");
        if (url.includes("bitcoin.org")) return new Response("<main><h1>Frequently Asked Questions</h1></main>");
        return new Response("<feed/>");
      }) as typeof fetch;
      const snapshot = await new ContentDiscoveryService(statePath, fetchImpl).refresh({ force: true });
      expect(snapshot.candidates.some((candidate) => ["openlearn", "nasa-space-place", "noaa-ocean-facts"].includes(candidate.sourceId))).toBe(false);
      expect(snapshot.sources.some((source) => ["openlearn", "nasa-space-place", "noaa-ocean-facts", "nasa-climate-kids"].includes(source.sourceId))).toBe(false);
      expect(await readFile(statePath, "utf8")).toContain("our-world-in-data");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports why a curated page source returned no candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-error-"));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("ourworldindata.org/atom.xml")) return new Response("unavailable", { status: 503 });
        if (url.includes("nps.gov")) return new Response("<main><h1>Wildlife</h1></main>");
        return new Response("<rss><channel/></rss>");
      }) as typeof fetch;
      const service = new ContentDiscoveryService(path.join(root, "content-discovery.json"), fetchImpl);
      const snapshot = await service.refresh({ force: true });
      expect(snapshot.sources.find((source) => source.sourceId === "our-world-in-data")).toMatchObject({
        status: "error", candidateCount: 0, error: "来源返回 HTTP 503",
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports a forbidden feed response without hiding the failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-cloudflare-"));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("ourworldindata.org/atom.xml")) return new Response("forbidden", { status: 403 });
        if (url.includes("nps.gov")) return new Response("<main><h1>Wildlife</h1></main>");
        return new Response("<rss><channel/></rss>");
      }) as typeof fetch;
      const snapshot = await new ContentDiscoveryService(path.join(root, "content-discovery.json"), fetchImpl).refresh({ force: true });
      expect(snapshot.sources.find((source) => source.sourceId === "our-world-in-data")?.error)
        .toBe("来源返回 HTTP 403");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("includes the underlying network code when a source fetch fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-fetch-error-"));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        if (String(input).includes("ourworldindata.org/atom.xml")) {
          const cause = Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" });
          throw new TypeError("fetch failed", { cause });
        }
        if (String(input).includes("nps.gov")) return new Response("<main><h1>Wildlife</h1></main>");
        if (String(input).includes("climatekids.nasa.gov")) return new Response("<main><h1>Climate</h1></main>");
        if (String(input).includes("ourworldindata.org")) return new Response("<feed/>");
        return new Response("<rss><channel/></rss>");
      }) as typeof fetch;
      const snapshot = await new ContentDiscoveryService(path.join(root, "content-discovery.json"), fetchImpl).refresh({ force: true });
      expect(snapshot.sources.find((source) => source.sourceId === "our-world-in-data")?.error).toContain("ENOTFOUND");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("discovers NPS animals, topical Our World in Data pages, and the Bitcoin FAQ", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-discovery-"));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("ourworldindata.org/atom.xml")) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Why do people experience mental health conditions?</title><link rel="alternate" href="https://ourworldindata.org/when-do-people-experience-mental-health-conditions-for-the-first-time"/><published>2026-10-19T08:00:00Z</published><author><name>Hannah Ritchie</name></author></entry><entry><title>Data page</title><link rel="alternate" href="https://ourworldindata.org/grapher/example"/></entry><entry><title>External</title><link rel="alternate" href="https://outside.invalid/article"/></entry><entry><title>Topic directory</title><link rel="alternate" href="https://ourworldindata.org/topics"/></entry></feed>', { headers: { "Content-Type": "application/atom+xml" } });
        if (url.includes("bitcoin.org")) return new Response("<main><h1>Frequently Asked Questions</h1></main>");
        if (url.includes("spaceplace.nasa.gov")) {
          if (url.includes("planet-what-is")) return new Response("<main></main>");
          if (url.includes("all-about-earth")) return new Response("<main><h1>All About Earth</h1></main>");
          if (url.includes("all-about-the-moon")) return new Response("<main><h1>All About the Moon</h1></main>");
          return new Response('<main><a href="/planet-what-is/en/"><h2>What Is a Planet?</h2></a><a href="/en/menu/universe/"><h2>Universe</h2></a><a href="https://outside.invalid/planet/en/">Outside topic</a></main>');
        }
        if (url.includes("climatekids.nasa.gov")) {
          const slug = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
          const title: Record<string, string> = {
            "climate-change-meaning": "What Is Climate Change?", "water-cycle": "What Is the Water Cycle?",
            "greenhouse-effect": "What Is the Greenhouse Effect?", "air-pollution": "What Causes Air Pollution?",
            ocean: "How Does Climate Change Affect the Ocean?", soil: "How Do We Know if We're in a Drought?",
            "polar-temperatures": "Which Pole Is Colder?", "cloud-climate": "How Do Clouds Affect Earth's Climate?",
            "how-to-help": "What Can We Do to Slow Down Climate Change?", "sun-people": "Meet the Sun power people!",
            "science-fair": "Do a science fair project!",
          };
          return new Response(`<main><h1>${title[slug] ?? ""}</h1></main>`);
        }
        if (url.endsWith("animals-for-kids.htm")) return new Response("<main><h1>Animals for Kids</h1></main>");
        if (url.endsWith("wildlife.htm")) return new Response("<main><h1>Wildlife</h1></main>");
        if (url.endsWith("plants-animals-more.htm")) return new Response('<main><a href="/yell/learn/kidsyouth/wildlife.htm"><h2>Wildlife</h2></a></main>');
        return new Response("<rss><channel/></rss>");
      }) as typeof fetch;
      const service = new ContentDiscoveryService(path.join(root, "content-discovery.json"), fetchImpl);
      const snapshot = await service.refresh({ force: true });
      expect(snapshot.sources.find((source) => source.sourceId === "nps-animals")).toMatchObject({ status: "ok", candidateCount: 2 });
      expect(snapshot.sources.find((source) => source.sourceId === "bitcoin-org")).toMatchObject({ status: "ok", candidateCount: 1 });
      expect(snapshot.sources.find((source) => source.sourceId === "our-world-in-data")).toMatchObject({ status: "ok", candidateCount: 8 });
      expect(snapshot.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: "our-world-in-data", sourceName: "Our World in Data · 全球议题", title: "Why do people experience mental health conditions?", author: "Hannah Ritchie", publishedAt: "2026-10-19T08:00:00.000Z", contentPolicy: "creative-commons-cc-by-4.0" }),
        expect.objectContaining({ sourceId: "nps-animals", title: "Animals for Kids" }),
        expect.objectContaining({ sourceId: "nps-animals", title: "Wildlife" }),
        expect.objectContaining({ sourceId: "our-world-in-data", title: "Artificial Intelligence", sourceUrl: "https://ourworldindata.org/artificial-intelligence" }),
        expect.objectContaining({ sourceId: "our-world-in-data", title: "Economic Growth", sourceUrl: "https://ourworldindata.org/economic-growth" }),
        expect.objectContaining({ sourceId: "our-world-in-data", title: "Global Health", sourceUrl: "https://ourworldindata.org/global-health" }),
        expect.objectContaining({ sourceId: "bitcoin-org", title: "Bitcoin FAQ: Answers to common questions", sourceUrl: "https://bitcoin.org/en/faq" }),
      ]));
      expect(snapshot.sources.some((source) => ["noaa-ocean-facts", "nasa-space-place", "nasa-climate-kids"].includes(source.sourceId))).toBe(false);
      expect(snapshot.candidates.some((candidate) => candidate.sourceUrl.includes("outside.invalid"))).toBe(false);
      expect(snapshot.candidates.some((candidate) => /grapher|topics|atom\.xml|outside\.invalid/.test(candidate.sourceUrl))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
