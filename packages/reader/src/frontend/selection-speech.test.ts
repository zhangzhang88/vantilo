import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionSpeechPlayer, SELECTION_SPEECH_QWEN_TIMEOUT_MS, SHORT_SELECTION_SPEECH_QWEN_TIMEOUT_MS, type SelectionSpeechReport } from "./selection-speech";
import type { SpeechPhase } from "./chinese-audio-types";

function setup() {
  const reports: SelectionSpeechReport[] = [];
  const streams: Array<{ text: string; phase: (phase: SpeechPhase, error?: string) => void; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const speak = vi.fn();
  const cancel = vi.fn();
  const utterances: Array<{ text: string; lang: string; onstart?: () => void; onend?: () => void; onerror?: () => void }> = [];
  const player = new SelectionSpeechPlayer({
    streaming: (text, phase) => {
      const instance = { text, phase, start: vi.fn(async () => {}), stop: vi.fn() };
      streams.push(instance);
      return instance;
    },
    synthesis: () => ({ speak, cancel }) as unknown as SpeechSynthesis,
    utterance: text => {
      const item = { text, lang: "", onstart: undefined, onend: undefined, onerror: undefined };
      utterances.push(item);
      return item as unknown as SpeechSynthesisUtterance;
    },
    report: event => reports.push(event),
  });
  return { player, reports, streams, speak, cancel, utterances };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", new EventTarget()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("selection speech prefers Qwen and uses macOS only as last resort", () => {
  it("uses natural Qwen audio when it starts in time, without system speech", async () => {
    const f = setup();
    f.player.play("blockchain intelligence company");
    expect(f.streams[0].text).toBe("blockchain intelligence company");
    f.streams[0].phase("playing");
    await vi.advanceTimersByTimeAsync(SELECTION_SPEECH_QWEN_TIMEOUT_MS + 100);
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.reports.some(e => e.status === "qwen")).toBe(true);
    f.player.stop();
  });

  it("only uses system speech if Qwen fails before audio starts", () => {
    const f = setup();
    f.player.play("a short sentence");
    f.streams[0].phase("error", "service busy");
    expect(f.streams[0].stop).toHaveBeenCalled();
    expect(f.speak).toHaveBeenCalledTimes(1);
    expect(f.utterances[0].lang).toBe("en-US");
    f.utterances[0].onstart?.();
    expect(f.reports.at(-1)).toMatchObject({ status: "system" });
    f.player.stop();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it("falls back after a bounded first-audio timeout and aborts stale Qwen", async () => {
    const f = setup();
    f.player.play("a slow request");
    await vi.advanceTimersByTimeAsync(SHORT_SELECTION_SPEECH_QWEN_TIMEOUT_MS - 1);
    expect(f.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.speak).toHaveBeenCalledTimes(1);
    expect(f.streams[0].stop).toHaveBeenCalled();
    f.streams[0].phase("playing");
    expect(f.reports.filter(e => e.status === "qwen")).toHaveLength(0);
    f.player.stop();
  });

  it("latest selection cancels older audio and cannot replay the older selection", async () => {
    const f = setup();
    f.player.play("first expression");
    f.player.play("second expression");
    expect(f.streams[0].stop).toHaveBeenCalled();
    f.streams[0].phase("error");
    f.streams[1].phase("playing");
    await vi.advanceTimersByTimeAsync(SELECTION_SPEECH_QWEN_TIMEOUT_MS + 10);
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.reports.filter(e => e.status === "qwen").map(e => e.text)).toEqual(["second expression"]);
    f.player.stop();
  });

  it("does not restart the text with a system voice if Qwen fails mid-playback", () => {
    const f = setup();
    f.player.play("the market changed rapidly");
    f.streams[0].phase("playing");
    f.streams[0].phase("error", "interrupted");
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.reports.some(e => e.status === "failed")).toBe(true);
  });

  it("never invokes a fallback after an explicit stop", async () => {
    const f = setup();
    f.player.play("stopped before first audio");
    f.player.stop();
    await vi.advanceTimersByTimeAsync(SHORT_SELECTION_SPEECH_QWEN_TIMEOUT_MS + 30);
    f.streams[0].phase("error");
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.streams[0].stop).toHaveBeenCalled();
  });

  it("preserves an actionable failure if neither speaker can start", () => {
    const f = setup();
    f.speak.mockImplementationOnce(() => { throw new Error("system audio blocked"); });
    f.player.play("hello world");
    f.streams[0].phase("error", "qwen busy");
    expect(f.reports.at(-1)).toMatchObject({ status: "failed", message: "Qwen 和系统朗读均不可用" });
  });
});
