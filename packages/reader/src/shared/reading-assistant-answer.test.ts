import { describe, expect, it } from "vitest";
import { normalizeReadingAssistantAnswer } from "./reading-assistant-answer.js";

describe("reading assistant answer presentation", () => {
  it("removes inline paragraph markers while preserving explicit reference buttons", () => {
    expect(normalizeReadingAssistantAnswer({
      text: "核心观点来自前文。[P2][P3]\n\n后文进一步补充。[P6]",
      paragraphCount: 8,
      paragraphIndexes: [1, 2, 5],
    })).toEqual({
      answer: "核心观点来自前文。\n\n后文进一步补充。",
      paragraphIndexes: [1, 2, 5],
    });
  });

  it("recovers paragraph buttons from leaked paragraphs JSON and removes the JSON tail", () => {
    expect(normalizeReadingAssistantAnswer({
      text: '作者最后承认这只是其中一点安慰。[P9]","paragraphs":[1,2,3,4,5,6,7,8]}',
      paragraphCount: 10,
    })).toEqual({
      answer: "作者最后承认这只是其中一点安慰。",
      paragraphIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("recovers malformed JSON-object output without exposing JSON syntax", () => {
    expect(normalizeReadingAssistantAnswer({
      text: '{"answer":"第一点。[P1]\\n\\n第二点。[P4]","paragraphs":[1,4]}',
      paragraphCount: 6,
    })).toEqual({
      answer: "第一点。\n\n第二点。",
      paragraphIndexes: [0, 3],
    });
  });

  it("uses inline markers as reference buttons when no structured indexes exist", () => {
    expect(normalizeReadingAssistantAnswer({
      text: "依据主要来自这两处。[P2] [P5]",
      paragraphCount: 6,
    })).toEqual({
      answer: "依据主要来自这两处。",
      paragraphIndexes: [1, 4],
    });
  });
});
