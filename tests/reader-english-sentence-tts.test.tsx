// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnglishSentenceTts, splitEnglishSentenceForTts } from "../packages/reader/src/frontend/english-sentence-tts";
import { QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY, QWEN_TTS_VOICE_STORAGE_KEY } from "../packages/reader/src/shared/qwen-tts-voices";

const mocked = vi.hoisted(() => ({ players: [] as Array<{
  startCalls: unknown[]; stopCalls: number; pauseCalls: number; resumeCalls: number; finish: () => void;
}>, stream: vi.fn() }));

vi.mock("../packages/reader/src/frontend/selection-speech-clips", () => ({
  getEnglishSpeechClipCache: () => ({
    stream: (...args: unknown[]) => {
      mocked.stream(...args);
      return (async function* () { /* PCM caching is covered by clip tests. */ })();
    },
  }),
}));

vi.mock("../packages/reader/src/frontend/chinese-streaming-audio-player", () => ({
  ChineseStreamingAudioPlayer: class {
    startCalls: unknown[] = [];
    stopCalls = 0;
    pauseCalls = 0;
    resumeCalls = 0;
    constructor(private options: {
      getText: (index: number) => Promise<string>;
      splitText: (text: string) => string[];
      synthesize: (text: string, signal: AbortSignal) => unknown;
      phase: (phase: string) => void;
    }) {
      mocked.players.push(this);
    }
    async start(cursor: unknown) {
      this.startCalls.push(cursor);
      this.options.phase("loading");
      const text = await this.options.getText(0);
      this.options.synthesize(this.options.splitText(text)[0], new AbortController().signal);
      this.options.phase("playing");
    }
    pause() { this.pauseCalls++; this.options.phase("paused"); }
    resume() { this.resumeCalls++; this.options.phase("playing"); }
    stop() { this.stopCalls++; }
    finish() { this.options.phase("complete"); }
  },
}));

beforeEach(() => {
  mocked.players.length = 0;
  mocked.stream.mockClear();
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it("shows only Ryan and Aiden and streams the current sentence in English on click", async () => {
  localStorage.setItem(QWEN_TTS_VOICE_STORAGE_KEY, "serena");
  render(<EnglishSentenceTts text="Elon Musk floated the possibility of merging SpaceX and Tesla." />);
  const select = screen.getByRole("combobox", { name: "英文朗读音色" }) as HTMLSelectElement;
  expect([...select.options].map(option => option.value)).toEqual(["ryan", "aiden"]);
  expect(select.value).toBe("aiden");
  fireEvent.click(screen.getByRole("button", { name: "朗读当前英文句子" }));
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledOnce());
  expect(mocked.stream.mock.calls[0]).toMatchObject([
    "Elon Musk floated the possibility of merging SpaceX and Tesla.", "aiden", expect.anything(), false,
  ]);
  expect(localStorage.getItem(QWEN_TTS_VOICE_STORAGE_KEY)).toBe("serena");
  fireEvent.click(screen.getByRole("button", { name: "暂停英文朗读" }));
  expect(mocked.players[0].pauseCalls).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "继续英文朗读" }));
  expect(mocked.players[0].resumeCalls).toBe(1);
});

it("switches speakers without retaining old audio, persists independently and stops on sentence navigation", async () => {
  const view = render(<EnglishSentenceTts key="s1" text="The first English sentence." />);
  fireEvent.click(screen.getByRole("button", { name: "朗读当前英文句子" }));
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledTimes(1));
  const previousStops = mocked.players[0].stopCalls;
  fireEvent.change(screen.getByRole("combobox", { name: "英文朗读音色" }), { target: { value: "ryan" } });
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledTimes(2));
  expect(mocked.stream.mock.calls[1][1]).toBe("ryan");
  expect(mocked.players[0].stopCalls).toBeGreaterThan(previousStops);
  expect(localStorage.getItem(QWEN_TTS_ENGLISH_VOICE_STORAGE_KEY)).toBe("ryan");
  view.rerender(<EnglishSentenceTts key="s2" text="A new sentence should not play automatically." />);
  expect(mocked.players[1].stopCalls).toBeGreaterThan(0);
  expect(mocked.stream).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("combobox", { name: "英文朗读音色" }) as HTMLSelectElement).value).toBe("ryan");
});

it("repeats the current sentence from cache and Option forces a fresh generation", async () => {
  render(<EnglishSentenceTts text="Alexander Dobrindt led the talks." />);
  fireEvent.click(screen.getByRole("button", { name: "朗读当前英文句子" }));
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledTimes(1));
  act(() => mocked.players[0].finish());
  await waitFor(() => expect(screen.getByRole("button", { name: "重新朗读英文句子" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "重新朗读英文句子" }));
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledTimes(2));
  expect(mocked.stream.mock.calls[1]).toMatchObject([
    "Alexander Dobrindt led the talks.", "aiden", expect.anything(), false,
  ]);
  fireEvent.click(screen.getByRole("button", { name: "暂停英文朗读" }), { altKey: true });
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledTimes(3));
  expect(mocked.stream.mock.calls[2]).toMatchObject([
    "Alexander Dobrindt led the talks.", "aiden", expect.anything(), true,
  ]);
  expect(mocked.players[1].stopCalls).toBeGreaterThan(0);
});

it("stops English playback when another audio mode takes priority", async () => {
  render(<EnglishSentenceTts text="A useful sentence for listening practice." />);
  fireEvent.click(screen.getByRole("button", { name: "朗读当前英文句子" }));
  await waitFor(() => expect(mocked.stream).toHaveBeenCalledOnce());
  const before = mocked.players[0].stopCalls;
  fireEvent(window, new Event("magazine-reader:stop-english-sentence-audio"));
  expect(mocked.players[0].stopCalls).toBeGreaterThan(before);
  expect(screen.getByRole("button", { name: "朗读当前英文句子" })).toBeTruthy();
});

it("splits oversized English sentences into <=380 character requests without losing words", () => {
  const text = "The future of technology depends on careful design and clear thinking. ".repeat(30).trim();
  const parts = splitEnglishSentenceForTts(text);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every(item => item.length <= 380)).toBe(true);
  expect(parts.join(" ")).toBe(text);
  const unbroken = "a".repeat(1200);
  expect(splitEnglishSentenceForTts(unbroken).map(item => item.length)).toEqual([380, 380, 380, 60]);
});
