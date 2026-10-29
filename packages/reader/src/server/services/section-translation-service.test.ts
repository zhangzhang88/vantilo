import { describe, expect, it, vi } from "vitest";
import {
  createEasyCLIProxySectionTranslationProvider,
  EasyCLIProxySectionTranslationProvider,
  parseSectionTranslationResponse,
} from "./section-translation-service.js";

describe("section translation service", () => {
  it("parses strict section translations", () => {
    const parsed = parseSectionTranslationResponse(JSON.stringify([
      { section: "New Ideas", sectionZh: "新思想" },
      { section: "Field Notes", sectionZh: "现场笔记" },
    ]), ["New Ideas", "Field Notes"]);
    expect(parsed.get("New Ideas")).toBe("新思想");
    expect(parsed.get("Field Notes")).toBe("现场笔记");
  });

  it("includes publication context and returns reusable labels", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      expect(body.instructions).toContain("The New Yorker");
      expect(JSON.parse(body.input)).toEqual([{ section: "Future Desk" }]);
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify([
          { section: "Future Desk", sectionZh: "未来栏目" },
        ]) }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new EasyCLIProxySectionTranslationProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.translate("new-yorker", ["Future Desk"]);
    expect(result.get("Future Desk")).toBe("未来栏目");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns no provider without the local API key", () => {
    expect(createEasyCLIProxySectionTranslationProvider({})).toBeNull();
  });
});
