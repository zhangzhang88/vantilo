import { useCallback, useEffect, useState } from "react";

interface PublicSettings {
  mode: "worker" | "api";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
interface TtsInstallerStatus {
  state: "not-installed" | "downloading" | "extracting" | "verifying" | "installed" | "error" | "unsupported";
  hardware: { supported: boolean; appleSilicon: boolean; memoryGiB: number; reason: string | null };
  mirror: boolean;
  model: {
    id: string;
    displayName: string;
    totalDownloadBytes: number;
    installedDiskBytes: number;
    runtimeVersion: string;
    modelLicense: string;
  };
  disk: { availableBytes: number | null; requiredBytes: number; sufficient: boolean };
  progress: { downloadedBytes: number; totalBytes: number; percent: number; bytesPerSecond: number; phaseLabel: string };
  paths: { binaryPath: string; modelPath: string } | null;
  error: string | null;
}
const DEFAULT_BASE = "http://192.168.3.54:18439/v1";
const DEFAULT_MODEL = "qwen3-tts-0.6b";
const message = (error: unknown) => error instanceof Error ? error.message : "请求失败";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function isInstallerStatus(value: unknown): value is TtsInstallerStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.state === "string" && typeof item.hardware === "object" && item.hardware !== null
    && typeof item.model === "object" && item.model !== null && typeof item.progress === "object" && item.progress !== null;
}

function isInstallerActive(state: TtsInstallerStatus["state"] | undefined): boolean {
  return state === "downloading" || state === "extracting" || state === "verifying";
}

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
  const [installer, setInstaller] = useState<TtsInstallerStatus | null>(null);
  const [installerMirror, setInstallerMirror] = useState(false);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [installerFeedback, setInstallerFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [config, setConfig] = useState<PublicSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const refreshInstaller = useCallback(async () => {
    try {
      const response = await fetch("/api/vantilo-tts-installer/status", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const result: unknown = await response.json();
      if (!isInstallerStatus(result)) return;
      setInstaller(result);
      setInstallerMirror(prev => prev || Boolean(result.mirror));
      if (result.state === "unsupported") setAdvancedOpen(true);
    } catch {
      /* Installer route is optional in standalone Reader mode. */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void refreshInstaller();
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if ((event.data as { type?: unknown }).type === "vantilo:tts-installer-updated") {
        void refreshInstaller();
      }
    };
    const onFocus = () => { void refreshInstaller(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshInstaller(); };
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    void requestApi<PublicSettings>("/api/tts-settings")
      .then(result => {
        if (!alive) return;
        setConfig(result);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
      })
      .catch(error => { if (alive) setFeedback({ kind: "error", text: message(error) }); });
    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshInstaller]);

  useEffect(() => {
    if (!isInstallerActive(installer?.state)) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void fetch("/api/vantilo-tts-installer/status", { headers: { Accept: "application/json" } })
        .then(async response => (response.ok ? response.json() : null))
        .then(result => {
          if (!alive || !isInstallerStatus(result)) return;
          setInstaller(result);
          if (result.state === "installed") {
            setInstallerFeedback({ kind: "success", text: "离线语音模型已安装并校验通过，可直接点击「听中文译文」免费离线听书。" });
            window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
          } else if (result.state === "error" && result.error) {
            setInstallerFeedback({ kind: "error", text: result.error });
          }
        })
        .catch(() => { /* Ignore transient polling failure. */ });
    }, 600);
    return () => { alive = false; window.clearInterval(timer); };
  }, [installer?.state]);

  async function runInstaller(action: "install" | "cancel" | "remove") {
    if (installerBusy) return;
    setInstallerBusy(true); setInstallerFeedback(null); setConfirmRemove(false);
    try {
      const url = action === "install"
        ? "/api/vantilo-tts-installer/install"
        : action === "cancel"
          ? "/api/vantilo-tts-installer/cancel"
          : "/api/vantilo-tts-installer/remove";
      const result = await requestApi<TtsInstallerStatus>(url, {
        method: "POST",
        body: JSON.stringify(action === "install" ? { consent: true, mirror: installerMirror } : {}),
      });
      if (isInstallerStatus(result)) {
        setInstaller(result);
        if (action === "remove") {
          setInstallerFeedback({ kind: "success", text: "已卸载本机离线语音模型并释放磁盘空间。" });
          window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
        } else if (action === "cancel") {
          setInstallerFeedback({ kind: "success", text: "已暂停下载，已下载部分已保留，可随时续传。" });
        } else if (result.state === "installed") {
          setInstallerFeedback({ kind: "success", text: "离线语音模型已安装并就绪。" });
          window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
        }
      }
    } catch (error) {
      setInstallerFeedback({ kind: "error", text: message(error) });
    } finally { setInstallerBusy(false); }
  }

  const draft = () => ({ baseUrl: baseUrl.trim(), model: DEFAULT_MODEL, apiKey: apiKey.trim() });
  async function run(mode: "test" | "save" | "clear") {
    if (busy) return;
    setBusy(true); setFeedback(null); setInstallerFeedback(null);
    try {
      if (mode === "test") {
        await requestApi<{ ok: boolean }>("/api/tts-settings/test", { method: "POST", body: JSON.stringify(draft()) });
        setFeedback({ kind: "success", text: "已连接 Qwen3-TTS 服务，API Key 验证成功" });
      } else if (mode === "clear") {
        const result = await requestApi<PublicSettings>("/api/tts-settings", { method: "DELETE" });
        setConfig(result); setApiKey("");
        window.dispatchEvent(new Event("magazine-reader:tts-profile-updated"));
        const msg = installer?.state === "installed"
          ? "已停用独立 TTS API，现在听书将自动使用本机离线 Qwen3-TTS。"
          : "已停用独立 TTS API。";
        setFeedback({ kind: "success", text: msg });
        if (installer) setInstallerFeedback({ kind: "success", text: msg });
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

  const installerActive = isInstallerActive(installer?.state);
  const installerStateLabel = !installer ? ""
    : installer.state === "installed" ? "已安装并就绪"
    : installer.state === "downloading" ? `下载中 ${installer.progress.percent}%`
    : installer.state === "extracting" ? "正在解压语音引擎…"
    : installer.state === "verifying" ? "正在校验 SHA-256…"
    : installer.state === "unsupported" ? "当前设备不支持"
    : installer.state === "error" ? "下载未完成"
    : installer.progress.downloadedBytes > 0 ? `已暂停（${installer.progress.percent}%）`
    : "未安装";

  return <>
  {installer && (
    <section className="tts-api-settings tts-local-installer" data-testid="local-tts-installer-card">
      <div className="tts-local-installer-header">
        <h3>本机离线听书 · Qwen3-TTS 0.6B（免费）</h3>
        <span className={`tts-local-installer-badge is-${installer.state}`} role="status">{installerStateLabel}</span>
      </div>
      <p className="settings-help">
        无需任何云端费用或 API Key，下载一次即可在 Apple Silicon Mac 上免费离线听书（约 {formatBytes(installer.model.totalDownloadBytes)}，基于 speech.cpp {installer.model.runtimeVersion} 与 {installer.model.modelLicense} 权重，自动校验 SHA-256 并支持断点续传）。
      </p>
      {installer.state === "unsupported" ? (
        <p className="tts-api-settings-error">{installer.hardware.reason}</p>
      ) : (
        <>
          {installerActive && (
            <div className="tts-local-installer-progress">
              <div className="tts-local-installer-bar" role="progressbar" aria-label="本机离线语音下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installer.progress.percent}>
                <span style={{ width: `${installer.progress.percent}%` }} />
              </div>
              <div className="tts-local-installer-meta">
                <span>{installer.progress.phaseLabel || "正在下载…"}</span>
                <span>
                  {formatBytes(installer.progress.downloadedBytes)} / {formatBytes(installer.progress.totalBytes)}
                  {installer.progress.bytesPerSecond > 0 ? ` · ${formatBytes(installer.progress.bytesPerSecond)}/s` : ""}
                </span>
              </div>
            </div>
          )}
          {installer.state !== "installed" && !installerActive && (
            <label className="tts-local-installer-mirror">
              <input type="checkbox" checked={installerMirror} onChange={event => setInstallerMirror(event.target.checked)} />
              <span>使用国内镜像加速模型下载（hf-mirror.com，校验同一 SHA-256）</span>
            </label>
          )}
          <div className="tts-local-installer-actions">
            {installerActive ? (
              <button type="button" className="tts-local-installer-button" disabled={installerBusy} onClick={() => void runInstaller("cancel")}>暂停取消</button>
            ) : installer.state === "installed" ? (
              confirmRemove ? (
                <>
                  <button type="button" className="tts-local-installer-button is-danger" disabled={installerBusy} onClick={() => void runInstaller("remove")}>确认卸载（释放 {formatBytes(installer.model.installedDiskBytes)}）</button>
                  <button type="button" className="tts-local-installer-button" disabled={installerBusy} onClick={() => setConfirmRemove(false)}>取消</button>
                </>
              ) : (
                <button type="button" className="tts-local-installer-button" disabled={installerBusy} onClick={() => setConfirmRemove(true)}>卸载模型释放空间</button>
              )
            ) : (
              <button type="button" className="tts-local-installer-button is-primary" disabled={installerBusy || !installer.disk.sufficient} onClick={() => void runInstaller("install")}>
                {installer.state === "error"
                  ? "重试下载"
                  : installer.progress.downloadedBytes > 0
                    ? "继续断点续传"
                    : "一键下载并启用"}
              </button>
            )}
            <span className="tts-api-settings-state">
              {installer.hardware.appleSilicon ? `Apple Silicon · ${installer.hardware.memoryGiB} GB 内存` : `${installer.hardware.memoryGiB} GB 内存`}
              {installer.state === "installed" ? ` · 占用 ${formatBytes(installer.model.installedDiskBytes)}` : ""}
            </span>
          </div>
          {!installer.disk.sufficient && installer.state !== "installed" && (
            <p className="tts-api-settings-error" role="alert">磁盘可用空间不足，至少需要预留约 {formatBytes(installer.disk.requiredBytes)} 空间。</p>
          )}
        </>
      )}
      {config?.mode === "api" && installer.state === "installed" && (
        <div className="tts-local-installer-override-banner">
          <span>当前优先使用高级独立 TTS API（{config.baseUrl}）；停用后将直接走本机离线模型。</span>
          <button type="button" className="tts-local-installer-button" disabled={busy} onClick={() => void run("clear")}>
            切回本机离线模型
          </button>
        </div>
      )}
      {(installerFeedback || installer.error) && (
        <p role="status" className={(installerFeedback?.kind === "error" || (!installerFeedback && installer.error)) ? "tts-api-settings-error" : "tts-api-settings-success"}>
          {installerFeedback?.text || installer.error}
        </p>
      )}
    </section>
  )}
  {(() => {
    const advancedCards = <>
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
    <div className="tts-local-installer-actions">
      <button type="button" className="tts-local-installer-button" disabled={busy} onClick={() => void run("test")}>测试连接</button>
      <button type="button" className="tts-local-installer-button is-primary" disabled={busy} onClick={() => void run("save")}>保存并使用</button>
      {config?.mode === "api" && (
        <button type="button" className="tts-local-installer-button" disabled={busy} onClick={() => void run("clear")}>停用并切回本机模型</button>
      )}
      <span className="tts-api-settings-state">{config?.mode === "api" ? "当前：独立 API" : installer?.state === "installed" ? "当前：本机离线 Qwen3-TTS" : "当前：本机旧版 Worker"}</span>
    </div>
    {feedback && <p role="status" className={feedback.kind === "error" ? "tts-api-settings-error" : "tts-api-settings-success"}>{feedback.text}</p>}
    <p className="settings-help">API Key 仅交给本机 Reader 服务端保存，不会返回浏览器。当前网关使用局域网 HTTP，请只在可信网络内使用，不要开放公网端口。</p>
  </section>
    </>;
    if (!installer) return advancedCards;
    const summaryHint = config?.mode === "api"
      ? "当前优先使用独立 API"
      : "适用于 Intel Mac 或局域网多机共享";
    return (
      <details
        className="tts-advanced-details"
        data-testid="tts-advanced-details"
        open={advancedOpen}
        onToggle={event => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className="tts-advanced-summary">
          <span>高级：连接局域网 / 独立 TTS 服务</span>
          <span className={`tts-advanced-summary-hint ${config?.mode === "api" ? "is-active" : ""}`}>{summaryHint}</span>
        </summary>
        <div className="tts-advanced-body">{advancedCards}</div>
      </details>
    );
  })()}
  </>;
}
