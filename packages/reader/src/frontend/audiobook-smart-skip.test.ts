import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIOBOOK_SMART_SKIP } from "../shared/audiobook-bridge";
import {
  applyAudiobookSmartSkip,
  loadAudiobookSmartSkip,
  saveAudiobookSmartSkip,
} from "./audiobook-smart-skip";

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe("audiobook smart skip", () => {
  it("loads sensible defaults and persists customized rules", () => {
    const storage = memory();
    expect(loadAudiobookSmartSkip(storage)).toEqual(DEFAULT_AUDIOBOOK_SMART_SKIP);

    const custom = { tables: false, urls: true, parentheses: true, brackets: true, braces: true };
    saveAudiobookSmartSkip(storage, custom);
    expect(loadAudiobookSmartSkip(storage)).toEqual(custom);
  });

  it("strips URLs, parentheses, brackets, and braces only when enabled", () => {
    const sample = "详见 https://readify.example.com/docs 与 site.com/a（括号说明）[引用1]【编者注】{内部变量}，继续正文。";

    expect(
      applyAudiobookSmartSkip(sample, {
        tables: false,
        urls: false,
        parentheses: false,
        brackets: false,
        braces: false,
      }),
    ).toBe(sample);

    expect(
      applyAudiobookSmartSkip(sample, {
        tables: true,
        urls: true,
        parentheses: false,
        brackets: false,
        braces: false,
      }),
    ).toBe("详见 与 （括号说明）[引用1]【编者注】{内部变量}，继续正文。");

    expect(
      applyAudiobookSmartSkip(sample, {
        tables: true,
        urls: true,
        parentheses: true,
        brackets: true,
        braces: true,
      }),
    ).toBe("详见 与，继续正文。");
  });

  it("handles English parentheticals and returns empty string if nothing remains", () => {
    expect(
      applyAudiobookSmartSkip("(see appendix) https://example.org/ref", {
        tables: true,
        urls: true,
        parentheses: true,
        brackets: false,
        braces: false,
      }),
    ).toBe("");
  });
});
