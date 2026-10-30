import { describe, expect, it } from "vitest";
import type { DictionaryDefinition } from "../shared/types";
import { firstChineseDictionaryMeaning, selectWordGloss } from "./dictionary-meaning";

const definition = (text: string): DictionaryDefinition => ({
  definition: text,
  partOfSpeech: null,
  example: null,
  source: "youdao",
});

describe("Chinese dictionary gloss fallback", () => {
  it("skips English part-of-speech labels and selects the first Chinese sense", () => {
    expect(firstChineseDictionaryMeaning([
      definition("A. noun"),
      definition("① 三；② 点钟；③ 点；④ 岁"),
    ])).toBe("三");
  });

  it("skips an English definition and continues to the next Chinese entry", () => {
    expect(firstChineseDictionaryMeaning([
      definition("the number after two"),
      definition("n. 三"),
    ])).toBe("三");
  });

  it("reads nested definition fields without treating examples or native full entries as glosses", () => {
    expect(firstChineseDictionaryMeaning([{ definition: ["A. noun", { meaning: "① 三" }], example: "错误例句" }])).toBe("三");
    expect(firstChineseDictionaryMeaning([{ definition: "展开查看完整词条", source: "macos-dictionary" }, { definition: "例句中文", source: "macos-dictionary-full" }])).toBeUndefined();
    expect(selectWordGloss({ cachedAiMeaning: "A. noun", dictionaryDefinitions: [definition("三")] })?.meaning).toBe("三");
  });

  it("uses the dictionary gloss while AI is loading, then prefers the generated gloss", () => {
    const dictionaryDefinitions = [definition("A. noun"), definition("① 三")];
    expect(selectWordGloss({ dictionaryDefinitions, generationStatus: "loading" })).toEqual({ meaning: "三", source: "dictionary" });
    expect(selectWordGloss({ dictionaryDefinitions, generationStatus: "success", generatedAiMeaning: "三个人" })).toEqual({ meaning: "三个人", source: "ai" });
  });

  it("keeps the dictionary fallback after AI failure and never leaks English-only definitions", () => {
    expect(selectWordGloss({ dictionaryDefinitions: [definition("the number after two"), definition("三")], generationStatus: "error" }))
      .toEqual({ meaning: "三", source: "dictionary" });
    expect(selectWordGloss({ dictionaryDefinitions: [definition("A. noun"), definition("the number after two")], generationStatus: "error" })).toBeUndefined();
  });

  it("keeps a compatible cached AI gloss visible during regeneration or after failure", () => {
    const candidates = { cachedAiMeaning: "三（数量）", dictionaryDefinitions: [definition("① 三")], generatedAiMeaning: "", generationStatus: "error" as const };
    expect(selectWordGloss(candidates)).toEqual({ meaning: "三（数量）", source: "ai" });
    expect(selectWordGloss({ ...candidates, generationStatus: "loading" })).toEqual({ meaning: "三（数量）", source: "ai" });
  });
});
