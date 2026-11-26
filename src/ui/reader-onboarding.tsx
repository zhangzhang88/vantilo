import React from 'react';
import { detectOfficialApiProvider, formatApiTargetHost, type CustomApiProviderKind as ApiProviderKind } from '../../packages/reader/src/shared/custom-api-provider';
import './reader-onboarding.css';

export type ReaderSetupCheck = {
  dictionary: 'bilingual' | 'english-only' | 'unavailable';
  hardware: { appleSilicon: boolean; memoryGiB: number };
  localAi: 'not-integrated';
};
export type TtsInstallStatus = {
  state: 'not-installed' | 'downloading' | 'extracting' | 'verifying' | 'installed' | 'error' | 'unsupported';
  hardware: { supported: boolean; appleSilicon: boolean; memoryGiB: number; reason: string | null };
  mirror: boolean;
  model: { id: string; displayName: string; totalDownloadBytes: number; installedDiskBytes: number; runtimeVersion: string; modelLicense: string };
  disk: { availableBytes: number | null; requiredBytes: number; sufficient: boolean };
  progress: { downloadedBytes: number; totalBytes: number; percent: number; bytesPerSecond: number; phaseLabel: string };
  paths: { binaryPath: string; modelPath: string } | null;
  error: string | null;
};
export type OnboardingCustomApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  credentialStatus?: string;
};
export type OnboardingCustomApiSettings = OnboardingCustomApiProfile & {
  configured: boolean;
  profiles: OnboardingCustomApiProfile[];
  activeId: string;
};
export type OnboardingCustomApiDraft = {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};
type ReaderSetupApi = {
  checkReaderSetup: () => Promise<ReaderSetupCheck>;
  openDictionaryApp: () => Promise<{ opened: boolean; error?: string }>;
  getTtsInstallStatus?: () => Promise<TtsInstallStatus>;
  installTtsModel?: (options: { consent: true; mirror?: boolean }) => Promise<TtsInstallStatus>;
  cancelTtsInstall?: () => Promise<TtsInstallStatus>;
  removeTtsModel?: () => Promise<TtsInstallStatus>;
  getCustomApiSettings?: () => Promise<OnboardingCustomApiSettings>;
  saveCustomApiSettings?: (config: OnboardingCustomApiDraft) => Promise<OnboardingCustomApiSettings>;
  testCustomApiSettings?: (config: OnboardingCustomApiDraft) => Promise<{ ok?: boolean; message?: string }>;
  listCustomApiModels?: (config: Partial<OnboardingCustomApiDraft> & { baseUrl: string }) => Promise<{ models: string[] }>;
};

const API_PROVIDER_PRESETS: Record<Exclude<ApiProviderKind, 'custom'>, {
  tabLabel: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  hint: string;
  models: ReadonlyArray<{ id: string; label: string }>;
}> = {
  deepseek: {
    tabLabel: 'DeepSeek（国内直连）',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    hint: '已内置官方地址 https://api.deepseek.com/v1，国内直连无需代理；填好 API Key 后可点击「拉取模型列表」获取最新型号。',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat（推荐 · V3 通用翻译）' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner（R1 深度推理）' },
    ],
  },
  gemini: {
    tabLabel: 'Gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    hint: '已内置 Google Gemini OpenAI 兼容地址，需确保网络可访问 Google；填好 API Key 后可点击「拉取模型列表」同步账号下全部最新模型。',
    models: [
      { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash（推荐 · 最新高速主力）' },
      { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite（轻量省额 · 低延迟）' },
      { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview（Pro 深度理解）' },
    ],
  },
};

function cleanIpcError(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error) || !reason.message) return fallback;
  return reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim() || fallback;
}

const detectApiProvider = detectOfficialApiProvider;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function isTtsActiveState(state: TtsInstallStatus['state'] | undefined): boolean {
  return state === 'downloading' || state === 'extracting' || state === 'verifying';
}

export function ReaderOnboarding({ api, onDismiss }: {
  api: ReaderSetupApi;
  onDismiss: (decision: 'finished' | 'skipped') => Promise<void>;
  onStartReader?: () => Promise<void>;
}) {
  const [status, setStatus] = React.useState<ReaderSetupCheck | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [ttsStatus, setTtsStatus] = React.useState<TtsInstallStatus | null>(null);
  const [ttsMirror, setTtsMirror] = React.useState(false);
  const [ttsBusy, setTtsBusy] = React.useState(false);
  const [ttsError, setTtsError] = React.useState('');
  const [customApi, setCustomApi] = React.useState<OnboardingCustomApiSettings | null>(null);
  const [apiFormOpen, setApiFormOpen] = React.useState(false);
  const [apiProfileId, setApiProfileId] = React.useState('');
  const [apiProvider, setApiProvider] = React.useState<ApiProviderKind>('deepseek');
  const [apiName, setApiName] = React.useState<string>(API_PROVIDER_PRESETS.deepseek.name);
  const [apiBaseUrl, setApiBaseUrl] = React.useState<string>(API_PROVIDER_PRESETS.deepseek.baseUrl);
  const [apiModel, setApiModel] = React.useState<string>(API_PROVIDER_PRESETS.deepseek.defaultModel);
  const [apiCustomModelInput, setApiCustomModelInput] = React.useState(false);
  const [apiFetchedModels, setApiFetchedModels] = React.useState<string[]>([]);
  const [apiFetchingModels, setApiFetchingModels] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [apiBusy, setApiBusy] = React.useState(false);
  const [apiMessage, setApiMessage] = React.useState('');
  const [apiError, setApiError] = React.useState('');
  const dialogRef = React.useRef<HTMLElement>(null);
  const savedFocus = React.useRef<HTMLElement | null>(null);
  const hasTtsInstaller = typeof api.getTtsInstallStatus === 'function';
  const hasCustomApi = typeof api.getCustomApiSettings === 'function' && typeof api.saveCustomApiSettings === 'function';

  const check = React.useCallback(async () => {
    setBusy(true); setError('');
    try { setStatus(await api.checkReaderSetup()); }
    catch { setStatus(null); setError('检测阅读环境失败，可以继续使用应用，稍后再试。'); }
    finally { setBusy(false); }
  }, [api]);

  const refreshTts = React.useCallback(async () => {
    if (!api.getTtsInstallStatus) return;
    try {
      const next = await api.getTtsInstallStatus();
      setTtsStatus(next);
      setTtsMirror(prev => prev || Boolean(next.mirror));
    } catch {
      /* ignore transient status poll error */
    }
  }, [api]);

  const refreshCustomApi = React.useCallback(async () => {
    if (!api.getCustomApiSettings) return;
    try {
      const next = await api.getCustomApiSettings();
      setCustomApi(next);
      if (next.configured) {
        const kind = detectApiProvider(next.baseUrl);
        setApiProfileId(next.id || '');
        setApiProvider(kind);
        setApiName(next.name);
        setApiBaseUrl(next.baseUrl);
        setApiModel(next.model);
        if (kind !== 'custom') {
          setApiCustomModelInput(!API_PROVIDER_PRESETS[kind].models.some(item => item.id === next.model));
        }
      }
    } catch {
      /* ignore transient custom api read error */
    }
  }, [api]);

  React.useEffect(() => {
    savedFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    void check();
    void refreshTts();
    void refreshCustomApi();
    return () => { if (savedFocus.current?.isConnected) savedFocus.current.focus(); };
  }, [check, refreshTts, refreshCustomApi]);

  React.useEffect(() => {
    if (!hasTtsInstaller || !isTtsActiveState(ttsStatus?.state)) return;
    const timer = window.setInterval(() => { void refreshTts(); }, 600);
    return () => window.clearInterval(timer);
  }, [hasTtsInstaller, ttsStatus?.state, refreshTts]);

  async function openDictionary() {
    try { const result = await api.openDictionaryApp(); if (!result.opened) setError(result.error || '未能打开系统词典，请手动打开「词典」App。'); }
    catch { setError('未能打开系统词典，请手动打开「词典」App。'); }
  }

  async function startTtsInstall() {
    if (!api.installTtsModel || ttsBusy) return;
    setTtsBusy(true); setTtsError('');
    try {
      const next = await api.installTtsModel({ consent: true, mirror: ttsMirror });
      setTtsStatus(next);
    } catch (reason) {
      setTtsError(reason instanceof Error ? reason.message : '无法开始下载离线语音模型');
    } finally { setTtsBusy(false); }
  }

  async function cancelTtsInstall() {
    if (!api.cancelTtsInstall || ttsBusy) return;
    setTtsBusy(true); setTtsError('');
    try {
      const next = await api.cancelTtsInstall();
      setTtsStatus(next);
    } catch (reason) {
      setTtsError(reason instanceof Error ? reason.message : '取消下载失败');
    } finally { setTtsBusy(false); }
  }

  async function removeTtsModel() {
    if (!api.removeTtsModel || ttsBusy) return;
    setTtsBusy(true); setTtsError('');
    try {
      const next = await api.removeTtsModel();
      setTtsStatus(next);
    } catch (reason) {
      setTtsError(reason instanceof Error ? reason.message : '卸载离线语音模型失败');
    } finally { setTtsBusy(false); }
  }

  function selectApiProvider(kind: ApiProviderKind) {
    setApiProvider(kind);
    setApiFetchedModels([]);
    setApiCustomModelInput(false);
    setApiError('');
    setApiMessage('');
    setApiKey('');
    const savedList = customApi?.profiles ?? [];
    if (kind === 'custom') {
      const existingCustom = savedList.find(item => item.id === customApi?.activeId && detectApiProvider(item.baseUrl) === 'custom')
        ?? savedList.find(item => detectApiProvider(item.baseUrl) === 'custom');
      if (existingCustom) {
        setApiProfileId(existingCustom.id);
        setApiName(existingCustom.name);
        setApiBaseUrl(existingCustom.baseUrl);
        setApiModel(existingCustom.model);
      } else {
        setApiProfileId('');
        setApiName('');
        setApiBaseUrl('');
        setApiModel('');
      }
      return;
    }
    const preset = API_PROVIDER_PRESETS[kind];
    const existing = savedList.find(item => detectApiProvider(item.baseUrl) === kind);
    if (existing) {
      setApiProfileId(existing.id);
      setApiName(existing.name);
      setApiBaseUrl(existing.baseUrl);
      setApiModel(existing.model);
      setApiCustomModelInput(!preset.models.some(item => item.id === existing.model));
    } else {
      setApiProfileId('');
      setApiName(preset.name);
      setApiBaseUrl(preset.baseUrl);
      setApiModel(preset.defaultModel);
    }
  }

  async function fetchLiveModels() {
    if (!api.listCustomApiModels || apiFetchingModels || !apiBaseUrl.trim()) return;
    setApiFetchingModels(true); setApiError(''); setApiMessage('');
    try {
      const normalizedUrl = apiBaseUrl.trim().replace(/\/+$/, '');
      const matchingProfile = (customApi?.profiles ?? []).find(item => item.id === apiProfileId && item.baseUrl === normalizedUrl);
      const result = await api.listCustomApiModels({
        ...(matchingProfile ? { id: matchingProfile.id } : {}),
        baseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
      });
      const list = Array.isArray(result?.models) ? result.models : [];
      setApiFetchedModels(list);
      setApiCustomModelInput(false);
      if (list.length && !list.includes(apiModel.trim())) {
        setApiModel(list[0]);
      }
      setApiMessage(`已拉取 ${list.length} 个当前可用模型，可在下拉框中直接选择。`);
    } catch (reason) {
      setApiError(cleanIpcError(reason, '拉取模型列表失败，请先填好 API Key 或检查网络'));
    } finally { setApiFetchingModels(false); }
  }

  async function runCustomApi(mode: 'test' | 'save') {
    if (apiBusy) return;
    const normalizedUrl = apiBaseUrl.trim().replace(/\/+$/, '');
    const matchingProfile = (customApi?.profiles ?? []).find(item => item.id === apiProfileId && item.baseUrl === normalizedUrl);
    const hasSavedProfiles = (customApi?.profiles?.length ?? 0) > 0;
    const draft: OnboardingCustomApiDraft = {
      ...(matchingProfile ? { id: matchingProfile.id } : (mode === 'save' && hasSavedProfiles ? { id: '' } : {})),
      name: apiName.trim(),
      baseUrl: apiBaseUrl.trim(),
      model: apiModel.trim(),
      apiKey: apiKey.trim(),
    };
    setApiBusy(true); setApiError(''); setApiMessage('');
    try {
      if (mode === 'test') {
        if (!api.testCustomApiSettings) return;
        const result = await api.testCustomApiSettings(draft);
        setApiMessage(result?.message || '连接成功，API Key 与模型可用。');
      } else {
        if (!api.saveCustomApiSettings) return;
        const saved = await api.saveCustomApiSettings(draft);
        setCustomApi(saved);
        setApiProfileId(saved.id || '');
        setApiName(saved.name);
        setApiBaseUrl(saved.baseUrl);
        setApiModel(saved.model);
        setApiKey('');
        setApiMessage('已安全保存 AI 模型服务，翻译与语境释义现已就绪。');
      }
    } catch (reason) {
      setApiError(cleanIpcError(reason, mode === 'test' ? 'API 连接失败，请检查地址、模型或密钥' : '保存自定义 API 失败'));
    } finally { setApiBusy(false); }
  }

  const ttsActive = isTtsActiveState(ttsStatus?.state);
  const ttsBadge = !ttsStatus
    ? '检测中'
    : ttsStatus.state === 'installed'
      ? '已安装并就绪'
      : ttsStatus.state === 'downloading'
        ? `下载中 ${ttsStatus.progress.percent}%`
        : ttsStatus.state === 'extracting'
          ? '正在解压引擎'
          : ttsStatus.state === 'verifying'
            ? '正在校验完整性'
            : ttsStatus.state === 'unsupported'
              ? '当前设备不支持'
              : ttsStatus.state === 'error'
                ? '下载未完成'
                : ttsStatus.progress.downloadedBytes > 0
                  ? `已暂停 ${ttsStatus.progress.percent}%`
                  : '未安装（可选）';

  return <div className="reader-onboarding-backdrop">
    <section ref={dialogRef} tabIndex={-1} className="reader-onboarding" role="dialog" aria-modal="true" aria-labelledby="reader-setup-title"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); void onDismiss('skipped'); return; }
        if (event.key !== 'Tab') return;
        const focusables = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
        const first=focusables[0],last=focusables.at(-1);
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="reader-onboarding-heading"><span className="reader-onboarding-eyebrow">VANTILO · READING</span><h2 id="reader-setup-title">阅读环境设置</h2><p>{hasTtsInstaller ? '检查系统词典、配置免费离线听书引擎，并了解翻译服务。' : '检查系统词典，并选择适合自己的翻译服务。'}</p></div>
      <div className="reader-onboarding-step">
        <div className="reader-onboarding-step-title"><strong>macOS 系统词典</strong><small role="status">{busy ? '检测中' : !status ? '尚未检测' : status.dictionary === 'bilingual' ? '已检测到中文释义' : status.dictionary === 'english-only' ? '只有英文释义' : '未检测到可用词条'}</small></div>
        <p>{status?.dictionary === 'bilingual' ? '现在可以在阅读时使用本机英汉词典。' : '可在 Mac「词典」App 的设置中启用英汉词典，然后返回重新检测。'}</p>
        <div className="reader-onboarding-actions"><button type="button" onClick={() => void openDictionary()}>打开系统词典</button><button type="button" onClick={() => void check()} disabled={busy}>重新检测</button></div>
      </div>
      <div className="reader-onboarding-step" data-testid="onboarding-custom-api-step">
        <div className="reader-onboarding-step-title">
          <strong>翻译和语境解释</strong>
          {hasCustomApi && (
            <small role="status">{customApi?.configured ? `已配置（${customApi.name}）` : '未配置（可选）'}</small>
          )}
        </div>
        <p>在阅读设置的「AI 模型服务」中添加 DeepSeek、Gemini 或局域网模型服务。</p>
        {hasCustomApi && (
          <>
            <div className="reader-onboarding-actions">
              <button
                type="button"
                onClick={() => {
                  setApiFormOpen(open => !open);
                  setApiError('');
                  setApiMessage('');
                }}
              >
                {apiFormOpen ? '收起配置' : customApi?.configured ? '修改 AI 模型服务' : '配置 AI 模型服务'}
              </button>
            </div>
            {apiFormOpen && (() => {
              const preset = apiProvider === 'custom' ? null : API_PROVIDER_PRESETS[apiProvider];
              const presetIds = preset ? preset.models.map(item => item.id) : [];
              const mergedModelOptions: Array<{ id: string; label: string }> = [
                ...(preset ? preset.models : []),
                ...apiFetchedModels.filter(id => !presetIds.includes(id)).map(id => ({ id, label: id })),
              ];
              const currentModelInList = mergedModelOptions.some(item => item.id === apiModel);
              const selectValue = apiCustomModelInput || (!currentModelInList && apiModel) ? '__custom__' : (apiModel || mergedModelOptions[0]?.id || '');
              return (
              <div className="reader-onboarding-api-panel" data-testid="onboarding-custom-api-form">
                <div className="reader-onboarding-provider-tabs" role="tablist" aria-label="选择模型服务商">
                  {(['deepseek', 'gemini', 'custom'] as const).map(kind => (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={apiProvider === kind}
                      className={`reader-onboarding-provider-tab ${apiProvider === kind ? 'is-active' : ''}`}
                      onClick={() => selectApiProvider(kind)}
                    >
                      {kind === 'custom' ? '其他兼容 API / 局域网' : API_PROVIDER_PRESETS[kind].tabLabel}
                    </button>
                  ))}
                </div>
                {preset && <p className="reader-onboarding-api-hint">{preset.hint}</p>}
                <div className="reader-onboarding-api-grid">
                  {apiProvider === 'custom' && (
                    <>
                      <label className="reader-onboarding-api-field">
                        <span>服务名称</span>
                        <input
                          aria-label="自定义 API 服务名称"
                          value={apiName}
                          maxLength={80}
                          placeholder="例如 Ollama、书房服务器"
                          onChange={event => { setApiName(event.target.value); setApiError(''); }}
                        />
                      </label>
                      <label className="reader-onboarding-api-field">
                        <span>API 地址</span>
                        <input
                          aria-label="自定义 API 地址"
                          type="url"
                          spellCheck={false}
                          value={apiBaseUrl}
                          maxLength={2048}
                          placeholder="https://api.example.com/v1 或 http://127.0.0.1:11434/v1"
                          onChange={event => { setApiBaseUrl(event.target.value); setApiError(''); }}
                        />
                      </label>
                    </>
                  )}
                  <label className="reader-onboarding-api-field is-wide">
                    <span>
                      {preset ? `${preset.name} API Key` : 'API Key'}
                      {formatApiTargetHost(apiBaseUrl) && <small> · 目标主机：{formatApiTargetHost(apiBaseUrl)}</small>}
                    </span>
                    <input
                      aria-label="自定义 API Key"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={apiKey}
                      maxLength={4096}
                      placeholder={(customApi?.profiles ?? []).some(item => item.id === apiProfileId && item.hasApiKey && item.baseUrl === apiBaseUrl.trim().replace(/\/+$/, '')) ? '已保存密钥；留空表示保留' : preset ? `粘贴你的 ${preset.name} API Key` : '输入 API Key（局域网服务可留空）'}
                      onChange={event => { setApiKey(event.target.value); setApiError(''); }}
                    />
                  </label>
                  <div className="reader-onboarding-api-field is-wide">
                    <span>模型名称</span>
                    <div className="reader-onboarding-model-row">
                      {mergedModelOptions.length > 0 ? (
                        <select
                          aria-label="自定义 API 模型选择"
                          value={selectValue}
                          onChange={event => {
                            const chosen = event.target.value;
                            if (chosen === '__custom__') {
                              setApiCustomModelInput(true);
                            } else {
                              setApiCustomModelInput(false);
                              setApiModel(chosen);
                            }
                            setApiError('');
                          }}
                        >
                          {mergedModelOptions.map(item => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                          <option value="__custom__">手动输入其他模型名…</option>
                        </select>
                      ) : (
                        <input
                          aria-label="自定义 API 模型名称"
                          value={apiModel}
                          maxLength={256}
                          placeholder="例如 qwen3、gpt-4o-mini"
                          onChange={event => { setApiModel(event.target.value); setApiError(''); }}
                        />
                      )}
                      {api.listCustomApiModels && (
                        <button
                          type="button"
                          disabled={apiFetchingModels || apiBusy || !apiBaseUrl.trim()}
                          onClick={() => void fetchLiveModels()}
                        >
                          {apiFetchingModels ? '拉取中…' : '拉取模型列表'}
                        </button>
                      )}
                    </div>
                    {mergedModelOptions.length > 0 && (apiCustomModelInput || (!currentModelInList && apiModel)) && (
                      <input
                        aria-label="自定义 API 模型名称"
                        value={apiModel}
                        maxLength={256}
                        placeholder="输入完整模型 ID"
                        onChange={event => { setApiModel(event.target.value); setApiError(''); }}
                      />
                    )}
                  </div>
                </div>
                <div className="reader-onboarding-actions">
                  {api.testCustomApiSettings && (
                    <button type="button" disabled={apiBusy || !apiName.trim() || !apiBaseUrl.trim() || !apiModel.trim()} onClick={() => void runCustomApi('test')}>
                      {apiBusy ? '处理中…' : '测试连接'}
                    </button>
                  )}
                  <button type="button" className="reader-onboarding-primary" disabled={apiBusy || !apiName.trim() || !apiBaseUrl.trim() || !apiModel.trim()} onClick={() => void runCustomApi('save')}>
                    {apiBusy ? '正在保存…' : '保存并使用'}
                  </button>
                </div>
                {apiMessage && <p className="reader-onboarding-success" role="status">{apiMessage}</p>}
                {apiError && <p className="reader-onboarding-error" role="alert">{apiError}</p>}
              </div>
              );
            })()}
          </>
        )}
      </div>
      {hasTtsInstaller && (
        <div className="reader-onboarding-step" data-testid="onboarding-tts-step">
          <div className="reader-onboarding-step-title">
            <strong>本地离线听书（Qwen3-TTS 0.6B）</strong>
            <small role="status">{ttsBadge}</small>
          </div>
          {ttsStatus?.state === 'unsupported' ? (
            <p>{ttsStatus.hardware.reason}</p>
          ) : ttsStatus?.state === 'installed' ? (
            <>
              <p>离线语音模型已安装在本机（约 {formatBytes(ttsStatus.model.installedDiskBytes)}），支持免费离线听书，无需配置 API Key。</p>
              <div className="reader-onboarding-actions">
                <button type="button" onClick={() => void removeTtsModel()} disabled={ttsBusy}>卸载释放空间</button>
              </div>
            </>
          ) : (
            <>
              <p>
                下载一次即可在本机免费离线听书（约 {formatBytes(ttsStatus?.model.totalDownloadBytes ?? 1219622221)}，自动校验 SHA-256，支持断点续传；也可稍后在「设置 → 本地 TTS 服务」安装）。
              </p>
              {ttsActive && ttsStatus && (
                <div className="reader-onboarding-tts-progress">
                  <div className="reader-onboarding-tts-bar" role="progressbar" aria-label="离线语音模型下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ttsStatus.progress.percent}>
                    <span style={{ width: `${ttsStatus.progress.percent}%` }} />
                  </div>
                  <div className="reader-onboarding-tts-meta">
                    <span>{ttsStatus.progress.phaseLabel || '正在下载…'}</span>
                    <span>
                      {formatBytes(ttsStatus.progress.downloadedBytes)} / {formatBytes(ttsStatus.progress.totalBytes)}
                      {ttsStatus.progress.bytesPerSecond > 0 ? ` · ${formatBytes(ttsStatus.progress.bytesPerSecond)}/s` : ''}
                    </span>
                  </div>
                </div>
              )}
              {!ttsActive && (
                <label className="reader-onboarding-tts-mirror">
                  <input type="checkbox" checked={ttsMirror} onChange={event => setTtsMirror(event.target.checked)} />
                  <span>使用国内镜像加速模型下载（hf-mirror.com，校验同一 SHA-256）</span>
                </label>
              )}
              <div className="reader-onboarding-actions">
                {ttsActive ? (
                  <button type="button" onClick={() => void cancelTtsInstall()} disabled={ttsBusy}>暂停取消</button>
                ) : (
                  <button type="button" className="reader-onboarding-primary" onClick={() => void startTtsInstall()} disabled={ttsBusy || !ttsStatus || !ttsStatus.disk.sufficient}>
                    {ttsStatus?.state === 'error'
                      ? '重试下载'
                      : (ttsStatus?.progress.downloadedBytes ?? 0) > 0
                        ? '继续断点续传'
                        : '一键下载并启用'}
                  </button>
                )}
              </div>
              {ttsStatus && !ttsStatus.disk.sufficient && (
                <p className="reader-onboarding-error" role="alert">磁盘可用空间不足，至少需要预留约 {formatBytes(ttsStatus.disk.requiredBytes)} 空间。</p>
              )}
            </>
          )}
          {(ttsError || ttsStatus?.error) && (
            <p className="reader-onboarding-error" role="alert">{ttsError || ttsStatus?.error}</p>
          )}
        </div>
      )}
      {error && <p className="reader-onboarding-error" role="alert">{error}</p>}
      <div className="reader-onboarding-footer"><button type="button" onClick={() => void onDismiss('skipped')}>稍后设置</button><button type="button" className="reader-onboarding-primary" onClick={() => void onDismiss('finished')}>完成</button></div>
    </section>
  </div>;
}
