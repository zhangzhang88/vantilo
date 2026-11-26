import { describe, expect, it } from "vitest";
import { detectOfficialApiProvider, formatApiTargetHost } from "./custom-api-provider";

describe("custom-api-provider", () => {
  it("recognizes official DeepSeek and Gemini providers strictly by exact HTTPS origin", () => {
    expect(detectOfficialApiProvider("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(detectOfficialApiProvider("https://API.DEEPSEEK.COM/v1/chat/completions")).toBe("deepseek");
    expect(detectOfficialApiProvider("https://generativelanguage.googleapis.com/v1beta/openai")).toBe("gemini");
  });

  it("classifies relay paths, lookalike subdomains, non-HTTPS, custom ports, and userinfo URLs as custom", () => {
    expect(detectOfficialApiProvider("https://relay.example.com/api.deepseek.com/v1")).toBe("custom");
    expect(detectOfficialApiProvider("https://relay.example.com/?target=generativelanguage.googleapis.com")).toBe("custom");
    expect(detectOfficialApiProvider("https://api.deepseek.com.evil.example/v1")).toBe("custom");
    expect(detectOfficialApiProvider("https://evil.api.deepseek.com/v1")).toBe("custom");
    expect(detectOfficialApiProvider("http://api.deepseek.com/v1")).toBe("custom");
    expect(detectOfficialApiProvider("https://api.deepseek.com:8443/v1")).toBe("custom");
    expect(detectOfficialApiProvider("https://user@api.deepseek.com/v1")).toBe("custom");
    expect(detectOfficialApiProvider("not-a-url")).toBe("custom");
  });

  it("formats actual destination hosts for display next to API key inputs", () => {
    expect(formatApiTargetHost("https://api.deepseek.com/v1")).toBe("api.deepseek.com");
    expect(formatApiTargetHost("http://192.168.1.20:18437/v1/responses")).toBe("192.168.1.20:18437");
    expect(formatApiTargetHost("https://relay.example.com/api.deepseek.com/v1")).toBe("relay.example.com");
    expect(formatApiTargetHost("")).toBe("");
  });
});
