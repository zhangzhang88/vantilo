import { describe, expect, it, vi } from "vitest";
import type { Article } from "../../shared/types.js";
import {
  createEasyCLIProxyReaderGuideProvider,
  EasyCLIProxyReaderGuideProvider,
  parseReaderGuideResponse,
} from "./reader-guide-service.js";

const article = (id: string): Article => ({
  id,
  issueId: "economist:2026-09-19",
  publicationId: "economist",
  href: `${id}.xhtml`,
  section: "Finance & economics",
  kicker: null,
  title: "The trickle-down economics of the AI boom",
  subtitle: "How fast are AI investments translating into broader gains?",
  author: "A Writer",
  publishedAt: null,
  sourceUrl: null,
  bodyText: "The article examines how an AI investment boom may spread through the wider economy and what evidence would show broader gains.",
  wordCount: 120,
  status: null,
  analysis: null,
});

describe("reader guide service", () => {
  it("parses a strict bilingual guide response", () => {
    // Complete responses remain the normal path; partial responses are tested separately below.
    const guides = parseReaderGuideResponse(JSON.stringify([{
      id: "a1",
      titleZh: "AI 热潮的涓滴经济学",
      subtitleZh: "AI 投资多快能转化为更广泛的收益？",
      summaryZh: "文章讨论 AI 投资热潮是否正在向更广泛的经济领域传导，并观察哪些迹象能证明收益不只停留在科技公司。",
    }]), [article("a1")], "gpt-6-luna", "2026-09-21T00:00:00.000Z");

    expect(guides.get("a1")).toMatchObject({
      titleZh: "AI 热潮的涓滴经济学",
      provider: "easycliproxy",
      model: "gpt-6-luna",
    });
  });

  it("keeps valid guides when a batch response omits another requested article", () => {
    const guides = parseReaderGuideResponse(JSON.stringify([{
      id: "a1",
      titleZh: "第一篇中文标题",
      subtitleZh: null,
      summaryZh: "第一篇文章的中文摘要。第二句继续帮助读者判断是否阅读。",
    }]), [article("a1"), article("a2")], "gpt-6-luna", "2026-09-23T00:00:00.000Z");

    expect(guides.get("a1")?.titleZh).toBe("第一篇中文标题");
    expect(guides.has("a2")).toBe(false);
  });

  it("sends article text to EasyCLIProxyAPI and returns guides", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      expect(body.input).toContain("trickle-down economics");
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify([{
          id: "a1",
          titleZh: "AI 热潮的涓滴经济学",
          subtitleZh: "AI 投资多快能转化为更广泛的收益？",
          summaryZh: "文章讨论 AI 投资如何向更广泛的经济领域传导。它关注普通家庭和其他行业是否真正分享到收益。",
        }]) }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new EasyCLIProxyReaderGuideProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const guides = await provider.generate([article("a1")]);
    expect(guides.get("a1")?.summaryZh).toContain("更广泛的经济领域");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("builds the same guide request for non-Economist publications and translates a displayed kicker", async () => {
    const newYorkerArticle: Article = {
      ...article("ny1"),
      issueId: "new-yorker:2026-09-21",
      publicationId: "new-yorker",
      section: "The Critics",
      kicker: "Books",
      title: "A New Yorker story",
      subtitle: null,
      bodyText: "A review considers a new book and explains the questions it raises for readers.",
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input);
      expect(body.instructions).toContain("English-language magazines");
      expect(input[0]).toMatchObject({
        publication: "The New Yorker",
        section: "The Critics",
        title: "A New Yorker story",
        subtitle: "Books",
      });
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify([{
          id: "ny1",
          titleZh: "一篇《纽约客》文章",
          subtitleZh: "书评",
          summaryZh: "文章评介一本新书，并梳理它向读者提出的核心问题。第二句话继续帮助读者判断是否值得阅读。",
        }]) }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new EasyCLIProxyReaderGuideProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const guides = await provider.generate([newYorkerArticle]);
    expect(guides.get("ny1")).toMatchObject({
      titleZh: "一篇《纽约客》文章",
      subtitleZh: "书评",
    });
  });

  it("returns no provider without the local API key", () => {
    expect(createEasyCLIProxyReaderGuideProvider({})).toBeNull();
  });
});
