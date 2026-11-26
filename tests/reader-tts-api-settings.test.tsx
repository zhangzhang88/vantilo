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
  expect(screen.queryByText(/我的声音/)).toBeNull();
});

it("renders local Qwen3-TTS one-click installer card in settings and supports install with mirror and confirmed removal", async () => {
  const baseInstaller = {
    state: "not-installed",
    hardware: { supported: true, appleSilicon: true, memoryGiB: 16, reason: null },
    mirror: false,
    model: { id: "qwen3-tts-0.6b-q8-metal", displayName: "Qwen3-TTS 0.6B", totalDownloadBytes: 1219622221, installedDiskBytes: 1225123176, runtimeVersion: "v0.10.1", modelLicense: "Apache-2.0" },
    disk: { availableBytes: 50 * 1024 ** 3, requiredBytes: 1.7 * 1024 ** 3, sufficient: true },
    progress: { downloadedBytes: 0, totalBytes: 1219622221, percent: 0, bytesPerSecond: 0, phaseLabel: "" },
    paths: null as { binaryPath: string; modelPath: string } | null,
    error: null as string | null,
  };
  let current = baseInstaller;
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url === "/api/vantilo-tts-installer/status") return new Response(JSON.stringify(current), { status: 200 });
    if (url === "/api/vantilo-tts-installer/install") {
      current = { ...baseInstaller, state: "installed", mirror: Boolean(body?.mirror), paths: { binaryPath: "/u/speech", modelPath: "/u/model.gguf" } };
      return new Response(JSON.stringify(current), { status: 200 });
    }
    if (url === "/api/vantilo-tts-installer/remove") {
      current = baseInstaller;
      return new Response(JSON.stringify(current), { status: 200 });
    }
    return new Response(JSON.stringify({ mode: "worker", baseUrl: "", model: "qwen3-tts-0.6b", hasApiKey: false }), { status: 200 });
  }));

  render(<TtsApiSettingsPanel />);
  await waitFor(() => expect(screen.getByTestId("local-tts-installer-card")).toBeTruthy());
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "一键下载并启用" }));
  await waitFor(() => expect(screen.getByText("已安装并就绪")).toBeTruthy());
  expect(calls.find(c => c.url === "/api/vantilo-tts-installer/install")?.body).toEqual({ consent: true, mirror: true });
  expect(screen.getByText("当前：本机离线 Qwen3-TTS")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "卸载模型释放空间" }));
  fireEvent.click(screen.getByRole("button", { name: /确认卸载/ }));
  await waitFor(() => expect(screen.getByText("未安装")).toBeTruthy());

  // Updating in the host onboarding modal immediately refreshes an already-mounted settings panel.
  current = { ...baseInstaller, state: "installed", paths: { binaryPath: "/u/speech", modelPath: "/u/model.gguf" } };
  window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "vantilo:tts-installer-updated", installed: true } }));
  await waitFor(() => expect(screen.getByText("已安装并就绪")).toBeTruthy());
  expect((screen.getByTestId("tts-advanced-details") as HTMLDetailsElement).open).toBe(false);
});

it("folds advanced LAN TTS settings by default on Apple Silicon and lets users switch back to local offline model", async () => {
  const installer = {
    state: "installed",
    hardware: { supported: true, appleSilicon: true, memoryGiB: 16, reason: null },
    mirror: false,
    model: { id: "qwen3-tts-0.6b-q8-metal", displayName: "Qwen3-TTS 0.6B", totalDownloadBytes: 1219622221, installedDiskBytes: 1225123176, runtimeVersion: "v0.10.1", modelLicense: "Apache-2.0" },
    disk: { availableBytes: 50 * 1024 ** 3, requiredBytes: 1.7 * 1024 ** 3, sufficient: true },
    progress: { downloadedBytes: 1219622221, totalBytes: 1219622221, percent: 100, bytesPerSecond: 0, phaseLabel: "已安装并就绪" },
    paths: { binaryPath: "/u/speech", modelPath: "/u/model.gguf" },
    error: null,
  };
  let ttsConfig = { mode: "api", baseUrl: "http://127.0.0.1:18439/v1", model: "qwen3-tts-0.6b", hasApiKey: true };
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/vantilo-tts-installer/status") return new Response(JSON.stringify(installer), { status: 200 });
    if (url === "/api/tts-settings" && method === "DELETE") {
      ttsConfig = { mode: "worker", baseUrl: "", model: "qwen3-tts-0.6b", hasApiKey: false };
      return new Response(JSON.stringify(ttsConfig), { status: 200 });
    }
    if (url === "/api/tts-settings") return new Response(JSON.stringify(ttsConfig), { status: 200 });
    return new Response(JSON.stringify({ mode: "worker", baseUrl: "", model: "qwen3-tts-0.6b", hasApiKey: false }), { status: 200 });
  }));

  render(<TtsApiSettingsPanel />);
  await waitFor(() => expect(screen.getByRole("button", { name: "切回本机离线模型" })).toBeTruthy());
  expect((screen.getByTestId("tts-advanced-details") as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "切回本机离线模型" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "切回本机离线模型" })).toBeNull());
  expect(calls).toContainEqual({ url: "/api/tts-settings", method: "DELETE" });
});
