import type { DiscoveryCandidate } from "./content-discovery.js";
import type { ScienceArticleBlock } from "./science-article.js";

export function compareScienceCandidatesByRecency(left: DiscoveryCandidate, right: DiscoveryCandidate): number {
  if (left.publishedAt && right.publishedAt) return right.publishedAt.localeCompare(left.publishedAt);
  if (left.publishedAt) return -1;
  if (right.publishedAt) return 1;
  return right.discoveredAt.localeCompare(left.discoveredAt);
}

function safeUrl(candidate: DiscoveryCandidate): URL | null {
  try { return new URL(candidate.sourceUrl); } catch { return null; }
}

export function isScienceReadingCandidate(candidate: DiscoveryCandidate): boolean {
  if (candidate.kind !== "article") return false;
  const url = safeUrl(candidate);
  if (!url || url.protocol !== "https:") return false;
  if (["noaa-ocean-facts", "nasa-space-place", "nasa-climate-kids", "openlearn"].includes(candidate.sourceId)) return false;
  if (/\b(?:space|planet|moon|solar system|universe|astronom|ocean|marine|sea|climate|environment|environmental|pollution|biodiversity|carbon emissions|deforestation|weather|ecosystem|forest|sustainability|living planet|wildlife populations)\b/i.test(candidate.title)) return false;
  if (candidate.sourceId === "nps-animals") {
    return candidate.contentPolicy === "us-government-public-domain-credit"
      && url.hostname === "www.nps.gov" && /\/learn\/kidsyouth\//.test(url.pathname);
  }
  if (candidate.sourceId === "our-world-in-data") {
    return candidate.contentPolicy === "creative-commons-cc-by-4.0"
      && ["ourworldindata.org", "www.ourworldindata.org"].includes(url.hostname)
      && /^\/[a-z0-9][a-z0-9-]*\/?$/i.test(url.pathname)
      && !/^\/(?:about|latest|topics?|data|grapher|search|team|donate|faqs?|atom\.xml)\/?$/i.test(url.pathname);
  }
  if (candidate.sourceId === "bitcoin-org") {
    return candidate.contentPolicy === "personal-local-reading"
      && url.hostname === "bitcoin.org" && url.pathname === "/en/faq";
  }
  return false;
}

function blockText(blocks: ScienceArticleBlock[]): string[] {
  return blocks.flatMap((block): string[] => {
    if (block.kind === "paragraph" || block.kind === "heading") return [block.text];
    if (block.kind === "list") return block.items.flatMap(blockText);
    if (block.kind === "table") return block.rows.flatMap((row) => row.cells.flatMap((cell) => blockText(cell.blocks)));
    if (block.kind === "figure") return [block.caption, ...block.images.map((image) => image.alt)].filter(Boolean);
    return [];
  });
}

/** A conservative readability guard for auto-collection; manual collection is unaffected. */
export function isAccessibleScienceArticle(blocks: ScienceArticleBlock[]): boolean {
  const body = blockText(blocks).join(" ").replace(/\s+/g, " ").trim();
  const words = body.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
  const sentences = body.split(/[.!?]+/).map((sentence) => sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0).filter(Boolean);
  if (words.length < 100 || sentences.length < 8) return false;
  const averageSentenceLength = words.length / sentences.length;
  const longWordRatio = words.filter((word) => word.length >= 12).length / words.length;
  const longSentenceRatio = sentences.filter((length) => length > 32).length / sentences.length;
  return averageSentenceLength <= 24 && longWordRatio <= 0.16 && longSentenceRatio <= 0.2;
}
