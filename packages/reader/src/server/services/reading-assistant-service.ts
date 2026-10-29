import type {
  ReadingAssistantMode,
  ReadingAssistantResponse,
  ReadingAssistantTurn,
} from "../../shared/types.js";
import { extractResponseText } from "./translation-service.js";
import { normalizeReadingAssistantAnswer } from "../../shared/reading-assistant-answer.js";

export interface ReadingAssistantContextRequest {
  sourceKind?: "article" | "book-chapter" | "book-lesson";
  question: string;
  mode: ReadingAssistantMode;
  publicationName: string;
  articleTitle: string;
  articleSubtitle?: string | null;
  paragraphs: string[];
  currentParagraphIndex?: number;
  history?: ReadingAssistantTurn[];
}

export interface ReadingAssistantProvider {
  assist(request: ReadingAssistantContextRequest): Promise<ReadingAssistantResponse>;
}

export interface EasyCLIProxyReadingAssistantOptions {
  endpoint: string;
  apiKey: string;
  quickModel?: string;
  deepModel?: string;
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

interface StructuredAnswer {
  answer?: unknown;
  paragraphs?: unknown;
}

export const READING_ASSISTANT_QUICK_MODEL = "gpt-6-luna";
export const READING_ASSISTANT_DEEP_MODEL = "gpt-6-sol";
const MAX_ARTICLE_CONTEXT_CHARS = 180_000;
const MAX_HISTORY_TURNS = 8;

function numberedArticle(paragraphs: string[]): string {
  const full = paragraphs.map((paragraph, index) => `[P${index + 1}] ${paragraph}`).join("\n\n");
  if (full.length <= MAX_ARTICLE_CONTEXT_CHARS) return full;
  return `${full.slice(0, MAX_ARTICLE_CONTEXT_CHARS)}\n\n[Article context truncated by the reader.]`;
}

function conversationHistory(history: ReadingAssistantTurn[] | undefined): string {
  const turns = (history ?? []).slice(-MAX_HISTORY_TURNS);
  if (!turns.length) return "None.";
  return turns.map((turn) => `${turn.role === "user" ? "Reader" : "Assistant"}: ${turn.text.trim()}`).join("\n");
}

function parseStructuredAnswer(text: string, paragraphCount: number): { answer: string; paragraphIndexes: number[] } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as StructuredAnswer;
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const paragraphIndexes = Array.isArray(parsed.paragraphs)
      ? [...new Set(parsed.paragraphs
          .filter((value): value is number => Number.isInteger(value))
          .map((value) => value - 1)
          .filter((value) => value >= 0 && value < paragraphCount))].slice(0, 8)
      : [];
    if (answer) return normalizeReadingAssistantAnswer({ text: answer, paragraphCount, paragraphIndexes });
  } catch {
    // Fall back to plain text if a compatible Responses endpoint ignores the JSON-only instruction.
  }
  return normalizeReadingAssistantAnswer({ text: cleaned, paragraphCount });
}

export class EasyCLIProxyReadingAssistantProvider implements ReadingAssistantProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly quickModel: string;
  private readonly deepModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EasyCLIProxyReadingAssistantOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.quickModel = options.quickModel ?? READING_ASSISTANT_QUICK_MODEL;
    this.deepModel = options.deepModel ?? READING_ASSISTANT_DEEP_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async assist(request: ReadingAssistantContextRequest): Promise<ReadingAssistantResponse> {
    const question = request.question.trim();
    if (!question) throw new Error("Reading assistant question is empty");
    if (!request.paragraphs.length) throw new Error("Reading assistant article has no readable paragraphs");
    const model = request.mode === "deep" ? this.deepModel : this.quickModel;
    const currentParagraph = request.currentParagraphIndex === undefined
      ? "Not specified."
      : `P${request.currentParagraphIndex + 1}`;
    const sourceName = request.sourceKind === "book-lesson" ? "saved AI-adapted English lesson (not a verbatim book chapter)" : request.sourceKind === "book-chapter" ? "book chapter" : "article";
    const instructions = [
      "You are an AI reading assistant for a Chinese reader.",
      `Answer in clear Simplified Chinese and base the answer on the supplied ${sourceName} only.`,
      `Do not invent outside facts. If the ${sourceName} does not support a claim, say so explicitly.`,
      "Paragraph markers [P#] are authoritative source locations.",
      request.mode === "deep"
        ? `This is deep analysis: explain the argument structure, evidence, assumptions, tensions or plausible counterarguments when relevant, while clearly separating ${sourceName} claims from your own analysis.`
        : `This is quick reading help: be concise, concrete and useful for understanding the ${sourceName}.`,
      "Return only one JSON object with exactly this shape: {\"answer\":\"Chinese answer\",\"paragraphs\":[1,2]}.",
      "The paragraphs array must contain only 1-based paragraph numbers that materially support the answer, with at most 8 entries.",
      "Do not put [P#] markers, the paragraphs array, or any JSON syntax inside the answer string; source locations belong only in the separate paragraphs field.",
    ].join(" ");
    const input = [
      `${request.sourceKind === "book-chapter" ? "Book" : "Publication"}: ${request.publicationName}`,
      `${request.sourceKind === "book-chapter" ? "Chapter" : "Article"} title: ${request.articleTitle}`,
      request.articleSubtitle?.trim() ? `Article subtitle: ${request.articleSubtitle.trim()}` : null,
      `Current reading paragraph: ${currentParagraph}`,
      `Conversation history:\n${conversationHistory(request.history)}`,
      `Reader question:\n${question}`,
      `${request.sourceKind === "book-chapter" ? "Chapter" : "Article"}:\n${numberedArticle(request.paragraphs)}`,
    ].filter(Boolean).join("\n\n");

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, instructions, input }),
      signal: AbortSignal.timeout(request.mode === "deep" ? 90_000 : 60_000),
    });
    const payload = await response.json().catch(() => null) as ResponsesPayload | null;
    if (!response.ok) {
      throw new Error(payload?.error?.message || `EasyCLIProxyAPI request failed (${response.status})`);
    }
    const text = extractResponseText(payload ?? {});
    if (!text) throw new Error("EasyCLIProxyAPI returned no reading-assistant text");
    const parsed = parseStructuredAnswer(text, request.paragraphs.length);
    if (!parsed.answer) throw new Error("EasyCLIProxyAPI returned an empty reading-assistant answer");
    return {
      ...parsed,
      mode: request.mode,
      model,
      provider: "easycliproxy",
    };
  }
}
