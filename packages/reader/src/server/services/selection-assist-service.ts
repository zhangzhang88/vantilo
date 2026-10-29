import type {
  SelectionAssistRequest,
  SelectionAssistResponse,
} from "../../shared/types.js";
import { extractResponseText } from "./translation-service.js";

export interface SelectionAssistProvider {
  assist(request: SelectionAssistRequest): Promise<SelectionAssistResponse>;
}

export interface EasyCLIProxySelectionAssistOptions {
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

export class EasyCLIProxySelectionAssistProvider implements SelectionAssistProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EasyCLIProxySelectionAssistOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async assist(request: SelectionAssistRequest): Promise<SelectionAssistResponse> {
    const text = request.text.trim();
    if (!text) throw new Error("Selected text is empty");

    const context = [
      request.articleTitle?.trim() ? `Article title:\n${request.articleTitle.trim()}` : null,
      request.context?.trim() ? `Paragraph context:\n${request.context.trim()}` : null,
      `Selected text:\n${text}`,
    ].filter(Boolean).join("\n\n");

    const instructions = request.action === "translate"
      ? [
          "You are assisting a Chinese learner reading The Economist.",
          "Translate only the selected English text into natural, accurate Simplified Chinese.",
          "Use the article title and paragraph only to resolve meaning and ambiguity.",
          "For a word or phrase, return its concise meaning in this exact context; for a sentence, return a natural sentence translation.",
          "Do not add grammar lessons, commentary or outside facts.",
          "Return only the Chinese translation.",
        ].join(" ")
      : [
          "You are assisting a Chinese learner reading The Economist.",
          "Explain in concise Simplified Chinese what the selected English word, phrase or sentence means in this exact context.",
          "Focus on contextual meaning and, when useful, the expression or usage that makes it hard to understand.",
          "Do not turn this into a long grammar lesson and do not add outside facts.",
          "Use one to three short Chinese sentences.",
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
        input: context,
      }),
    });

    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || `EasyCLIProxyAPI request failed (${response.status})`);
    }

    const result = extractResponseText(payload);
    if (!result) throw new Error("EasyCLIProxyAPI returned no selection-assist text");

    return {
      action: request.action,
      result,
      model: this.model,
      provider: "easycliproxy",
    };
  }
}

export function createEasyCLIProxySelectionAssistProvider(
  env: NodeJS.ProcessEnv = process.env,
): SelectionAssistProvider | null {
  const apiKey = env.EASYCLIPROXY_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = normalizeBaseUrl(env.EASYCLIPROXY_BASE_URL?.trim() || "http://127.0.0.1:8317/v1");
  const model = env.EASYCLIPROXY_MODEL?.trim() || "gpt-6-luna";
  return new EasyCLIProxySelectionAssistProvider({
    endpoint: `${baseUrl}/responses`,
    model,
    apiKey,
  });
}
