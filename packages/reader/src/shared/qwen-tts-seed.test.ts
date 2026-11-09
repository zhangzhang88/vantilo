import { describe, expect, it } from "vitest";
import { qwenTtsSeed } from "./qwen-tts-seed";
import { selectionSpeechSeed } from "../frontend/selection-speech-clips";

describe("stable Qwen3-TTS seed", () => {
  it("returns the same bounded seed for repeat Chinese narration of the same text and voice", () => {
    const paragraph = "在暴风雨结束后，村庄恢复了往日的宁静。";
    const first = qwenTtsSeed(paragraph, "serena");
    expect(qwenTtsSeed(paragraph, "serena")).toBe(first);
    expect(Number.isSafeInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(2_147_483_647);
  });

  it("separates different Chinese paragraphs, exact synthesis chunks, and voices", () => {
    const text = "这是一段需要重复朗读的中文。";
    const base = qwenTtsSeed(text, "serena");
    expect(qwenTtsSeed(text + "第二句。", "serena")).not.toBe(base);
    expect(qwenTtsSeed("这是一段需要重复朗读", "serena")).not.toBe(base);
    for (const voice of ["vivian", "uncle_fu", "dylan", "eric"] as const) {
      expect(qwenTtsSeed(text, voice)).not.toBe(base);
    }
  });

  it("preserves the existing English selection seed behavior", () => {
    expect(selectionSpeechSeed("Alexander Dobrindt", "aiden")).toBe(qwenTtsSeed("Alexander Dobrindt", "aiden"));
    expect(selectionSpeechSeed("Alexander Dobrindt", "ryan")).toBe(qwenTtsSeed("Alexander Dobrindt", "ryan"));
  });
});
