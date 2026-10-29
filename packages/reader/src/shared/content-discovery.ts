export type DiscoveryCandidateKind = "article" | "book";
export type DiscoverySourceId = "science-news-explores" | "standard-ebooks" | "noaa-ocean-facts" | "nasa-space-place" | "nasa-climate-kids" | "nps-animals" | "openlearn" | "our-world-in-data" | "bitcoin-org";

export interface DiscoveryCandidate {
  id: string;
  kind: DiscoveryCandidateKind;
  sourceId: DiscoverySourceId;
  sourceName: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  discoveredAt: string;
  /** Discovery is metadata-only unless the source grants an explicit full-text license. */
  contentPolicy: "link-only" | "public-domain-us-check-jurisdiction" | "us-government-public-domain-credit" | "personal-local-reading" | "open-education-cc-by-nc-sa-4.0" | "creative-commons-cc-by-4.0";
}

export type DiscoverySourceResult = {
  sourceId: DiscoverySourceId;
  status: "ok" | "error";
  checkedAt: string;
  candidateCount: number;
  error?: string;
};

export interface ContentDiscoverySnapshot {
  version: 1;
  refreshedAt: string | null;
  lastAttemptAt: string | null;
  candidates: DiscoveryCandidate[];
  sources: DiscoverySourceResult[];
}
