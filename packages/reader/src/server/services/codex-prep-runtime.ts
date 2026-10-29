import type { BookResearchReport } from "../../shared/book-research.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveCodexProxySettings } from "./codex-auth-transport.js";
import type { CodexModelOption, CodexModelUsage } from "../../shared/codex-prep-models.js";

export const CODEX_PREP_SANDBOX_MODE = "read-only";

export interface PrepTurnOptions {
  onDelta?: (text: string) => void;
  onResearch?: (report: BookResearchReport) => void;
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  sessionKey?: string;
  continuedInput?: string;
  model?: string;
  reasoningEffort?: string;
  onModelUsage?: (usage: CodexModelUsage) => void;
}
type RpcCall = { id?: number; method?: string; result?: any; error?: { message?: string }; params?: Record<string, any> };

async function launch(token: string, cwd: string, binary: string) {
  await mkdir(cwd, { recursive: true });
  // Never inherit the user's ~/.codex credentials, MCP tools, or unrelated personal instructions.
  const codexHome = path.join(cwd, ".codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const proxy = await resolveCodexProxySettings();
  const child = spawn(binary, [
    "app-server", "--listen", "stdio://",
    "-c", 'model_provider="openai_chatgpt_plan"',
    "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
    "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
    "-c", 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
    "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
    "-c", 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
    "-c", 'model_providers.openai_chatgpt_plan.supports_websockets=false',
  ], { cwd, env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: codexHome,
    CODEX_HOME: codexHome,
    ACCESS_TOKEN: token,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...(proxy.httpsProxy ? { HTTPS_PROXY: proxy.httpsProxy } : {}),
    ...(proxy.httpProxy ? { HTTP_PROXY: proxy.httpProxy } : {}),
    NO_PROXY: proxy.noProxy,
  }, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  return child;
}

class PrepSession {
  private nextId = 0;
  private buffer = "";
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private turn?: { resolve: (value: string) => void; reject: (error: Error) => void; answer: string; onDelta?: (text: string) => void; options: PrepTurnOptions; reroutedModel?: string };
  private threadId = "";
  turns = 0;
  closed = false;
  busy = false;
  idle?: ReturnType<typeof setTimeout>;
  constructor(private child: ChildProcessWithoutNullStreams, private timeoutMs: number) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      this.buffer += part;
      for (let cut = this.buffer.indexOf("\n"); cut !== -1; cut = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, cut); this.buffer = this.buffer.slice(cut + 1);
        let event: RpcCall;
        try { event = JSON.parse(line); } catch { continue; }
        if (typeof event.id === "number") {
          const pending = this.pending.get(event.id);
          this.pending.delete(event.id);
          if (event.error) pending?.reject(new Error(event.error.message ? `Codex 请求失败：${event.error.message}` : "Codex 请求失败，请重试")); else pending?.resolve(event.result);
        }
        const turn = this.turn;
        if (!turn) continue;
        if (event.method === "item/agentMessage/delta" && typeof event.params?.delta === "string") {
          turn.answer += event.params.delta; turn.onDelta?.(event.params.delta);
        }
        if (event.method === "item/completed" && event.params?.item?.type === "agentMessage" && !turn.answer && typeof event.params.item.text === "string") {
          turn.answer = event.params.item.text; turn.onDelta?.(turn.answer);
        }
        if (event.method === "turn/completed") {
          if (event.params?.turn?.status !== "completed") {
            const status = typeof event.params?.turn?.status === "string" ? event.params.turn.status : "unknown";
            const detail = typeof event.params?.turn?.error?.message === "string" ? event.params.turn.error.message : "";
            turn.reject(new Error(detail ? `Codex 本轮未完成（${status}）：${detail}` : `Codex 本轮未完成（${status}），请稍后重试`));
          }
          else if (!turn.answer.trim()) turn.reject(new Error("Codex 返回空内容"));
          else {
            turn.options.onModelUsage?.({
              modelId: turn.reroutedModel ?? turn.options.model ?? null,
              reasoningEffort: turn.options.reasoningEffort ?? null,
              requestedModelId: turn.options.model ?? null,
              requestedReasoningEffort: turn.options.reasoningEffort ?? null,
              generatedAt: new Date().toISOString(),
            });
            turn.resolve(turn.answer.trim());
          }
          this.turn = undefined;
        }
        if (event.method === "model/rerouted" && typeof event.params?.toModel === "string" && this.turn) this.turn.reroutedModel = event.params.toModel;
        if (event.method === "turn/failed") {
          const detail = typeof event.params?.error?.message === "string" ? event.params.error.message : "";
          turn.reject(new Error(detail ? `Codex 生成失败：${detail}` : "Codex 生成失败")); this.turn = undefined;
        }
      }
    });
    child.on("error", () => this.close(new Error("无法启动 Codex，请检查本机 Codex 安装")));
    child.on("exit", () => this.close(new Error("Codex 连接已结束，请重试")));
    child.stdin.on("error", () => this.close(new Error("Codex 连接已中断，请重试")));
  }
  private send(value: RpcCall) { if (!this.closed) this.child.stdin.write(`${JSON.stringify(value)}\n`); }
  private request(method: string, params: Record<string, unknown>): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Codex 连接已结束，请重试"));
    return new Promise((resolve, reject) => { const id = ++this.nextId; this.pending.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  async initialize(): Promise<void> {
    if (this.threadId) return;
    await this.request("initialize", { clientInfo: { name: "magazine_reader", title: "Magazine Reader", version: "0.1.0" }, capabilities: {} });
    this.send({ method: "initialized", params: {} });
  }
  async listModels(cwd: string): Promise<CodexModelOption[]> {
    await this.initialize();
    const models: CodexModelOption[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error("Codex 没有返回可识别的模型列表");
      for (const raw of result.data) {
        if (!raw || typeof raw !== "object" || typeof raw.model !== "string" || !raw.model) continue;
        models.push({
          id: typeof raw.id === "string" ? raw.id : raw.model,
          model: raw.model,
          displayName: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : raw.model,
          description: typeof raw.description === "string" ? raw.description : "",
          isDefault: raw.isDefault === true,
          hidden: raw.hidden === true,
          defaultReasoningEffort: typeof raw.defaultReasoningEffort === "string" ? raw.defaultReasoningEffort : "",
          supportedReasoningEfforts: Array.isArray(raw.supportedReasoningEfforts) ? raw.supportedReasoningEfforts.flatMap((option: any) => typeof option?.reasoningEffort === "string" ? [{ reasoningEffort: option.reasoningEffort, description: typeof option.description === "string" ? option.description : option.reasoningEffort }] : []) : [],
          upgrade: typeof raw.upgrade === "string" ? raw.upgrade : null,
          upgradeInfo: raw.upgradeInfo && typeof raw.upgradeInfo.model === "string" ? { model: raw.upgradeInfo.model, upgradeCopy: typeof raw.upgradeInfo.upgradeCopy === "string" ? raw.upgradeInfo.upgradeCopy : null, modelLink: typeof raw.upgradeInfo.modelLink === "string" ? raw.upgradeInfo.modelLink : null, migrationMarkdown: typeof raw.upgradeInfo.migrationMarkdown === "string" ? raw.upgradeInfo.migrationMarkdown : null, retirementAt: typeof raw.upgradeInfo.retirementAt === "number" ? raw.upgradeInfo.retirementAt : null } : null,
        });
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    } while (cursor);
    return models;
  }
  async run(input: string, cwd: string, options: PrepTurnOptions): Promise<string> {
    clearTimeout(this.idle); this.busy = true;
    const abort = () => this.close(new Error("备课请求已中断"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => this.close(new Error("Codex 响应超时，请重试")), this.timeoutMs);
    try {
      if (options.signal?.aborted) throw new Error("备课请求已中断");
      if (!this.threadId) {
        await this.initialize();
        const result = await this.request("thread/start", { cwd, approvalPolicy: "never", sandbox: CODEX_PREP_SANDBOX_MODE, ephemeral: true, ...(options.model ? { model: options.model } : {}) });
        if (typeof result?.thread?.id !== "string") throw new Error("Codex 未提供会话标识");
        this.threadId = result.thread.id;
      }
      const completed = new Promise<string>((resolve, reject) => { this.turn = { resolve, reject, answer: "", onDelta: options.onDelta, options }; });
      void completed.catch(() => undefined);
      await this.request("turn/start", { threadId: this.threadId, input: [{ type: "text", text: this.turns && options.continuedInput ? options.continuedInput : input }], approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, ...(options.model ? { model: options.model } : {}), ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}) });
      const answer = await completed; this.turns++; return answer;
    } catch (error) { this.close(); throw error; }
    finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); this.busy = false; }
  }
  close(error = new Error("Codex 会话已释放")) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.idle);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); this.turn?.reject(error); this.turn = undefined;
    this.child.kill(); this.child.stdin.destroy();
  }
}

/** Short-lived, isolated book sessions; no user Codex home or credentials are read. */
export class CodexPrepRuntime {
  private sessions = new Map<string, { token: string; session: PrepSession }>();
  private starting = new Set<string>();
  private generation = 0;
  constructor(private idleMs = 300_000, private timeoutMs = 150_000) {}
  async listModels(token: string, cwd: string, binary = process.env.CODEX_BINARY || path.resolve(cwd, "../../node_modules/.bin/codex")): Promise<CodexModelOption[]> {
    const child = await launch(token, cwd, binary);
    const session = new PrepSession(child, this.timeoutMs);
    const timer = setTimeout(() => session.close(new Error("Codex 模型列表请求超时，请重试")), this.timeoutMs);
    try { return await session.listModels(cwd); }
    finally { clearTimeout(timer); session.close(); }
  }
  async run(input: string, token: string, cwd: string, binary = process.env.CODEX_BINARY || path.resolve(cwd, "../../node_modules/.bin/codex"), options: PrepTurnOptions = {}): Promise<string> {
    const key = JSON.stringify([cwd, binary, options.sessionKey ?? "one-shot"]);
    if (this.starting.has(key)) throw new Error("该会话正在连接 Codex，请稍后重试");
    const generation = this.generation;
    let entry = this.sessions.get(key);
    if (entry && (entry.token !== token || entry.session.closed || entry.session.turns >= 10)) { entry.session.close(); this.sessions.delete(key); entry = undefined; }
    if (entry?.session.busy) throw new Error("该会话已有进行中的备课任务");
    if (!entry) {
      // Bound the number of idle processes without interrupting another book's turn.
      for (const [id, value] of this.sessions) if (value.session.closed || (this.sessions.size + this.starting.size >= 4 && !value.session.busy)) { value.session.close(); this.sessions.delete(id); }
      if (this.sessions.size + this.starting.size >= 4) throw new Error("备课任务较多，请稍后重试");
      if (options.signal?.aborted) throw new Error("备课请求已中断");
      this.starting.add(key);
      try {
        entry = { token, session: new PrepSession(await launch(token, cwd, binary), this.timeoutMs) };
        if (generation !== this.generation || options.signal?.aborted) { entry.session.close(); throw new Error("备课请求已中断"); }
        this.sessions.set(key, entry);
      } finally { this.starting.delete(key); }
    }
    const { session } = entry;
    try { return await session.run(input, cwd, options); }
    finally {
      if (session.closed || !options.sessionKey) { session.close(); this.sessions.delete(key); }
      else { session.idle = setTimeout(() => { session.close(); this.sessions.delete(key); }, this.idleMs); session.idle.unref(); }
    }
  }
  forget(sessionKey: string) {
    for (const [key, entry] of this.sessions) if (JSON.parse(key)[2] === sessionKey) { entry.session.close(); this.sessions.delete(key); }
  }
  close() { this.generation++; for (const { session } of this.sessions.values()) session.close(); this.sessions.clear(); }
}

export async function runCodexPrepTurn(input: string, token: string, cwd: string, binary?: string, options: PrepTurnOptions = {}): Promise<string> {
  const runtime = new CodexPrepRuntime();
  try { return await runtime.run(input, token, cwd, binary, options); } finally { runtime.close(); }
}
