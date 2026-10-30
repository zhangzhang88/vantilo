import { describe, expect, it } from "vitest";
import { dictionaryPreviewMeanings } from "./dictionary-preview";
import { firstChineseDictionaryMeaning, selectWordGloss } from "./dictionary-meaning";

describe("dictionary popup preview", () => {
  it("shows at most three distinct Chinese senses across parts of speech", () => {
    const definitions = [{ source: "macos-dictionary", definition: "A. noun\n① 三\n② 点钟\n③ 点\n④ 岁\nB. adjective\n① 三的" }, { source: "macos-dictionary-full", definition: "所有内容及例句" }];
    expect(dictionaryPreviewMeanings(definitions)).toEqual([
      { meaning: "三", partOfSpeech: "A. noun" },
      { meaning: "点钟", partOfSpeech: "A. noun" },
      { meaning: "点", partOfSpeech: "A. noun" },
    ]);
    expect(firstChineseDictionaryMeaning(definitions)).toBe("三");
    expect(selectWordGloss({ cachedAiMeaning: "三个", dictionaryDefinitions: definitions })?.meaning).toBe("三个");
    expect(definitions[1].definition).toBe("所有内容及例句");
  });

  it("skips English, duplicates and placeholders without inventing senses", () => {
    const definitions = [
      { source: "test", definition: "A. noun\n—\nan English definition\n① 一\n② 一\nB. adjective\n① 唯一的" },
    ];
    expect(dictionaryPreviewMeanings(definitions)).toEqual([
      { meaning: "一", partOfSpeech: "A. noun" },
      { meaning: "唯一的", partOfSpeech: "B. adjective" },
    ]);
    expect(dictionaryPreviewMeanings([{ source: "test", definition: "noun\n—\nEnglish only" }])).toEqual([]);
    expect(dictionaryPreviewMeanings([{ source: "test", definition: "唯一", partOfSpeech: "adj." }])).toEqual([{ meaning: "唯一", partOfSpeech: "adj." }]);
  });
});
