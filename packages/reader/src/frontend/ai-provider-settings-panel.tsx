import { useEffect, useMemo, useState } from "react";
import type {
  AiProviderProfileDraft,
  AiProviderProfilePublic,
  AiProviderSettingsPublic,
} from "../shared/types";
import {
  activateAiProviderProfile,
  deleteAiProviderProfile,
  discoverAiProviderModels,
  fetchAiProviderSettings,
  saveAiProviderProfile,
  testAiProviderConnection,
} from "./api";

const DEFAULT_RESPONSES_URL = "http://127.0.0.1:8317/v1/responses";

function draftFromProfile(profile?: AiProviderProfilePublic): AiProviderProfileDraft {
  return profile
    ? {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        responsesUrl: profile.responsesUrl,
        model: profile.model,
        apiKey: "",
      }
    : {
        name: "",
        description: "",
        responsesUrl: DEFAULT_RESPONSES_URL,
        model: "",
        apiKey: "",
      };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "操作失败";
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // The server may return plain text instead of JSON.
  }
  return error.message;
}

export function AiProviderSettingsPanel() {
  const [settings, setSettings] = useState<AiProviderSettingsPublic | null>(null);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [draft, setDraft] = useState<AiProviderProfileDraft>(() => draftFromProfile());
  const [showApiKey, setShowApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const selectedProfile = useMemo(
    () => settings?.profiles.find((profile) => profile.id === selectedId),
    [settings, selectedId],
  );
  const isActive = Boolean(selectedProfile && selectedProfile.id === settings?.activeProfileId);

  useEffect(() => {
    let cancelled = false;
    void fetchAiProviderSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        const initial = value.profiles.find((profile) => profile.id === value.activeProfileId) ?? value.profiles[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraft(draftFromProfile(initial));
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus({ kind: "error", text: errorText(error) });
      });
    return () => { cancelled = true; };
  }, []);

  function chooseProfile(id: string) {
    setSelectedId(id);
    setModels([]);
    setStatus(null);
    setShowApiKey(false);
    if (id === "new") {
      const active = settings?.profiles.find((profile) => profile.id === settings.activeProfileId);
      setDraft({
        ...draftFromProfile(),
        responsesUrl: active?.responsesUrl ?? DEFAULT_RESPONSES_URL,
      });
      return;
    }
    setDraft(draftFromProfile(settings?.profiles.find((profile) => profile.id === id)));
  }

  function patchDraft(patch: Partial<AiProviderProfileDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus(null);
  }

  async function runAction<T>(name: string, action: () => Promise<T>): Promise<T | null> {
    setBusy(name);
    setStatus(null);
    try {
      return await action();
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    const result = await runAction("test", () => testAiProviderConnection(draft));
    if (!result) return;
    setStatus(result.ok
      ? { kind: "success", text: `连接成功 · ${result.model}${result.output ? ` · ${result.output}` : ""}` }
      : { kind: "error", text: result.error ?? "连接失败" });
  }

  async function loadModels() {
    const result = await runAction("models", () => discoverAiProviderModels(draft));
    if (!result) return;
    setModels(result.models);
    setStatus({ kind: "success", text: `已获取 ${result.models.length} 个可用模型` });
  }

  async function saveAndActivate() {
    const result = await runAction("save", () => saveAiProviderProfile(draft, true));
    if (!result) return;
    setSettings(result);
    const profile = result.profiles.find((candidate) => candidate.id === result.savedProfileId);
    if (profile) {
      setSelectedId(profile.id);
      setDraft(draftFromProfile(profile));
    }
    setShowApiKey(false);
    setStatus({ kind: "success", text: `已保存并切换到 ${profile?.name ?? "新 AI 配置"}` });
  }

  async function activateSelected() {
    if (!selectedProfile) return;
    const result = await runAction("activate", () => activateAiProviderProfile(selectedProfile.id));
    if (!result) return;
    setSettings(result);
    setStatus({ kind: "success", text: `当前 AI 已切换到 ${selectedProfile.name}` });
  }

  async function removeSelected() {
    if (!selectedProfile) return;
    if (!window.confirm(`删除 AI 配置“${selectedProfile.name}”？`)) return;
    const result = await runAction("delete", () => deleteAiProviderProfile(selectedProfile.id));
    if (!result) return;
    setSettings(result);
    const next = result.profiles.find((profile) => profile.id === result.activeProfileId) ?? result.profiles[0];
    if (next) {
      setSelectedId(next.id);
      setDraft(draftFromProfile(next));
    } else {
      setSelectedId("new");
      setDraft(draftFromProfile());
    }
    setModels([]);
    setStatus({ kind: "success", text: "AI 配置已删除" });
  }

  return (
    <section className="settings-card ai-provider-settings-card" data-testid="ai-provider-settings">
      <div className="settings-card-heading">
        <div><span>AI Service</span><h2>AI 服务</h2></div>
        <small>保存多个 Responses-compatible 配置，随时在 GPT、Gemini 或其他 EasyCLIProxy 模型之间切换。</small>
      </div>

      <div className="ai-profile-toolbar">
        <label className="ai-field ai-profile-picker">
          <span>配置</span>
          <select
            aria-label="AI 配置"
            value={selectedId}
            onChange={(event) => chooseProfile(event.target.value)}
            disabled={busy !== null}
          >
            {settings?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id === settings.activeProfileId ? "● " : ""}{profile.name}
              </option>
            ))}
            <option value="new">＋ 新增 AI 配置</option>
          </select>
        </label>
        <div className="ai-profile-state">
          {selectedProfile && isActive && <span className="ai-active-badge">当前使用</span>}
          {selectedProfile && !isActive && (
            <button className="ai-settings-button" type="button" onClick={() => void activateSelected()} disabled={busy !== null}>
              设为当前
            </button>
          )}
        </div>
      </div>

      <div className="ai-settings-form">
        <label className="ai-field">
          <span>名称</span>
          <input
            aria-label="AI 配置名称"
            value={draft.name}
            onChange={(event) => patchDraft({ name: event.target.value })}
            placeholder="例如：EasyCLIProxy - Gemini"
          />
        </label>
        <label className="ai-field">
          <span>描述</span>
          <input
            aria-label="AI 配置描述"
            value={draft.description}
            onChange={(event) => patchDraft({ description: event.target.value })}
            placeholder="例如：Gemini Flash / 网页翻译"
          />
        </label>
        <label className="ai-field ai-field-wide">
          <span>Responses URL</span>
          <input
            aria-label="AI Responses URL"
            value={draft.responsesUrl}
            onChange={(event) => patchDraft({ responsesUrl: event.target.value })}
            placeholder={DEFAULT_RESPONSES_URL}
            spellCheck={false}
          />
        </label>
        <label className="ai-field ai-field-wide">
          <span>API Key</span>
          <div className="ai-api-key-row">
            <input
              aria-label="AI API Key"
              type={showApiKey ? "text" : "password"}
              value={draft.apiKey ?? ""}
              onChange={(event) => patchDraft({ apiKey: event.target.value })}
              placeholder={selectedProfile?.hasApiKey ? "已安全保存在本机；留空表示不修改" : "输入 API Key"}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="ai-settings-button" onClick={() => setShowApiKey((value) => !value)}>
              {showApiKey ? "隐藏输入" : "显示输入"}
            </button>
          </div>
          <small>完整 API Key 只保存在本机 Fastify 私有配置中，不会返回浏览器。这里显示的仅是新输入内容。</small>
        </label>
        <label className="ai-field ai-field-wide">
          <span>模型</span>
          <div className="ai-model-row">
            <input
              aria-label="AI 模型"
              list="ai-provider-models"
              value={draft.model}
              onChange={(event) => patchDraft({ model: event.target.value })}
              placeholder="例如：gpt-6-luna 或 gemini-3.1-flash-lite"
              spellCheck={false}
            />
            <button type="button" className="ai-settings-button" onClick={() => void loadModels()} disabled={busy !== null}>
              {busy === "models" ? "正在获取…" : "获取可用模型"}
            </button>
          </div>
          <datalist id="ai-provider-models">
            {models.map((model) => <option key={model} value={model} />)}
          </datalist>
          {models.length > 0 && <small className="ai-model-hint">已加载 {models.length} 个模型，可直接输入筛选。</small>}
        </label>
      </div>

      {status && <div className={`ai-connection-status is-${status.kind}`} role="status">{status.text}</div>}

      <div className="ai-settings-actions">
        <button type="button" className="ai-settings-button" onClick={() => void testConnection()} disabled={busy !== null}>
          {busy === "test" ? "测试中…" : "测试连接"}
        </button>
        <button type="button" className="ai-settings-button is-primary" onClick={() => void saveAndActivate()} disabled={busy !== null}>
          {busy === "save" ? "保存中…" : "保存并应用"}
        </button>
        {selectedProfile && (
          <button type="button" className="ai-settings-button is-danger" onClick={() => void removeSelected()} disabled={busy !== null}>
            删除配置
          </button>
        )}
      </div>
    </section>
  );
}
