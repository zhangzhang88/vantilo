import { describe, expect, it, vi } from "vitest";
import {
  EasyCLIProxyReadingAssistantProvider,
  READING_ASSISTANT_DEEP_MODEL,
  READING_ASSISTANT_QUICK_MODEL,
} from "./reading-assistant-service.js";

describe("reading assistant service", () => {
  it("labels canonical Book Chapter paragraphs without claiming they are a magazine article", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toContain("supplied book chapter only");
      expect(body.input).toContain("Book: Fixture Book");
      expect(body.input).toContain("Chapter title: Chapter One");
      expect(body.input).toContain("Chapter:\n[P1] Canonical chapter paragraph.");
      expect(body.input).not.toContain("Publication:");
      return new Response(JSON.stringify({ output_text: JSON.stringify({ answer: "章节摘要。", paragraphs: [1] }) }), { status: 200 });
    });
    const provider = new EasyCLIProxyReadingAssistantProvider({ endpoint: "http://127.0.0.1:8317/v1/responses", apiKey: "local-test-key", fetchImpl: fetchImpl as typeof fetch });
    await expect(provider.assist({ sourceKind: "book-chapter", question: "概述本章", mode: "quick", publicationName: "Fixture Book", articleTitle: "Chapter One", paragraphs: ["Canonical chapter paragraph."] })).resolves.toMatchObject({ answer: "章节摘要。", paragraphIndexes: [0] });
  });

  it("uses Luna for quick article questions and returns verified paragraph indexes", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(READING_ASSISTANT_QUICK_MODEL);
      expect(body.instructions).toContain("supplied article only");
      expect(body.input).toContain("Current reading paragraph: P2");
      expect(body.input).toContain("[P1] First paragraph.");
      expect(body.input).toContain("[P3] Third paragraph.");
      expect(body.input).toContain("Reader: Earlier question");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer local-test-key" });
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ answer: "核心观点在第一和第三段。[P1][P3]", paragraphs: [1, 3, 99, 3] }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new EasyCLIProxyReadingAssistantProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.assist({
      question: "核心观点是什么？",
      mode: "quick",
      publicationName: "The Economist",
      articleTitle: "A test article",
      articleSubtitle: "A deck",
      paragraphs: ["First paragraph.", "Second paragraph.", "Third paragraph."],
      currentParagraphIndex: 1,
      history: [{ role: "user", text: "Earlier question" }],
    })).resolves.toEqual({
      answer: "核心观点在第一和第三段。",
      paragraphIndexes: [0, 2],
      mode: "quick",
      model: "gpt-6-luna",
      provider: "easycliproxy",
    });
  });

  it("uses Sol for deep analysis", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(READING_ASSISTANT_DEEP_MODEL);
      expect(body.instructions).toContain("deep analysis");
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ answer: "作者的论证有一个隐含前提。", paragraphs: [2] }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new EasyCLIProxyReadingAssistantProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await provider.assist({
      question: "分析作者的隐含前提。",
      mode: "deep",
      publicationName: "The New Yorker",
      articleTitle: "A test article",
      paragraphs: ["First paragraph.", "Second paragraph."],
    });
    expect(result.model).toBe("gpt-6-sol");
    expect(result.paragraphIndexes).toEqual([1]);
  });

  it("cleans malformed fallback output and recovers paragraph references instead of leaking JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output_text: '作者先说明房价可能下跌。[P2][P3]\n\n最后补充限制条件。[P6]","paragraphs":[2,3,6]}',
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new EasyCLIProxyReadingAssistantProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.assist({
      question: "作者怎么论证？",
      mode: "quick",
      publicationName: "The Economist",
      articleTitle: "A test article",
      paragraphs: ["P1", "P2", "P3", "P4", "P5", "P6"],
    })).resolves.toMatchObject({
      answer: "作者先说明房价可能下跌。\n\n最后补充限制条件。",
      paragraphIndexes: [1, 2, 5],
    });
  });
});
