// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodexPrepPanel } from "./codex-prep-panel";

vi.mock("./api", () => ({
  fetchCodexPrepModelPreferences: vi.fn(async () => ({
    modelMode: "auto", model: null, reasoningMode: "auto", reasoningEffort: null,
  })),
  fetchCodexPrepModels: vi.fn(async () => ({ models: [], defaultModelId: null })),
  saveCodexPrepModelPreferences: vi.fn(async (value: unknown) => value),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockConnectedAssistant() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/prep/auth") return { ok: true, json: async () => ({ connected: true, sharing: true, pending: false }), headers: { get: () => null } };
    if (url.includes("/history?scope=")) return { ok: true, json: async () => [], headers: { get: () => "source-fingerprint" } };
    throw new Error("Unexpected network request: " + url);
  }));
}

it("uses English-article creation guidance only inside the AI practice workshop", async () => {
  mockConnectedAssistant();
  render(<CodexPrepPanel scope={{ kind: "practice" }} scopeLabel="Practice Lab · 英文创作" onClose={() => {}} />);
  expect(screen.getByText("Practice Lab · 英文创作")).toBeTruthy();
  await screen.findByText(/告诉我想练什么主题、英语水平或目标词汇/);
  expect(screen.getByRole("complementary", { name: "英文文章创作助手" })).toBeTruthy();
  const picker = screen.getByRole("group", { name: "英文创作快捷提示" });
  expect(picker.textContent).toContain("帮我确定主题");
  expect(picker.textContent).toContain("生成英文短文");
  expect(picker.textContent).toContain("指定词汇写文章");
  expect(picker.textContent).toContain("简化现有文章");
  for (const old of ["全部书刊","推荐适合我的阅读","这里有哪些内容","用简单中文解释"]) {
    expect(screen.queryByText(old)).toBeNull();
  }
  fireEvent.click(screen.getByRole("button", { name: "生成英文短文" }));
  const textarea = screen.getByRole("textbox", { name: "消息输入" }) as HTMLTextAreaElement;
  expect(textarea.value).toContain("只输出可以直接复制到 Practice Lab 的英文正文");
  expect(textarea.placeholder).toContain("例如：写一篇");
  expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
  const calls = vi.mocked(fetch).mock.calls;
  await waitFor(() => expect(calls.some(([url]) => String(url).includes('%22practice%22'))).toBe(true));
});

it("retains the original reading suggestions on the book shelf", async () => {
  mockConnectedAssistant();
  render(<CodexPrepPanel scope={{ kind: "books" }} scopeLabel="电子书书架" onClose={() => {}} />);
  await screen.findByText(/可以问我选什么、讲了什么/);
  expect(screen.getByRole("group", { name: "阅读快捷提示" }).textContent).toContain("推荐适合我的阅读");
  expect(screen.queryByText("生成英文短文")).toBeNull();
});
