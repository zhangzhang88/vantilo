import { PUBLICATIONS } from "../../shared/publication.js";
import type { PublicationId } from "../../shared/types.js";
import { extractResponseText } from "./translation-service.js";

export interface SectionTranslationProvider {
  translate(publicationId: PublicationId, sections: string[]): Promise<Map<string, string>>;
}

export interface EasyCLIProxySectionTranslationOptions {
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

interface RawSectionTranslation {
  section?: unknown;
  sectionZh?: unknown;
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
  if (start < 0 || end <= start) throw new Error("Section translation response is not a JSON array");
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Section translation response is not a JSON array");
  return parsed;
}

export function parseSectionTranslationResponse(text: string, sections: string[]): Map<string, string> {
  const allowed = new Set(sections);
  const translations = new Map<string, string>();
  for (const row of jsonArrayFromText(text) as RawSectionTranslation[]) {
    const section = typeof row.section === "string" ? row.section.trim() : "";
    const sectionZh = typeof row.sectionZh === "string" ? row.sectionZh.trim() : "";
    if (allowed.has(section) && sectionZh) translations.set(section, sectionZh);
  }
  const missing = sections.filter((section) => !translations.has(section));
  if (missing.length) throw new Error(`Section translation response omitted ${missing.length} section(s)`);
  return translations;
}

export class EasyCLIProxySectionTranslationProvider implements SectionTranslationProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EasyCLIProxySectionTranslationOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async translate(publicationId: PublicationId, sections: string[]): Promise<Map<string, string>> {
    if (!sections.length) return new Map();
    const publication = PUBLICATIONS[publicationId].name;
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions: [
          "Translate recurring editorial section names from an English-language magazine into stable, concise Simplified Chinese labels for a table of contents.",
          `The publication is ${publication}.`,
          "Preserve the editorial meaning rather than translating word-for-word when the section is an established magazine label.",
          "Use short, natural Chinese suitable for repeated reuse across future issues.",
          "Return only a JSON array. Every item must contain exactly: section, sectionZh.",
        ].join(" "),
        input: JSON.stringify(sections.map((section) => ({ section }))),
      }),
    });
    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || `EasyCLIProxyAPI section-translation request failed (${response.status})`);
    }
    const output = extractResponseText(payload);
    if (!output) throw new Error("EasyCLIProxyAPI returned no section-translation text");
    return parseSectionTranslationResponse(output, sections);
  }
}

export function createEasyCLIProxySectionTranslationProvider(
  env: NodeJS.ProcessEnv = process.env,
): SectionTranslationProvider | null {
  const apiKey = env.EASYCLIPROXY_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = normalizeBaseUrl(env.EASYCLIPROXY_BASE_URL?.trim() || "http://127.0.0.1:8317/v1");
  const model = env.EASYCLIPROXY_MODEL?.trim() || "gpt-6-luna";
  return new EasyCLIProxySectionTranslationProvider({
    endpoint: `${baseUrl}/responses`,
    model,
    apiKey,
  });
}
