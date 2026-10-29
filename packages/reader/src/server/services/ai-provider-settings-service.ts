import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AiProviderConnectionTestResponse,
  AiProviderModelsResponse,
  AiProviderProfileDraft,
  AiProviderProfilePublic,
  AiProviderSaveResponse,
  AiProviderSettingsPublic,
} from "../../shared/types.js";
import { extractResponseText } from "./translation-service.js";

interface StoredAiProviderProfile {
  id: string;
  name: string;
  description: string;
  responsesUrl: string;
  model: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredAiProviderSettings {
  version: 1;
  activeProfileId: string | null;
  profiles: StoredAiProviderProfile[];
}

interface AiProviderSettingsServiceOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  idFactory?: () => string;
}

export interface ActiveAiProviderProfile {
  id: string;
  name: string;
  description: string;
  responsesUrl: string;
  model: string;
  apiKey: string;
}

const SETTINGS_FILENAME = "ai-providers.local.json";
const MASKED_KEY = "••••••••";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateResponsesUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Responses URL 格式无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Responses URL 只支持 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("Responses URL 不应包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("Responses URL 不应包含 query 或 hash");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.toLowerCase().endsWith("/responses")) {
    throw new Error("Responses URL 必须指向 /responses 端点");
  }
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

function modelsUrlFromResponsesUrl(responsesUrl: string): string {
  const url = new URL(responsesUrl);
  url.pathname = url.pathname.replace(/\/responses\/?$/i, "/models");
  return url.toString().replace(/\/$/, "");
}

function legacyResponsesUrl(env: NodeJS.ProcessEnv): string {
  const base = trimmed(env.EASYCLIPROXY_BASE_URL) || "http://127.0.0.1:8317/v1";
  const normalized = base.replace(/\/+$/, "");
  return normalized.toLowerCase().endsWith("/responses") ? normalized : `${normalized}/responses`;
}

function publicProfile(profile: StoredAiProviderProfile): AiProviderProfilePublic {
  const hasApiKey = Boolean(profile.apiKey);
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    responsesUrl: profile.responsesUrl,
    model: profile.model,
    hasApiKey,
    apiKeyMasked: hasApiKey ? MASKED_KEY : "",
  };
}

function responseErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
      return String((error as Record<string, unknown>).message);
    }
    if (typeof record.message === "string") return record.message;
  }
  return `AI 服务请求失败 (${status})`;
}

export class AiProviderSettingsService {
  private state: StoredAiProviderSettings = { version: 1, activeProfileId: null, profiles: [] };
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly settingsPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  private constructor(projectRoot: string, options: AiProviderSettingsServiceOptions) {
    this.settingsPath = path.join(projectRoot, "config", SETTINGS_FILENAME);
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `profile-${randomUUID()}`);
  }

  static async create(
    projectRoot: string,
    options: AiProviderSettingsServiceOptions = {},
  ): Promise<AiProviderSettingsService> {
    const service = new AiProviderSettingsService(projectRoot, options);
    await service.loadOrSeed();
    return service;
  }

  getPublicSettings(): AiProviderSettingsPublic {
    return {
      version: 1,
      activeProfileId: this.state.activeProfileId,
      profiles: this.state.profiles.map(publicProfile),
    };
  }

  getActiveProfile(): ActiveAiProviderProfile | null {
    const id = this.state.activeProfileId;
    const profile = id ? this.state.profiles.find((candidate) => candidate.id === id) : undefined;
    if (!profile || !profile.apiKey) return null;
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      responsesUrl: profile.responsesUrl,
      model: profile.model,
      apiKey: profile.apiKey,
    };
  }

  hasConfiguredActiveProfile(): boolean {
    return Boolean(this.getActiveProfile());
  }

  async saveProfile(profileDraft: AiProviderProfileDraft, activate = false): Promise<AiProviderSaveResponse> {
    const existing = profileDraft.id
      ? this.state.profiles.find((profile) => profile.id === profileDraft.id)
      : undefined;
    if (profileDraft.id && !existing) throw new Error("AI 配置不存在");

    const name = trimmed(profileDraft.name);
    const description = trimmed(profileDraft.description);
    const model = trimmed(profileDraft.model);
    const responsesUrl = validateResponsesUrl(trimmed(profileDraft.responsesUrl));
    const submittedKey = trimmed(profileDraft.apiKey);
    const apiKey = submittedKey || existing?.apiKey || "";
    if (!name) throw new Error("名称不能为空");
    if (name.length > 120) throw new Error("名称过长");
    if (description.length > 500) throw new Error("描述过长");
    if (!model) throw new Error("模型不能为空");
    if (model.length > 200) throw new Error("模型名称过长");
    if (!apiKey) throw new Error("API Key 不能为空");
    if (apiKey.length > 8_000) throw new Error("API Key 过长");

    const timestamp = this.now().toISOString();
    const id = existing?.id ?? this.idFactory();
    const next: StoredAiProviderProfile = {
      id,
      name,
      description,
      responsesUrl,
      model,
      apiKey,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const index = this.state.profiles.findIndex((profile) => profile.id === id);
    if (index >= 0) this.state.profiles[index] = next;
    else this.state.profiles.push(next);
    if (activate || !this.state.activeProfileId) this.state.activeProfileId = id;
    await this.persist();
    return { ...this.getPublicSettings(), savedProfileId: id };
  }

  async activateProfile(id: string): Promise<AiProviderSettingsPublic> {
    const profile = this.state.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("AI 配置不存在");
    if (!profile.apiKey) throw new Error("AI 配置缺少 API Key");
    this.state.activeProfileId = id;
    await this.persist();
    return this.getPublicSettings();
  }

  async deleteProfile(id: string): Promise<AiProviderSettingsPublic> {
    const index = this.state.profiles.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error("AI 配置不存在");
    this.state.profiles.splice(index, 1);
    if (this.state.activeProfileId === id) {
      this.state.activeProfileId = this.state.profiles[0]?.id ?? null;
    }
    await this.persist();
    return this.getPublicSettings();
  }

  async testConnection(profileDraft: AiProviderProfileDraft): Promise<AiProviderConnectionTestResponse> {
    let profile: ActiveAiProviderProfile;
    try {
      profile = this.resolveDraft(profileDraft);
    } catch (error) {
      return {
        ok: false,
        model: trimmed(profileDraft.model),
        error: error instanceof Error ? error.message : "AI 配置无效",
      };
    }

    try {
      const response = await this.fetchImpl(profile.responsesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify({
          model: profile.model,
          instructions: "This is a connection test. Return only OK.",
          input: "Reply with OK only.",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        return { ok: false, model: profile.model, error: responseErrorMessage(payload, response.status) };
      }
      const output = extractResponseText(payload as Parameters<typeof extractResponseText>[0]);
      if (!output) return { ok: false, model: profile.model, error: "AI 服务返回为空" };
      return { ok: true, model: profile.model, output: output.slice(0, 240) };
    } catch (error) {
      return {
        ok: false,
        model: profile.model,
        error: error instanceof Error ? error.message : "无法连接 AI 服务",
      };
    }
  }

  async discoverModels(profileDraft: AiProviderProfileDraft): Promise<AiProviderModelsResponse> {
    const profile = this.resolveDraft(profileDraft);
    const modelsUrl = modelsUrlFromResponsesUrl(profile.responsesUrl);
    const response = await this.fetchImpl(modelsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${profile.apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(responseErrorMessage(payload, response.status));

    const raw: unknown[] = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data)
      ? (payload as Record<string, unknown>).data as unknown[]
      : Array.isArray(payload)
        ? payload
        : [];
    const models = raw
      .map((item) => item && typeof item === "object" ? trimmed((item as Record<string, unknown>).id) : "")
      .filter((id): id is string => Boolean(id))
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort((left, right) => left.localeCompare(right));
    if (!models.length) throw new Error("模型列表接口没有返回可用模型");
    return { models, modelsUrl };
  }

  private resolveDraft(profileDraft: AiProviderProfileDraft): ActiveAiProviderProfile {
    const existing = profileDraft.id
      ? this.state.profiles.find((profile) => profile.id === profileDraft.id)
      : undefined;
    const name = trimmed(profileDraft.name) || existing?.name || "临时 AI 配置";
    const description = trimmed(profileDraft.description) || existing?.description || "";
    const responsesUrl = validateResponsesUrl(trimmed(profileDraft.responsesUrl) || existing?.responsesUrl || "");
    const model = trimmed(profileDraft.model) || existing?.model || "";
    const apiKey = trimmed(profileDraft.apiKey) || existing?.apiKey || "";
    if (!model) throw new Error("模型不能为空");
    if (!apiKey) throw new Error("API Key 不能为空");
    return { id: existing?.id ?? "draft", name, description, responsesUrl, model, apiKey };
  }

  private async loadOrSeed(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredAiProviderSettings>;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) throw new Error("AI 配置文件格式无效");
      const profiles = parsed.profiles.filter((profile): profile is StoredAiProviderProfile => Boolean(
        profile
        && typeof profile.id === "string"
        && typeof profile.name === "string"
        && typeof profile.responsesUrl === "string"
        && typeof profile.model === "string"
        && typeof profile.apiKey === "string",
      ));
      const requestedActive = typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : null;
      this.state = {
        version: 1,
        profiles,
        activeProfileId: profiles.some((profile) => profile.id === requestedActive)
          ? requestedActive
          : profiles[0]?.id ?? null,
      };
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code && code !== "ENOENT") throw error;
    }

    const apiKey = trimmed(this.env.EASYCLIPROXY_API_KEY);
    if (!apiKey) return;
    const timestamp = this.now().toISOString();
    const model = trimmed(this.env.EASYCLIPROXY_MODEL) || "gpt-6-luna";
    const seeded: StoredAiProviderProfile = {
      id: "easycliproxy-default",
      name: "EasyCLIProxy - GPT",
      description: model === "gpt-6-luna" ? "GPT-6 Luna" : model,
      responsesUrl: validateResponsesUrl(legacyResponsesUrl(this.env)),
      model,
      apiKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state = { version: 1, activeProfileId: seeded.id, profiles: [seeded] };
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2) + "\n";
    const target = this.settingsPath;
    const temp = `${target}.tmp`;
    const task = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temp, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temp, target);
      await chmod(target, 0o600).catch(() => undefined);
    });
    this.writeQueue = task;
    await task;
  }
}
