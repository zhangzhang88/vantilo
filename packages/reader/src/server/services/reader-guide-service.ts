import type { Article, ReaderGuide } from "../../shared/types.js";
import { PUBLICATIONS } from "../../shared/publication.js";
import { extractResponseText } from "./translation-service.js";

export interface ReaderGuideProvider {
  generate(articles: Article[]): Promise<Map<string, ReaderGuide>>;
}

export interface EasyCLIProxyReaderGuideOptions {
  endpoint: string;
  model: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface ResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string } | null;
}

interface RawGuide {
  id?: unknown;
  titleZh?: unknown;
  subtitleZh?: unknown;
  summaryZh?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function jsonArrayFromText(text: string): unknown[] {
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Reader guide response is not a JSON array");
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Reader guide response is not a JSON array");
  return parsed;
}

export function parseReaderGuideResponse(
  text: string,
  articles: Article[],
  model: string,
  generatedAt = new Date().toISOString(),
): Map<string, ReaderGuide> {
  const allowed = new Set(articles.map((article) => article.id));
  const rows = jsonArrayFromText(text) as RawGuide[];
  const guides = new Map<string, ReaderGuide>();

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    const titleZh = typeof row.titleZh === "string" ? row.titleZh.trim() : "";
    const summaryZh = typeof row.summaryZh === "string" ? row.summaryZh.trim() : "";
    const subtitleZh = row.subtitleZh === null
      ? null
      : typeof row.subtitleZh === "string" && row.subtitleZh.trim()
        ? row.subtitleZh.trim()
        : null;
    if (!allowed.has(id) || !titleZh || !summaryZh) continue;
    guides.set(id, {
      titleZh,
      subtitleZh,
      summaryZh,
      model,
      provider: "easycliproxy",
      generatedAt,
    });
  }

  return guides;
}

export class EasyCLIProxyReaderGuideProvider implements ReaderGuideProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EasyCLIProxyReaderGuideOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(articles: Article[]): Promise<Map<string, ReaderGuide>> {
    if (!articles.length) return new Map();
    const input = articles.map((article) => ({
      id: article.id,
      publication: PUBLICATIONS[article.publicationId].name,
      section: article.section,
      title: article.title,
      subtitle: article.subtitle ?? article.kicker,
      articleText: article.bodyText.slice(0, 5000),
    }));

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions: [
          "You create bilingual navigation aids for a Chinese reader of English-language magazines, including The Economist, The New Yorker, The Atlantic and Wired.",
          "For every supplied article, translate the English title into natural, faithful Simplified Chinese while preserving the publication's framing.",
          "Translate the supplied subtitle or kicker when one is supplied; otherwise return null.",
          "Write a concise 2-3 sentence Simplified Chinese summary explaining what the article is about so a reader can decide whether to read it.",
          "Base the summary only on the supplied title, subtitle and article text. Do not add outside facts, opinions, recommendations or invented details.",
          "Preserve names, numbers, uncertainty and the article's framing.",
          "Return only a JSON array. Every item must contain exactly: id, titleZh, subtitleZh, summaryZh.",
          "Return exactly one item for every supplied id. Never omit an article, merge two articles, or change an id.",
        ].join(" "),
        input: JSON.stringify(input),
      }),
    });

    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || `EasyCLIProxyAPI reader-guide request failed (${response.status})`);
    }
    const output = extractResponseText(payload);
    if (!output) throw new Error("EasyCLIProxyAPI returned no reader-guide text");
    return parseReaderGuideResponse(output, articles, this.model);
  }
}

export function createEasyCLIProxyReaderGuideProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReaderGuideProvider | null {
  const apiKey = env.EASYCLIPROXY_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = normalizeBaseUrl(env.EASYCLIPROXY_BASE_URL?.trim() || "http://127.0.0.1:8317/v1");
  const model = env.EASYCLIPROXY_MODEL?.trim() || "gpt-6-luna";
  return new EasyCLIProxyReaderGuideProvider({
    endpoint: `${baseUrl}/responses`,
    model,
    apiKey,
  });
}
