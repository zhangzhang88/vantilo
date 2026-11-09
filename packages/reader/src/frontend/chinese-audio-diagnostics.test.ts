import { afterEach, describe, expect, it, vi } from "vitest";
import { CHINESE_AUDIO_DIAGNOSTICS_KEY, recordChineseAudioDiagnostic } from "./chinese-audio-diagnostics";
import type { ChineseAudioDiagnosticEvent } from "./chinese-streaming-audio-player";

const sample: ChineseAudioDiagnosticEvent = {
  event: "low_buffer", paragraphIndex: 0, chunkIndex: 2,
  elapsedMs: 7000, availableSeconds: 0.8, targetSeconds: 6, rtf: 1.25,
};

afterEach(() => vi.unstubAllGlobals());

describe("Private Chinese audiobook diagnostics", () => {
  it("keeps a bounded per-tab history of numeric events, stripping speech text and credentials", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    for (let i = 0; i < 120; i++) {
      recordChineseAudioDiagnostic({ ...sample, elapsedMs: i, text: "private transcript", apiKey: "secret" } as ChineseAudioDiagnosticEvent);
    }
    const raw = values.get(CHINESE_AUDIO_DIAGNOSTICS_KEY)!;
    const events = JSON.parse(raw) as Array<ChineseAudioDiagnosticEvent>;
    expect(events).toHaveLength(96);
    expect(events[0].elapsedMs).toBe(24);
    expect(events.at(-1)).toMatchObject({
      event: "low_buffer", paragraphIndex: 0, chunkIndex: 2,
      elapsedMs: 119, availableSeconds: 0.8, targetSeconds: 6, rtf: 1.25,
    });
    expect(raw).not.toContain("private transcript");
    expect(raw).not.toContain("secret");
    expect(Object.keys(events.at(-1)!)).toEqual([
      "at", "event", "paragraphIndex", "chunkIndex", "elapsedMs",
      "availableSeconds", "targetSeconds", "rtf",
    ]);
  });

  it("ignores invalid telemetry and unavailable session storage without interrupting audio", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => "invalid json",
      setItem: () => { throw new Error("Session storage unavailable"); },
    });
    expect(() => recordChineseAudioDiagnostic(sample)).not.toThrow();
    expect(() => recordChineseAudioDiagnostic({ ...sample, event: "include_private_data" } as never)).not.toThrow();
  });
});
