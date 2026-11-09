// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TtsApiSettingsPanel } from "../packages/reader/src/frontend/tts-api-settings-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("offers configurable LAN API URL and key, tests the server and saves without retaining the credential in the form", async () => {
  const ttsProfileChanged = vi.fn();
  window.addEventListener("magazine-reader:tts-profile-updated", ttsProfileChanged);
  const saved = { mode: "worker", baseUrl: "", model: "qwen3-tts-0.6b", hasApiKey: false };
  const requests: Array<{ method: string; url: string; body?: Record<string, string> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : undefined;
    requests.push({ url, method, body });
    if (method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (method === "PUT") return new Response(JSON.stringify({ ...saved, mode: "api", baseUrl: body!.baseUrl, hasApiKey: true }), { status: 200 });
    return new Response(JSON.stringify(saved), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<TtsApiSettingsPanel />);
  await waitFor(() => expect(screen.getByText("当前：本机旧版 Worker")).toBeTruthy());
  const base = screen.getByRole("textbox", { name: "TTS API 地址" }) as HTMLInputElement;
  expect(base.value).toBe("http://192.168.3.54:18439/v1");
  fireEvent.change(screen.getByLabelText("TTS API Key"), { target: { value: "synthetic-test-credential" } });
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(screen.getByText(/API Key 验证成功/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "保存并使用" }));
  await waitFor(() => expect(screen.getByText("当前：独立 API")).toBeTruthy());
  expect((screen.getByLabelText("TTS API Key") as HTMLInputElement).value).toBe("");
  expect(requests.find(row => row.method === "POST")).toMatchObject({ url: "/api/tts-settings/test", body: { apiKey: "synthetic-test-credential" } });
  expect(requests.find(row => row.method === "PUT")).toMatchObject({ url: "/api/tts-settings", body: { apiKey: "synthetic-test-credential" } });
  expect(ttsProfileChanged).toHaveBeenCalledTimes(1);
  window.removeEventListener("magazine-reader:tts-profile-updated", ttsProfileChanged);
});

it("loads a saved LAN TTS endpoint without ever fetching the saved API Key", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    mode: "api", baseUrl: "http://192.168.3.54:18439/v1", model: "qwen3-tts-0.6b", hasApiKey: true,
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(<TtsApiSettingsPanel />);
  await waitFor(() => expect(screen.getByText("当前：独立 API")).toBeTruthy());
  expect((screen.getByLabelText("TTS API Key") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("TTS API Key") as HTMLInputElement).placeholder).toBe("已保存（留空保持不变）");
  expect(fetcher).toHaveBeenCalledWith("/api/tts-settings", expect.anything());
});

it("keeps my_voice bf16 API settings independent and never reflects its saved secret into inputs", async () => {
  const savedMy = { mode: "worker", baseUrl: "", model: "qwen3-tts-0.6b-base-bf16", hasApiKey: false };
  const savedOriginal = { mode: "api", baseUrl: "http://127.0.0.1:18439/v1", model: "qwen3-tts-0.6b", hasApiKey: true };
  const calls: Array<{ url: string; method: string; body?: Record<string, string> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : undefined;
    calls.push({ url, method, body });
    if (method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (method === "PUT") return new Response(JSON.stringify({ ...savedMy, mode: "api", baseUrl: body?.baseUrl, hasApiKey: true }), { status: 200 });
    return new Response(JSON.stringify(url.endsWith("/my-voice") ? savedMy : savedOriginal), { status: 200 });
  }));
  render(<TtsApiSettingsPanel />);
  await waitFor(() => expect(screen.getByText("我的声音：待配置")).toBeTruthy());
  expect((screen.getByLabelText("TTS API 地址") as HTMLInputElement).value).toBe(savedOriginal.baseUrl);
  expect((screen.getByLabelText("我的声音 API 地址") as HTMLInputElement).value).toBe("http://127.0.0.1:18441/v1");
  fireEvent.change(screen.getByLabelText("我的声音 API Key"), { target: { value: "isolated-test-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "测试我的声音连接" }));
  await waitFor(() => expect(screen.getByText(/bf16 API 连接成功/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "保存我的声音服务" }));
  await waitFor(() => expect(screen.getByText("我的声音：已配置")).toBeTruthy());
  expect((screen.getByLabelText("我的声音 API Key") as HTMLInputElement).value).toBe("");
  expect(calls.find(item => item.url === "/api/tts-settings/my-voice" && item.method === "PUT")?.body)
    .toMatchObject({ model: "qwen3-tts-0.6b-base-bf16", baseUrl: "http://127.0.0.1:18441/v1", apiKey: "isolated-test-secret" });
  expect(calls.filter(item => item.url === "/api/tts-settings" && item.method === "PUT")).toHaveLength(0);
});
