import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAuthService, verifyIdentityToken } from "./codex-auth-service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function syntheticIdentity(clientId: string | string[], nonce: string, subject = "account-a", claims: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", ...headers })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: clientId, nonce, sub: subject, email: "synthetic@example.invalid", exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return { token: `${header}.${payload}.${signature}`, jwks: { keys: [{ ...jwk, kid: "test-key" }] } };
}

describe("local ChatGPT OAuth", () => {
  it.each([
    { audience: ["oaiapp_test"], claims: {} },
    { audience: ["other-resource", "oaiapp_test"], claims: { azp: "oaiapp_test" } },
  ])("accepts standard audience representations and small clock skew: $audience", async ({ audience, claims }) => {
    const identity = syntheticIdentity(audience, "nonce", "account-a", claims);
    const fetchMock = vi.fn(async () => Response.json(identity.jwks));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).resolves.toMatchObject({ subject: "account-a" });
  });

  it("allows only the documented five-second clock tolerance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
    try {
      const identity = syntheticIdentity("oaiapp_test", "nonce", "account-a", { exp: Date.now() / 1000 - 3 });
      const fetchMock = vi.fn(async () => Response.json(identity.jwks));
      await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).resolves.toMatchObject({ subject: "account-a" });
      vi.advanceTimersByTime(3000);
      await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).rejects.toThrow("TOKEN_EXPIRED");
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { claims: { iss: "https://untrusted.invalid" }, code: "ISSUER_MISMATCH" },
    { claims: { aud: ["different-client"] }, code: "AUDIENCE_MISMATCH" },
    { claims: { aud: ["oaiapp_test", "other"] }, code: "AUTHORIZED_PARTY_MISMATCH" },
    { claims: { azp: "different-client" }, code: "AUTHORIZED_PARTY_MISMATCH" },
    { claims: { nonce: "different-nonce" }, code: "NONCE_MISMATCH" },
    { claims: { exp: Math.floor(Date.now() / 1000) - 60 }, code: "TOKEN_EXPIRED" },
    { claims: { exp: undefined }, code: "TOKEN_EXPIRED" },
    { claims: { sub: "" }, code: "INVALID_SUBJECT" },
  ])("rejects invalid signed identities with safe diagnostics: $code", async ({ claims, code }) => {
    const identity = syntheticIdentity("oaiapp_test", "nonce", "account-a", claims);
    const fetchMock = vi.fn(async () => Response.json(identity.jwks));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).rejects.toThrow(code);
  });

  it("refreshes an unfamiliar signing key once and still rejects unknown keys", async () => {
    const identity = syntheticIdentity("oaiapp_test", "nonce");
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ keys: [] })).mockResolvedValueOnce(Response.json(identity.jwks));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).resolves.toMatchObject({ subject: "account-a" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const missing = vi.fn(async () => Response.json({ keys: [] }));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", missing)).rejects.toThrow("KEY_NOT_FOUND");
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it.each([
    { headers: { alg: "HS256" }, code: "UNSUPPORTED_ALGORITHM" },
    { headers: { kid: undefined }, code: "MISSING_KEY_ID" },
  ])("rejects unsupported headers without exposing their values: $code", async ({ headers, code }) => {
    const identity = syntheticIdentity("oaiapp_test", "nonce", "account-a", {}, headers);
    const fetchMock = vi.fn(async () => Response.json(identity.jwks));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "nonce", fetchMock)).rejects.toThrow(code);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps pending through token exchange and identity verification, and only then reports callback success", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-oauth-test-"));
    roots.push(root);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let identity: ReturnType<typeof syntheticIdentity>;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/oauth/token")) {
        await gate;
        return Response.json({ id_token: identity.token, access_token: "synthetic-access", refresh_token: "synthetic-refresh", scope: "openid chatgpt.tokens.use.direct" });
      }
      return Response.json(identity.jwks);
    });
    const auth = new CodexAuthService(root, fetchMock);
    try {
      const url = new URL(await auth.start());
      identity = syntheticIdentity("oaiapp_test", url.searchParams.get("nonce")!);
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "synthetic-code", client_id: "oaiapp_test" }).toString();
      const result = fetch(callback);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(auth.status()).toMatchObject({ pending: true, connected: false, sharing: false });
      await expect(auth.start()).rejects.toThrow("已有进行中的");
      release();
      const response = await result;
      const html = await response.text();
      expect(html).toContain("ChatGPT 已授权");
      expect(html).toContain("history.replaceState");
      expect(html).not.toContain("synthetic-access");
      expect(html).not.toContain("synthetic-code");
      expect(auth.status()).toMatchObject({ pending: false, connected: true, sharing: true });
    } finally { release(); await auth.close(); }
  });

  it.each(["network", "http", "signature"])("reports a safe %s failure on both callback and status instead of premature success", async (failure) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-oauth-test-"));
    roots.push(root);
    const fetchMock = vi.fn(async () => {
      if (failure === "network") throw new TypeError("secret-token-must-not-leak");
      if (failure === "http") return Response.json({ error: "secret-code-must-not-leak" }, { status: 400 });
      return Response.json({ id_token: "invalid.synthetic.signature", access_token: "secret-token-must-not-leak" });
    });
    const auth = new CodexAuthService(root, fetchMock);
    try {
      const url = new URL(await auth.start());
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "synthetic-code", client_id: "oaiapp_test" }).toString();
      const html = await (await fetch(callback)).text();
      const status = auth.status();
      expect(status).toMatchObject({ pending: false, connected: false, sharing: false });
      expect(status.error).toBeTruthy();
      expect(html).toContain(status.error);
      expect(html).not.toContain("ChatGPT 已授权");
      expect(JSON.stringify(status) + html).not.toContain("secret-");
      if (failure === "network") expect(status.error).toContain("系统代理或网络");
      if (failure === "http") expect(status.error).toContain("HTTP 400");
      if (failure === "signature") expect(status.error).toContain("INVALID_TOKEN");
    } finally { await auth.close(); }
  });

  it("verifies JWT signature, audience and nonce", async () => {
    const identity = syntheticIdentity("oaiapp_test", "my-nonce");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(identity.jwks), { status: 200 }));
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "my-nonce", fetchMock as typeof fetch)).resolves.toMatchObject({ subject: "account-a" });
    await expect(verifyIdentityToken(identity.token, "wrong-client", "my-nonce", fetchMock as typeof fetch)).rejects.toThrow();
    await expect(verifyIdentityToken(identity.token, "oaiapp_test", "wrong-nonce", fetchMock as typeof fetch)).rejects.toThrow();
    const tampered = identity.token.slice(0, -8) + randomBytes(6).toString("base64url");
    await expect(verifyIdentityToken(tampered, "oaiapp_test", "my-nonce", fetchMock as typeof fetch)).rejects.toThrow();
  });

  it("starts loopback PKCE, rejects incorrect state, never returns credentials to the caller", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-oauth-test-"));
    roots.push(root);
    const auth = new CodexAuthService(root);
    await auth.load();
    const url = new URL(await auth.start());
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    await fetch(`${url.searchParams.get("redirect_uri")!}?code=fake&state=wrong&client_id=oaiapp_test`);
    expect(auth.status()).toMatchObject({ connected: false, sharing: false, pending: false, error: "OAuth 状态校验失败，请重新连接" });
    await expect(auth.accessToken()).rejects.toThrow();
    expect((await stat(path.join(root, "codex-auth.local.json"))).mode & 0o777).toBe(0o600);
  });
});
