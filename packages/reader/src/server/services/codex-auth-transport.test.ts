import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createCodexAuthTransport, parseSystemHttpsProxy, resolveCodexProxySettings } from "./codex-auth-transport.js";

describe("OAuth network transport", () => {
  it("shares only proxy settings with the isolated Codex process, preserving explicit precedence", async () => {
    const read = vi.fn(async () => "HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 9999");
    await expect(resolveCodexProxySettings({ platform: "darwin", readSystemProxy: read, env: {
      HTTPS_PROXY: "http://127.0.0.1:1234", HTTP_PROXY: "http://127.0.0.1:1235", NO_PROXY: "localhost", UNRELATED_SECRET: "synthetic-secret",
    } })).resolves.toEqual({ httpsProxy: "http://127.0.0.1:1234", httpProxy: "http://127.0.0.1:1235", noProxy: "localhost" });
    expect(read).not.toHaveBeenCalled();
  });

  it("uses only enabled, valid macOS HTTPS proxy settings", () => {
    expect(parseSystemHttpsProxy("HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 1082")).toBe("http://127.0.0.1:1082");
    expect(parseSystemHttpsProxy("HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 1082")).toBeUndefined();
    expect(parseSystemHttpsProxy("HTTPSEnable : 1\nHTTPSProxy : user:password@proxy\nHTTPSPort : 1082")).toBeUndefined();
    expect(parseSystemHttpsProxy("HTTPSEnable : 1\nHTTPSProxy : proxy\nHTTPSPort : 70000")).toBeUndefined();
  });

  it("actually routes HTTPS through the configured system proxy instead of attempting direct DNS", async () => {
    const targets: string[] = [];
    const server = createServer();
    server.on("connect", (req, socket) => {
      targets.push(req.url!);
      socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No proxy address");
    const read = vi.fn(async () => `HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : ${address.port}`);
    const transport = createCodexAuthTransport({ platform: "darwin", env: {}, readSystemProxy: read });
    try {
      await expect(transport.fetch("https://synthetic.invalid/public")).rejects.toThrow();
      expect(targets).toEqual(["synthetic.invalid:443"]);
      expect(read).toHaveBeenCalledOnce();
    } finally {
      await transport.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("respects explicit proxy configuration and applies a bounded request signal", async () => {
    const read = vi.fn(async () => "");
    const fetchMock = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true });
    });
    const transport = createCodexAuthTransport({ platform: "darwin", env: { HTTPS_PROXY: "http://127.0.0.1:1234" }, readSystemProxy: read, fetchImpl: fetchMock });
    try {
      await transport.fetch("https://synthetic.invalid/public");
      expect(read).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { await transport.close(); }
  });
});
