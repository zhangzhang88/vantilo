// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { articleReadingDocumentIdentity } from "../packages/reader/src/shared/reading-document-identity";
import { paragraphTranslationTarget, titleTranslationTarget, translationCacheMetadata, PARAGRAPH_TRANSLATIONS_KEY, type ParagraphTranslationRecord } from "../packages/reader/src/frontend/paragraph-translation-state";
import { ChineseReader } from "../packages/reader/src/frontend/chinese-reader";
import type { ReaderDocumentView } from "../packages/reader/src/frontend/reading-document-view";
import { QWEN_TTS_VOICE_STORAGE_KEY } from "../packages/reader/src/shared/qwen-tts-voices";
import { CHINESE_AUDIOBOOK_PREFERENCES_KEY } from "../packages/reader/src/frontend/chinese-audiobook-preferences";
import { saveChineseListeningPosition } from "../packages/reader/src/frontend/chinese-listening-state";

const engineId = "custom-api:012345abcdef";
const source = [
  "A complete translated first paragraph with several important ideas.",
  "A complete translated second paragraph with more details.",
];
const document = articleReadingDocumentIdentity("economist:2026-10-31", "world-this-week");
const article: ReaderDocumentView = {
  id: "world-this-week", identity: document, title: "The world this week", titleZh: "",
  subtitle: "", subtitleZh: "", summaryZh: "", section: "", sectionZh: "", minutes: 2,
  progress: 0, wordCount: 20, paragraphs: source,
  blocks: source.map((text, paragraphIndex) => ({ kind: "paragraph" as const, paragraphIndex, text })),
};
function translatedRecords(): ParagraphTranslationRecord[] {
  const targets = [titleTranslationTarget({ document, sourceText: article.title }),
    ...source.map((text, paragraphIndex) => paragraphTranslationTarget({ document, paragraphIndex, sourceText: text }))];
  return targets.map((target, index) => ({
    ...target, translationZh: ["本周世界", "已经翻译好的第一段。", "已经翻译好的第二段。"][index],
    provider: "easycliproxy", model: "selected-custom-model",
    ...translationCacheMetadata({ provider: "easycliproxy", model: "selected-custom-model",
      contextBefore: index > 1 ? source[index - 2] : undefined,
      contextAfter: index === 1 ? source[1] : undefined }),
    generatedAt: "2026-11-06T08:00:00.000Z",
  }));
}
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });
function mount(records: ParagraphTranslationRecord[], fetcher = vi.fn(() => { throw new Error("unexpected AI request"); })) {
  const key = `${PARAGRAPH_TRANSLATIONS_KEY}:vantilo-v2:${engineId}`;
  localStorage.setItem(key, JSON.stringify(records));
  vi.stubGlobal("fetch", fetcher);
  render(<ChineseReader article={article} initialParagraph={0} translationEngineId={engineId} translationRecords={records}
    onPosition={() => {}} onTranslation={() => {}} onComplete={() => {}} />);
  return fetcher;
}
it("immediately displays cached title and both paragraphs without repeating AI translation", async () => {
  const fetcher = mount(translatedRecords());
  expect(screen.getByRole("heading", { name: "本周世界" })).toBeTruthy();
  expect(screen.getByText("已经翻译好的第一段。")).toBeTruthy();
  expect(screen.getByText("已经翻译好的第二段。")).toBeTruthy();
  expect(screen.getByText("正文译文已就绪")).toBeTruthy();
  // Silent TTS prewarming is expected. Only a second translation request
  // would be a cache regression.
  await waitFor(() => expect(fetcher.mock.calls.filter(call =>
    (call as unknown[])[0] === "/api/vantilo-translation/translate")).toHaveLength(0));
});

it("translates only the missing paragraph using the selected engine while preserving cached title and first paragraph", async () => {
  const firstTwo = translatedRecords().slice(0, 2);
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    if (_url === "/api/translation-cache-identity") return new Response(
      JSON.stringify({ profileId: "active-profile", model: "selected-custom-model" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ engineId: body.engineId, translation: "补全的第二段。", model: "selected-custom-model", provider: "easycliproxy" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  });
  mount(firstTwo, fetcher as never);
  expect(screen.getByText("已经翻译好的第一段。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "播放中文" }) as HTMLButtonElement).disabled).toBe(false);
  await waitFor(() => expect(screen.getByText("补全的第二段。")).toBeTruthy());
  expect(fetcher.mock.calls.filter(call => call[0] === "/api/vantilo-translation/translate")).toHaveLength(1);
  const translationCall = fetcher.mock.calls.find(call => call[0] === "/api/vantilo-translation/translate");
  expect(translationCall?.[0]).toBe("/api/vantilo-translation/translate");
  expect(JSON.parse(String(translationCall?.[1].body)).engineId).toBe(engineId);
});

it("disables playback until the starting paragraph translation arrives, without waiting for all paragraphs", async () => {
  let releaseFirst!: (response: Response) => void;
  const firstPending = new Promise<Response>(resolve => { releaseFirst = resolve; });
  const speechTexts: string[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/translation-cache-identity") return new Response(
      JSON.stringify({ profileId: "active-profile", model: "selected-custom-model" }), { status: 200 });
    if (url === "/api/vantilo-translation/translate") {
      const text = JSON.parse(String(init.body)).text;
      if (text === source[0]) return firstPending;
      if (text === source[1]) return new Promise<Response>(() => {}); // second paragraph deliberately unfinished
    }
    if (url === "/api/prep/tts") {
      speechTexts.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ type: "end", stop: "complete" }) + "\n",
        { status: 200, headers: { "content-type": "application/x-ndjson" } });
    }
    throw new Error("Unexpected endpoint: " + url);
  });
  mount(translatedRecords().slice(0, 1), fetcher as never);
  const play = screen.getByRole("button", { name: "播放中文" }) as HTMLButtonElement;
  expect(play.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "从第 1 段开始朗读" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("正在准备当前段译文…")).toBeTruthy();
  fireEvent.click(play);
  expect(screen.getByText("正在准备当前段译文…")).toBeTruthy();
  expect(speechTexts).toHaveLength(0);
  releaseFirst(new Response(JSON.stringify({
    engineId, translation: "新译出的第一段。", model: "selected-custom-model", provider: "easycliproxy",
  }), { status: 200 }));
  await waitFor(() => expect(play.disabled).toBe(false));
  expect((screen.getByRole("button", { name: "从第 1 段开始朗读" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "从第 2 段开始朗读" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("新译出的第一段。")).toBeTruthy();
  expect(screen.getByText("译文准备中 · 1/2 段")).toBeTruthy();
  await waitFor(() => expect(speechTexts).toContain("新译出的第一段。"));
});

it("shows a retry for failed first translation and unlocks Play only after the retry succeeds", async () => {
  let firstAttempts = 0;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/translation-cache-identity") return new Response(
      JSON.stringify({ profileId: "active-profile", model: "selected-custom-model" }), { status: 200 });
    if (url === "/api/vantilo-translation/translate") {
      if (JSON.parse(String(init.body)).text !== source[0]) throw new Error("unexpected translation");
      firstAttempts++;
      if (firstAttempts === 1) return new Response(JSON.stringify({ error: "模拟翻译失败" }), { status: 503 });
      return new Response(JSON.stringify({
        engineId, translation: "重新翻译成功。", model: "selected-custom-model", provider: "easycliproxy",
      }), { status: 200 });
    }
    if (url === "/api/prep/tts") return new Response(JSON.stringify({ type: "end", stop: "complete" }) + "\n",
      { status: 200, headers: { "content-type": "application/x-ndjson" } });
    throw new Error("Unexpected endpoint: " + url);
  });
  // Title and second paragraph are already cached, only first can fail.
  mount(translatedRecords().filter((_, index) => index !== 1), fetcher as never);
  const play = screen.getByRole("button", { name: "播放中文" }) as HTMLButtonElement;
  await waitFor(() => expect(screen.getByRole("button", { name: "重试当前段译文" })).toBeTruthy());
  expect(play.disabled).toBe(true);
  expect(screen.getByText("当前段译文准备失败")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试当前段译文" }));
  await waitFor(() => expect(play.disabled).toBe(false));
  expect(screen.getByText("重新翻译成功。")).toBeTruthy();
  expect(firstAttempts).toBe(2);
  expect(screen.queryByRole("button", { name: "重试当前段译文" })).toBeNull();
});

it("requires the saved listening-position paragraph, not merely any other translated paragraph", async () => {
  saveChineseListeningPosition(localStorage, {
    documentId: document.documentId, paragraphIndex: 1, sourceText: source[1],
    chunkIndex: 0, chunkText: "", seconds: 0, rate: 1, completed: false,
  });
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/vantilo-translation/translate") return new Promise<Response>(() => {});
    if (url === "/api/prep/tts") return new Response(JSON.stringify({ type: "end", stop: "complete" }) + "\n",
      { status: 200, headers: { "content-type": "application/x-ndjson" } });
    throw new Error("Unexpected endpoint: " + url);
  });
  mount(translatedRecords().slice(0, 2), fetcher as never);
  expect((screen.getByRole("button", { name: "播放中文" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "上一段" }));
  expect((screen.getByRole("button", { name: "播放中文" }) as HTMLButtonElement).disabled).toBe(false);
});

it("shows five original voices and the private clone, preserving the chosen preset across remounts", () => {
  const fetcher = mount(translatedRecords());
  const select = screen.getByRole("combobox", { name: "朗读音色" }) as HTMLSelectElement;
  expect(select.options).toHaveLength(6);
  expect([...select.options].map(option => option.value)).toEqual(["serena", "vivian", "uncle_fu", "dylan", "eric", "my_voice"]);
  expect(select.value).toBe("serena");
  fireEvent.change(select, { target: { value: "uncle_fu" } });
  expect(select.value).toBe("uncle_fu");
  expect(localStorage.getItem(QWEN_TTS_VOICE_STORAGE_KEY)).toBe("uncle_fu");
  cleanup();
  mount(translatedRecords(), fetcher);
  expect((screen.getByRole("combobox", { name: "朗读音色" }) as HTMLSelectElement).value).toBe("uncle_fu");
  expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === "/api/vantilo-translation/translate")).toHaveLength(0);
});

it("offers the five original Chinese voices plus my_voice, defaulting to Serena if the saved voice is non-Chinese", () => {
  localStorage.setItem(QWEN_TTS_VOICE_STORAGE_KEY, "ryan");
  mount(translatedRecords());
  const select = screen.getByRole("combobox", { name: "朗读音色" }) as HTMLSelectElement;
  expect(select.options).toHaveLength(6);
  expect(select.value).toBe("serena");
  expect([...select.options].map(item => item.value)).toEqual(["serena", "vivian", "uncle_fu", "dylan", "eric", "my_voice"]);
});

it("restores my_voice and its preferred speed across articles without changing the other TTS voice preference", () => {
  mount(translatedRecords());
  fireEvent.change(screen.getByRole("combobox", { name: "朗读音色" }), { target: { value: "my_voice" } });
  fireEvent.change(screen.getByRole("combobox", { name: "朗读语速" }), { target: { value: "1.25" } });
  expect(JSON.parse(localStorage.getItem(CHINESE_AUDIOBOOK_PREFERENCES_KEY)!)).toMatchObject({ voice: "my_voice", rate: 1.25 });
  expect(localStorage.getItem(QWEN_TTS_VOICE_STORAGE_KEY)).not.toBe("my_voice");
  cleanup();
  mount(translatedRecords());
  expect((screen.getByRole("combobox", { name: "朗读音色" }) as HTMLSelectElement).value).toBe("my_voice");
  expect((screen.getByRole("combobox", { name: "朗读语速" }) as HTMLSelectElement).value).toBe("1.25");
});

it("restores the last selected speed and Chinese voice across different articles, not the old per-article rate", () => {
  mount(translatedRecords());
  fireEvent.change(screen.getByRole("combobox", { name: "朗读语速" }), { target: { value: "1.5" } });
  fireEvent.change(screen.getByRole("combobox", { name: "朗读音色" }), { target: { value: "vivian" } });
  expect(JSON.parse(localStorage.getItem(CHINESE_AUDIOBOOK_PREFERENCES_KEY)!)).toMatchObject({ rate: 1.5, voice: "vivian" });
  cleanup();
  const nextArticle: ReaderDocumentView = {
    ...article, id: "next-story", identity: articleReadingDocumentIdentity("economist:2026-11-09", "next-story"),
    title: "Different story", paragraphs: ["A separate English paragraph."],
    blocks: [{ kind: "paragraph", paragraphIndex: 0, text: "A separate English paragraph." }],
  };
  render(<ChineseReader article={nextArticle} initialParagraph={0} translationEngineId={engineId}
    onPosition={() => {}} onTranslation={() => {}} onComplete={() => {}} />);
  expect((screen.getByRole("combobox", { name: "朗读语速" }) as HTMLSelectElement).value).toBe("1.5");
  expect((screen.getByRole("combobox", { name: "朗读音色" }) as HTMLSelectElement).value).toBe("vivian");
});

it("starts bounded, silent audiobook prewarming when entering Chinese reading, before Play is clicked", async () => {
  const synthRequests: Array<{ text: string; voice: string; seed: number; signal: AbortSignal }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url !== "/api/prep/tts") throw new Error("The cached Chinese text must not invoke real AI translation");
    const body = JSON.parse(String(init.body));
    synthRequests.push({ ...body, signal: init.signal! });
    const pcm = btoa(String.fromCharCode(...new Uint8Array(4800)));
    return new Response(JSON.stringify({ type: "chunk", sampleRate: 24000, pcm }) + "\n"
      + JSON.stringify({ type: "end", stop: "complete" }) + "\n", {
        status: 200, headers: { "content-type": "application/x-ndjson" },
      });
  });
  mount(translatedRecords(), fetcher as never);
  await waitFor(() => expect(synthRequests.length).toBe(2));
  expect(synthRequests.map(item => item.text)).toEqual(["已经翻译好的第一段。", "已经翻译好的第二段。"]);
  expect(synthRequests.every(item => item.voice === "serena" && Number.isInteger(item.seed))).toBe(true);
  expect(screen.getByRole("button", { name: "播放中文" })).toBeTruthy();
  expect(screen.getByText("听书")).toBeTruthy();
  cleanup();
  expect(synthRequests.every(item => item.signal.aborted)).toBe(true);
});

it("shows a simple loading message without exposing internal buffer seconds", async () => {
  // jsdom does not provide WebAudio; this test only checks the UI while audio
  // is still being prepared, so no buffers or sources are ever scheduled.
  vi.stubGlobal("AudioContext", class {
    currentTime = 0;
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  });
  const pendingAudio = new Promise<Response>(() => {});
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/prep/tts") return pendingAudio;
    throw new Error("Cached translations should not trigger an AI request");
  });
  mount(translatedRecords(), fetcher as never);
  fireEvent.click(screen.getByRole("button", { name: "播放中文" }));
  await waitFor(() => {
    const player = screen.getByRole("region", { name: "中文听书播放器" });
    expect(player.textContent).toContain("正在准备朗读…");
    expect(player.textContent).not.toMatch(/\d+\.\d+\s*\/\s*\d+\s*秒/);
  });
});

it("keeps the active first-paragraph prebuffer alive when the second translation arrives", async () => {
  let finishFirstAudio!: (response: Response) => void;
  let finishSecondTranslation!: (response: Response) => void;
  const pendingAudio = new Promise<Response>(resolve => { finishFirstAudio = resolve; });
  const pendingTranslation = new Promise<Response>(resolve => { finishSecondTranslation = resolve; });
  const speechRequests: Array<{ text: string; signal: AbortSignal }> = [];
  const pcm = btoa(String.fromCharCode(...new Uint8Array(4800)));
  const audioResponse = () => new Response(
    JSON.stringify({ type: "chunk", sampleRate: 24000, pcm }) + "\n"
      + JSON.stringify({ type: "end", stop: "complete" }) + "\n",
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/translation-cache-identity") return new Response(
      JSON.stringify({ profileId: "active-profile", model: "selected-custom-model" }), { status: 200 });
    if (url === "/api/vantilo-translation/translate") {
      expect(JSON.parse(String(init.body)).text).toBe(source[1]);
      return pendingTranslation;
    }
    if (url === "/api/prep/tts") {
      const text = JSON.parse(String(init.body)).text as string;
      speechRequests.push({ text, signal: init.signal! });
      return text === "已经翻译好的第一段。" ? pendingAudio : audioResponse();
    }
    throw new Error("Unexpected URL: " + url);
  });
  mount(translatedRecords().slice(0, 2), fetcher as never);
  await waitFor(() => expect(speechRequests.some(request => request.text === "已经翻译好的第一段。")).toBe(true));
  const first = speechRequests.find(request => request.text === "已经翻译好的第一段。")!;
  finishSecondTranslation(new Response(JSON.stringify({
    engineId, translation: "稍后完成的第二段。", model: "selected-custom-model", provider: "easycliproxy",
  }), { status: 200 }));
  await waitFor(() => expect(screen.getByText("稍后完成的第二段。")).toBeTruthy());
  expect(first.signal.aborted).toBe(false);
  finishFirstAudio(audioResponse());
  await waitFor(() => expect(speechRequests.some(request => request.text === "稍后完成的第二段。")).toBe(true));
  expect(speechRequests.filter(request => request.text === "已经翻译好的第一段。")).toHaveLength(1);
  cleanup();
});
