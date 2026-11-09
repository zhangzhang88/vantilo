import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adaptReaderSource } from "../scripts/reader-variant.mjs";
import { wordAudioUrl, WORD_FALLBACK_DELAY_MS } from "../packages/reader/src/frontend/word-pronunciation";

describe("Vantilo Reader pronunciation integration", () => {
  it("only accepts English words and keeps US/UK URLs separate", () => {
    expect(wordAudioUrl("imposed", "us")).toBe("/api/word-audio?word=imposed&accent=us");
    expect(wordAudioUrl("imposed", "uk")).toBe("/api/word-audio?word=imposed&accent=uk");
    expect(wordAudioUrl("don't", "us")).toBe("/api/word-audio?word=don%27t&accent=us");
    expect(() => wordAudioUrl("two words", "us")).toThrow();
    expect(() => wordAudioUrl("https://evil.test", "us")).toThrow();
    expect(WORD_FALLBACK_DELAY_MS).toBe(400);
  });

  it("preserves automatic click accent and both independently controlled pronunciation buttons", () => {
    const filename = "packages/reader/src/frontend/App.tsx";
    const source = readFileSync(filename, "utf8");
    const adapted = adaptReaderSource(source, "/" + filename);
    expect(adapted).toContain('playWordPronunciation(lookup.text, "us")');
    expect(adapted).toContain('playWordPronunciation(lookup.text, "uk")');
    expect(adapted).toContain('playWordPronunciation(text, preferences.pronunciationAccent)');
    expect(adapted).toContain('return () => { window.dispatchEvent(new Event(STOP_WORD_AUDIO_EVENT)); };');
    expect(adapted).not.toContain("SpeechSynthesisUtterance");
    expect(adapted).not.toContain("synthesis.speak(");
  });

  it("uses a fixed Youdao provider endpoint and Qwen3-TTS only for a supported US fallback", () => {
    const audio = readFileSync("packages/reader/src/frontend/word-pronunciation.ts", "utf8");
    const backend = readFileSync("packages/reader/src/server/services/word-audio-cache.ts", "utf8");
    expect(audio).toContain('active.accent !== "us"');
    expect(audio).toContain('DEFAULT_QWEN_TTS_ENGLISH_VOICE');
    expect(audio).not.toMatch(/window\.speechSynthesis\s*\.|new\s+SpeechSynthesisUtterance/);
    expect(backend).toContain("https://dict.youdao.com/dictvoice?audio=");
    expect(backend).toContain("MAX_DISK_BYTES");
  });
});
