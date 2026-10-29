import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type {
  ContentDiscoverySnapshot,
  DiscoveryCandidate,
  DiscoverySourceId,
  DiscoverySourceResult,
} from "../../shared/content-discovery.js";

interface DiscoveryFeedSource {
  id: DiscoverySourceId;
  name: string;
  kind: DiscoveryCandidate["kind"];
  url: string;
  allowedHosts: string[];
  contentPolicy: DiscoveryCandidate["contentPolicy"];
  mode?: "feed" | "html-index" | "html-pages";
  indexUrls?: string[];
  seedUrls?: Array<{ url: string; title: string }>;
}

const SOURCES: DiscoveryFeedSource[] = [
  {
    id: "science-news-explores",
    name: "Science News Explores",
    kind: "article",
    url: "https://www.snexplores.org/feed/",
    allowedHosts: ["snexplores.org", "www.snexplores.org"],
    contentPolicy: "link-only",
  },
  {
    id: "nps-animals",
    name: "National Park Service · Animals for Kids",
    kind: "article",
    url: "https://www.nps.gov/learnandexplore/plants-animals-more.htm",
    allowedHosts: ["www.nps.gov"],
    contentPolicy: "us-government-public-domain-credit",
    mode: "html-pages",
    indexUrls: [
      "https://www.nps.gov/mora/learn/kidsyouth/animals-for-kids.htm",
      "https://www.nps.gov/yell/learn/kidsyouth/wildlife.htm",
    ],
  },
  {
    id: "our-world-in-data",
    name: "Our World in Data · 全球议题",
    kind: "article",
    url: "https://ourworldindata.org/atom.xml",
    allowedHosts: ["ourworldindata.org", "www.ourworldindata.org"],
    contentPolicy: "creative-commons-cc-by-4.0",
    seedUrls: [
      { url: "https://ourworldindata.org/artificial-intelligence", title: "Artificial Intelligence" },
      { url: "https://ourworldindata.org/technology-long-run", title: "Technology over the long run" },
      { url: "https://ourworldindata.org/economic-growth", title: "Economic Growth" },
      { url: "https://ourworldindata.org/what-is-economic-growth", title: "What is economic growth?" },
      { url: "https://ourworldindata.org/trade-and-globalization", title: "Trade and Globalization" },
      { url: "https://ourworldindata.org/global-health", title: "Global Health" },
      { url: "https://ourworldindata.org/mental-health", title: "Mental Health" },
    ],
  },
  {
    id: "bitcoin-org",
    name: "Bitcoin.org · 比特币入门",
    kind: "article",
    url: "https://bitcoin.org/en/faq",
    allowedHosts: ["bitcoin.org"],
    contentPolicy: "personal-local-reading",
    mode: "html-pages",
    indexUrls: ["https://bitcoin.org/en/faq"],
  },
];

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_FEED_BYTES = 2_000_000;
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_STORED_CANDIDATES = 200;

const emptySnapshot = (): ContentDiscoverySnapshot => ({
  version: 1,
  refreshedAt: null,
  lastAttemptAt: null,
  candidates: [],
  sources: SOURCES.map((source) => ({
    sourceId: source.id,
    status: "error",
    checkedAt: "",
    candidateCount: 0,
    error: "尚未检查",
  })),
});

function canonicalUrl(rawUrl: string, allowedHosts: string[]): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function parseFeed(source: DiscoveryFeedSource, xml: string, discoveredAt: string): DiscoveryCandidate[] {
  const $ = load(xml, { xmlMode: true });
  const candidates: DiscoveryCandidate[] = [];
  $("item, entry").each((_index, element) => {
    if (candidates.length >= MAX_ITEMS_PER_SOURCE) return;
    const entry = $(element);
    const title = entry.children("title").first().text().replace(/\s+/g, " ").trim();
    const linkElement = entry.children("link").toArray().find((candidate) => {
      const rel = $(candidate).attr("rel");
      return !rel || rel === "alternate";
    }) ?? entry.children("link").first().get(0);
    const rawUrl = linkElement
      ? $(linkElement).attr("href") ?? $(linkElement).text().trim()
      : entry.children("guid, id").first().text().trim();
    const sourceUrl = canonicalUrl(rawUrl, source.allowedHosts);
    if (!title || !sourceUrl) return;
    if (source.id === "openlearn") {
      const pathname = new URL(sourceUrl).pathname;
      if (!/^\/openlearn\/(?:money-business|health-sports-psychology|education-development)\//i.test(pathname)
        || /\/(?:all-content|altformat-printable|review|reviews|download)\/?$/i.test(pathname)
        || /\/content-section-\d+\/(?:review|download)/i.test(pathname)) return;
    }
    if (source.id === "our-world-in-data") {
      const pathname = new URL(sourceUrl).pathname;
      if (!/^\/[a-z0-9][a-z0-9-]*\/?$/i.test(pathname)
        || /^\/(?:about|latest|topics?|data|grapher|search|team|donate|faqs?|atom\.xml)\/?$/i.test(pathname)) return;
    }

    const author = entry.children("author, creator").first().text().trim()
      || entry.find("author > name").first().text().trim()
      || null;
    const rawDate = entry.children("pubDate, published, updated, date").first().text().trim();
    const timestamp = rawDate ? Date.parse(rawDate) : Number.NaN;
    const publishedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
    const id = createHash("sha256").update(`${source.id}\n${sourceUrl}`).digest("hex");
    const sourceName = source.name;
    candidates.push({
      id: `${source.kind}:${id}`,
      kind: source.kind,
      sourceId: source.id,
      sourceName,
      title: title.slice(0, 500),
      author: author?.slice(0, 300) ?? null,
      publishedAt,
      sourceUrl,
      discoveredAt,
      contentPolicy: source.contentPolicy,
    });
  });
  return candidates;
}

export function openLearnSourceName(title: string, rawUrl: string): string {
  let pathname = "";
  try { pathname = new URL(rawUrl).pathname; } catch { return "The Open University · OpenLearn"; }
  const normalizedTitle = title.toLowerCase();
  const football = /football|soccer|world cup|euros|fifa/i.test(normalizedTitle);
  if (/\/money-business\//.test(pathname)) return football ? "OpenLearn · 经济学与足球" : "OpenLearn · 经济学与金融";
  if (/\/education-development\//.test(pathname)) {
    return /personal development|self-development|motivation|resilience|confidence|career/i.test(normalizedTitle)
      ? "OpenLearn · 个人成长" : "OpenLearn · 教育与学习";
  }
  if (football) return "OpenLearn · 足球";
  if (/psycholog|mind|emotion|anxiety|memory|motivation|wellbeing|well-being/i.test(normalizedTitle)) return "OpenLearn · 心理学";
  return "OpenLearn · 心理与运动";
}

function candidateFromPage(source: DiscoveryFeedSource, title: string, rawUrl: string, discoveredAt: string, allowedHosts = source.allowedHosts): DiscoveryCandidate | null {
  const sourceUrl = canonicalUrl(rawUrl, allowedHosts);
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (!sourceUrl || !normalizedTitle || normalizedTitle.length > 500) return null;
  const id = createHash("sha256").update(`${source.id}\n${sourceUrl}`).digest("hex");
  return {
    id: `${source.kind}:${id}`, kind: source.kind, sourceId: source.id, sourceName: source.name,
    title: normalizedTitle, author: null, publishedAt: null, sourceUrl, discoveredAt,
    contentPolicy: source.contentPolicy,
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    return `${error.message}${code ? ` (${code})` : ` (${cause.message})`}`;
  }
  return error.message;
}

export function parseHtmlIndex(source: DiscoveryFeedSource, html: string, indexUrl: string, discoveredAt: string): DiscoveryCandidate[] {
  const $ = load(html);
  const candidates: DiscoveryCandidate[] = [];
  $("a[href]").each((_index, element) => {
    if (candidates.length >= MAX_ITEMS_PER_SOURCE) return;
    const link = $(element);
    const href = link.attr("href") ?? "";
    let url: string | null;
    try { url = canonicalUrl(new URL(href, indexUrl).toString(), source.allowedHosts); }
    catch { return; }
    if (!url || url === canonicalUrl(indexUrl, source.allowedHosts)) return;
    const pathname = new URL(url).pathname.toLowerCase();
    let title = link.find("h1,h2,h3,h4").first().text().trim()
      || link.attr("title") || link.attr("aria-label") || link.text() || link.find("img").first().attr("alt") || "";
    title = title.replace(/\s+/g, " ").trim();
    if (!title || title.length < 8 || /^(explore|play|do|view|learn more|read more)$/i.test(title)) return;
    if (source.id === "nasa-space-place") {
      if (!/^\/[a-z0-9-]+\/en\/$/.test(pathname) || /\/\d{4}\//.test(pathname)) return;
    } else if (source.id === "openlearn") {
      if (!/^\/openlearn\/(?:money-business|health-sports-psychology|education-development)\//.test(pathname)
        || /\/(?:all-content|altformat-printable|review|reviews|download)\/?$/.test(pathname)
        || /\/content-section-\d+\/(?:review|download)/.test(pathname)) return;
    } else if (!/\.htm$/.test(pathname) || !/\/learn\/kidsyouth\//.test(pathname) || /\/(?:aboutus|contact|privacy|accessibility|foia|notices)\//.test(pathname)) return;
    const candidate = candidateFromPage(source, title, url, discoveredAt);
    if (candidate && source.id === "openlearn") candidate.sourceName = openLearnSourceName(candidate.title, candidate.sourceUrl);
    if (candidate && !candidates.some((item) => item.id === candidate.id)) candidates.push(candidate);
  });
  return candidates;
}

async function readBoundedFeed(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_BYTES) {
    await response.body?.cancel();
    throw new Error("来源页面超过 2 MB 安全限制");
  }
  if (!response.body) throw new Error("来源没有返回 Feed 内容");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error("来源页面超过 2 MB 安全限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

async function sourceResponseError(response: Response): Promise<Error> {
  if (response.status === 403) {
    try {
      const body = await readBoundedFeed(response);
      if (/cloudflare|cf-chl|just a moment/i.test(body)) {
        return new Error("来源的 Cloudflare 自动访问检查拒绝了后台抓取（HTTP 403）");
      }
    } catch { /* Keep the HTTP status if the response body is unavailable or oversized. */ }
  }
  return new Error(`来源返回 HTTP ${response.status}`);
}

export class ContentDiscoveryService {
  private inFlight: Promise<ContentDiscoverySnapshot> | null = null;

  constructor(private readonly statePath: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async snapshot(): Promise<ContentDiscoverySnapshot> {
    return this.readSnapshot();
  }

  refresh(options: { force?: boolean } = {}): Promise<ContentDiscoverySnapshot> {
    if (this.inFlight) return this.inFlight;
    const promise = this.refreshOnce(options.force ?? false).finally(() => { this.inFlight = null; });
    this.inFlight = promise;
    return promise;
  }

  private async refreshOnce(force: boolean): Promise<ContentDiscoverySnapshot> {
    const previous = await this.readSnapshot();
    const lastAttempt = previous.lastAttemptAt ? Date.parse(previous.lastAttemptAt) : Number.NaN;
    const allSourcesHealthy = SOURCES.every((source) => previous.sources.find((result) => result.sourceId === source.id)?.status === "ok");
    if (!force && allSourcesHealthy && Number.isFinite(lastAttempt) && Date.now() - lastAttempt < DAILY_INTERVAL_MS) return previous;

    const checkedAt = new Date().toISOString();
    const results = await Promise.all(SOURCES.map((source) => this.fetchSource(source, checkedAt)));
    // Retired discovery sources are removed from the candidate cache; saved personal articles live separately and are preserved.
    const retiredSourceIds = new Set(["openlearn", "noaa-ocean-facts", "nasa-space-place", "nasa-climate-kids"]);
    const byId = new Map(previous.candidates.filter((candidate) => !retiredSourceIds.has(candidate.sourceId)).map((candidate) => [candidate.id, candidate]));
    const sourceResults = new Map(previous.sources.filter((result) => !retiredSourceIds.has(result.sourceId)).map((result) => [result.sourceId, result]));
    let anySucceeded = false;

    for (const result of results) {
      sourceResults.set(result.status.sourceId, result.status);
      if (result.status.status === "ok") {
        anySucceeded = true;
        const source = SOURCES.find((item) => item.id === result.status.sourceId)!;
        const previousSourceCandidates = new Map(
          [...byId.values()].filter((candidate) => candidate.sourceId === source.id).map((candidate) => [candidate.id, candidate]),
        );
        for (const [id, candidate] of byId) {
          if (candidate.sourceId === source.id) byId.delete(id);
        }
        for (const candidate of result.candidates) {
          const previousCandidate = previousSourceCandidates.get(candidate.id);
          byId.set(candidate.id, previousCandidate
            ? { ...candidate, discoveredAt: previousCandidate.discoveredAt }
            : candidate);
        }
      }
    }

    const candidates = [...byId.values()]
      .sort((left, right) => (right.publishedAt ?? right.discoveredAt).localeCompare(left.publishedAt ?? left.discoveredAt))
      .slice(0, MAX_STORED_CANDIDATES);
    const snapshot: ContentDiscoverySnapshot = {
      version: 1,
      refreshedAt: anySucceeded ? checkedAt : previous.refreshedAt,
      lastAttemptAt: checkedAt,
      candidates,
      sources: SOURCES.map((source) => sourceResults.get(source.id) ?? {
        sourceId: source.id,
        status: "error",
        checkedAt,
        candidateCount: 0,
        error: "没有收到来源结果",
      }),
    };
    await this.writeSnapshot(snapshot);
    return snapshot;
  }

  private async fetchSource(source: DiscoveryFeedSource, checkedAt: string): Promise<{
    status: DiscoverySourceResult;
    candidates: DiscoveryCandidate[];
  }> {
    try {
      if (source.mode === "html-index" || source.mode === "html-pages") {
        const urls = [...(source.indexUrls ?? [source.url]), ...(source.seedUrls ?? []).map((seed) => seed.url)];
        const outcomes = await Promise.all(urls.map(async (pageUrl) => {
          const response = await this.fetchImpl(pageUrl, {
            headers: { Accept: "text/html", "User-Agent": "MagazineReader/0.1 (local content discovery; https://github.com/zhangzhang88/magazine-reader)" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw await sourceResponseError(response);
          const html = await readBoundedFeed(response);
          if (source.mode === "html-index") {
            const seed = source.seedUrls?.find((item) => item.url === pageUrl);
            if (seed) {
              const $ = load(html);
              const pageTitle = $("main h1, h1").first().text().replace(/\s+/g, " ").trim();
              const title = pageTitle && !/^(?:earth|space place|nasa space place)$/i.test(pageTitle) ? pageTitle : seed.title;
              const hasArticleBody = Boolean(pageTitle) || $("main, article").length > 0;
              const candidate = hasArticleBody ? candidateFromPage(source, title, pageUrl, checkedAt) : null;
              return { candidates: candidate ? [candidate] : [], error: null };
            }
            return { candidates: parseHtmlIndex(source, html, pageUrl, checkedAt), error: null };
          }
          const $ = load(html);
          const pageTitle = $("main h1, #nps-main h1, h1").first().text().replace(/\s+/g, " ").trim();
          const title = source.id === "bitcoin-org" ? "Bitcoin FAQ: Answers to common questions" : pageTitle;
          const candidate = candidateFromPage(source, title, pageUrl, checkedAt);
          return { candidates: candidate ? [candidate] : [], error: null };
        }).map((request) => request.catch((error: unknown) => ({ candidates: [], error }))));
        const candidates = [...new Map(outcomes.flatMap((outcome) => outcome.candidates).map((candidate) => [candidate.id, candidate])).values()].slice(0, MAX_ITEMS_PER_SOURCE);
        const failed = outcomes.find((outcome) => outcome.error)?.error;
        if (candidates.length === 0) {
          const detail = failed ? `：${errorMessage(failed)}` : "";
          throw new Error(`没有发现符合规则的文章页面${detail}`);
        }
        return { status: { sourceId: source.id, status: failed ? "error" : "ok", checkedAt, candidateCount: candidates.length, ...(failed ? { error: errorMessage(failed).slice(0, 500) } : {}) }, candidates };
      }
      const response = await this.fetchImpl(source.url, {
        headers: {
          Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
          "User-Agent": "MagazineReader/0.1 (local content discovery; https://github.com/zhangzhang88/magazine-reader)",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw await sourceResponseError(response);
      const xml = await readBoundedFeed(response);
      const candidates = parseFeed(source, xml, checkedAt);
      if (source.id === "our-world-in-data" && source.seedUrls?.length) {
        const seeded = await Promise.all(source.seedUrls.map(async (seed) => {
          try {
            const page = await this.fetchImpl(seed.url, {
              headers: { Accept: "text/html", "User-Agent": "MagazineReader/0.1 (local content discovery; https://github.com/zhangzhang88/magazine-reader)" },
              signal: AbortSignal.timeout(15_000),
            });
            if (!page.ok) throw await sourceResponseError(page);
            const html = await readBoundedFeed(page);
            const $ = load(html);
            const title = $("main h1, article h1, h1").first().text().replace(/\s+/g, " ").trim() || seed.title;
            return candidateFromPage(source, title, seed.url, checkedAt);
          } catch { return null; }
        }));
        for (const candidate of seeded) {
          if (candidates.length >= MAX_ITEMS_PER_SOURCE) break;
          if (candidate && !candidates.some((item) => item.id === candidate.id)) candidates.push(candidate);
        }
      }
      return {
        status: { sourceId: source.id, status: "ok", checkedAt, candidateCount: candidates.length },
        candidates,
      };
    } catch (error) {
      const message = errorMessage(error);
      return {
        status: {
          sourceId: source.id,
          status: "error",
          checkedAt,
          candidateCount: 0,
          error: message.slice(0, 500),
        },
        candidates: [],
      };
    }
  }

  private async readSnapshot(): Promise<ContentDiscoverySnapshot> {
    try {
      const text = await readFile(this.statePath, "utf8");
      const value = JSON.parse(text) as Partial<ContentDiscoverySnapshot>;
      if (value.version !== 1 || !Array.isArray(value.candidates) || !Array.isArray(value.sources)) {
        throw new Error("内容发现缓存格式无效");
      }
      return {
        version: 1,
        refreshedAt: typeof value.refreshedAt === "string" ? value.refreshedAt : null,
        lastAttemptAt: typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
        candidates: value.candidates as DiscoveryCandidate[],
        sources: value.sources as DiscoverySourceResult[],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
      throw error;
    }
  }

  private async writeSnapshot(snapshot: ContentDiscoverySnapshot): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.statePath);
  }
}
