import { describe, expect, it, vi } from "vitest";
import {
  dictionaryBaseFormCandidates,
  parseFreeDictionaryPayload,
  parseYoudaoDictionaryPayload,
  parseYoudaoSuggestPayload,
  PublicDictionaryProvider,
} from "./dictionary-service.js";

describe("dictionary service", () => {
  it("parses Youdao phonetics and Chinese definitions", () => {
    const parsed = parseYoudaoDictionaryPayload({
      ec: { word: [{
        usphone: "ˈhʌzbənd",
        ukphone: "ˈhʌzbənd",
        trs: [
          { tr: [{ l: { i: ["n. 丈夫"] } }] },
          { tr: [{ l: { i: ["v. 节约使用"] } }] },
        ],
      }] },
    });
    expect(parsed.usPhonetic).toBe("ˈhʌzbənd");
    expect(parsed.ukPhonetic).toBe("ˈhʌzbənd");
    expect(parsed.definitions.map((item) => item.definition)).toEqual(["n. 丈夫", "v. 节约使用"]);
  });

  it("keeps only the exact Youdao suggestion entry", () => {
    const parsed = parseYoudaoSuggestPayload({
      data: { entries: [
        { entry: "husbandry", explain: "n. 农牧业" },
        { entry: "husband", explain: "n. 丈夫; v. 节约使用" },
      ] },
    }, "husband");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.definition).toContain("丈夫");
  });

  it("combines Youdao lookup with Free Dictionary definitions and audio URLs", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("jsonapi")) {
        return new Response(JSON.stringify({ ec: { word: [{ usphone: "ˈhʌzbənd", ukphone: "ˈhʌzbənd", trs: [{ tr: [{ l: { i: ["n. 丈夫"] } }] }] }] } }), { status: 200 });
      }
      if (value.includes("suggest")) {
        return new Response(JSON.stringify({ data: { entries: [{ entry: "husband", explain: "n. 丈夫" }] } }), { status: 200 });
      }
      return new Response(JSON.stringify([{
        phonetic: "/ˈhʌzbənd/",
        meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "the man someone is married to", example: "Her husband is a doctor." }] }],
      }]), { status: 200 });
    });
    const provider = new PublicDictionaryProvider({ fetchImpl: fetchImpl as typeof fetch, timeoutMs: 500 });
    const result = await provider.lookup("husband");
    expect(result.usPhonetic).toBe("ˈhʌzbənd");
    expect(result.definitionsZh[0]?.definition).toBe("n. 丈夫");
    expect(result.definitionsEn[0]).toMatchObject({ partOfSpeech: "noun", example: "Her husband is a doctor." });
    expect(result.englishDefinitionSource).toBe("exact");
    expect(result.englishLookupWord).toBe("husband");
    expect(result.usAudioUrl).toContain("type=2");
    expect(result.ukAudioUrl).toContain("type=1");
    expect(parseFreeDictionaryPayload([{}]).definitions).toEqual([]);
  });

  it("falls back from an inflected form to a base form for English definitions", async () => {
    expect(dictionaryBaseFormCandidates("appointed")[0]).toBe("appoint");
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("jsonapi")) {
        return new Response(JSON.stringify({ ec: { word: [{ usphone: "ə'pɔɪntɪd", ukphone: "ə'pɔɪntɪd", trs: [{ tr: [{ l: { i: ["v. 任命"] } }] }] }] } }), { status: 200 });
      }
      if (value.includes("suggest")) {
        return new Response(JSON.stringify({ data: { entries: [{ entry: "appointed", explain: "adj. 被任命的" }] } }), { status: 200 });
      }
      if (value.endsWith("/appointed")) return new Response("{}", { status: 404 });
      if (value.endsWith("/appoint")) {
        return new Response(JSON.stringify([{
          phonetic: "/əˈpɔɪnt/",
          meanings: [{ partOfSpeech: "verb", definitions: [{ definition: "to officially choose someone for a job or position" }] }],
        }]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    const provider = new PublicDictionaryProvider({ fetchImpl: fetchImpl as typeof fetch, timeoutMs: 500 });
    const result = await provider.lookup("appointed");
    expect(result.definitionsEn[0]?.definition).toBe("to officially choose someone for a job or position");
    expect(result.englishDefinitionSource).toBe("base-form");
    expect(result.englishLookupWord).toBe("appoint");
    expect(result.usPhonetic).toBe("ə'pɔɪntɪd");
  });
});
