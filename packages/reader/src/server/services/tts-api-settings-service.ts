import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

export interface TtsApiSettingsPublic {
  mode: "worker" | "api";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
export interface TtsApiProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface TtsApiSettingsDraft {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

const FILE = "tts-api.local.json";
const DEFAULT_MODEL = "qwen3-tts-0.6b";
const MY_VOICE_FILE = "tts-api-my-voice.local.json";
export const MY_VOICE_MODEL = "qwen3-tts-0.6b-base-bf16";
export const MY_VOICE_BASE_URL = "http://127.0.0.1:18441/v1";

/** Only explicit private IPv4 literals and loopback are accepted; no DNS, URL credentials or redirects. */
export function validateTtsApiBaseUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error("TTS API 地址格式无效"); }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "/v1") {
    throw new Error("TTS API 地址应为局域网 http://IP:端口/v1，不支持其他路径或参数");
  }
  if (url.hostname !== "localhost") {
    const octets = url.hostname.split(".");
    if (octets.length !== 4 || octets.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error("TTS API 仅支持局域网 IPv4 地址");
    const [a, b] = octets.map(Number);
    if (!(a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31))) {
      throw new Error("TTS API 地址必须是本机或私有局域网 IP");
    }
  }
  url.pathname = "/v1";
  return url.toString().replace(/\/$/, "");
}

export class TtsApiSettingsService {
  private state: TtsApiProfile | null = null;
  private writeQueue = Promise.resolve();
  private constructor(private filePath: string, private expectedModel = DEFAULT_MODEL) {}

  static async create(userDataRoot: string, kind: "custom" | "my_voice" = "custom"): Promise<TtsApiSettingsService> {
    const model = kind === "my_voice" ? MY_VOICE_MODEL : DEFAULT_MODEL;
    const service = new TtsApiSettingsService(path.join(userDataRoot, "tts", kind === "my_voice" ? MY_VOICE_FILE : FILE), model);
    try {
      const data: unknown = JSON.parse(await readFile(service.filePath, "utf8"));
      if (data && typeof data === "object") {
        const record = data as Record<string, unknown>;
        if (typeof record.baseUrl === "string" && typeof record.apiKey === "string" && typeof record.model === "string"
          && record.apiKey && record.model === model) {
          service.state = { baseUrl: validateTtsApiBaseUrl(record.baseUrl), model: record.model, apiKey: record.apiKey };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("读取 TTS API 私有配置失败", { cause: error });
    }
    return service;
  }

  publicSettings(): TtsApiSettingsPublic {
    return this.state
      ? { mode: "api", baseUrl: this.state.baseUrl, model: this.state.model, hasApiKey: true }
      : { mode: "worker", baseUrl: "", model: this.expectedModel, hasApiKey: false };
  }
  activeProfile(): TtsApiProfile | null { return this.state && { ...this.state }; }

  resolveDraft(draft: TtsApiSettingsDraft): TtsApiProfile {
    const baseUrl = validateTtsApiBaseUrl(draft.baseUrl);
    if (draft.model !== this.expectedModel) throw new Error("TTS 模型与当前服务配置不匹配");
    const apiKey = draft.apiKey?.trim() || (this.state?.baseUrl === baseUrl ? this.state.apiKey : "");
    if (!apiKey || apiKey.length > 1024 || /\s/.test(apiKey)) throw new Error("请填写有效的 TTS API Key");
    return { baseUrl, model: this.expectedModel, apiKey };
  }

  async save(draft: TtsApiSettingsDraft): Promise<TtsApiSettingsPublic> {
    const validated = this.resolveDraft(draft);
    const serialized = JSON.stringify({ version: 1, ...validated });
    const task = this.writeQueue.then(async () => {
      const folder = path.dirname(this.filePath);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temporary = this.filePath + ".writing";
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "w" });
      await chmod(temporary, 0o600);
      await rename(temporary, this.filePath);
      this.state = validated;
    });
    this.writeQueue = task.catch(() => {});
    await task;
    return this.publicSettings();
  }
}
