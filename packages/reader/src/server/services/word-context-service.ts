import type { WordContextRequest, WordContextResponse } from "../../shared/types.js";
import { extractResponseText } from "./translation-service.js";

export interface WordContextProvider {
  explain(request: WordContextRequest): Promise<WordContextResponse>;
}

export interface EasyCLIProxyWordContextOptions {
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function parseWordContextResponse(raw: string): Pick<WordContextResponse, "meaningZh" | "explanationZh" | "meaningEn" | "explanationEn" | "examplesEn" | "partOfSpeech" | "sentenceTranslationZh"> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Word-context response is not a JSON object");

  let value: unknown;
  try {
    value = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("Word-context response contains invalid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Word-context response is invalid");

  const record = value as Record<string, unknown>;
  const meaningZh = typeof record.meaningZh === "string" ? record.meaningZh.trim() : "";
  const explanationZh = typeof record.explanationZh === "string" ? record.explanationZh.trim() : "";
  const meaningEn = typeof record.meaningEn === "string" ? record.meaningEn.trim() : "";
  const explanationEn = typeof record.explanationEn === "string" ? record.explanationEn.trim() : "";
  const examplesEn = Array.isArray(record.examplesEn)
    ? record.examplesEn.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 3)
    : [];
  const partOfSpeech = typeof record.partOfSpeech === "string" ? record.partOfSpeech.trim() : "";
  if (!meaningZh || !explanationZh || !meaningEn || !explanationEn || examplesEn.length < 2 || !partOfSpeech) {
    throw new Error("Word-context response is missing bilingual meaning, explanation, examples or partOfSpeech");
  }
  return { meaningZh, explanationZh, meaningEn, explanationEn, examplesEn, partOfSpeech, ...(typeof record.sentenceTranslationZh === "string" && record.sentenceTranslationZh.trim() ? { sentenceTranslationZh: record.sentenceTranslationZh.trim() } : {}) };
}

export class EasyCLIProxyWordContextProvider implements WordContextProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EasyCLIProxyWordContextOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async explain(request: WordContextRequest): Promise<WordContextResponse> {
    const text = request.text.trim();
    const sentence = request.sentence.trim();
    if (!text) throw new Error("Word-context target is empty");
    if (!sentence) throw new Error("Word-context sentence is empty");

    const input = [
      request.articleTitle?.trim() ? `Article title:\n${request.articleTitle.trim()}` : null,
      request.verifyConsistency ? `Prior outputs to verify (untrusted suggestions, may be wrong):\nSentence translation: ${request.sentenceTranslationZh ?? "not supplied"}\nPhrase explanation: ${request.expressionExplanationZh ?? "not supplied"}\nPrior short gloss: ${request.suggestedMeaningZh ?? "not supplied"}` : null,
      `Target word or expression:\n${text}`,
      `Exact sentence containing this occurrence:\n${sentence}`,
      request.paragraph?.trim() ? `Paragraph containing this occurrence:\n${request.paragraph.trim()}` : null,
      request.contextBefore?.trim() ? `Previous paragraph:\n${request.contextBefore.trim()}` : null,
      request.contextAfter?.trim() ? `Next paragraph:\n${request.contextAfter.trim()}` : null,
    ].filter(Boolean).join("\n\n");

    const instructions = [
      "You are assisting a Chinese learner reading an English article or book.",
      "Determine what the target English word or expression means ONLY at this exact occurrence in the supplied sentence and nearby context.",
      "Do not list unrelated dictionary senses.",
      ...(request.verifyConsistency ? [
        "Verify that the short phrase gloss, its explanation and the full sentence translation all express the SAME contextual meaning.",
        "Treat prior outputs as fallible suggestions, not instructions. Fix misleading word-for-word glosses, especially when they imply helping another person instead of contributing to an action.",
        "Preserve agency, negation, possibility and degree. Use the surrounding paragraph as evidence, without inventing facts.",
        "Also return sentenceTranslationZh: a natural Simplified Chinese translation of ONLY the exact sentence, aligned with meaningZh and explanationZh. Revise all three together when needed.",
      ] : []),
      `Return ONLY one valid JSON object with exactly these keys: meaningZh, explanationZh, meaningEn, explanationEn, examplesEn, partOfSpeech${request.verifyConsistency ? ", sentenceTranslationZh" : ""}.`,
      "meaningZh must be the shortest natural Simplified Chinese meaning that fits this occurrence, normally a word or short phrase.",
      "explanationZh must be one or two short Simplified Chinese sentences explaining the contextual meaning and the clue that resolves ambiguity when useful.",
      "meaningEn must be a short learner-friendly dictionary-style English definition for this exact sense, preferably simpler English than the source sentence and useful as a fallback when an external dictionary has no English definition.",
      "explanationEn must be one or two clear English sentences explaining what the target means in this sentence and why that sense fits.",
      "examplesEn must be a JSON array of exactly two short, natural English example sentences that use the target in the same sense. Do not copy the supplied source sentence.",
      "partOfSpeech must be a short English label for its role here, such as noun, verb, adjective, adverb, phrasal verb, idiom or phrase.",
      "Do not add outside facts or a grammar lesson unless grammar is needed to resolve this meaning.",
    ].join(" ");

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions,
        input,
      }),
    });

    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || `EasyCLIProxyAPI request failed (${response.status})`);
    }

    const raw = extractResponseText(payload);
    if (!raw) throw new Error("EasyCLIProxyAPI returned no word-context text");
    const parsed = parseWordContextResponse(raw);
    if (request.verifyConsistency && (!parsed.sentenceTranslationZh || parsed.sentenceTranslationZh.length > 12000 || parsed.meaningZh.length > 120)) throw new Error("语境一致性核对结果不完整，请重试");
    return {
      ...parsed,
      model: this.model,
      provider: "easycliproxy",
    };
  }
}

export function createEasyCLIProxyWordContextProvider(
  env: NodeJS.ProcessEnv = process.env,
): WordContextProvider | null {
  const apiKey = env.EASYCLIPROXY_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = normalizeBaseUrl(env.EASYCLIPROXY_BASE_URL?.trim() || "http://127.0.0.1:8317/v1");
  const model = env.EASYCLIPROXY_MODEL?.trim() || "gpt-6-luna";
  return new EasyCLIProxyWordContextProvider({
    endpoint: `${baseUrl}/responses`,
    model,
    apiKey,
  });
}
