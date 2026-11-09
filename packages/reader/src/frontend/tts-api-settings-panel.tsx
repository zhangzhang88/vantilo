import { useEffect, useState } from "react";

interface PublicSettings {
  mode: "worker" | "api";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
const DEFAULT_BASE = "http://192.168.3.54:18439/v1";
const DEFAULT_MODEL = "qwen3-tts-0.6b";
const MY_VOICE_BASE = "http://127.0.0.1:18441/v1";
const MY_VOICE_MODEL = "qwen3-tts-0.6b-base-bf16";
const message = (error: unknown) => error instanceof Error ? error.message : "请求失败";

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;
    throw new Error(typeof error === "string" ? error : "TTS API 操作失败");
  }
  return body as T;
}

/** API credentials are submitted only to the local Reader backend. */
export function TtsApiSettingsPanel() {
  const [config, setConfig] = useState<PublicSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [myConfig, setMyConfig] = useState<PublicSettings | null>(null);
  const [myBaseUrl, setMyBaseUrl] = useState(MY_VOICE_BASE);
  const [myApiKey, setMyApiKey] = useState("");
  const [myBusy, setMyBusy] = useState(false);
  const [myFeedback, setMyFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void requestApi<PublicSettings>("/api/tts-settings")
      .then(result => {
        if (!alive) return;
        setConfig(result);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
      })
      .catch(error => { if (alive) setFeedback({ kind: "error", text: message(error) }); });
    void requestApi<PublicSettings>("/api/tts-settings/my-voice")
      .then(result => {
        if (!alive) return;
        setMyConfig(result);
        if (result.baseUrl) setMyBaseUrl(result.baseUrl);
      })
      .catch(error => { if (alive) setMyFeedback({ kind: "error", text: message(error) }); });
    return () => { alive = false; };
  }, []);

  const draft = () => ({ baseUrl: baseUrl.trim(), model: DEFAULT_MODEL, apiKey: apiKey.trim() });
  async function run(mode: "test" | "save") {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try {
      if (mode === "test") {
        await requestApi<{ ok: boolean }>("/api/tts-settings/test", { method: "POST", body: JSON.stringify(draft()) });
        setFeedback({ kind: "success", text: "已连接 Qwen3-TTS 服务，API Key 验证成功" });
      } else {
        const result = await requestApi<PublicSettings>("/api/tts-settings", { method: "PUT", body: JSON.stringify(draft()) });
        setConfig(result); setApiKey("");
        window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
        setFeedback({ kind: "success", text: "已保存。中文听书与逐句英文朗读将使用此独立 API 服务。" });
      }
    } catch (error) {
      setFeedback({ kind: "error", text: message(error) });
    } finally { setBusy(false); }
  }

  const myDraft = () => ({ baseUrl: myBaseUrl.trim(), model: MY_VOICE_MODEL, apiKey: myApiKey.trim() });
  async function runMyVoice(mode: "test" | "save") {
    if (myBusy) return;
    setMyBusy(true); setMyFeedback(null);
    try {
      if (mode === "test") {
        await requestApi<{ ok: boolean }>("/api/tts-settings/my-voice/test", { method: "POST", body: JSON.stringify(myDraft()) });
        setMyFeedback({ kind: "success", text: "「我的声音」bf16 API 连接成功" });
      } else {
        const result = await requestApi<PublicSettings>("/api/tts-settings/my-voice", { method: "PUT", body: JSON.stringify(myDraft()) });
        setMyConfig(result); setMyApiKey("");
        window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
        setMyFeedback({ kind: "success", text: "「我的声音」已保存；中文听书选择它时将自动使用独立的 bf16 API。" });
      }
    } catch (error) { setMyFeedback({ kind: "error", text: message(error) }); }
    finally { setMyBusy(false); }
  }

  return <>
  <section className="tts-api-settings">
    <h3>本地 TTS 服务</h3>
    <p className="settings-help">独立 Qwen3-TTS API，可由 Mac mini 或同一局域网的电脑提供。模型只在服务端运行；中文听书和英文逐句朗读共用此服务。</p>
    <div className="tts-api-fields">
      <label className="ai-field ai-field-wide">
        <span>API 地址</span>
        <input aria-label="TTS API 地址" type="url" spellCheck={false} value={baseUrl}
          onChange={event => { setBaseUrl(event.target.value); setFeedback(null); }} placeholder={DEFAULT_BASE}/>
      </label>
      <label className="ai-field">
        <span>模型</span>
        <input aria-label="TTS 模型" readOnly value={DEFAULT_MODEL}/>
      </label>
      <label className="ai-field">
        <span>API Key</span>
        <input aria-label="TTS API Key" type="password" autoComplete="off" spellCheck={false}
          value={apiKey} onChange={event => { setApiKey(event.target.value); setFeedback(null); }}
          placeholder={config?.hasApiKey ? "已保存（留空保持不变）" : "输入 TTS API Key"} />
      </label>
    </div>
    <div className="ai-settings-actions">
      <button type="button" className="ai-settings-button" disabled={busy} onClick={() => void run("test")}>测试连接</button>
      <button type="button" className="ai-settings-button is-primary" disabled={busy} onClick={() => void run("save")}>保存并使用</button>
      <span className="tts-api-settings-state">{config?.mode === "api" ? "当前：独立 API" : "当前：本机旧版 Worker"}</span>
    </div>
    {feedback && <p role="status" className={feedback.kind === "error" ? "tts-api-settings-error" : "tts-api-settings-success"}>{feedback.text}</p>}
    <p className="settings-help">API Key 仅交给本机 Reader 服务端保存，不会返回浏览器。当前网关使用局域网 HTTP，请只在可信网络内使用，不要开放公网端口。</p>
  </section>
  <section className="tts-api-settings">
    <h3>我的声音 · 独立 bf16 服务</h3>
    <p className="settings-help">仅供中文听书的个人克隆音色使用。它与上方的 Qwen CustomVoice API 分开保存；不影响 Serena、Vivian 等音色或英文逐句朗读。</p>
    <div className="tts-api-fields">
      <label className="ai-field ai-field-wide"><span>API 地址</span>
        <input aria-label="我的声音 API 地址" type="url" spellCheck={false} value={myBaseUrl}
          onChange={event => { setMyBaseUrl(event.target.value); setMyFeedback(null); }} placeholder={MY_VOICE_BASE} />
      </label>
      <label className="ai-field"><span>模型</span>
        <input aria-label="我的声音模型" readOnly value={MY_VOICE_MODEL}/>
      </label>
      <label className="ai-field"><span>API Key</span>
        <input aria-label="我的声音 API Key" type="password" autoComplete="off" spellCheck={false}
          value={myApiKey} onChange={event => { setMyApiKey(event.target.value); setMyFeedback(null); }}
          placeholder={myConfig?.hasApiKey ? "已保存（留空保持不变）" : "输入独立服务 API Key"} />
      </label>
    </div>
    <div className="ai-settings-actions">
      <button type="button" className="ai-settings-button" disabled={myBusy} onClick={() => void runMyVoice("test")}>测试我的声音连接</button>
      <button type="button" className="ai-settings-button is-primary" disabled={myBusy} onClick={() => void runMyVoice("save")}>保存我的声音服务</button>
      <span className="tts-api-settings-state">{myConfig?.mode === "api" ? "我的声音：已配置" : "我的声音：待配置"}</span>
    </div>
    {myFeedback && <p role="status" className={myFeedback.kind === "error" ? "tts-api-settings-error" : "tts-api-settings-success"}>{myFeedback.text}</p>}
    <p className="settings-help">独立密钥只保存在 Reader 本机服务端，不返回页面。个人克隆音色目前仅配置这一种。</p>
  </section>
  </>;
}
