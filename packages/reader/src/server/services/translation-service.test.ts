import { describe, expect, it, vi } from "vitest";
import {
  createEasyCLIProxyTranslationProvider,
  EasyCLIProxyTranslationProvider,
  extractResponseText,
} from "./translation-service.js";

describe("translation service", () => {
  it("extracts text from OpenAI Responses-compatible message output", () => {
    expect(extractResponseText({
      output: [{ type: "message", content: [{ type: "output_text", text: "中文翻译" }] }],
    })).toBe("中文翻译");
  });

  it("sends the target paragraph and context to EasyCLIProxyAPI", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      expect(body.input).toContain("Previous paragraph");
      expect(body.input).toContain("Target paragraph to translate");
      expect(body.input).toContain("Next paragraph");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer local-test-key" });
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "这是一段中文翻译。" }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new EasyCLIProxyTranslationProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await provider.translate({
      text: "Target text.",
      contextBefore: "Previous text.",
      contextAfter: "Next text.",
    });

    expect(result).toEqual({
      translation: "这是一段中文翻译。",
      model: "gpt-6-luna",
      provider: "easycliproxy",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns no provider when the local API key is not configured", () => {
    expect(createEasyCLIProxyTranslationProvider({})).toBeNull();
  });
  it("uses the containing paragraph for natural sentence translation and separates grounded phrase explanations", async () => {
    const text = "But we also help choose our own world.";
    const paragraphContext = "The people and places around us help shape our lives. " + text + " Think about your friends and your free time.";
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.input).toContain(paragraphContext);
      expect(body.input).toContain("Target sentence to translate");
      expect(body.instructions).toContain("Preserve hedges");
      expect(body.instructions).toContain("ONLY the target sentence");
      return new Response(JSON.stringify({ output_text: JSON.stringify({ translation: "但我们自己也会参与选择所处的生活环境。", expressions: [{ text: "help choose", meaningZh: "参与选择", explanationZh: "参与选择，对选择起一定作用。" }, { text: "our own world", explanationZh: "这里指自己所处的生活环境。" }, { text: "not in source", explanationZh: "should be filtered" }] }) }));
    });
    const provider = new EasyCLIProxyTranslationProvider({ endpoint: "https://fixture.invalid/responses", model: "fixture", apiKey: "synthetic", fetchImpl });
    const result = await provider.translate({ text, paragraphContext, mode: "sentence" });
    expect(result.translation).toBe("但我们自己也会参与选择所处的生活环境。");
    expect(result.expressions).toHaveLength(2);
    expect(result.expressions?.[0].text).toBe("help choose");
    expect(result.expressions?.[0].meaningZh).toBe("参与选择");
  });
  it("rejects malformed sentence JSON rather than showing it as a translation", async () => {
    for (const output_text of ["translation without structured fields", '{"translation":"译文"}', '{"translation":"","expressions":[]}']) {
      const provider = new EasyCLIProxyTranslationProvider({ endpoint: "https://fixture.invalid", model: "fixture", apiKey: "synthetic", fetchImpl: async () => new Response(JSON.stringify({ output_text })) });
      await expect(provider.translate({ text: "A sentence.", paragraphContext: "A sentence.", mode: "sentence" })).rejects.toThrow("格式不完整");
    }
  });

});

describe("meaningful expression selection", () => {
  const text = "We take an active part in making decisions, have an influence on others, and this does not mean genes decide everything.";
  async function translate(expressions: unknown[]) {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.instructions).toContain("Never meet a quota");
      expect(body.instructions).toContain("Reject arbitrary adjacent words");
      expect(body.instructions).toContain("at most one keyword");
      return new Response(JSON.stringify({ output_text: JSON.stringify({ translation: "我们积极参与选择，但基因不决定一切。", expressions }) }));
    });
    return new EasyCLIProxyTranslationProvider({ endpoint: "https://fixture.invalid", model: "fixture", apiKey: "fixture", fetchImpl }).translate({ text, mode: "sentence", paragraphContext: text });
  }
  const expression = (text: string, kind: string) => ({ text, kind, meaningZh: "语境释义", explanationZh: "解释本句中的用法。" });
  it("retains four grounded classified expressions and limits the total", async () => {
    const result = await translate([
      expression("take an active part in", "collocation"),
      expression("have an influence on", "collocation"),
      expression("this does not mean", "pattern"),
      expression("genes", "keyword"),
      expression("making decisions", "contextual"),
    ]);
    expect(result.expressions).toHaveLength(4);
    expect(result.expressions?.map((item) => item.kind)).toEqual(["collocation", "collocation", "pattern", "keyword"]);
  });
  it("accepts no expressions without fabricating a minimum", async () => {
    expect((await translate([])).expressions).toEqual([]);
  });
  it("rejects duplicate extracts, word fragments, fabricated text and multiple keywords", async () => {
    const result = await translate([
      expression("take an active part in", "collocation"), expression("take an active part in", "collocation"),
      expression("active par", "contextual"), expression("active", "collocation"),
      expression("not present", "pattern"), expression("genes", "keyword"), expression("others", "keyword"),
    ]);
    expect(result.expressions?.map((item) => item.text)).toEqual(["take an active part in", "genes"]);
  });
});
