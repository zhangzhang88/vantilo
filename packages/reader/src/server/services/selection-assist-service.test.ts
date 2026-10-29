import { describe, expect, it, vi } from "vitest";
import {
  createEasyCLIProxySelectionAssistProvider,
  EasyCLIProxySelectionAssistProvider,
} from "./selection-assist-service.js";

describe("selection assist service", () => {
  it("translates selected text using its exact article context", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      expect(body.instructions).toContain("Translate only the selected English text");
      expect(body.input).toContain("The trickle-down economics of the AI boom");
      expect(body.input).toContain("riding a wave of investment");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer local-test-key" });
      return new Response(JSON.stringify({ output_text: "乘着一波投资热潮" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new EasyCLIProxySelectionAssistProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.assist({
      action: "translate",
      text: "riding a wave of investment",
      context: "Taiwan's economy has been riding a wave of investment in artificial intelligence.",
      articleTitle: "The trickle-down economics of the AI boom",
    })).resolves.toEqual({
      action: "translate",
      result: "乘着一波投资热潮",
      model: "gpt-6-luna",
      provider: "easycliproxy",
    });
  });

  it("uses a concise contextual prompt for explain", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toContain("Explain in concise Simplified Chinese");
      expect(body.instructions).toContain("one to three short Chinese sentences");
      return new Response(JSON.stringify({ output_text: "这里指投资热潮正在推动经济增长。" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = new EasyCLIProxySelectionAssistProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await provider.assist({ action: "explain", text: "riding a wave", context: "Context." });
    expect(result.action).toBe("explain");
    expect(result.result).toContain("投资热潮");
  });

  it("returns no provider when the local API key is not configured", () => {
    expect(createEasyCLIProxySelectionAssistProvider({})).toBeNull();
  });
});
