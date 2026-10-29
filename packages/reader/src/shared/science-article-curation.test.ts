import { describe, expect, it } from "vitest";
import type { DiscoveryCandidate } from "./content-discovery.js";
import { compareScienceCandidatesByRecency, isAccessibleScienceArticle, isScienceReadingCandidate } from "./science-article-curation.js";
import type { ScienceArticleBlock } from "./science-article.js";

function candidate(title: string, sourceId: DiscoveryCandidate["sourceId"] = "nps-animals", contentPolicy: DiscoveryCandidate["contentPolicy"] = "us-government-public-domain-credit"): DiscoveryCandidate {
  const sourceUrl = sourceId === "nps-animals" ? "https://www.nps.gov/yell/learn/kidsyouth/wildlife.htm"
    : sourceId === "nasa-climate-kids" ? "https://climatekids.nasa.gov/climate-change-meaning/"
      : sourceId === "nasa-space-place" ? "https://spaceplace.nasa.gov/planet-what-is/en/"
        : sourceId === "openlearn" ? "https://www.open.edu/openlearn/money-business/what-is-economics/content-section-0"
      : sourceId === "our-world-in-data" ? "https://ourworldindata.org/mental-health"
        : sourceId === "bitcoin-org" ? "https://bitcoin.org/en/faq"
          : "https://www.nps.gov/yell/learn/kidsyouth/example.htm";
  return { id: title, kind: "article", sourceId, sourceName: "source", title, author: null, publishedAt: null, sourceUrl, discoveredAt: "2026-10-19", contentPolicy };
}

describe("science article reading curation", () => {
  it("sorts known publication dates ahead of newly discovered undated pages", () => {
    const dated = { ...candidate("Latest article", "our-world-in-data", "creative-commons-cc-by-4.0"), publishedAt: "2026-10-19T00:00:00.000Z", discoveredAt: "2026-10-19T07:00:00.000Z" };
    const undated = { ...candidate("Evergreen page", "nasa-space-place", "personal-local-reading"), publishedAt: null, discoveredAt: "2026-10-19T08:00:00.000Z" };
    expect(compareScienceCandidatesByRecency(dated, undated)).toBeLessThan(0);
    expect([undated, dated].sort(compareScienceCandidatesByRecency)).toEqual([dated, undated]);
  });

  it("widens trusted in-app science topics while excluding link-only or untrusted sources", () => {
    expect(isScienceReadingCandidate(candidate("How long do Greenland sharks live?"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("What is a Kelvin wave?", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("What is a SOFAR?", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("How long do Greenland sharks live?", "science-news-explores", "link-only"))).toBe(false);
    expect(isScienceReadingCandidate({ ...candidate("Open ocean page"), sourceUrl: "https://outside.invalid/facts/example.html" })).toBe(false);
  });

  it("keeps animal reading, admits Bitcoin basics, and excludes the user's unwanted topics", () => {
    expect(isScienceReadingCandidate(candidate("Animals for Kids", "nps-animals"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("How to Avoid Park Fees", "nps-animals"))).toBe(true);
    expect(isScienceReadingCandidate({ ...candidate("Birds & Birding", "nps-animals"), sourceUrl: "https://www.nps.gov/subjects/birds/index.htm" })).toBe(false);
    expect(isScienceReadingCandidate(candidate("Bitcoin FAQ: Answers to common questions", "bitcoin-org", "personal-local-reading"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("Old space article", "nasa-space-place", "personal-local-reading"))).toBe(false);
    expect(isScienceReadingCandidate(candidate("Old ocean article", "noaa-ocean-facts", "us-government-public-domain-credit"))).toBe(false);
    for (const title of ["What Is a Planet?", "How do ocean currents work?", "How is the climate changing?", "Why is the environment important?", "A 73% average decline in wildlife populations: an overview of the 2026 Living Planet Index report"]) {
      expect(isScienceReadingCandidate(candidate(title, "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(false);
    }
  });

  it("rejects retired link and OpenLearn source candidates", () => {
    const policy = "open-education-cc-by-nc-sa-4.0";
    const urls = [
      "https://www.open.edu/openlearn/money-business/economics/example",
      "https://www.open.edu/openlearn/health-sports-psychology/psychology/example",
      "https://www.open.edu/openlearn/education-development/personal-growth/example",
    ];
    urls.forEach((sourceUrl) => expect(isScienceReadingCandidate({ ...candidate("OpenLearn article", "openlearn", policy), sourceUrl })).toBe(false));
    expect(isScienceReadingCandidate({ ...candidate("OpenLearn article", "openlearn", policy), sourceUrl: "https://www.open.edu/openlearn/science-maths-technology/example" })).toBe(false);
    expect(isScienceReadingCandidate({ ...candidate("OpenLearn article", "openlearn", policy), sourceUrl: "https://outside.invalid/openlearn/money-business/example" })).toBe(false);
    expect(isScienceReadingCandidate({ ...candidate("OpenLearn article", "openlearn"), contentPolicy: "link-only" })).toBe(false);
  });

  it("accepts current Our World in Data articles while excluding chart and directory pages", () => {
    expect(isScienceReadingCandidate(candidate("Mental health", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
    expect(isScienceReadingCandidate({ ...candidate("Graph", "our-world-in-data", "creative-commons-cc-by-4.0"), sourceUrl: "https://ourworldindata.org/grapher/example" })).toBe(false);
    expect(isScienceReadingCandidate({ ...candidate("External", "our-world-in-data", "creative-commons-cc-by-4.0"), sourceUrl: "https://outside.invalid/mental-health" })).toBe(false);
    expect(isScienceReadingCandidate(candidate("Wrong license", "our-world-in-data", "link-only"))).toBe(false);
    expect(isScienceReadingCandidate(candidate("How does AI work?", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("How does the economy grow?", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
    expect(isScienceReadingCandidate(candidate("How has global health changed?", "our-world-in-data", "creative-commons-cc-by-4.0"))).toBe(true);
  });

  it("accepts clear short-sentence prose and rejects sparse or dense text", () => {
    const readable: ScienceArticleBlock[] = Array.from({ length: 10 }, (_, index) => ({
      kind: "paragraph",
      text: `Many animals use this simple skill every day. Scientists study it to learn more about nature and how living things respond to the world around them. Example ${index}.`,
    }));
    const dense: ScienceArticleBlock[] = [{ kind: "paragraph", text: Array.from({ length: 8 }, () => "The interconnectedness of oceanographic circulation demonstrates thermohaline redistribution across geographically extensive meridional basins.").join(" ") }];
    expect(isAccessibleScienceArticle(readable)).toBe(true);
    expect(isAccessibleScienceArticle(dense)).toBe(false);
    expect(isAccessibleScienceArticle([{ kind: "paragraph", text: "A short sentence." }])).toBe(false);
  });
});
