// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AudiobookSnapshot } from "../shared/audiobook-bridge";
import { AudiobookDock } from "./audiobook-dock";

afterEach(cleanup);

function makeSnapshot(overrides: Partial<AudiobookSnapshot> = {}): AudiobookSnapshot {
  return {
    sessionId: 1,
    mode: "original",
    sourceId: "book:demo",
    title: "人类简史",
    chapterId: "ch3",
    chapters: [
      { id: "ch1", title: "第一章" },
      { id: "ch2", title: "第二章" },
      { id: "ch3", title: "第三章" },
    ],
    phase: "playing",
    error: "",
    rate: 1,
    voice: "serena",
    paragraphIndex: 11,
    paragraphNumber: 12,
    paragraphCount: 28,
    sleepMinutes: 0,
    progressPercent: 18,
    progressScope: "book",
    ...overrides,
  };
}

describe("AudiobookDock progress indicator", () => {
  it("shows whole-book percentage alongside the title while keeping the bottom bar on chapter progress", () => {
    render(<AudiobookDock state={makeSnapshot()} send={vi.fn()} />);

    const badge = screen.getByText("全书 18%");
    expect(badge.getAttribute("title")).toBe("全书 18% · 本章 43%（第 12/28 段）");

    const bar = screen.getByRole("progressbar", { name: "朗读段落进度" });
    expect(bar.getAttribute("aria-valuenow")).toBe("12");
    expect(bar.getAttribute("aria-valuemax")).toBe("28");
    expect(bar.getAttribute("title")).toBe("本章 43%（第 12/28 段）");
    const fill = bar.querySelector("span") as HTMLSpanElement;
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo((12 / 28) * 100, 3);
  });

  it("uses article wording for single magazine articles", () => {
    render(<AudiobookDock
      state={makeSnapshot({
        sourceId: "reading:article:1",
        title: "AI 的下一阶段",
        sourceLabel: "The Economist · 2026-01-01",
        chapters: [{ id: "a1", title: "AI 的下一阶段" }],
        chapterId: "a1",
        paragraphNumber: 4,
        paragraphCount: 10,
        progressPercent: 35,
        progressScope: "article",
      })}
      send={vi.fn()}
    />);

    const badge = screen.getByText("本篇 35%");
    expect(badge.getAttribute("title")).toBe("本篇 35%（第 4/10 段）");

    const bar = screen.getByRole("progressbar", { name: "朗读段落进度" });
    expect(bar.getAttribute("title")).toBe("第 4/10 段");
  });

  it("omits the percentage badge when progressPercent is unavailable", () => {
    render(<AudiobookDock
      state={makeSnapshot({ progressPercent: undefined, progressScope: undefined })}
      send={vi.fn()}
    />);

    expect(screen.queryByText(/全书|本篇/)).toBeNull();
  });

  it("lets users choose playback rate and voice directly from the bottom player bar without skip or sleep buttons", () => {
    const send = vi.fn();
    render(<AudiobookDock state={makeSnapshot({ rate: 1, voice: "serena", sleepMinutes: 0 })} send={send} />);

    expect(screen.queryByRole("button", { name: "后退 15 秒" })).toBeNull();
    expect(screen.queryByRole("button", { name: "前进 15 秒" })).toBeNull();
    expect(screen.queryByRole("button", { name: /睡眠定时/ })).toBeNull();
    expect(screen.getByRole("button", { name: "回到当前位置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂停朗读" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /切换播放倍速/ }));
    expect(screen.getByTestId("audiobook-rate-picker")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1.25x" }));
    expect(send).toHaveBeenCalledWith({ type: "rate", value: 1.25 });

    fireEvent.click(screen.getByRole("button", { name: /切换朗读音色/ }));
    expect(screen.getByTestId("audiobook-voice-picker")).toBeTruthy();
    const voiceOptions = screen.getAllByRole("menuitemradio");
    fireEvent.click(voiceOptions[voiceOptions.length - 1]);
    expect(send).toHaveBeenCalledWith({ type: "voice", value: expect.any(String) });
  });

  it("opens ReadifyAI-style reading settings with only smart-skip toggles and no redundant playback controls", () => {
    const send = vi.fn();
    render(<AudiobookDock state={makeSnapshot()} send={send} />);

    fireEvent.click(screen.getByRole("button", { name: "展开播放设置" }));
    const panel = screen.getByTestId("audiobook-reading-settings");
    expect(panel).toBeTruthy();
    expect(screen.getByText("朗读设置")).toBeTruthy();
    expect(screen.getByText("智能跳过")).toBeTruthy();
    // Playback controls live directly on the bottom bar; reading settings only houses Smart Skip.
    expect(screen.queryByText("播放控制")).toBeNull();
    expect(panel.querySelector("select")).toBeNull();

    const tablesSwitch = screen.getByRole("switch", { name: "智能跳过表格" });
    const urlsSwitch = screen.getByRole("switch", { name: "智能跳过网址" });
    const parensSwitch = screen.getByRole("switch", { name: "智能跳过圆括号" });
    expect(tablesSwitch.getAttribute("aria-checked")).toBe("true");
    expect(urlsSwitch.getAttribute("aria-checked")).toBe("true");
    expect(parensSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(parensSwitch);
    expect(send).toHaveBeenCalledWith({
      type: "smart-skip",
      settings: {
        tables: true,
        urls: true,
        parentheses: true,
        brackets: false,
        braces: false,
      },
    });
  });

  it("shows a one-click TTS setup CTA when playback reports missing local offline Qwen3-TTS model", () => {
    const onOpenTtsSetup = vi.fn();
    render(
      <AudiobookDock
        state={makeSnapshot({
          phase: "error",
          error: "本地离线语音模型（Qwen3-TTS 0.6B）尚未安装，请前往「设置」或「阅读环境设置」一键下载。",
        })}
        send={vi.fn()}
        onOpenTtsSetup={onOpenTtsSetup}
      />,
    );
    const button = screen.getByRole("button", { name: "一键安装离线语音" });
    fireEvent.click(button);
    expect(onOpenTtsSetup).toHaveBeenCalledOnce();
  });
});
