import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCodexAuthTransport } from "./codex-auth-transport.js";

const AUTHORIZATION = "https://auth.openai.com/api/accounts/authorize";
const TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS = "https://auth.openai.com/.well-known/jwks.json";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

interface SavedAuth {
  hostId: string;
  clientId?: string;
  subject?: string;
  email?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

interface PendingAuth { state: string; nonce: string; verifier: string; clientId: string; redirectUri: string; }

export interface CodexAuthPublicState { connected: boolean; sharing: boolean; email?: string; pending: boolean; error?: string; }

function randomValue(): string { return randomBytes(32).toString("base64url"); }

class AuthHttpError extends Error {
  constructor(readonly status: number) { super(`ChatGPT 授权请求失败（HTTP ${status}）`); }
}

type IdentityFailure = "INVALID_TOKEN" | "UNSUPPORTED_ALGORITHM" | "MISSING_KEY_ID" | "KEY_NOT_FOUND"
  | "INVALID_KEY" | "INVALID_SIGNATURE" | "ISSUER_MISMATCH" | "AUDIENCE_MISMATCH"
  | "AUTHORIZED_PARTY_MISMATCH" | "NONCE_MISMATCH" | "INVALID_SUBJECT" | "TOKEN_EXPIRED";

class IdentityValidationError extends Error {
  constructor(code: IdentityFailure) { super(`验证 ChatGPT 身份失败（${code}），请重新连接 ChatGPT`); }
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object") throw new AuthHttpError(response.status);
  return value as Record<string, unknown>;
}

export async function verifyIdentityToken(token: string, clientId: string, nonce: string, fetchImpl: typeof fetch): Promise<{ subject: string; email?: string }> {
  const chunks = token.split(".");
  if (chunks.length !== 3) throw new IdentityValidationError("INVALID_TOKEN");
  let header: Record<string, unknown>;
  let body: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(chunks[0], "base64url").toString("utf8")) as Record<string, unknown>;
    body = JSON.parse(Buffer.from(chunks[1], "base64url").toString("utf8")) as Record<string, unknown>;
    if (!header || !body || typeof header !== "object" || typeof body !== "object" || Array.isArray(header) || Array.isArray(body)) throw new Error();
  } catch { throw new IdentityValidationError("INVALID_TOKEN"); }
  if (header.alg !== "RS256") throw new IdentityValidationError("UNSUPPORTED_ALGORITHM");
  if (typeof header.kid !== "string" || !header.kid) throw new IdentityValidationError("MISSING_KEY_ID");
  const loadKey = async () => {
    const jwks = await parseJson(await fetchImpl(JWKS, { headers: { "Cache-Control": "no-cache" } }));
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    return keys.find((candidate) => candidate && typeof candidate === "object" && (candidate as { kid?: string }).kid === header.kid);
  };
  // An unfamiliar key may be a signing-key rotation; refresh once before rejecting it.
  const key = await loadKey() ?? await loadKey();
  if (!key) throw new IdentityValidationError("KEY_NOT_FOUND");
  let valid: boolean;
  try {
    valid = verify("RSA-SHA256", Buffer.from(`${chunks[0]}.${chunks[1]}`), createPublicKey({ key: key as never, format: "jwk" }), Buffer.from(chunks[2], "base64url"));
  } catch { throw new IdentityValidationError("INVALID_KEY"); }
  if (!valid) throw new IdentityValidationError("INVALID_SIGNATURE");
  if (body.iss !== "https://auth.openai.com") throw new IdentityValidationError("ISSUER_MISMATCH");
  const audiences = typeof body.aud === "string" ? [body.aud] : body.aud;
  if (!Array.isArray(audiences) || !audiences.every((value) => typeof value === "string") || !audiences.includes(clientId)) {
    throw new IdentityValidationError("AUDIENCE_MISMATCH");
  }
  if ((body.azp !== undefined && body.azp !== clientId) || (audiences.length > 1 && body.azp !== clientId)) throw new IdentityValidationError("AUTHORIZED_PARTY_MISMATCH");
  if (body.nonce !== nonce) throw new IdentityValidationError("NONCE_MISMATCH");
  if (typeof body.sub !== "string" || !body.sub) throw new IdentityValidationError("INVALID_SUBJECT");
  // Match the official example's five-second clock tolerance.
  if (typeof body.exp !== "number" || !Number.isFinite(body.exp) || body.exp <= Date.now() / 1000 - 5) throw new IdentityValidationError("TOKEN_EXPIRED");
  return { subject: body.sub, ...(typeof body.email === "string" ? { email: body.email } : {}) };
}

export class CodexAuthService {
  private state: SavedAuth | null = null;
  private pending: PendingAuth | null = null;
  private listener: Server | null = null;
  private lastError: string | null = null;
  private readonly file: string;
  private readonly fetchImpl: typeof fetch;
  private refreshPending: Promise<string> | null = null;
  private readonly transport?: ReturnType<typeof createCodexAuthTransport>;

  constructor(dataDir: string, fetchImpl?: typeof fetch) {
    this.file = path.join(dataDir, "codex-auth.local.json");
    this.transport = fetchImpl ? undefined : createCodexAuthTransport();
    this.fetchImpl = fetchImpl ?? this.transport!.fetch;
  }

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8")) as SavedAuth;
      if (typeof saved.hostId === "string" && saved.hostId.startsWith("urn:uuid:")) this.state = saved;
    } catch { /* First run. */ }
    if (!this.state) { this.state = { hostId: `urn:uuid:${randomUUID()}` }; await this.persist(); }
  }

  private async persist(state = this.state): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }

  status(): CodexAuthPublicState {
    return { connected: Boolean(this.state?.subject), sharing: Boolean(this.state?.scopes?.includes("chatgpt.tokens.use.direct") && this.state?.refreshToken), email: this.state?.email, pending: Boolean(this.pending), ...(this.lastError ? { error: this.lastError } : {}) };
  }

  async start(): Promise<string> {
    if (this.pending) throw new Error("已有进行中的 ChatGPT 授权，请先完成或稍后重试");
    this.lastError = null;
    if (!this.state) await this.load();
    const state = randomValue();
    const nonce = randomValue();
    const verifier = randomValue();
    const clientId = this.state?.clientId ?? "dynamic_agent_client";
    const listener = createServer((req, res) => {
      const uri = new URL(req.url ?? "/", "http://127.0.0.1");
      if (uri.pathname !== "/auth/callback") { res.writeHead(404); res.end(); return; }
      void this.finish(uri.searchParams).then(() => {
        const message = this.status().sharing ? "ChatGPT 已授权，请回到 Magazine Reader 开始备课。"
          : this.lastError ?? "账号已登录，但未授权 ChatGPT 计划额度，请回到 Magazine Reader 重新连接。";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        res.end(`<!doctype html><meta charset=utf-8><title>Magazine Reader</title><script>history.replaceState(null,"","/auth/callback")</script><p>${message}</p>`);
      }).catch(() => { res.writeHead(500); res.end("授权处理失败，请回到 Magazine Reader 重试。"); });
    });
    try { await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); }); }
    catch (error) { listener.close(); throw error; }
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("无法创建本地 OAuth 回调监听");
    this.listener = listener;
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    this.pending = { state, nonce, verifier, clientId, redirectUri };
    const url = new URL(AUTHORIZATION);
    const params: Record<string, string> = {
      client_id: clientId, ext_agent_host_id: this.state!.hostId, response_type: "code",
      redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
    if (clientId === "dynamic_agent_client") params.agent_name_hint = "magazine_reader";
    else if (this.state?.idToken) params.id_token_hint = this.state.idToken;
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    // Avoid a server left listening indefinitely after an abandoned authorization attempt.
    listener.timeout = 180_000;
    setTimeout(() => { if (this.listener === listener) { this.stopListener(); this.lastError = "授权超时，请重新连接 ChatGPT"; } }, 180_000).unref();
    return url.toString();
  }

  private stopListener(clearPending = true): void {
    this.listener?.close(); this.listener = null;
    if (clearPending) this.pending = null;
  }

  private async finish(params: URLSearchParams): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    // Closing the callback socket must not end the observable authorization attempt.
    this.stopListener(false);
    let stage = "交换授权码";
    try {
      if (params.get("state") !== pending.state) { this.lastError = "OAuth 状态校验失败，请重新连接"; return; }
      if (params.has("error")) { this.lastError = "未完成 ChatGPT 授权，请重新连接"; return; }
      const code = params.get("code");
      const receivedClientId = params.get("client_id");
      if (!code) { this.lastError = "未收到 ChatGPT 授权码"; return; }
      const clientId = pending.clientId === "dynamic_agent_client" ? receivedClientId : pending.clientId;
      if (!clientId || clientId === "dynamic_agent_client" || (receivedClientId && receivedClientId !== clientId)) { this.lastError = "ChatGPT 客户端注册信息不完整"; return; }
      const data = await parseJson(await this.fetchImpl(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }) }));
      if (typeof data.id_token !== "string" || typeof data.access_token !== "string") throw new Error("未收到有效 OAuth 凭据");
      stage = "验证 ChatGPT 身份";
      const identity = await verifyIdentityToken(data.id_token, clientId, pending.nonce, this.fetchImpl);
      if (this.pending !== pending) return;
      if (this.state?.subject && this.state.subject !== identity.subject) throw new Error("授权身份与原账户不一致");
      const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/) : [];
      const saved: SavedAuth = {
        hostId: this.state!.hostId, clientId, subject: identity.subject, email: identity.email,
        idToken: data.id_token, accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        scopes, expiresAt: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000,
      };
      stage = "保存授权结果";
      await this.persist(saved);
      if (this.pending === pending) this.state = saved;
    } catch (error) {
      if (this.pending !== pending) return;
      this.lastError = error instanceof IdentityValidationError ? error.message
        : error instanceof AuthHttpError ? `${stage}失败（HTTP ${error.status}），请重新连接 ChatGPT`
        : error instanceof TypeError || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
          ? "无法连接 OpenAI 授权服务，请检查系统代理或网络后重新连接"
          : `${stage}失败，请重新连接 ChatGPT`;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  async accessToken(): Promise<string> {
    if (!this.status().sharing || !this.state?.accessToken || !this.state.clientId) throw new Error("请先通过 ChatGPT 授权 AI 使用额度");
    if ((this.state.expiresAt ?? 0) > Date.now() + 90_000) return this.state.accessToken;
    if (!this.refreshPending) this.refreshPending = this.refresh().finally(() => { this.refreshPending = null; });
    return this.refreshPending;
  }

  private async refresh(): Promise<string> {
    const state = this.state!;
    const data = await parseJson(await this.fetchImpl(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: state.clientId!, refresh_token: state.refreshToken!, resource: RESOURCE }) }));
    if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") throw new Error("ChatGPT 授权过期，请重新连接");
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/) : state.scopes ?? [];
    if (!scopes.includes("chatgpt.tokens.use.direct")) throw new Error("未授权 ChatGPT 计划额度");
    this.state = { ...state, accessToken: data.access_token, refreshToken: data.refresh_token, scopes, expiresAt: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 };
    await this.persist();
    return data.access_token;
  }

  async disconnect(): Promise<void> {
    this.stopListener();
    this.lastError = null;
    this.state = { hostId: this.state?.hostId ?? `urn:uuid:${randomUUID()}` };
    await this.persist();
  }

  async close(): Promise<void> { this.stopListener(); await this.transport?.close(); }
}
