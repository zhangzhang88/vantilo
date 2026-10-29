import { describe, expect, it, vi } from "vitest";
import {
  createEasyCLIProxyWordContextProvider,
  EasyCLIProxyWordContextProvider,
  parseWordContextResponse,
} from "./word-context-service.js";

describe("word context service", () => {
  it("parses a strict contextual-meaning JSON response", () => {
    expect(parseWordContextResponse("```json\n{\"meaningZh\":\"河岸\",\"explanationZh\":\"这里指河边的岸。上下文提到了草地和水边。\",\"meaningEn\":\"the side of a river\",\"explanationEn\":\"Here, bank means the land beside a river. The nearby river clue selects this sense.\",\"examplesEn\":[\"They sat on the bank and watched the water.\",\"Trees grew along the river bank.\"],\"partOfSpeech\":\"noun\"}\n```"))
      .toEqual({
        meaningZh: "河岸",
        explanationZh: "这里指河边的岸。上下文提到了草地和水边。",
        meaningEn: "the side of a river",
        explanationEn: "Here, bank means the land beside a river. The nearby river clue selects this sense.",
        examplesEn: ["They sat on the bank and watched the water.", "Trees grew along the river bank."],
        partOfSpeech: "noun",
      });
  });

  it("asks Luna for only the exact occurrence meaning", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      expect(body.instructions).toContain("ONLY at this exact occurrence");
      expect(body.instructions).toContain("meaningZh, explanationZh, meaningEn, explanationEn, examplesEn, partOfSpeech");
      expect(body.instructions).toContain("dictionary-style English definition");
      expect(body.input).toContain("Target word or expression:\nbank");
      expect(body.input).toContain("Exact sentence containing this occurrence:\nMary sat on the bank by the river.");
      expect(body.input).toContain("Previous paragraph");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer local-test-key" });
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          meaningZh: "河岸",
          explanationZh: "这里指河边的岸；river 明确了这个义项。",
          meaningEn: "the land beside a river",
          explanationEn: "Here, bank means the land beside a river. The word river makes this sense clear.",
          examplesEn: ["We walked along the bank.", "A boat was tied to the river bank."],
          partOfSpeech: "noun",
        }),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new EasyCLIProxyWordContextProvider({
      endpoint: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      apiKey: "local-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.explain({
      text: "bank",
      sentence: "Mary sat on the bank by the river.",
      paragraph: "Mary sat on the bank by the river. The grass was wet.",
      contextBefore: "She walked out of the house.",
      contextAfter: "Later she went into town.",
      articleTitle: "The Weekend",
    })).resolves.toEqual({
      meaningZh: "河岸",
      explanationZh: "这里指河边的岸；river 明确了这个义项。",
      meaningEn: "the land beside a river",
      explanationEn: "Here, bank means the land beside a river. The word river makes this sense clear.",
      examplesEn: ["We walked along the bank.", "A boat was tied to the river bank."],
      partOfSpeech: "noun",
      model: "gpt-6-luna",
      provider: "easycliproxy",
    });
  });

  it("returns no provider when the local API key is not configured", () => {
    expect(createEasyCLIProxyWordContextProvider({})).toBeNull();
  });
});

it("verifies short gloss, usage and sentence together and rejects an incomplete reply", async () => {
  const reply = { meaningZh: "参与选择", explanationZh: "这里强调自己也参与选择，而不是帮助别人。", meaningEn: "contribute to choosing", explanationEn: "We contribute to the choice.", examplesEn: ["We help choose the route.", "They help choose the music."], partOfSpeech: "phrase", sentenceTranslationZh: "但我们也会参与选择自己的生活环境。" };
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.instructions).toContain("sentenceTranslationZh");
    expect(body.instructions).toContain("SAME");
    expect(body.input).toContain("帮助选择");
    return new Response(JSON.stringify({ output_text: JSON.stringify(reply) }), { status: 200 });
  });
  const provider = new EasyCLIProxyWordContextProvider({ endpoint: "http://localhost/mock", model: "fixture", apiKey: "fixture", fetchImpl: fetchImpl as typeof fetch });
  const request = { text: "help choose", sentence: "But we also help choose our own world.", paragraph: "People shape our lives. But we also help choose our own world.", verifyConsistency: true, suggestedMeaningZh: "帮助选择" };
  await expect(provider.explain(request)).resolves.toMatchObject(reply);
  delete (reply as Partial<typeof reply>).sentenceTranslationZh;
  await expect(provider.explain(request)).rejects.toThrow("不完整");
});
